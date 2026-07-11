"""SynCo v2.0 — SaaS Multiproyecto para reportes de obra.

Arquitectura:
- Coordinador General (god mode): único que crea proyectos, árbol de nodos,
  áreas e invitaciones.
- Sub-Coordinador: scope_node_id (un nodo del árbol; ve todo lo que cuelga).
- Especialista: area + puesto + scope_node_ids (hojas autorizadas a capturar).
- Sin auto-registro. Acceso 100% por token de invitación.
"""
import os
import re
import io
import uuid
import logging
import secrets
import asyncio
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal
try:
    from zoneinfo import ZoneInfo  # Python 3.9+
    MX_TZ = ZoneInfo("America/Mexico_City")
except Exception:  # pragma: no cover
    MX_TZ = timezone(timedelta(hours=-6))  # fallback CST

import jwt
import bcrypt
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "10080"))
BOOTSTRAP_SECRET = os.environ.get("BOOTSTRAP_SECRET", "synco_bootstrap_2026_change_me")
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="SynCo v2.0 API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("synco")


# Handler temporal para diagnosticar 422 (validation errors). Registra el
# path y los errores exactos que Pydantic devuelve para que sea trivial
# depurar payloads inválidos desde el frontend.
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def _log_422(request, exc: RequestValidationError):
    try:
        body_len = 0
        try:
            _b = await request.body()
            body_len = len(_b or b"")
        except Exception:
            body_len = -1
        # Sólo registramos loc/msg/type (no el input crudo, que puede
        # contener imágenes base64 gigantes). Suficiente para diagnóstico.
        compact = [
            {"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")}
            for e in (exc.errors() or [])
        ]
        log.warning(
            "[422] path=%s body_bytes=%d errors=%s",
            request.url.path, body_len, compact,
        )
    except Exception as _e:
        log.warning("[422 handler] logging failed: %s", _e)
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


# === Constants =============================================================
ROLE_COORD = "coordinador_general"
ROLE_JEFE = "jefe_proyecto"  # Jefe de Proyecto: lectura global (read-only)
ROLE_SUB = "sub_coordinador"
ROLE_ESPECIALISTA = "especialista"
VALID_ROLES = {ROLE_COORD, ROLE_JEFE, ROLE_SUB, ROLE_ESPECIALISTA}
# Roles que sólo pueden LEER (no escribir / crear / editar nada).
READ_ONLY_ROLES = {ROLE_JEFE}


def _assert_write_allowed(user: dict) -> None:
    """Bloquea operaciones de escritura para roles de sólo lectura.
    Llama esta función al inicio de cualquier endpoint POST/PUT/PATCH/DELETE
    que use `current_user` directamente (sin `require_role`)."""
    if user.get("role") in READ_ONLY_ROLES:
        raise HTTPException(403, "Tu rol es solo de lectura; no puedes realizar esta acción")

MEASUREMENT_TYPES = {"coord_latlon", "cadenamiento", "eje", "nivel"}


def _sanitize_reference_files(items) -> list:
    """Valida y limpia la lista de archivos de referencia.
    Espera una lista de dicts con 'name' y 'url'.
    Descarta entradas vacías o malformadas. Máximo 50 elementos."""
    if not items or not isinstance(items, list):
        return []
    cleaned = []
    for it in items[:50]:
        if not isinstance(it, dict):
            continue
        name = (it.get("name") or "").strip()
        url = (it.get("url") or "").strip()
        if not name or not url:
            continue
        # Limitar tamaños para evitar payloads abusivos
        cleaned.append({"name": name[:200], "url": url[:1000]})
    return cleaned

# Colecciones del esquema v2
COLLECTIONS_V2 = ["users", "projects", "location_nodes", "areas", "invitations", "reports", "announcements", "messages", "events", "channels"]

# Colecciones legacy a eliminar en startup
COLLECTIONS_LEGACY = [
    "activities", "reference_points", "chat_messages", "chat_areas", "chat_area_messages",
    "events", "documents", "site_config", "report_history",
]


# === Models =================================================================
class Token(BaseModel):
    token: str
    user: dict


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class BootstrapIn(BaseModel):
    secret: str
    email: EmailStr
    password: str
    name: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: str
    area: Optional[str] = None
    puesto: Optional[str] = None
    scope_node_id: Optional[str] = None
    scope_node_ids: List[str] = Field(default_factory=list)
    project_ids: List[str] = Field(default_factory=list)
    expo_push_tokens: List[str] = Field(default_factory=list)
    created_at: datetime


class PushTokenIn(BaseModel):
    """Payload del cliente Expo para registrar / des-registrar un push token."""
    token: str
    platform: Optional[str] = None  # 'ios' | 'android' | 'web' (informativo)


class ProjectIn(BaseModel):
    name: str
    constructora: str
    contract_number: str
    objeto_contrato: Optional[str] = None  # Descripción institucional del objeto del contrato
    cliente_principal: Optional[str] = None  # Cliente / dependencia que contrata (aparece en portada)
    color_tema: Optional[str] = None  # Color institucional del proyecto (#RRGGBB). Default #003366
    report_text_color: Optional[str] = None  # Color del pie de foto en reportes ejecutivos (#RRGGBB). Default #0F172A
    start_date: Optional[str] = None  # ISO date "2026-01-15"
    end_date: Optional[str] = None
    description: Optional[str] = None
    reference_files: Optional[List[dict]] = None  # [{"name": str, "url": str}]
    contratistas_list: Optional[List[str]] = None  # Catálogo dinámico de contratistas
    contratos_list: Optional[List[str]] = None  # Catálogo dinámico de números de contrato
    categorias_personal: Optional[List[str]] = None  # Catálogo de categorías de personal
    categorias_equipo: Optional[List[str]] = None  # Catálogo de categorías de equipo
    constructora_logo: Optional[str] = None  # Base64 (data URI o crudo) del logo institucional


class ProjectPatch(BaseModel):
    """PUT parcial — todos los campos opcionales. No exige name/constructora/contract_number."""
    name: Optional[str] = None
    constructora: Optional[str] = None
    contract_number: Optional[str] = None
    objeto_contrato: Optional[str] = None
    cliente_principal: Optional[str] = None
    color_tema: Optional[str] = None
    report_text_color: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    description: Optional[str] = None
    reference_files: Optional[List[dict]] = None
    contratistas_list: Optional[List[str]] = None
    contratos_list: Optional[List[str]] = None
    categorias_personal: Optional[List[str]] = None
    categorias_equipo: Optional[List[str]] = None
    constructora_logo: Optional[str] = None


class ProjectOut(BaseModel):
    id: str
    name: str
    constructora: str
    contract_number: str
    objeto_contrato: Optional[str] = None
    cliente_principal: Optional[str] = None
    color_tema: Optional[str] = None
    report_text_color: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    description: Optional[str] = None
    reference_files: List[dict] = Field(default_factory=list)
    contratistas_list: List[str] = Field(default_factory=list)
    contratos_list: List[str] = Field(default_factory=list)
    categorias_personal: List[str] = Field(default_factory=list)
    categorias_equipo: List[str] = Field(default_factory=list)
    # Plantillas de exportación (rutas relativas dentro del backend). None si no hay.
    template_pdf: Optional[str] = None
    template_docx: Optional[str] = None
    template_pptx: Optional[str] = None
    template_map: Optional[str] = None
    # Sección "Datos Generales" (ex-Mapa): array de imágenes base64 que se
    # renderizan como slides/páginas dedicadas al inicio de las exportaciones
    # (presupuesto, programa, planos, etc.). Reemplaza al single `template_map`.
    general_data_images: List[str] = Field(default_factory=list)
    created_by: str
    created_at: datetime
    archived: bool = False


class LocationNodeIn(BaseModel):
    project_id: str
    parent_id: Optional[str] = None
    name: str
    order: int = 0
    is_leaf: bool = False
    measurement_type: Optional[Literal["coord_latlon", "cadenamiento", "eje", "nivel"]] = None
    # Coordenadas objetivo dictadas por el Coordinador desde oficina (sólo aplican
    # a nodos hoja con measurement_type == "coord_latlon"). El Especialista las
    # ve en modo solo-lectura al capturar.
    target_lat: Optional[float] = None
    target_lon: Optional[float] = None
    target_elev: Optional[float] = None
    # Meta/objetivo numérico del nodo (p.ej. metros lineales, puntos, etc.).
    # Se utiliza para calcular % de avance vs. última lectura registrada.
    meta: Optional[float] = None


class LocationNodeOut(BaseModel):
    id: str
    project_id: str
    parent_id: Optional[str] = None
    name: str
    depth: int
    order: int
    is_leaf: bool
    measurement_type: Optional[str] = None
    target_lat: Optional[float] = None
    target_lon: Optional[float] = None
    target_elev: Optional[float] = None
    meta: Optional[float] = None
    avance_actual: float = 0.0
    # Portada institucional del nodo (foto de render/arquitectura). Se usa como
    # fondo de la "Portadilla de Nodo" dinámica en el PDF exportado.
    # Se almacena como data URL base64 (image/jpeg, image/png, image/webp).
    cover_image: Optional[str] = None
    metadata: Optional[dict] = None
    path: List[str] = Field(default_factory=list)  # cadena de ids desde raíz hasta self


class AreaIn(BaseModel):
    project_id: str
    name: str
    color: Optional[str] = "#1E40AF"


class AreaOut(BaseModel):
    id: str
    project_id: str
    name: str
    color: str
    created_at: datetime


class InvitationIn(BaseModel):
    project_id: str
    email: EmailStr
    name: str
    role: Literal["sub_coordinador", "especialista", "jefe_proyecto"]
    # Sub-coordinador: scope_node_id (un nodo padre)
    scope_node_id: Optional[str] = None
    # Especialista: area_id, puesto, scope_node_ids (lista de hojas)
    area_id: Optional[str] = None
    puesto: Optional[str] = None
    scope_node_ids: List[str] = Field(default_factory=list)


class InvitationOut(BaseModel):
    id: str
    token: str
    project_id: str
    project_name: str
    email: EmailStr
    name: str
    role: str
    area_id: Optional[str] = None
    puesto: Optional[str] = None
    scope_node_id: Optional[str] = None
    scope_node_ids: List[str] = Field(default_factory=list)
    status: str  # "pending" | "accepted" | "revoked"
    created_at: datetime
    expires_at: datetime


class AcceptInviteIn(BaseModel):
    token: str
    password: str


class ReportIn(BaseModel):
    project_id: str
    node_id: str  # debe ser hoja
    # Valor de medición (formato depende del measurement_type del nodo)
    measurement_value: dict  # ej: {"lat": 19.43, "lon": -99.13} | {"cadenamiento": "5+100"} | {"eje": "A"} | {"nivel": 12.45}
    # Título/nombre del reporte (opcional). Si viene vacío, en el frontend
    # se muestra un fallback tipo "Reporte del <fecha>". Se indexa para búsqueda.
    title: Optional[str] = None
    area_id: Optional[str] = None
    notes: Optional[str] = None
    avance: Optional[str] = None
    observaciones: Optional[str] = None
    incidencias: Optional[str] = None  # Notas sobre eventos/desviaciones del día
    severidad: Optional[Literal["informativo", "importante", "urgente"]] = "informativo"
    contratista: Optional[str] = None
    personnel: List[str] = Field(default_factory=list)
    equipment: List[str] = Field(default_factory=list)
    images: List[str] = Field(default_factory=list)  # base64
    # Descripciones individuales por foto (foto 1 → captions[0], foto 2 → captions[1]).
    # Fallback al campo `observaciones` general si no se rellena.
    photo_captions: List[str] = Field(default_factory=list)
    files: List[dict] = Field(default_factory=list)  # [{filename, mime, data_base64}]
    # Lecturas numéricas (P/U) – específicas del flujo Especialista v2.
    primera_lectura: Optional[float] = None
    ultima_lectura: Optional[float] = None
    # Unidad de las lecturas (km | m | cm). Default = "m".
    unidad: Optional[str] = "m"


class ReportOut(BaseModel):
    id: str
    project_id: str
    node_id: str
    node_path_names: List[str]
    node_path_ids: List[str] = Field(default_factory=list)  # ids ancestrales para filtros
    measurement_type: str
    measurement_value: dict
    title: Optional[str] = None
    area_id: Optional[str] = None
    area_name: Optional[str] = None
    notes: Optional[str] = None
    avance: Optional[str] = None
    observaciones: Optional[str] = None
    incidencias: Optional[str] = None
    severidad: str = "informativo"
    contratista: Optional[str] = None
    personnel: List[str] = Field(default_factory=list)
    equipment: List[str] = Field(default_factory=list)
    images: List[str] = Field(default_factory=list)
    photo_captions: List[str] = Field(default_factory=list)
    files: List[dict] = Field(default_factory=list)
    primera_lectura: Optional[float] = None
    ultima_lectura: Optional[float] = None
    unidad: Optional[str] = "m"
    captured_by: str
    captured_by_name: str
    created_at: datetime


# === Helpers ================================================================
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_pw(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), h.encode())
    except Exception:
        return False


def make_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    return jwt.encode({"sub": user_id, "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Token requerido")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        uid = payload.get("sub")
    except jwt.PyJWTError:
        raise HTTPException(401, "Token inválido")
    u = await db.users.find_one({"id": uid})
    if not u:
        raise HTTPException(401, "Usuario no existe")
    u.pop("_id", None)
    u.pop("password", None)
    return u


def require_role(*allowed_roles: str):
    async def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in allowed_roles:
            raise HTTPException(403, f"Rol no autorizado: {user['role']}")
        return user
    return dep


def user_to_out(u: dict) -> dict:
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u["name"],
        "role": u["role"],
        "area": u.get("area"),
        "puesto": u.get("puesto"),
        "scope_node_id": u.get("scope_node_id"),
        "scope_node_ids": u.get("scope_node_ids") or [],
        "project_ids": u.get("project_ids") or [],
        "expo_push_tokens": u.get("expo_push_tokens") or [],
        "created_at": u.get("created_at", datetime.now(timezone.utc)),
    }


async def ensure_project_access(user: dict, project_id: str) -> dict:
    """Valida que el usuario tenga acceso a un proyecto; devuelve el proyecto."""
    p = await db.projects.find_one({"id": project_id, "archived": {"$ne": True}})
    if not p:
        raise HTTPException(404, "Proyecto no existe")
    if user["role"] in (ROLE_COORD, ROLE_JEFE):
        return p  # acceso global (Coordinador General y Jefe de Proyecto)
    if project_id not in (user.get("project_ids") or []):
        raise HTTPException(403, "Sin acceso a este proyecto")
    return p


async def build_node_path(node: dict) -> List[str]:
    """Devuelve la cadena de IDs desde raíz hasta self (incluido)."""
    path = [node["id"]]
    cur = node
    while cur.get("parent_id"):
        parent = await db.location_nodes.find_one({"id": cur["parent_id"]})
        if not parent:
            break
        path.insert(0, parent["id"])
        cur = parent
    return path


async def node_path_names(node_id: str) -> List[str]:
    node = await db.location_nodes.find_one({"id": node_id})
    if not node:
        return []
    ids = await build_node_path(node)
    names: List[str] = []
    for nid in ids:
        n = await db.location_nodes.find_one({"id": nid})
        if n:
            names.append(n["name"])
    return names


async def descendants_ids(root_id: str) -> List[str]:
    """Devuelve TODOS los descendientes (incluyendo root_id) de un nodo."""
    out = [root_id]
    queue = [root_id]
    while queue:
        pid = queue.pop(0)
        children = await db.location_nodes.find({"parent_id": pid}).to_list(length=10000)
        for c in children:
            out.append(c["id"])
            queue.append(c["id"])
    return out


# === Startup: wipe legacy ===================================================
@app.on_event("startup")
async def startup_event():
    # Eliminar colecciones legacy de la versión anterior
    existing = await db.list_collection_names()
    for c in COLLECTIONS_LEGACY:
        if c in existing:
            await db[c].drop()
            log.info(f"[wipe] Dropped legacy collection: {c}")
    # Indexes esenciales
    await db.users.create_index("email", unique=True)
    await db.invitations.create_index("token", unique=True)
    await db.location_nodes.create_index([("project_id", 1), ("parent_id", 1)])
    await db.reports.create_index([("project_id", 1), ("created_at", -1)])
    await db.announcements.create_index([("project_id", 1), ("pinned", -1), ("created_at", -1)])
    await db.minutas.create_index([("project_id", 1), ("created_at", -1)])
    await db.minutas.create_index([("project_id", 1), ("acuerdos.responsable_id", 1)])
    await db.minutas.create_index([("project_id", 1), ("involved_ids", 1)])
    await db.messages.create_index([("project_id", 1), ("created_at", -1)])
    await db.messages.create_index([("channel_id", 1), ("created_at", -1)])
    await db.events.create_index([("project_id", 1), ("start_at", 1)])
    await db.channels.create_index([("project_id", 1), ("type", 1)])
    await db.channels.create_index([("project_id", 1), ("type", 1), ("area_id", 1)])
    await db.channels.create_index([("project_id", 1), ("type", 1), ("member_ids", 1)])

    # --- Migración one-shot: asegurar canal General + asignar channel_id a
    # mensajes legacy creados antes del refactor de canales.
    try:
        legacy_msgs = await db.messages.count_documents({"channel_id": {"$exists": False}})
        if legacy_msgs:
            log.info(f"[migrate] {legacy_msgs} mensajes legacy sin channel_id → asignando a General de cada proyecto")
            project_ids = await db.messages.distinct("project_id", {"channel_id": {"$exists": False}})
            for pid in project_ids:
                if not pid:
                    continue
                await _ensure_default_channels(pid)
                g = await db.channels.find_one({"project_id": pid, "type": "general"})
                if g:
                    await db.messages.update_many(
                        {"project_id": pid, "channel_id": {"$exists": False}},
                        {"$set": {"channel_id": g["id"]}},
                    )
            log.info("[migrate] mensajes legacy migrados al canal General")
    except Exception as e:
        log.warning(f"[migrate] error migrando mensajes legacy: {e}")
    log.info("[startup] SynCo v2.0 ready")


# === ROOT / HEALTH ==========================================================
@api.get("/")
async def root():
    return {"name": "SynCo v2.0", "status": "ok"}


@api.get("/health")
async def health():
    return {"ok": True, "ts": datetime.now(timezone.utc).isoformat()}


# === BOOTSTRAP (idempotente) ================================================
@api.post("/admin/bootstrap")
async def bootstrap(body: BootstrapIn):
    if body.secret != BOOTSTRAP_SECRET:
        raise HTTPException(403, "Secret inválido")
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        # Idempotente: si ya existe y es coordinador_general, OK
        if existing.get("role") != ROLE_COORD:
            raise HTTPException(409, "Email existe con otro rol")
        return {"ok": True, "user": user_to_out(existing), "created": False}
    uid = str(uuid.uuid4())
    user = {
        "id": uid,
        "email": body.email.lower(),
        "password": hash_pw(body.password),
        "name": body.name,
        "role": ROLE_COORD,
        "created_at": datetime.now(timezone.utc),
        "project_ids": [],
    }
    await db.users.insert_one(user)
    log.info(f"[bootstrap] Created coordinador_general {body.email}")
    return {"ok": True, "user": user_to_out(user), "created": True}


# === COORDINADORES GENERALES (gestión por pares) ============================
class CoordinatorCreateIn(BaseModel):
    name: str
    email: EmailStr
    password: str


@api.get("/admin/coordinators")
async def list_coordinators(user: dict = Depends(require_role(ROLE_COORD))):
    """Lista todos los Coordinadores Generales. Sólo accesible por otro
    Coordinador General. Devuelve el directorio con email, nombre y fecha
    de alta para auditoría."""
    items = await db.users.find({"role": ROLE_COORD}).sort("created_at", 1).to_list(length=500)
    return [user_to_out(u) for u in items]


@api.post("/admin/coordinators")
async def create_coordinator(
    body: CoordinatorCreateIn,
    user: dict = Depends(require_role(ROLE_COORD)),
):
    """Crea un nuevo Coordinador General. Sólo un Coordinador General
    autenticado puede ejecutar esta acción. El nuevo usuario hereda los
    mismos privilegios globales (gobierna cualquier proyecto)."""
    name = (body.name or "").strip()
    email = (body.email or "").strip().lower()
    pw = (body.password or "").strip()
    if not name:
        raise HTTPException(400, "Nombre requerido")
    if len(name) > 80:
        raise HTTPException(400, "Nombre máximo 80 caracteres")
    if not email:
        raise HTTPException(400, "Email requerido")
    if len(pw) < 6:
        raise HTTPException(400, "Contraseña mínima de 6 caracteres")
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Ya existe un usuario con ese email")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid,
        "email": email,
        "password": hash_pw(pw),
        "name": name,
        "role": ROLE_COORD,
        "created_at": datetime.now(timezone.utc),
        "project_ids": [],
        "created_by": user["id"],
    }
    await db.users.insert_one(doc)
    log.info(f"[admin] Coord {user['email']} created new coordinador_general {email}")
    return user_to_out(doc)


# === AUTH ===================================================================
@api.post("/auth/login", response_model=Token)
async def login(body: LoginIn):
    u = await db.users.find_one({"email": body.email.lower()})
    if not u or not verify_pw(body.password, u["password"]):
        raise HTTPException(401, "Credenciales inválidas")
    return {"token": make_token(u["id"]), "user": user_to_out(u)}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return user_to_out(user)


# === PUSH NOTIFICATIONS (Expo) ==============================================
import httpx  # local import is safe — module-level top imports remain authoritative

EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send"


def _is_valid_expo_token(token: str) -> bool:
    """
    Valida el formato de un Expo push token.
    Formato oficial: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' o 'ExpoPushToken[...]'.
    """
    if not token or not isinstance(token, str):
        return False
    t = token.strip()
    if not (t.startswith("ExponentPushToken[") or t.startswith("ExpoPushToken[")):
        return False
    if not t.endswith("]"):
        return False
    if len(t) > 200:  # defensive cap
        return False
    return True


@api.post("/users/push-token")
async def register_push_token(
    body: PushTokenIn,
    user: dict = Depends(current_user),
):
    """
    Registra un Expo Push Token en el perfil del usuario autenticado.
    - Usa $addToSet para evitar duplicados.
    - Limita el array a 10 tokens (FIFO) para no acumular dispositivos viejos.
    """
    token = (body.token or "").strip()
    if not _is_valid_expo_token(token):
        raise HTTPException(400, "Token de Expo inválido")

    # Add to set (no duplicates).
    await db.users.update_one(
        {"id": user["id"]},
        {"$addToSet": {"expo_push_tokens": token}},
    )

    # FIFO cap @ 10 tokens — keep only the most recent ones.
    fresh = await db.users.find_one(
        {"id": user["id"]}, {"_id": 0, "expo_push_tokens": 1}
    )
    tokens_list = (fresh or {}).get("expo_push_tokens") or []
    if len(tokens_list) > 10:
        trimmed = tokens_list[-10:]
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"expo_push_tokens": trimmed}},
        )
        tokens_list = trimmed

    logger_count = len(tokens_list)
    log.info(
        "[push] token registered user=%s platform=%s total_tokens=%d",
        user.get("email"),
        body.platform or "unknown",
        logger_count,
    )
    return {"ok": True, "count": logger_count}


@api.delete("/users/push-token")
async def unregister_push_token(
    body: PushTokenIn,
    user: dict = Depends(current_user),
):
    """Elimina un Expo push token del perfil del usuario (logout / device removal)."""
    token = (body.token or "").strip()
    if not token:
        raise HTTPException(400, "Token vacío")
    await db.users.update_one(
        {"id": user["id"]},
        {"$pull": {"expo_push_tokens": token}},
    )
    return {"ok": True}


async def send_push_notification(
    user_id: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
    sound: Optional[str] = "default",
    priority: str = "high",
) -> dict:
    """
    Envía una notificación push a TODOS los Expo push tokens registrados del usuario.

    Esta función está **definida y lista para usarse**, pero NO se vincula a ningún
    evento todavía. Es responsabilidad del feature que la consuma (e.g. nuevo reporte,
    mensaje en chat, asignación de tarea) llamarla.

    Args:
        user_id: ID del usuario destinatario.
        title:   Título de la notificación.
        body:    Cuerpo / mensaje principal.
        data:    Payload opcional para deep-linking (e.g. {"report_id": "..."}).
        sound:   'default' o None.
        priority: 'default' | 'normal' | 'high'.

    Returns:
        dict con shape:
        {
          "ok": bool,
          "sent": int,            # cuántos mensajes se intentaron enviar
          "failed_tokens": [str], # tokens que Expo reportó como inválidos
          "response": <expo raw json or error string>,
        }
    """
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "expo_push_tokens": 1})
    tokens: list = (u or {}).get("expo_push_tokens") or []
    if not tokens:
        return {"ok": False, "sent": 0, "failed_tokens": [], "response": "no tokens"}

    # Build the Expo push message batch (Expo accepts a JSON array).
    messages = []
    for t in tokens:
        if not _is_valid_expo_token(t):
            continue
        msg = {
            "to": t,
            "title": title,
            "body": body,
            "priority": priority,
        }
        if sound:
            msg["sound"] = sound
        if data:
            msg["data"] = data
        messages.append(msg)

    if not messages:
        return {"ok": False, "sent": 0, "failed_tokens": tokens, "response": "no valid tokens"}

    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
    }

    failed_tokens: list = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(EXPO_PUSH_API_URL, json=messages, headers=headers)
            try:
                payload = r.json()
            except Exception:
                payload = {"raw": r.text}

            # Expo returns {"data": [{"status":"ok"|"error","id":"...","message":"...","details":{"error":"DeviceNotRegistered"}}, ...]}
            results = (payload or {}).get("data") or []
            for idx, item in enumerate(results):
                if isinstance(item, dict) and item.get("status") == "error":
                    err = (item.get("details") or {}).get("error", "")
                    if err in ("DeviceNotRegistered", "InvalidCredentials"):
                        if idx < len(messages):
                            failed_tokens.append(messages[idx]["to"])

            # Auto-clean: remove invalid tokens from user's profile.
            if failed_tokens:
                await db.users.update_one(
                    {"id": user_id},
                    {"$pull": {"expo_push_tokens": {"$in": failed_tokens}}},
                )

            return {
                "ok": r.status_code < 400,
                "sent": len(messages),
                "failed_tokens": failed_tokens,
                "response": payload,
            }
    except Exception as exc:  # pragma: no cover - defensive
        log.exception("[push] send_push_notification failed: %s", exc)
        return {
            "ok": False,
            "sent": 0,
            "failed_tokens": [],
            "response": f"exception: {exc}",
        }


# === PROJECTS ===============================================================
def _sanitize_str_list(items, max_items: int = 200, max_len: int = 200) -> list:
    """Limpia listas de strings (contratistas / contratos). Dedup case-insensitive."""
    if not items or not isinstance(items, list):
        return []
    out: list = []
    seen: set = set()
    for it in items:
        if not isinstance(it, str):
            continue
        s = it.strip()
        if not s:
            continue
        if len(s) > max_len:
            s = s[:max_len]
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= max_items:
            break
    return out


def _sanitize_color_hex(value: Optional[str]) -> Optional[str]:
    """Valida un color hex `#RRGGBB` o `#RGB`. Devuelve `#RRGGBB` en mayúsculas o None."""
    if not value or not isinstance(value, str):
        return None
    s = value.strip().lstrip("#")
    if len(s) == 3 and all(ch in "0123456789abcdefABCDEF" for ch in s):
        s = "".join(ch * 2 for ch in s)
    if len(s) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in s):
        return None
    return "#" + s.upper()


@api.get("/projects")
async def list_projects(user: dict = Depends(current_user)):
    if user["role"] in (ROLE_COORD, ROLE_JEFE):
        # Coordinador General y Jefe de Proyecto: acceso global a todos los proyectos.
        cursor = db.projects.find({"archived": {"$ne": True}}).sort("created_at", -1)
    else:
        pids = user.get("project_ids") or []
        cursor = db.projects.find({"id": {"$in": pids}, "archived": {"$ne": True}}).sort("created_at", -1)
    items = await cursor.to_list(length=500)
    for it in items:
        it.pop("_id", None)
        it.setdefault("contratistas_list", [])
        it.setdefault("contratos_list", [])
    return items


@api.post("/projects")
async def create_project(body: ProjectIn, user: dict = Depends(require_role(ROLE_COORD))):
    pid = str(uuid.uuid4())
    doc = {
        "id": pid,
        "name": body.name.strip(),
        "constructora": body.constructora.strip(),
        "contract_number": body.contract_number.strip(),
        "objeto_contrato": (body.objeto_contrato or "").strip() or None,
        "cliente_principal": (body.cliente_principal or "").strip() or None,
        "color_tema": _sanitize_color_hex(body.color_tema) or "#003366",
        "report_text_color": _sanitize_color_hex(body.report_text_color) or "#0F172A",
        "start_date": body.start_date,
        "end_date": body.end_date,
        "description": (body.description or "").strip() or None,
        "reference_files": _sanitize_reference_files(body.reference_files),
        "contratistas_list": _sanitize_str_list(body.contratistas_list),
        "contratos_list": _sanitize_str_list(body.contratos_list),
        "categorias_personal": _sanitize_str_list(body.categorias_personal),
        "categorias_equipo": _sanitize_str_list(body.categorias_equipo),
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
        "archived": False,
    }
    await db.projects.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/projects/{pid}")
async def get_project(pid: str, user: dict = Depends(current_user)):
    p = await ensure_project_access(user, pid)
    p.pop("_id", None)
    p.setdefault("reference_files", [])
    p.setdefault("contratistas_list", [])
    p.setdefault("contratos_list", [])
    p.setdefault("categorias_personal", [])
    p.setdefault("categorias_equipo", [])
    p.setdefault("objeto_contrato", None)
    p.setdefault("cliente_principal", None)
    p.setdefault("color_tema", "#003366")
    p.setdefault("report_text_color", "#0F172A")
    p.setdefault("general_data_images", [])
    return p


@api.put("/projects/{pid}")
async def update_project(pid: str, body: ProjectPatch, user: dict = Depends(require_role(ROLE_COORD))):
    """PATCH parcial: sólo actualiza los campos enviados.

    Permite, por ejemplo, actualizar únicamente `objeto_contrato` o catálogos
    sin tener que reenviar name/constructora/contract_number.
    """
    existing = await db.projects.find_one({"id": pid})
    if not existing:
        raise HTTPException(404, "Proyecto no existe")

    upd: dict = {}
    if body.name is not None:
        n = body.name.strip()
        if n:
            upd["name"] = n
    if body.constructora is not None:
        upd["constructora"] = body.constructora.strip()
    if body.contract_number is not None:
        upd["contract_number"] = body.contract_number.strip()
    if body.objeto_contrato is not None:
        upd["objeto_contrato"] = body.objeto_contrato.strip() or None
    if body.cliente_principal is not None:
        upd["cliente_principal"] = body.cliente_principal.strip() or None
    if body.color_tema is not None:
        upd["color_tema"] = _sanitize_color_hex(body.color_tema) or "#003366"
    if body.report_text_color is not None:
        upd["report_text_color"] = _sanitize_color_hex(body.report_text_color) or "#0F172A"
    if body.start_date is not None:
        upd["start_date"] = body.start_date
    if body.end_date is not None:
        upd["end_date"] = body.end_date
    if body.description is not None:
        upd["description"] = body.description.strip() or None
    if body.reference_files is not None:
        upd["reference_files"] = _sanitize_reference_files(body.reference_files)
    if body.contratistas_list is not None:
        upd["contratistas_list"] = _sanitize_str_list(body.contratistas_list)
    if body.contratos_list is not None:
        upd["contratos_list"] = _sanitize_str_list(body.contratos_list)
    if body.categorias_personal is not None:
        upd["categorias_personal"] = _sanitize_str_list(body.categorias_personal)
    if body.categorias_equipo is not None:
        upd["categorias_equipo"] = _sanitize_str_list(body.categorias_equipo)
    if body.constructora_logo is not None:
        # Aceptamos cadena vacía para "limpiar" el logo
        upd["constructora_logo"] = body.constructora_logo or None

    if upd:
        await db.projects.update_one({"id": pid}, {"$set": upd})

    p = await db.projects.find_one({"id": pid})
    return _project_public(p)


def _project_public(p: dict) -> dict:
    """Serializa un doc de proyecto para exponer al frontend con defaults."""
    if not p:
        return p
    p = dict(p)  # copia superficial para no mutar el original
    p.pop("_id", None)
    p.setdefault("reference_files", [])
    p.setdefault("contratistas_list", [])
    p.setdefault("contratos_list", [])
    p.setdefault("categorias_personal", [])
    p.setdefault("categorias_equipo", [])
    p.setdefault("objeto_contrato", None)
    p.setdefault("cliente_principal", None)
    p.setdefault("color_tema", "#003366")
    p.setdefault("report_text_color", "#0F172A")
    p.setdefault("general_data_images", [])
    p.setdefault("template_pdf", None)
    p.setdefault("template_docx", None)
    p.setdefault("template_pptx", None)
    p.setdefault("template_map", None)
    return p


@api.put("/projects/{pid}/catalogos")
async def set_project_catalogos(
    pid: str,
    body: dict,
    user: dict = Depends(require_role(ROLE_COORD)),
):
    """Actualiza catálogos dinámicos del proyecto:
    contratistas_list, contratos_list, categorias_personal y categorias_equipo.
    Sólo Coordinador General puede modificarlos."""
    upd: dict = {}
    if isinstance(body.get("contratistas_list"), list):
        upd["contratistas_list"] = _sanitize_str_list(body.get("contratistas_list"))
    if isinstance(body.get("contratos_list"), list):
        upd["contratos_list"] = _sanitize_str_list(body.get("contratos_list"))
    if isinstance(body.get("categorias_personal"), list):
        upd["categorias_personal"] = _sanitize_str_list(body.get("categorias_personal"))
    if isinstance(body.get("categorias_equipo"), list):
        upd["categorias_equipo"] = _sanitize_str_list(body.get("categorias_equipo"))
    if not upd:
        raise HTTPException(400, "Nada para actualizar")
    r = await db.projects.update_one({"id": pid}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(404, "Proyecto no existe")
    p = await db.projects.find_one({"id": pid})
    return _project_public(p)


@api.delete("/projects/{pid}")
async def archive_project(pid: str, user: dict = Depends(require_role(ROLE_COORD))):
    await db.projects.update_one({"id": pid}, {"$set": {"archived": True}})
    return {"ok": True, "archived": True}


class ReferenceFilesIn(BaseModel):
    reference_files: List[dict] = Field(default_factory=list)


@api.put("/projects/{pid}/reference-files")
async def set_reference_files(
    pid: str,
    body: ReferenceFilesIn,
    user: dict = Depends(require_role(ROLE_COORD)),
):
    """Actualiza la lista completa de Archivos de Consulta del proyecto.
    Sólo Coordinador General puede modificar esta lista."""
    cleaned = _sanitize_reference_files(body.reference_files)
    r = await db.projects.update_one(
        {"id": pid}, {"$set": {"reference_files": cleaned}}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Proyecto no existe")
    return {"ok": True, "reference_files": cleaned}


# === LOCATION NODES (Árbol Recursivo) =======================================
@api.get("/projects/{pid}/nodes")
async def list_nodes(pid: str, user: dict = Depends(current_user)):
    await ensure_project_access(user, pid)
    items = await db.location_nodes.find({"project_id": pid}).sort([("depth", 1), ("order", 1)]).to_list(length=10000)

    # --- FIX AMNESIA DE ESTADO: usar MAX(ultima_lectura) numérica, no SUM(avance) texto ---
    pipeline = [
        {"$match": {"project_id": pid, "ultima_lectura": {"$ne": None}}},
        {"$group": {"_id": "$node_id", "total_avance": {"$max": "$ultima_lectura"}}},
    ]
    aggr = await db.reports.aggregate(pipeline).to_list(length=10000)
    avances_dict = {doc["_id"]: float(doc.get("total_avance") or 0.0) for doc in aggr}
    # -------------------------------------------------------------------------------------

    # Filtrado por scope (Sub-coordinador AHORA tiene scope GLOBAL, igual que Coordinador).
    role = user.get("role")
    if role == ROLE_ESPECIALISTA and (user.get("scope_node_ids") or []):
        allowed_leaves = set(user.get("scope_node_ids") or [])
        # incluir ancestros para que el árbol sea navegable
        ancestors: set = set()
        # construir mapa id->parent
        all_nodes = await db.location_nodes.find({"project_id": pid}).to_list(length=10000)
        parent_of = {n["id"]: n.get("parent_id") for n in all_nodes}
        for leaf in allowed_leaves:
            cur = leaf
            while cur:
                ancestors.add(cur)
                cur = parent_of.get(cur)
        items = [it for it in items if it["id"] in ancestors]
        
    for it in items:
        it.pop("_id", None)
        # Inyectamos el acumulado al nodo
        it["avance_actual"] = avances_dict.get(it["id"], 0.0)
        
    return items


@api.get("/projects/{pid}/nodes/tree")
async def get_tree(pid: str, user: dict = Depends(current_user)):
    """Devuelve el árbol completo como estructura jerárquica."""
    await ensure_project_access(user, pid)
    items = await db.location_nodes.find({"project_id": pid}).sort([("depth", 1), ("order", 1)]).to_list(length=10000)
    
    # --- FIX AMNESIA DE ESTADO: usar MAX(ultima_lectura) numérica, no SUM(avance) texto ---
    pipeline = [
        {"$match": {"project_id": pid, "ultima_lectura": {"$ne": None}}},
        {"$group": {"_id": "$node_id", "total_avance": {"$max": "$ultima_lectura"}}},
    ]
    aggr = await db.reports.aggregate(pipeline).to_list(length=10000)
    avances_dict = {doc["_id"]: float(doc.get("total_avance") or 0.0) for doc in aggr}
    # -------------------------------------------------------------------------------------

    # Filtrado por scope (Sub-coordinador AHORA tiene scope GLOBAL, igual que Coordinador).
    role = user.get("role")
    if role == ROLE_ESPECIALISTA and (user.get("scope_node_ids") or []):
        allowed_leaves = set(user.get("scope_node_ids") or [])
        ancestors: set = set()
        parent_of = {n["id"]: n.get("parent_id") for n in items}
        for leaf in allowed_leaves:
            cur = leaf
            while cur:
                ancestors.add(cur)
                cur = parent_of.get(cur)
        items = [it for it in items if it["id"] in ancestors]
        
    by_id = {}
    for it in items:
        it.pop("_id", None)
        # Inyectamos el acumulado al nodo antes de anidarlo
        it["avance_actual"] = avances_dict.get(it["id"], 0.0)
        it["children"] = []
        by_id[it["id"]] = it
        
    roots = []
    # Para sub-coord/especialista, "root" debe ser el primer nodo cuyo padre no está en el set filtrado
    for it in items:
        if it.get("parent_id") and it["parent_id"] in by_id:
            by_id[it["parent_id"]]["children"].append(it)
        else:
            roots.append(it)
    return roots


@api.post("/projects/{pid}/nodes")
async def create_node(pid: str, body: LocationNodeIn, user: dict = Depends(require_role(ROLE_COORD))):
    if body.project_id != pid:
        raise HTTPException(400, "project_id mismatch")
    await ensure_project_access(user, pid)
    parent = None
    depth = 0
    if body.parent_id:
        parent = await db.location_nodes.find_one({"id": body.parent_id, "project_id": pid})
        if not parent:
            raise HTTPException(404, "Nodo padre no existe")
        depth = parent["depth"] + 1
        # Si el padre era hoja, deja de serlo automáticamente.
        if parent.get("is_leaf"):
            await db.location_nodes.update_one(
                {"id": parent["id"]},
                {"$set": {"is_leaf": False, "measurement_type": None, "target_lat": None, "target_lon": None, "target_elev": None}},
            )
    if body.is_leaf and body.measurement_type not in MEASUREMENT_TYPES:
        raise HTTPException(400, "Nodos hoja requieren measurement_type válido")
    nid = str(uuid.uuid4())
    # Coordenadas objetivo: sólo aplican a hojas coord_latlon.
    is_coord_leaf = body.is_leaf and body.measurement_type == "coord_latlon"
    doc = {
        "id": nid,
        "project_id": pid,
        "parent_id": body.parent_id,
        "name": body.name.strip(),
        "depth": depth,
        "order": body.order,
        "is_leaf": body.is_leaf,
        "measurement_type": body.measurement_type if body.is_leaf else None,
        "target_lat": body.target_lat if is_coord_leaf else None,
        "target_lon": body.target_lon if is_coord_leaf else None,
        "target_elev": body.target_elev if is_coord_leaf else None,
        "meta": body.meta if body.is_leaf else None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.location_nodes.insert_one(doc)
    doc.pop("_id", None)
    return doc


class NodePatch(BaseModel):
    name: Optional[str] = None
    order: Optional[int] = None
    is_leaf: Optional[bool] = None
    measurement_type: Optional[Literal["coord_latlon", "cadenamiento", "eje", "nivel"]] = None
    target_lat: Optional[float] = None
    target_lon: Optional[float] = None
    target_elev: Optional[float] = None
    meta: Optional[float] = None


@api.patch("/nodes/{nid}")
async def update_node(nid: str, body: NodePatch, user: dict = Depends(require_role(ROLE_COORD, ROLE_SUB))):
    node = await db.location_nodes.find_one({"id": nid})
    if not node:
        raise HTTPException(404, "Nodo no existe")
    upd: dict = {}
    if body.name is not None:
        upd["name"] = body.name.strip()
    if body.order is not None:
        upd["order"] = body.order
    if body.is_leaf is not None:
        if body.is_leaf:
            # Para convertirse en hoja no debe tener hijos
            has_children = await db.location_nodes.find_one({"parent_id": nid})
            if has_children:
                raise HTTPException(400, "No se puede marcar como hoja: tiene hijos")
            if body.measurement_type not in MEASUREMENT_TYPES:
                raise HTTPException(400, "Hoja requiere measurement_type")
            upd["is_leaf"] = True
            upd["measurement_type"] = body.measurement_type
        else:
            upd["is_leaf"] = False
            upd["measurement_type"] = None
            upd["target_lat"] = None
            upd["target_lon"] = None
            upd["target_elev"] = None
    elif body.measurement_type is not None:
        if not node.get("is_leaf"):
            raise HTTPException(400, "measurement_type solo aplica a hojas")
        if body.measurement_type not in MEASUREMENT_TYPES:
            raise HTTPException(400, "measurement_type inválido")
        upd["measurement_type"] = body.measurement_type
        # Si cambia el tipo y deja de ser coord_latlon, limpia coords objetivo.
        if body.measurement_type != "coord_latlon":
            upd["target_lat"] = None
            upd["target_lon"] = None
            upd["target_elev"] = None
    # Coordenadas objetivo (sólo válidas en hojas coord_latlon — usar valor final).
    final_is_leaf = upd.get("is_leaf", node.get("is_leaf"))
    final_mtype = upd.get("measurement_type", node.get("measurement_type"))
    is_coord_leaf = bool(final_is_leaf and final_mtype == "coord_latlon")
    for fld, val in (("target_lat", body.target_lat), ("target_lon", body.target_lon), ("target_elev", body.target_elev)):
        if val is not None and is_coord_leaf:
            upd[fld] = val
    # Meta numérica: válida sólo para nodos hoja; si se manda en no-hoja se ignora.
    if body.meta is not None:
        if final_is_leaf:
            upd["meta"] = float(body.meta)
        # Si el nodo deja de ser hoja, limpiamos meta más abajo.
    if upd.get("is_leaf") is False:
        upd["meta"] = None
    if upd:
        await db.location_nodes.update_one({"id": nid}, {"$set": upd})
    out = await db.location_nodes.find_one({"id": nid})
    out.pop("_id", None)
    return out


@api.delete("/nodes/{nid}")
async def delete_node(nid: str, user: dict = Depends(require_role(ROLE_COORD))):
    node = await db.location_nodes.find_one({"id": nid})
    if not node:
        raise HTTPException(404, "Nodo no existe")
    ids_to_delete = await descendants_ids(nid)
    await db.location_nodes.delete_many({"id": {"$in": ids_to_delete}})
    # NO borramos reportes huérfanos automáticamente (preservación). Marcar como huérfanos:
    await db.reports.update_many(
        {"node_id": {"$in": ids_to_delete}}, {"$set": {"node_orphan": True}}
    )
    return {"ok": True, "deleted_count": len(ids_to_delete)}


# === PORTADILLA POR NODO (cover_image) =====================================
# Se almacena como data URL base64 en el propio documento del nodo.
# Usado por el motor PDF para renderizar la "Portadilla de Nodo" dinámica:
#   fondo con color institucional + nombre del nodo (grande) + imagen incrustada.
_NODE_COVER_MIME = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
_NODE_COVER_MAX_BYTES = 8 * 1024 * 1024  # 8 MB por portada


@api.post("/projects/{pid}/nodes/{nid}/cover")
async def upload_node_cover(
    pid: str,
    nid: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_role(ROLE_COORD, ROLE_SUB)),
):
    """Sube (o reemplaza) la portada institucional de un nodo.
    Acepta JPG/PNG/WebP hasta 8 MB. Devuelve el nodo actualizado."""
    node = await db.location_nodes.find_one({"id": nid, "project_id": pid})
    if not node:
        raise HTTPException(404, "Nodo no existe")
    content_type = (file.content_type or "").lower()
    if content_type and content_type not in _NODE_COVER_MIME:
        raise HTTPException(415, f"Formato no soportado: {content_type}. Usa JPG/PNG/WebP.")
    raw = await file.read(_NODE_COVER_MAX_BYTES + 1)
    if len(raw) > _NODE_COVER_MAX_BYTES:
        raise HTTPException(413, f"Imagen demasiado grande (máx {_NODE_COVER_MAX_BYTES // (1024*1024)} MB).")
    # Serializar como data URL base64
    import base64 as _b64
    mime = content_type or "image/jpeg"
    b64_str = _b64.b64encode(raw).decode("ascii")
    data_url = f"data:{mime};base64,{b64_str}"
    await db.location_nodes.update_one({"id": nid}, {"$set": {"cover_image": data_url}})
    updated = await db.location_nodes.find_one({"id": nid})
    updated.pop("_id", None)
    return updated


@api.delete("/projects/{pid}/nodes/{nid}/cover")
async def delete_node_cover(
    pid: str,
    nid: str,
    user: dict = Depends(require_role(ROLE_COORD, ROLE_SUB)),
):
    """Elimina la portada institucional del nodo (vuelve a la portadilla genérica)."""
    node = await db.location_nodes.find_one({"id": nid, "project_id": pid})
    if not node:
        raise HTTPException(404, "Nodo no existe")
    await db.location_nodes.update_one({"id": nid}, {"$set": {"cover_image": None}})
    updated = await db.location_nodes.find_one({"id": nid})
    updated.pop("_id", None)
    return updated


# === BULK UPLOAD GENÉRICO DE NODOS DESDE EXCEL/CSV =========================
# Columnas reconocidas dinámicamente:
#   - Nombre del nodo: "nombre", "nodo", "nombre del nodo", "nombre del poste"
#     (case-insensitive, sin acentos). Si no se encuentra, se usa la 1ra columna.
#   - Padre (opcional, jerarquía): "padre", "nodo padre", "parent"
#   - Resto de columnas: se guardan tal cual dentro de `metadata` (dict).
#
# Reglas:
#   - Filas con nombre vacío se ignoran.
#   - Upsert por (project_id, name) case-insensitive. Si existe -> actualiza
#     metadata y parent_id; si no -> crea como nodo no-hoja.
#   - Las filas se procesan en orden: primero los nodos sin padre, después
#     los hijos (dos pasadas) para resolver referencias forward.

_NODE_NAME_CANDIDATES = {
    "nombre", "nodo", "nombre del nodo", "nombre del poste",
    "name", "node", "node name",
}
_NODE_PARENT_CANDIDATES = {
    "padre", "nodo padre", "parent", "padre id", "parent id",
}


def _normalize_col(s: str) -> str:
    """Normaliza un encabezado para comparación (lower, sin acentos, sin espacios extra)."""
    if not isinstance(s, str):
        return ""
    s = s.strip().lower()
    repl = {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ñ": "n"}
    for k, v in repl.items():
        s = s.replace(k, v)
    return s


def _coerce_cell(v):
    """Convierte celdas de pandas en algo serializable y limpio.
    Ignora NaN/None, recorta strings."""
    try:
        import math
        if v is None:
            return None
        if isinstance(v, float) and math.isnan(v):
            return None
    except Exception:
        pass
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return v


@api.get("/projects/{pid}/nodes/bulk-upload/template")
async def bulk_upload_template(
    pid: str,
    user: dict = Depends(require_role(ROLE_COORD)),
):
    """Devuelve una plantilla .xlsx de ejemplo para carga masiva de nodos.

    Columnas:
      - Nombre: nombre del nodo (obligatorio)
      - Padre: nombre del nodo padre (opcional; deja vacío para nodos raíz)
      - Coordenada X, Coordenada Y, Elevación (TN), Dirección: ejemplos de metadatos.
    """
    await ensure_project_access(user, pid)
    try:
        import pandas as pd  # noqa: WPS433
    except Exception as e:  # pragma: no cover
        raise HTTPException(500, f"pandas no disponible: {e}")

    sample = [
        {
            "Nombre": "Tramo 1",
            "Padre": "",
            "Coordenada X": "",
            "Coordenada Y": "",
            "Elevación (TN)": "",
            "Dirección": "Tronco principal",
        },
        {
            "Nombre": "P-101",
            "Padre": "Tramo 1",
            "Coordenada X": 19.432608,
            "Coordenada Y": -99.133209,
            "Elevación (TN)": 2240.5,
            "Dirección": "Av. Reforma 100",
        },
        {
            "Nombre": "P-102",
            "Padre": "Tramo 1",
            "Coordenada X": 19.433100,
            "Coordenada Y": -99.134000,
            "Elevación (TN)": 2241.0,
            "Dirección": "Av. Reforma 120",
        },
        {
            "Nombre": "Tramo 2",
            "Padre": "",
            "Coordenada X": "",
            "Coordenada Y": "",
            "Elevación (TN)": "",
            "Dirección": "Ramal secundario",
        },
        {
            "Nombre": "P-201",
            "Padre": "Tramo 2",
            "Coordenada X": 19.440100,
            "Coordenada Y": -99.145000,
            "Elevación (TN)": 2245.2,
            "Dirección": "Calz. Tlalpan 500",
        },
    ]
    df = pd.DataFrame(sample)

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Nodos", index=False)
        # Ajustar ancho de columnas para que sea legible
        ws = writer.sheets["Nodos"]
        widths = {"A": 22, "B": 22, "C": 16, "D": 16, "E": 18, "F": 32}
        for col, w in widths.items():
            ws.column_dimensions[col].width = w
    buf.seek(0)

    headers = {
        "Content-Disposition": 'attachment; filename="plantilla_nodos_synco.xlsx"',
    }
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@api.post("/projects/{pid}/nodes/bulk-upload")
async def bulk_upload_nodes(
    pid: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_role(ROLE_COORD)),
):
    """Carga masiva genérica de nodos desde un archivo .xlsx o .csv.

    Devuelve resumen: {created, updated, skipped, errors, total}.
    """
    await ensure_project_access(user, pid)
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")
    try:
        raw = await file.read()
    except Exception as e:
        raise HTTPException(400, f"No se pudo leer el archivo: {e}")
    if not raw:
        raise HTTPException(400, "Archivo vacío")
    return await _process_nodes_bulk_upload(pid, raw, file.filename or "")


async def _process_nodes_bulk_upload(pid: str, raw: bytes, filename: str) -> dict:
    """Núcleo reutilizable de la carga masiva de nodos.

    Recibe el contenido binario y el nombre original del archivo y devuelve el
    resumen `{total_rows, created, updated, skipped, errors, ...}`. Es invocado
    por:
      - POST /projects/{pid}/nodes/bulk-upload  (endpoint dedicado)
      - POST /projects/{pid}/upload-file        (router genérico)
    """
    fname = (filename or "").lower()
    try:
        import pandas as pd  # noqa: WPS433
    except Exception as e:  # pragma: no cover
        raise HTTPException(500, f"pandas no disponible: {e}")

    try:
        if fname.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(raw), dtype=object, keep_default_na=True)
        elif fname.endswith(".xlsx") or fname.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(raw), dtype=object, engine="openpyxl")
        else:
            # Intento auto: primero xlsx, después csv
            try:
                df = pd.read_excel(io.BytesIO(raw), dtype=object, engine="openpyxl")
            except Exception:
                df = pd.read_csv(io.BytesIO(raw), dtype=object, keep_default_na=True)
    except Exception as e:
        raise HTTPException(400, f"No se pudo parsear el archivo: {e}")

    if df is None or df.empty:
        raise HTTPException(400, "El archivo no contiene filas")

    # Identificar columna de nombre
    cols = list(df.columns)
    norm_to_orig = {_normalize_col(str(c)): c for c in cols}

    name_col = None
    for cand in _NODE_NAME_CANDIDATES:
        if cand in norm_to_orig:
            name_col = norm_to_orig[cand]
            break
    if name_col is None and cols:
        name_col = cols[0]  # fallback: primera columna

    parent_col = None
    for cand in _NODE_PARENT_CANDIDATES:
        if cand in norm_to_orig:
            parent_col = norm_to_orig[cand]
            break

    if name_col is None:
        raise HTTPException(400, "No se pudo identificar la columna de nombre")

    # Cargar nodos existentes del proyecto en memoria (map por nombre-lower)
    existing_docs = await db.location_nodes.find({"project_id": pid}).to_list(length=10000)
    by_name_lower: dict = {}
    for n in existing_docs:
        key = (n.get("name") or "").strip().lower()
        if key:
            by_name_lower[key] = n

    # Calcular siguiente "order" para raíces nuevas
    existing_roots = [n for n in existing_docs if not n.get("parent_id")]
    next_order = max([n.get("order", 0) for n in existing_roots], default=-1) + 1

    summary = {
        "total_rows": int(len(df)),
        "created": 0,
        "updated": 0,
        "skipped": 0,
        "errors": [],
        "name_column": str(name_col),
        "parent_column": str(parent_col) if parent_col else None,
        "metadata_columns": [str(c) for c in cols if c != name_col and c != parent_col],
    }

    # Procesamos en 2 pasadas para resolver referencias de padre forward.
    rows = df.to_dict(orient="records")

    async def upsert_row(row: dict, second_pass: bool = False):
        nonlocal next_order
        raw_name = _coerce_cell(row.get(name_col))
        if raw_name is None or str(raw_name).strip() == "":
            summary["skipped"] += 1
            return
        name = str(raw_name).strip()
        # Resolver padre por nombre (si la columna existe)
        parent_doc = None
        if parent_col:
            raw_parent = _coerce_cell(row.get(parent_col))
            if raw_parent:
                pname = str(raw_parent).strip().lower()
                parent_doc = by_name_lower.get(pname)
                if not parent_doc and not second_pass:
                    # Diferimos: el padre puede aparecer más adelante.
                    return "defer"
        # Construir metadata con resto de columnas
        metadata: dict = {}
        for c in cols:
            if c == name_col or c == parent_col:
                continue
            val = _coerce_cell(row.get(c))
            if val is None:
                continue
            # Convertir tipos no-JSON-serializables
            try:
                import numpy as np  # noqa: WPS433
                if isinstance(val, (np.integer,)):
                    val = int(val)
                elif isinstance(val, (np.floating,)):
                    val = float(val)
            except Exception:
                pass
            if isinstance(val, (datetime,)):
                val = val.isoformat()
            metadata[str(c)] = val

        key = name.lower()
        existing = by_name_lower.get(key)
        if existing:
            # Update: refrescamos metadata y parent_id (si vino padre)
            upd: dict = {"metadata": metadata}
            if parent_doc:
                upd["parent_id"] = parent_doc["id"]
                upd["depth"] = int(parent_doc.get("depth", 0)) + 1
            await db.location_nodes.update_one({"id": existing["id"]}, {"$set": upd})
            existing["metadata"] = metadata
            if parent_doc:
                existing["parent_id"] = parent_doc["id"]
                existing["depth"] = upd["depth"]
            summary["updated"] += 1
        else:
            nid = str(uuid.uuid4())
            parent_id = parent_doc["id"] if parent_doc else None
            depth = (int(parent_doc.get("depth", 0)) + 1) if parent_doc else 0
            order_val = 0 if parent_doc else next_order
            if not parent_doc:
                next_order += 1
            doc = {
                "id": nid,
                "project_id": pid,
                "parent_id": parent_id,
                "name": name,
                "depth": depth,
                "order": order_val,
                "is_leaf": False,
                "measurement_type": None,
                "target_lat": None,
                "target_lon": None,
                "target_elev": None,
                "meta": None,
                "metadata": metadata,
                "created_at": datetime.now(timezone.utc),
            }
            # Si tiene padre que era hoja, ya no lo es
            if parent_doc and parent_doc.get("is_leaf"):
                await db.location_nodes.update_one(
                    {"id": parent_doc["id"]},
                    {"$set": {
                        "is_leaf": False, "measurement_type": None,
                        "target_lat": None, "target_lon": None, "target_elev": None,
                    }},
                )
                parent_doc["is_leaf"] = False
            await db.location_nodes.insert_one(doc)
            doc_clean = {k: v for k, v in doc.items() if k != "_id"}
            by_name_lower[key] = doc_clean
            summary["created"] += 1
        return None

    # Pasada 1
    deferred: list = []
    for idx, row in enumerate(rows):
        try:
            r = await upsert_row(row, second_pass=False)
            if r == "defer":
                deferred.append((idx, row))
        except Exception as e:
            summary["errors"].append({"row": idx + 2, "error": str(e)})

    # Pasada 2 (resuelve padres que se crearon después)
    for idx, row in deferred:
        try:
            await upsert_row(row, second_pass=True)
        except Exception as e:
            summary["errors"].append({"row": idx + 2, "error": str(e)})

    return summary


# === UPLOAD GENÉRICO DE ARCHIVOS DEL PROYECTO ===============================
UPLOADS_DIR = Path(os.environ.get("UPLOADS_DIR", "/app/backend/uploads"))
try:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
except Exception as _exc:  # pragma: no cover
    log.warning("[uploads] no se pudo crear %s: %s", UPLOADS_DIR, _exc)

# Conjuntos de tipos para enrutar la lógica.
_NODES_EXTS = {".xlsx", ".xls", ".csv"}
_NODES_MIMES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/csv",
}
# PDF / Word / Excel (binarios que solo se guardan en disco).
_ALLOWED_DOC_MIMES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
}
_MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB (límite acordado para subidas en campo)


def _safe_filename(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", (name or "archivo")).strip("._")
    return base[:120] or "archivo"


@api.post("/projects/{pid}/upload-file")
async def upload_project_file(
    pid: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_role(ROLE_COORD, ROLE_JEFE)),
):
    """
    Router de archivos del proyecto. Acepta multipart/form-data.

    - Si el archivo es Excel/CSV de coordenadas (xlsx, xls, csv) → ejecuta el
      pipeline de carga masiva de nodos y devuelve el resumen.
    - Si es PDF/Word u otro documento permitido → lo guarda en `uploads/{pid}/`
      y lo añade a `project.reference_files`. Devuelve el registro creado.

    Limite por archivo: 25 MB. Solo Coordinador / Jefe de Proyecto.
    """
    await ensure_project_access(user, pid)
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")

    try:
        raw = await file.read()
    except Exception as e:
        raise HTTPException(400, f"No se pudo leer el archivo: {e}")
    if not raw:
        raise HTTPException(400, "Archivo vacío")
    if len(raw) > _MAX_FILE_BYTES:
        raise HTTPException(
            413,
            f"Archivo demasiado grande ({len(raw)//1024//1024} MB). Máx {_MAX_FILE_BYTES//1024//1024} MB.",
        )

    orig = file.filename or "archivo"
    ext = (Path(orig).suffix or "").lower()
    ctype = (file.content_type or "").lower().split(";", 1)[0].strip()

    is_nodes = ext in _NODES_EXTS or ctype in _NODES_MIMES
    if is_nodes:
        try:
            summary = await _process_nodes_bulk_upload(pid, raw, orig)
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("[upload-file] bulk_upload falló: %s", exc)
            raise HTTPException(400, f"No se pudo procesar el archivo de nodos: {exc}")
        return {
            "type": "nodes_bulk",
            "filename": orig,
            "mime_type": ctype or "application/octet-stream",
            "size": len(raw),
            "summary": summary,
        }

    # Documento (PDF/Word/etc.) → persistir en disco.
    if ctype and ctype not in _ALLOWED_DOC_MIMES:
        # No bloqueamos por extensión si el MIME es genérico, pero sí lo registramos.
        log.info("[upload-file] MIME no-listado pero aceptado: %s (%s)", ctype, orig)

    safe_name = _safe_filename(orig)
    file_id = uuid.uuid4().hex
    proj_dir = UPLOADS_DIR / pid
    try:
        proj_dir.mkdir(parents=True, exist_ok=True)
        on_disk = proj_dir / f"{file_id}__{safe_name}"
        on_disk.write_bytes(raw)
    except Exception as exc:
        log.exception("[upload-file] no se pudo escribir en disco: %s", exc)
        raise HTTPException(500, f"No se pudo guardar el archivo: {exc}")

    record = {
        "file_id": file_id,
        "name": Path(orig).stem or orig,
        "original_name": orig,
        "mime_type": ctype or "application/octet-stream",
        "size": len(raw),
        "url": f"/api/projects/{pid}/files/{file_id}",
        "path": str(on_disk),
        "uploaded_by": user.get("id"),
        "uploaded_by_name": user.get("name"),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.projects.update_one(
        {"id": pid},
        {"$push": {"reference_files": record}},
    )

    return {
        "type": "stored",
        "filename": orig,
        "mime_type": record["mime_type"],
        "size": record["size"],
        "file": record,
    }


@api.get("/projects/{pid}/files/{file_id}")
async def download_project_file(
    pid: str,
    file_id: str,
    user: dict = Depends(current_user),
):
    """Descarga un archivo previamente subido al proyecto.

    Requiere acceso al proyecto (rol/scope).
    """
    await ensure_project_access(user, pid)
    proj = await db.projects.find_one({"id": pid}, {"_id": 0, "reference_files": 1})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")
    refs = (proj or {}).get("reference_files") or []
    rec = next((f for f in refs if (f or {}).get("file_id") == file_id), None)
    if not rec:
        raise HTTPException(404, "Archivo no encontrado")
    on_disk = Path(rec.get("path") or "")
    if not on_disk.exists():
        raise HTTPException(404, "Archivo no disponible en disco")
    return FileResponse(
        path=str(on_disk),
        media_type=rec.get("mime_type") or "application/octet-stream",
        filename=rec.get("original_name") or on_disk.name,
    )


@api.delete("/projects/{pid}/files/{file_id}")
async def delete_project_file(
    pid: str,
    file_id: str,
    user: dict = Depends(require_role(ROLE_COORD, ROLE_JEFE)),
):
    """Elimina un archivo adjunto del proyecto (registro + binario en disco)."""
    await ensure_project_access(user, pid)
    proj = await db.projects.find_one({"id": pid}, {"_id": 0, "reference_files": 1})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")
    refs = (proj or {}).get("reference_files") or []
    rec = next((f for f in refs if (f or {}).get("file_id") == file_id), None)
    if not rec:
        raise HTTPException(404, "Archivo no encontrado")
    # Quitar de la BD primero (la verdad de origen).
    await db.projects.update_one(
        {"id": pid},
        {"$pull": {"reference_files": {"file_id": file_id}}},
    )
    # Best-effort: borrar binario.
    try:
        on_disk = Path(rec.get("path") or "")
        if on_disk.exists():
            on_disk.unlink()
    except Exception as exc:
        log.warning("[upload-file] no se pudo borrar binario: %s", exc)
    return {"ok": True, "file_id": file_id}


# === AREAS (por proyecto) ===================================================
@api.get("/projects/{pid}/areas")
async def list_areas(pid: str, user: dict = Depends(current_user)):
    await ensure_project_access(user, pid)
    items = await db.areas.find({"project_id": pid}).sort("name", 1).to_list(length=200)
    for it in items:
        it.pop("_id", None)
    return items


@api.post("/projects/{pid}/areas")
async def create_area(pid: str, body: AreaIn, user: dict = Depends(require_role(ROLE_COORD))):
    if body.project_id != pid:
        raise HTTPException(400, "project_id mismatch")
    await ensure_project_access(user, pid)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Nombre requerido")
    existing = await db.areas.find_one({"project_id": pid, "name": name})
    if existing:
        raise HTTPException(409, "Área ya existe en este proyecto")
    doc = {
        "id": str(uuid.uuid4()),
        "project_id": pid,
        "name": name,
        "color": body.color or "#1E40AF",
        "created_at": datetime.now(timezone.utc),
    }
    await db.areas.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/areas/{aid}")
async def delete_area(aid: str, user: dict = Depends(require_role(ROLE_COORD))):
    a = await db.areas.find_one({"id": aid})
    if not a:
        raise HTTPException(404, "Área no existe")
    await db.areas.delete_one({"id": aid})
    return {"ok": True}


# === INVITATIONS ============================================================
@api.get("/projects/{pid}/invitations")
async def list_invites(pid: str, user: dict = Depends(require_role(ROLE_COORD))):
    await ensure_project_access(user, pid)
    items = await db.invitations.find({"project_id": pid}).sort("created_at", -1).to_list(length=500)
    for it in items:
        it.pop("_id", None)
    return items


@api.post("/projects/{pid}/invitations")
async def create_invite(pid: str, body: InvitationIn, user: dict = Depends(require_role(ROLE_COORD))):
    if body.project_id != pid:
        raise HTTPException(400, "project_id mismatch")
    project = await ensure_project_access(user, pid)
    email = body.email.lower()
    # Validaciones por rol (deben ejecutarse antes del auto-link para validar pertenencia al proyecto)
    if body.role == "sub_coordinador":
        if not body.scope_node_id:
            raise HTTPException(400, "Sub-coordinador requiere scope_node_id")
        node = await db.location_nodes.find_one({"id": body.scope_node_id, "project_id": pid})
        if not node:
            raise HTTPException(404, "scope_node_id inválido")
        # Área/disciplina opcional del sub-coordinador — se usa en los exports
        # ejecutivos (PDF/PPTX) para etiquetar los reportes bajo esta disciplina.
        # Si NO se asigna, exports usan "Obra Civil" como fallback.
        if body.area_id:
            area = await db.areas.find_one({"id": body.area_id, "project_id": pid})
            if not area:
                raise HTTPException(404, "area_id inválido para sub-coordinador")
    elif body.role == "especialista":
        if not body.area_id:
            raise HTTPException(400, "Especialista requiere area_id")
        area = await db.areas.find_one({"id": body.area_id, "project_id": pid})
        if not area:
            raise HTTPException(404, "area_id inválido")
        if not body.scope_node_ids:
            raise HTTPException(400, "Especialista requiere al menos 1 scope_node_id")
        # Todos deben ser hojas del proyecto
        nodes = await db.location_nodes.find(
            {"id": {"$in": body.scope_node_ids}, "project_id": pid}
        ).to_list(length=1000)
        if len(nodes) != len(body.scope_node_ids):
            raise HTTPException(400, "scope_node_ids contiene IDs inválidos")
        for n in nodes:
            if not n.get("is_leaf"):
                raise HTTPException(400, f"Nodo '{n['name']}' no es hoja")
    # ====================================================================
    # REGLA GLOBAL: 1 USUARIO = 1 PROYECTO
    # --------------------------------------------------------------------
    # Un mismo correo NO puede ser invitado ni dado de alta en más de un
    # proyecto. Si ya existe como usuario en ANY proyecto, o si tiene una
    # invitación pendiente en OTRO proyecto, rechazamos con 400.
    # ====================================================================
    existing_user = await db.users.find_one({"email": email})
    if existing_user:
        raise HTTPException(400, "Este usuario ya está asignado a otro proyecto")
    pending_in_other = await db.invitations.find_one({
        "email": email,
        "status": "pending",
        "project_id": {"$ne": pid},
    })
    if pending_in_other:
        raise HTTPException(400, "Este usuario ya está asignado a otro proyecto")
    tok = secrets.token_urlsafe(24)
    doc = {
        "id": str(uuid.uuid4()),
        "token": tok,
        "project_id": pid,
        "project_name": project["name"],
        "email": email,
        "name": body.name.strip(),
        "role": body.role,
        "area_id": body.area_id,
        "puesto": (body.puesto or "").strip() or None,
        "scope_node_id": body.scope_node_id,
        "scope_node_ids": body.scope_node_ids or [],
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=30),
    }
    await db.invitations.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/invitations/{iid}")
async def revoke_invite(iid: str, user: dict = Depends(require_role(ROLE_COORD))):
    r = await db.invitations.update_one({"id": iid, "status": "pending"}, {"$set": {"status": "revoked"}})
    if r.matched_count == 0:
        raise HTTPException(404, "Invitación no pendiente")
    return {"ok": True}


@api.get("/invitations/by-token/{tok}")
async def invite_preview(tok: str):
    inv = await db.invitations.find_one({"token": tok})
    if not inv:
        raise HTTPException(404, "Invitación inválida")
    if inv["status"] != "pending":
        raise HTTPException(410, f"Invitación {inv['status']}")
    exp = inv["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(410, "Invitación expirada")
    inv.pop("_id", None)
    area_name = None
    if inv.get("area_id"):
        area = await db.areas.find_one({"id": inv["area_id"]})
        if area:
            area_name = area.get("name")
    return {
        "project_name": inv["project_name"],
        "email": inv["email"],
        "name": inv["name"],
        "role": inv["role"],
        "puesto": inv.get("puesto"),
        "area_name": area_name,
    }


@api.post("/invitations/accept", response_model=Token)
async def accept_invite(body: AcceptInviteIn):
    inv = await db.invitations.find_one({"token": body.token})
    if not inv:
        raise HTTPException(404, "Invitación inválida")
    if inv["status"] != "pending":
        raise HTTPException(410, f"Invitación {inv['status']}")
    exp = inv["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(410, "Invitación expirada")
    if len(body.password) < 6:
        raise HTTPException(400, "Password mínimo 6 caracteres")
    existing = await db.users.find_one({"email": inv["email"]})
    if existing:
        raise HTTPException(400, "Este usuario ya está asignado a otro proyecto")
    uid = str(uuid.uuid4())
    # Obtener nombre del área si aplica
    area_name = None
    if inv.get("area_id"):
        a = await db.areas.find_one({"id": inv["area_id"]})
        if a:
            area_name = a["name"]
    user_doc = {
        "id": uid,
        "email": inv["email"],
        "password": hash_pw(body.password),
        "name": inv["name"],
        "role": inv["role"],
        "area": area_name,
        "area_id": inv.get("area_id"),
        "puesto": inv.get("puesto"),
        "scope_node_id": inv.get("scope_node_id"),
        "scope_node_ids": inv.get("scope_node_ids") or [],
        "project_ids": [inv["project_id"]],
        "created_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(user_doc)
    await db.invitations.update_one(
        {"id": inv["id"]}, {"$set": {"status": "accepted", "accepted_at": datetime.now(timezone.utc), "accepted_user_id": uid}}
    )
    return {"token": make_token(uid), "user": user_to_out(user_doc)}


# === REPORTS ================================================================
def validate_measurement_value(mtype: str, value: dict):
    if mtype == "coord_latlon":
        lat, lon = value.get("lat"), value.get("lon")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            raise HTTPException(400, "coord_latlon requiere lat y lon numéricos")
        # Nota: en obra civil usamos UTM (X/Y en cientos de miles o millones),
        # por lo que NO aplicamos restricción geográfica -90/90, -180/180.
    elif mtype == "cadenamiento":
        v = value.get("cadenamiento") or value.get("value")
        if not isinstance(v, str) or not re.match(r"^\d+\+\d{1,4}(\.\d+)?$", v):
            raise HTTPException(400, "cadenamiento formato '5+100' o '5+100.50'")
    elif mtype == "eje":
        v = value.get("eje") or value.get("value")
        if not isinstance(v, str) or not v.strip():
            raise HTTPException(400, "eje requiere texto")
    elif mtype == "nivel":
        v = value.get("nivel") if "nivel" in value else value.get("value")
        if not isinstance(v, (int, float)):
            raise HTTPException(400, "nivel requiere número decimal")
    else:
        raise HTTPException(400, f"measurement_type desconocido: {mtype}")


@api.post("/reports")
async def create_report(body: ReportIn, user: dict = Depends(current_user)):
    if user["role"] not in (ROLE_ESPECIALISTA, ROLE_COORD, ROLE_SUB, ROLE_JEFE):
        raise HTTPException(403, "Tu rol no puede capturar reportes")
    await ensure_project_access(user, body.project_id)
    node = await db.location_nodes.find_one({"id": body.node_id, "project_id": body.project_id})
    if not node:
        raise HTTPException(404, "Nodo no existe en este proyecto")
    if not node.get("is_leaf"):
        raise HTTPException(400, "Solo se puede capturar en nodos hoja")
    if user["role"] == ROLE_ESPECIALISTA:
        if body.node_id not in (user.get("scope_node_ids") or []):
            raise HTTPException(403, "Nodo no está en tu scope autorizado")
    # Sub-coordinador: scope GLOBAL (puede capturar en cualquier hoja del proyecto).
    # ====================================================================
    # FALLBACK DE COORDENADAS DESDE metadata DEL NODO (pre-validación)
    # --------------------------------------------------------------------
    # Si el nodo es coord_latlon y el cliente NO mandó lat/lon válidos,
    # intentamos inyectar X/Y desde node.metadata ANTES de validar para que
    # la captura no falle cuando el Coordinador ya cargó coords vía Excel.
    # El cliente conserva el control: si manda valores, esos se respetan.
    # ====================================================================
    pre_mv = dict(body.measurement_value or {})
    if node.get("measurement_type") == "coord_latlon":
        pre_lat = pre_mv.get("lat")
        pre_lon = pre_mv.get("lon")
        client_valid = (
            isinstance(pre_lat, (int, float)) and isinstance(pre_lon, (int, float))
            and not (pre_lat == 0 and pre_lon == 0)
        )
        if not client_valid:
            node_meta = node.get("metadata") or {}
            inh_x = None
            inh_y = None
            if isinstance(node_meta, dict):
                for k, v in node_meta.items():
                    if v is None or not isinstance(k, str):
                        continue
                    kn = k.strip().lower()
                    for src, dst in (("á","a"),("é","e"),("í","i"),("ó","o"),("ú","u")):
                        kn = kn.replace(src, dst)
                    if kn in {"x", "coordenada x", "coord x"} and inh_x is None:
                        try: inh_x = float(v)
                        except Exception: pass
                    elif kn in {"y", "coordenada y", "coord y"} and inh_y is None:
                        try: inh_y = float(v)
                        except Exception: pass
            if inh_x is not None and inh_y is not None:
                pre_mv["lat"] = inh_y
                pre_mv["lon"] = inh_x
                # marcamos source para que el cierre sepa que fue fallback
                pre_mv["coord_source"] = "node_metadata"
                body.measurement_value = pre_mv

    validate_measurement_value(node["measurement_type"], body.measurement_value)
    path_names = await node_path_names(body.node_id)
    area_name = None
    if body.area_id:
        a = await db.areas.find_one({"id": body.area_id, "project_id": body.project_id})
        if a:
            area_name = a["name"]
    elif user.get("area"):
        area_name = user["area"]
    # Persistimos lecturas P/U también dentro de measurement_value para que el
    # endpoint /history pueda devolverlas a la siguiente captura del nodo.
    mv = dict(body.measurement_value or {})
    if body.primera_lectura is not None:
        mv["primera_lectura"] = body.primera_lectura
    if body.ultima_lectura is not None:
        mv["ultima_lectura"] = body.ultima_lectura

    # ====================================================================
    # Trace de fuente de coordenadas (para auditoría).
    # Si pre-validación ya marcó coord_source=node_metadata, se mantiene.
    # En caso contrario, asumimos user_input.
    # ====================================================================
    if node.get("measurement_type") == "coord_latlon" and "coord_source" not in mv:
        mv["coord_source"] = "user_input"
    inherited_target = None
    if mv.get("coord_source") == "node_metadata":
        inherited_target = {"lat": mv.get("lat"), "lon": mv.get("lon"), "elev": None}

    # ====================================================================
    # Normalizar severidad (Informativo / Importante / Urgente).
    # Default = "informativo" (no escala a supervisores en exportaciones).
    # ====================================================================
    sev_raw = (body.severidad or "informativo").strip().lower()
    if sev_raw not in ("informativo", "importante", "urgente"):
        sev_raw = "informativo"

    # Lista de ids ancestrales (incluye el propio nodo) — para filtros y
    # vinculación de noticias a ancestros en la exportación.
    node_path_ids = list(node.get("path") or [])
    if body.node_id not in node_path_ids:
        node_path_ids.append(body.node_id)

    doc = {
        "id": str(uuid.uuid4()),
        "project_id": body.project_id,
        "node_id": body.node_id,
        "node_path_names": path_names,
        "node_path_ids": node_path_ids,
        "measurement_type": node["measurement_type"],
        "measurement_value": mv,
        "node_target": inherited_target if inherited_target is not None else (
            {
                "lat": node.get("target_lat"),
                "lon": node.get("target_lon"),
                "elev": node.get("target_elev"),
            } if node.get("measurement_type") == "coord_latlon" else None
        ),
        "area_id": body.area_id or user.get("area_id"),
        "area_name": area_name,
        "title": (body.title or "").strip()[:200] or None,
        "notes": (body.notes or "").strip() or None,
        "avance": (body.avance or "").strip() or None,
        "observaciones": (body.observaciones or "").strip() or None,
        "incidencias": (body.incidencias or "").strip() or None,
        "severidad": sev_raw,
        "contratista": (body.contratista or "").strip() or None,
        "personnel": body.personnel,
        "equipment": body.equipment,
        "images": body.images,
        "photo_captions": (body.photo_captions or [])[:len(body.images or [])],
        "files": body.files,
        "primera_lectura": body.primera_lectura,
        "ultima_lectura": body.ultima_lectura,
        "unidad": (body.unidad or "m").strip() or "m",
        "captured_by": user["id"],
        "captured_by_name": user["name"],
        "created_at": datetime.now(timezone.utc),
    }
    await db.reports.insert_one(doc)
    doc.pop("_id", None)

    # ====================================================================
    # PUSH NOTIFICATION DISPATCH (background, fire-and-forget)
    # --------------------------------------------------------------------
    # Notifica a los supervisores del proyecto (Coordinador General y Jefe
    # de Proyecto) cuando se captura un nuevo reporte. Se ejecuta como
    # tarea en segundo plano con asyncio.create_task() para no bloquear
    # la respuesta al especialista.
    # ====================================================================
    try:
        project = await db.projects.find_one(
            {"id": body.project_id},
            {"_id": 0, "name": 1},
        )
        project_name = (project or {}).get("name") or "el proyecto"
        node_name = (path_names[-1] if path_names else None) or node.get("name") or "nodo"
        asyncio.create_task(
            _notify_supervisors_new_report(
                project_id=body.project_id,
                project_name=project_name,
                node_name=node_name,
                report_id=doc["id"],
                author_id=user["id"],
                author_name=user.get("name") or "Especialista",
            )
        )
    except Exception as exc:  # defensive: nunca rompemos el return del reporte.
        log.exception("[push] no se pudo agendar la notificación: %s", exc)

    return doc


async def _notify_supervisors_new_report(
    project_id: str,
    project_name: str,
    node_name: str,
    report_id: str,
    author_id: str,
    author_name: str,
) -> None:
    """
    Carga a los supervisores del proyecto (coordinador_general + jefe_proyecto)
    y dispara `send_push_notification` para cada uno. Se excluye al autor del
    reporte para que no se auto-notifique cuando él mismo lo captura.

    Esta función es defensiva: si un envío falla, se loguea y se continúa con
    el siguiente destinatario.
    """
    try:
        cursor = db.users.find(
            {
                "project_ids": project_id,
                "role": {"$in": [ROLE_COORD, ROLE_JEFE]},
            },
            {"_id": 0, "id": 1, "name": 1, "role": 1, "expo_push_tokens": 1},
        )
        recipients = [u async for u in cursor]
    except Exception as exc:
        log.exception("[push] no se pudo cargar destinatarios: %s", exc)
        return

    if not recipients:
        log.info(
            "[push] sin destinatarios (proyecto=%s, autor=%s)",
            project_id,
            author_name,
        )
        return

    title = f"Nuevo reporte en {project_name}"
    body_text = f"{author_name} registró un avance en {node_name}."
    payload = {
        "type": "new_report",
        "project_id": project_id,
        "report_id": report_id,
        "node_name": node_name,
    }

    for recipient in recipients:
        if recipient.get("id") == author_id:
            continue  # Skip self-notification.
        if not (recipient.get("expo_push_tokens") or []):
            continue  # Skip users without registered devices.
        try:
            result = await send_push_notification(
                user_id=recipient["id"],
                title=title,
                body=body_text,
                data=payload,
            )
            log.info(
                "[push] new_report → user=%s sent=%d ok=%s",
                recipient.get("name"),
                result.get("sent", 0),
                result.get("ok"),
            )
        except Exception as exc:
            log.exception(
                "[push] envío falló user=%s: %s",
                recipient.get("name"),
                exc,
            )


@api.get("/projects/{pid}/nodes/{nid}/history")
async def node_history(pid: str, nid: str, user: dict = Depends(current_user)):
    """Devuelve el último reporte del nodo para que el especialista pueda ver
    la lectura previa registrada (helper "Última lectura registrada en este
    nodo: [valor]"). Aplica el mismo RBAC que /reports.
    """
    await ensure_project_access(user, pid)
    node = await db.location_nodes.find_one({"id": nid, "project_id": pid})
    if not node:
        raise HTTPException(404, "Nodo no existe en este proyecto")
    if user["role"] == ROLE_ESPECIALISTA:
        if nid not in (user.get("scope_node_ids") or []):
            raise HTTPException(403, "Nodo no está en tu scope autorizado")
    # Sub-coordinador: acceso GLOBAL (sin restricción de scope).

    last = await db.reports.find_one(
        {"project_id": pid, "node_id": nid},
        sort=[("created_at", -1)],
    )
    if not last:
        return {
            "node_id": nid,
            "measurement_type": node.get("measurement_type"),
            "has_previous": False,
            "last_report": None,
        }
    last.pop("_id", None)
    mv = last.get("measurement_value") or {}
    return {
        "node_id": nid,
        "measurement_type": node.get("measurement_type"),
        "has_previous": True,
        "last_report": {
            "id": last.get("id"),
            "created_at": last.get("created_at"),
            "captured_by_name": last.get("captured_by_name"),
            "measurement_value": mv,
            "primera_lectura": mv.get("primera_lectura"),
            "ultima_lectura": mv.get("ultima_lectura"),
            "avance": last.get("avance"),
            "notes": last.get("notes"),
        },
    }


@api.get("/projects/{pid}/reports")
async def list_reports(pid: str, user: dict = Depends(current_user)):
    await ensure_project_access(user, pid)
    q: dict = {"project_id": pid}
    if user["role"] == ROLE_ESPECIALISTA:
        scope = user.get("scope_node_ids") or []
        q["node_id"] = {"$in": scope}
    # Sub-coordinador: acceso GLOBAL al listado de reportes (sin filtro de scope).
    items = await db.reports.find(q).sort("created_at", -1).to_list(length=2000)
    for it in items:
        it.pop("_id", None)
    return items


# ---- FEED endpoint (Specialist Dashboard) ---------------------------------
def _feed_range_start(rng: str) -> Optional[datetime]:
    """Devuelve el inicio del rango en UTC.

    today  → hoy 00:00 UTC
    week   → últimos 7 días (now - 7d)
    month  → últimos 30 días (now - 30d)
    all/None → None (sin filtro temporal)
    """
    now = datetime.now(timezone.utc)
    rng = (rng or "today").lower()
    if rng == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if rng == "week":
        return now - timedelta(days=7)
    if rng == "month":
        return now - timedelta(days=30)
    return None


@api.get("/projects/{pid}/reports/feed")
async def reports_feed(
    pid: str,
    range: str = "today",
    limit: int = 50,
    q: Optional[str] = None,
    user: dict = Depends(current_user),
):
    """Feed consolidado para Especialistas / Sub-Coordinadores.

    Devuelve estadísticas (total, mine, others) y la lista de reportes recientes
    livianos (solo primera imagen como thumbnail, conteo del resto).
    Aplica el mismo scope RBAC que list_reports.

    Búsqueda inteligente (`q`): filtra reportes cuyo `title`, `notes`,
    `observaciones`, `incidencias`, `contratista`, `captured_by_name` o
    cualquier segmento de `node_path_names` contenga el texto (case-insensitive).
    """
    await ensure_project_access(user, pid)
    query: dict = {"project_id": pid}
    if user["role"] == ROLE_ESPECIALISTA:
        scope = user.get("scope_node_ids") or []
        query["node_id"] = {"$in": scope}
    # Sub-coordinador: feed GLOBAL del proyecto (sin restricción de scope).

    start = _feed_range_start(range)
    if start is not None:
        query["created_at"] = {"$gte": start}

    # Búsqueda inteligente por texto libre — regex case-insensitive sobre
    # múltiples campos. Se escapan meta-caracteres regex para evitar errores
    # cuando el usuario escribe símbolos.
    q_txt = (q or "").strip()
    if q_txt:
        import re as _re
        pat = _re.escape(q_txt)
        query["$or"] = [
            {"title": {"$regex": pat, "$options": "i"}},
            {"notes": {"$regex": pat, "$options": "i"}},
            {"observaciones": {"$regex": pat, "$options": "i"}},
            {"incidencias": {"$regex": pat, "$options": "i"}},
            {"contratista": {"$regex": pat, "$options": "i"}},
            {"captured_by_name": {"$regex": pat, "$options": "i"}},
            {"node_path_names": {"$regex": pat, "$options": "i"}},
        ]

    # Conteos agregados por captured_by (con un solo round trip).
    pipeline = [
        {"$match": query},
        {"$group": {"_id": "$captured_by", "count": {"$sum": 1}}},
    ]
    groups = await db.reports.aggregate(pipeline).to_list(length=10000)
    total = sum(int(g.get("count", 0)) for g in groups)
    mine = sum(int(g.get("count", 0)) for g in groups if g.get("_id") == user["id"])
    others = total - mine

    # Lista de items livianos (orden desc, limit).
    safe_limit = max(1, min(int(limit or 50), 200))
    cursor = db.reports.find(query).sort("created_at", -1).limit(safe_limit)
    raw_items = await cursor.to_list(length=safe_limit)

    # Mapa de áreas (para color y nombre real).
    area_ids = {it.get("area_id") for it in raw_items if it.get("area_id")}
    areas_by_id: dict = {}
    if area_ids:
        async for a in db.areas.find({"id": {"$in": list(area_ids)}}):
            areas_by_id[a["id"]] = {"name": a.get("name"), "color": a.get("color")}

    items_out = []
    for it in raw_items:
        imgs = it.get("images") or []
        area_id = it.get("area_id")
        area_info = areas_by_id.get(area_id) if area_id else None
        items_out.append({
            "id": it["id"],
            "project_id": it["project_id"],
            "node_id": it["node_id"],
            "node_path_names": it.get("node_path_names") or [],
            "measurement_type": it.get("measurement_type"),
            "measurement_value": it.get("measurement_value") or {},
            "title": it.get("title"),
            "area_id": area_id,
            "area_name": (area_info or {}).get("name") or it.get("area_name"),
            "area_color": (area_info or {}).get("color"),
            "avance": it.get("avance"),
            "contratista": it.get("contratista"),
            "personnel": it.get("personnel") or [],
            "equipment": it.get("equipment") or [],
            "captured_by": it.get("captured_by"),
            "captured_by_name": it.get("captured_by_name"),
            "notes": it.get("notes"),
            "observaciones": it.get("observaciones"),
            "is_mine": it.get("captured_by") == user["id"],
            "images_count": len(imgs),
            "thumbnail_base64": imgs[0] if imgs else None,
            "created_at": it.get("created_at"),
        })

    return {
        "range": range,
        "stats": {"total": total, "mine": mine, "others": others},
        "reports": items_out,
    }


@api.get("/reports/{rid}")
async def get_report(rid: str, user: dict = Depends(current_user)):
    r = await db.reports.find_one({"id": rid})
    if not r:
        raise HTTPException(404, "Reporte no existe")
    await ensure_project_access(user, r["project_id"])
    # Scope check
    if user["role"] == ROLE_ESPECIALISTA:
        if r["node_id"] not in (user.get("scope_node_ids") or []):
            raise HTTPException(403, "Sin acceso a este reporte")
    # Sub-coordinador: acceso GLOBAL (sin filtro de scope).
    r.pop("_id", None)
    return r


# ---------------------------------------------------------------------------
# COLLAGE 2x2 (Fallback nativo para compartir en WhatsApp / mensajeros)
# ---------------------------------------------------------------------------
@api.get("/reports/{rid}/collage.jpg")
async def get_report_collage(rid: str, user: dict = Depends(current_user)):
    """Devuelve un JPEG con un collage 2x2 de hasta 4 fotos del reporte.
    Diseñado como fallback de compartir nativo: una sola imagen unificada
    incluye todo el material fotográfico clave del reporte.
    """
    r = await db.reports.find_one({"id": rid})
    if not r:
        raise HTTPException(404, "Reporte no existe")
    await ensure_project_access(user, r["project_id"])
    if user["role"] == ROLE_ESPECIALISTA:
        if r["node_id"] not in (user.get("scope_node_ids") or []):
            raise HTTPException(403, "Sin acceso a este reporte")
    imgs = (r.get("images") or [])[:4]
    if not imgs:
        raise HTTPException(404, "El reporte no tiene fotografías")

    from PIL import Image, ImageDraw, ImageFont  # noqa: WPS433

    # Lienzo final 1600x1600 (cuadrado, compatible con previews de WhatsApp).
    CANVAS = 1600
    GAP = 16
    CELL = (CANVAS - 3 * GAP) // 2  # 784 px por celda
    canvas = Image.new("RGB", (CANVAS, CANVAS), (245, 246, 250))

    # Cargar y normalizar cada imagen como un cuadrado CELL x CELL (cover).
    cells = []
    for b64 in imgs:
        try:
            raw = base64.b64decode(_strip_b64_prefix(b64))
            im = Image.open(io.BytesIO(raw)).convert("RGB")
            # Cover crop: escalar y recortar al centro
            iw, ih = im.size
            ratio = max(CELL / iw, CELL / ih)
            new_w, new_h = int(iw * ratio), int(ih * ratio)
            im = im.resize((new_w, new_h), Image.LANCZOS)
            left = (new_w - CELL) // 2
            top = (new_h - CELL) // 2
            im = im.crop((left, top, left + CELL, top + CELL))
            cells.append(im)
        except Exception:
            placeholder = Image.new("RGB", (CELL, CELL), (220, 220, 220))
            cells.append(placeholder)

    positions = [
        (GAP, GAP),
        (GAP * 2 + CELL, GAP),
        (GAP, GAP * 2 + CELL),
        (GAP * 2 + CELL, GAP * 2 + CELL),
    ]
    for i, cell in enumerate(cells):
        if i >= 4:
            break
        canvas.paste(cell, positions[i])

    # Marca SynCo discreta en la esquina inferior derecha
    try:
        draw = ImageDraw.Draw(canvas)
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        except Exception:
            font = ImageFont.load_default()
        stamp = f"SynCo · {len(cells)} foto{'s' if len(cells) != 1 else ''}"
        bbox = draw.textbbox((0, 0), stamp, font=font)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        pad = 10
        x0 = CANVAS - w - 2 * pad - GAP
        y0 = CANVAS - h - 2 * pad - GAP
        draw.rectangle([x0, y0, x0 + w + 2 * pad, y0 + h + 2 * pad],
                       fill=(15, 23, 42))
        draw.text((x0 + pad, y0 + pad), stamp, fill=(255, 255, 255), font=font)
    except Exception:
        pass

    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=88, optimize=True)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'inline; filename="collage_{rid[:8]}.jpg"'},
    )




@api.delete("/reports/{rid}")
async def delete_report(rid: str, user: dict = Depends(current_user)):
    r = await db.reports.find_one({"id": rid})
    if not r:
        raise HTTPException(404, "Reporte no existe")
    if user["role"] != ROLE_COORD and r["captured_by"] != user["id"]:
        raise HTTPException(403, "Solo el autor o un Coordinador General puede borrar")
    await db.reports.delete_one({"id": rid})
    return {"ok": True}


# --- Edición de descripciones individuales por foto ------------------------
# Endpoint quirúrgico que sólo permite modificar `photo_captions` sin tocar
# ningún otro dato del reporte. Cualquier miembro con acceso al proyecto y
# que sea el autor (o Coordinador General / Jefe de Proyecto) puede editar.
class ReportCaptionsPatch(BaseModel):
    photo_captions: List[str] = Field(default_factory=list)


@api.patch("/reports/{rid}/captions", response_model=ReportOut)
async def patch_report_captions(
    rid: str,
    body: ReportCaptionsPatch,
    user: dict = Depends(current_user),
):
    r = await db.reports.find_one({"id": rid})
    if not r:
        raise HTTPException(404, "Reporte no existe")
    # Autorización: autor original o roles supervisores.
    if user.get("role") not in (ROLE_COORD, ROLE_JEFE) and r.get("captured_by") != user["id"]:
        raise HTTPException(403, "Solo el autor o un Coordinador puede editar descripciones")
    # Sanitizamos: máximo 160 chars por caption y sólo se guardan hasta el
    # número real de imágenes que tiene el reporte (tope duro = 2 en export).
    raw_caps = body.photo_captions or []
    total_imgs = len(r.get("images") or [])
    cleaned = []
    for i, c in enumerate(raw_caps[:total_imgs]):
        s = (c or "").strip()
        if len(s) > 160:
            s = s[:160]
        cleaned.append(s)
    await db.reports.update_one(
        {"id": rid},
        {"$set": {"photo_captions": cleaned}},
    )
    updated = await db.reports.find_one({"id": rid}, {"_id": 0})
    return updated


# === USERS (admin) ==========================================================
@api.get("/projects/{pid}/users")
async def list_project_users(pid: str, user: dict = Depends(current_user)):
    """Lista usuarios miembros del proyecto. Cualquier miembro puede consultarla
    (usado para el selector de Mensajes Directos).

    Regla asimétrica: los Especialistas NO ven a los Coordinadores Generales en
    el directorio (no pueden iniciar chats con ellos).
    """
    await ensure_project_access(user, pid)
    # Incluye también a los Coord Generales y Jefes de Proyecto (que tienen
    # acceso global y pueden no estar en project_ids del documento).
    items = await db.users.find(
        {"$or": [
            {"project_ids": pid},
            {"role": {"$in": [ROLE_COORD, ROLE_JEFE]}},
        ]}
    ).to_list(length=1000)
    if user.get("role") == ROLE_ESPECIALISTA:
        items = [u for u in items if u.get("role") != ROLE_COORD]
    return [user_to_out(u) for u in items]


@api.get("/projects/{pid}/members")
async def list_project_members(pid: str, user: dict = Depends(current_user)):
    """Alias semántico de /users — lista miembros del proyecto."""
    await ensure_project_access(user, pid)
    items = await db.users.find(
        {"$or": [
            {"project_ids": pid},
            {"role": {"$in": [ROLE_COORD, ROLE_JEFE]}},
        ]}
    ).to_list(length=1000)
    if user.get("role") == ROLE_ESPECIALISTA:
        items = [u for u in items if u.get("role") != ROLE_COORD]
    return [user_to_out(u) for u in items]


# === ANNOUNCEMENTS (Noticias) ==============================================
class AnnouncementIn(BaseModel):
    title: str
    body: str
    pinned: bool = False
    jerarquia: Optional[str] = None  # 'urgente' | 'importante' | 'informativo' | None
    severidad: Optional[str] = None  # alias front-end de jerarquia
    audiencia: Optional[str] = None  # 'general' o area_id
    node_id: Optional[str] = None    # nodo al que se vincula la noticia (cualquier nivel)


class AnnouncementPatch(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    pinned: Optional[bool] = None
    jerarquia: Optional[str] = None
    severidad: Optional[str] = None
    audiencia: Optional[str] = None
    node_id: Optional[str] = None  # "" o null para desvincular


def _announcement_out(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


@api.get("/projects/{pid}/announcements")
async def list_announcements(pid: str, user: dict = Depends(current_user)):
    """Lista noticias del proyecto. Cualquier miembro del proyecto puede leer.

    Orden: pinned primero, luego más recientes primero.
    """
    await ensure_project_access(user, pid)
    cursor = db.announcements.find({"project_id": pid}).sort([("pinned", -1), ("created_at", -1)])
    items = await cursor.to_list(length=500)
    return [_announcement_out(it) for it in items]


@api.post("/projects/{pid}/announcements")
async def create_announcement(
    pid: str,
    body: AnnouncementIn,
    user: dict = Depends(current_user),
):
    """Cualquier miembro del proyecto puede publicar una noticia."""
    await ensure_project_access(user, pid)
    title = (body.title or "").strip()
    text = (body.body or "").strip()
    if not title:
        raise HTTPException(400, "Título requerido")
    if not text:
        raise HTTPException(400, "Cuerpo requerido")
    if len(title) > 140:
        raise HTTPException(400, "Título máximo 140 caracteres")
    if len(text) > 4000:
        raise HTTPException(400, "Cuerpo máximo 4000 caracteres")
    # Normaliza severidad/jerarquía (acepta ambos nombres).
    sev_raw = (body.severidad or body.jerarquia or "").strip().lower() or None
    if sev_raw and sev_raw not in ("urgente", "importante", "informativo"):
        raise HTTPException(400, "Severidad inválida")
    jerarquia = sev_raw
    # Audiencia: "general" (proyecto completo) o area_id
    audiencia = (body.audiencia or "").strip() or "general"
    if audiencia != "general":
        area = await db.areas.find_one({"id": audiencia, "project_id": pid})
        if not area:
            raise HTTPException(400, "Audiencia (área) inválida")
    # Vínculo opcional a nodo (cualquier nivel). Calculamos node_path_ids para
    # que el filtro por ancestros en la exportación sea O(1) en lectura.
    node_id = (body.node_id or "").strip() or None
    node_path_ids: list[str] = []
    node_name: Optional[str] = None
    if node_id:
        node = await db.location_nodes.find_one({"id": node_id, "project_id": pid})
        if not node:
            raise HTTPException(400, "Nodo no existe en este proyecto")
        node_path_ids = list(node.get("path") or [])
        if node_id not in node_path_ids:
            node_path_ids.append(node_id)
        node_name = node.get("name")
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "project_id": pid,
        "title": title,
        "body": text,
        "pinned": bool(body.pinned),
        "jerarquia": jerarquia,
        "audiencia": audiencia,
        "node_id": node_id,
        "node_path_ids": node_path_ids,
        "node_name": node_name,
        "author_id": user["id"],
        "author_name": user["name"],
        "author_role": user["role"],
        "created_at": now,
        "updated_at": now,
        "intranet": False,
    }
    await db.announcements.insert_one(doc)
    return _announcement_out(doc)


@api.patch("/announcements/{aid}")
async def update_announcement(
    aid: str,
    body: AnnouncementPatch,
    user: dict = Depends(current_user),
):
    """Editable por el autor o por cualquier Coordinador General."""
    a = await db.announcements.find_one({"id": aid})
    if not a:
        raise HTTPException(404, "Noticia no existe")
    await ensure_project_access(user, a["project_id"])
    is_author = a.get("author_id") == user["id"]
    is_coord = user["role"] == ROLE_COORD
    if not (is_author or is_coord):
        raise HTTPException(403, "Sólo el autor o un Coordinador puede editar")
    update: dict = {}
    if body.title is not None:
        t = body.title.strip()
        if not t:
            raise HTTPException(400, "Título no puede estar vacío")
        if len(t) > 140:
            raise HTTPException(400, "Título máximo 140 caracteres")
        update["title"] = t
    if body.body is not None:
        b = body.body.strip()
        if not b:
            raise HTTPException(400, "Cuerpo no puede estar vacío")
        if len(b) > 4000:
            raise HTTPException(400, "Cuerpo máximo 4000 caracteres")
        update["body"] = b
    if body.pinned is not None:
        # Sólo Coordinador puede fijar/desfijar (afecta visibilidad global).
        if not is_coord:
            raise HTTPException(403, "Sólo el Coordinador puede fijar noticias")
        update["pinned"] = bool(body.pinned)
    if body.jerarquia is not None or body.severidad is not None:
        j_raw = body.severidad if body.severidad is not None else body.jerarquia
        j = (j_raw or "").strip().lower()
        if j == "":
            update["jerarquia"] = None
        elif j in ("urgente", "importante", "informativo"):
            update["jerarquia"] = j
        else:
            raise HTTPException(400, "Severidad inválida")
    if body.audiencia is not None:
        aud = (body.audiencia or "").strip() or "general"
        if aud != "general":
            area = await db.areas.find_one({"id": aud, "project_id": a["project_id"]})
            if not area:
                raise HTTPException(400, "Audiencia (área) inválida")
        update["audiencia"] = aud
    if body.node_id is not None:
        nid = (body.node_id or "").strip()
        if not nid:
            update["node_id"] = None
            update["node_path_ids"] = []
            update["node_name"] = None
        else:
            node = await db.location_nodes.find_one({"id": nid, "project_id": a["project_id"]})
            if not node:
                raise HTTPException(400, "Nodo no existe en este proyecto")
            path_ids = list(node.get("path") or [])
            if nid not in path_ids:
                path_ids.append(nid)
            update["node_id"] = nid
            update["node_path_ids"] = path_ids
            update["node_name"] = node.get("name")
    if not update:
        return _announcement_out(a)
    update["updated_at"] = datetime.now(timezone.utc)
    await db.announcements.update_one({"id": aid}, {"$set": update})
    a = await db.announcements.find_one({"id": aid})
    return _announcement_out(a)


@api.delete("/announcements/{aid}")
async def delete_announcement(aid: str, user: dict = Depends(current_user)):
    """Eliminable por el autor o por cualquier Coordinador General."""
    a = await db.announcements.find_one({"id": aid})
    if not a:
        raise HTTPException(404, "Noticia no existe")
    await ensure_project_access(user, a["project_id"])
    is_author = a.get("author_id") == user["id"]
    is_coord = user["role"] == ROLE_COORD
    if not (is_author or is_coord):
        raise HTTPException(403, "Sólo el autor o un Coordinador puede eliminar")
    await db.announcements.delete_one({"id": aid})
    return {"ok": True}


# === CHANNELS + MESSAGES (Chat con canales: General / Áreas / Directos) =====
class MessageIn(BaseModel):
    text: str


def _message_out(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


def _channel_out(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


# Tipos de canal soportados
CHANNEL_TYPES = ("general", "area", "direct")


async def _ensure_default_channels(pid: str) -> None:
    """Crea (idempotentemente) el canal General y un canal por cada área del proyecto."""
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        return
    # General
    g = await db.channels.find_one({"project_id": pid, "type": "general"})
    now = datetime.now(timezone.utc)
    if not g:
        await db.channels.insert_one({
            "id": str(uuid.uuid4()),
            "project_id": pid,
            "type": "general",
            "name": "General",
            "area_id": None,
            "color": None,
            "member_ids": None,
            "created_at": now,
        })
    # Per-area
    areas = await db.areas.find({"project_id": pid}).to_list(length=200)
    for area in areas:
        existing = await db.channels.find_one({
            "project_id": pid, "type": "area", "area_id": area["id"],
        })
        if not existing:
            await db.channels.insert_one({
                "id": str(uuid.uuid4()),
                "project_id": pid,
                "type": "area",
                "name": area["name"],
                "area_id": area["id"],
                "color": area.get("color"),
                "member_ids": None,
                "created_at": now,
            })
        else:
            # Sincroniza nombre/color con el área (por si Coord la renombró)
            patch = {}
            if existing.get("name") != area["name"]:
                patch["name"] = area["name"]
            if existing.get("color") != area.get("color"):
                patch["color"] = area.get("color")
            if patch:
                await db.channels.update_one({"id": existing["id"]}, {"$set": patch})


def _can_access_channel(user: dict, ch: dict) -> bool:
    pid = ch["project_id"]
    project_ids = user.get("project_ids") or []
    # ===== Roles gerenciales con acceso TRANSVERSAL al proyecto =====
    # Coordinador General y Jefe de Proyecto tienen acceso GLOBAL a todos los
    # proyectos (no dependen de project_ids). Sub-coordinador requiere
    # pertenencia explícita al proyecto.
    if user["role"] == ROLE_COORD or user["role"] == ROLE_JEFE:
        if ch["type"] == "direct":
            return user["id"] in (ch.get("member_ids") or [])
        return True
    if user["role"] == ROLE_SUB:
        if pid not in project_ids:
            return False
        if ch["type"] == "direct":
            return user["id"] in (ch.get("member_ids") or [])
        return True
    # ===== Especialistas =====
    if pid not in project_ids:
        return False
    if ch["type"] == "general":
        return True
    if ch["type"] == "area":
        # Especialistas con area_id que coincide.
        return user.get("area_id") and user.get("area_id") == ch.get("area_id")
    if ch["type"] == "direct":
        return user["id"] in (ch.get("member_ids") or [])
    return False


def _direct_peer_role(user_id: str, ch: dict, peer_role_cache: dict) -> Optional[str]:
    """Helper sync — devuelve el rol del 'otro' miembro de un canal directo,
    si ya está cacheado. Pensado para usarse dentro de funciones async donde
    el caller hace la carga del peer."""
    other_id = next((mid for mid in (ch.get("member_ids") or []) if mid != user_id), None)
    return peer_role_cache.get(other_id) if other_id else None


async def _check_direct_send_rule(sender: dict, ch: dict) -> None:
    """Aplica la regla asimétrica de mensajería del Coordinador General:
      - Coord General puede ENVIAR a cualquier rol.
      - Coord General sólo puede RECIBIR de Jefe de Proyecto y Sub-coordinador.
      - Por tanto, un Especialista NO puede enviar mensajes a un Coord General
        en un canal directo.
    Lanza HTTPException(403) si el envío es inválido. Sólo aplica a canales 'direct'.
    """
    if ch.get("type") != "direct":
        return
    if sender.get("role") != ROLE_ESPECIALISTA:
        return
    other_id = next(
        (mid for mid in (ch.get("member_ids") or []) if mid != sender["id"]),
        None,
    )
    if not other_id:
        return
    other = await db.users.find_one({"id": other_id}, {"role": 1})
    if other and other.get("role") == ROLE_COORD:
        raise HTTPException(
            403,
            "Los especialistas no pueden enviar mensajes al Coordinador General. "
            "Contacta a tu Jefe de Proyecto o Sub-coordinador.",
        )


async def _general_channel_id(pid: str) -> str:
    await _ensure_default_channels(pid)
    g = await db.channels.find_one({"project_id": pid, "type": "general"})
    return g["id"] if g else ""


@api.get("/projects/{pid}/channels")
async def list_channels(pid: str, user: dict = Depends(current_user)):
    """Lista los canales accesibles del proyecto para el usuario actual.
    Crea automáticamente los canales por defecto (General + uno por área) si faltan.
    Cada canal trae su último mensaje (preview) para la lista estilo Slack/WhatsApp."""
    await ensure_project_access(user, pid)
    await _ensure_default_channels(pid)
    raw = await db.channels.find({"project_id": pid}).to_list(length=500)
    out: list = []
    for ch in raw:
        if not _can_access_channel(user, ch):
            continue
        # Para directos: nombre dinámico = nombre del otro usuario
        display_name = ch.get("name") or ""
        peer = None
        if ch["type"] == "direct":
            other_id = next(
                (mid for mid in (ch.get("member_ids") or []) if mid != user["id"]),
                None,
            )
            if other_id:
                other = await db.users.find_one({"id": other_id})
                if other:
                    display_name = other.get("name") or display_name
                    peer = {
                        "id": other.get("id"),
                        "name": other.get("name"),
                        "role": other.get("role"),
                    }
        # Último mensaje
        last_doc = await db.messages.find({"channel_id": ch["id"]}).sort("created_at", -1).limit(1).to_list(length=1)
        last_msg = None
        if last_doc:
            lm = last_doc[0]
            last_msg = {
                "id": lm["id"],
                "text": (lm.get("text") or "")[:140],
                "user_id": lm.get("user_id"),
                "user_name": lm.get("user_name"),
                "created_at": lm.get("created_at"),
            }
        out.append({
            "id": ch["id"],
            "project_id": ch["project_id"],
            "type": ch["type"],
            "name": display_name,
            "area_id": ch.get("area_id"),
            "color": ch.get("color"),
            "member_ids": ch.get("member_ids"),
            "peer": peer,
            "last_message": last_msg,
            "created_at": ch.get("created_at"),
        })
    # Orden: general primero, luego áreas, luego directos por last_message desc
    type_order = {"general": 0, "area": 1, "direct": 2}

    def _sort_key(c):
        t = type_order.get(c["type"], 9)
        last_dt = (c.get("last_message") or {}).get("created_at")
        # Más reciente primero dentro del mismo grupo
        ts = last_dt.timestamp() if isinstance(last_dt, datetime) else 0
        return (t, -ts, (c.get("name") or "").lower())

    out.sort(key=_sort_key)
    return out


class DirectChannelIn(BaseModel):
    target_user_id: str


@api.post("/projects/{pid}/channels/direct")
async def create_direct_channel(pid: str, body: DirectChannelIn, user: dict = Depends(current_user)):
    """Crea (o devuelve si ya existe) un canal directo 1-a-1 entre el usuario actual y target_user_id."""
    await ensure_project_access(user, pid)
    if body.target_user_id == user["id"]:
        raise HTTPException(400, "No puedes iniciar un chat contigo mismo")
    target = await db.users.find_one({"id": body.target_user_id})
    if not target:
        raise HTTPException(404, "Usuario no existe")
    # Coord General y Jefe de Proyecto tienen acceso global a todos los proyectos,
    # por lo que su pertenencia se asume sin necesidad de project_ids.
    if target.get("role") not in (ROLE_COORD, ROLE_JEFE):
        if pid not in (target.get("project_ids") or []):
            raise HTTPException(404, "Ese usuario no pertenece al proyecto")
    # Regla asimétrica: un Especialista NO puede iniciar un chat con un Coordinador
    # General. El Coord General sí puede iniciar chats con cualquiera.
    if user.get("role") == ROLE_ESPECIALISTA and target.get("role") == ROLE_COORD:
        raise HTTPException(
            403,
            "Los especialistas no pueden iniciar chats con la Coordinación General. "
            "Contacta a tu Jefe de Proyecto o Sub-coordinador.",
        )
    members = sorted([user["id"], body.target_user_id])
    existing = await db.channels.find_one({
        "project_id": pid, "type": "direct", "member_ids": members,
    })
    if existing:
        existing.pop("_id", None)
        # Devuelve con nombre del peer
        existing["name"] = target.get("name") or "DM"
        existing["peer"] = {
            "id": target.get("id"), "name": target.get("name"), "role": target.get("role"),
        }
        return existing
    doc = {
        "id": str(uuid.uuid4()),
        "project_id": pid,
        "type": "direct",
        "name": "DM",  # se reemplaza por el nombre del peer en la respuesta
        "area_id": None,
        "color": None,
        "member_ids": members,
        "created_at": datetime.now(timezone.utc),
    }
    await db.channels.insert_one(doc)
    doc.pop("_id", None)
    doc["name"] = target.get("name") or "DM"
    doc["peer"] = {
        "id": target.get("id"), "name": target.get("name"), "role": target.get("role"),
    }
    return doc


@api.get("/channels/{cid}")
async def get_channel(cid: str, user: dict = Depends(current_user)):
    ch = await db.channels.find_one({"id": cid})
    if not ch:
        raise HTTPException(404, "Canal no existe")
    if not _can_access_channel(user, ch):
        raise HTTPException(403, "Sin acceso a este canal")
    ch.pop("_id", None)
    if ch["type"] == "direct":
        other_id = next((mid for mid in (ch.get("member_ids") or []) if mid != user["id"]), None)
        if other_id:
            other = await db.users.find_one({"id": other_id})
            if other:
                ch["name"] = other.get("name") or ch.get("name")
                ch["peer"] = {
                    "id": other.get("id"), "name": other.get("name"), "role": other.get("role"),
                }
    return ch


@api.get("/channels/{cid}/messages")
async def list_channel_messages(
    cid: str,
    since: Optional[str] = None,
    before: Optional[str] = None,
    limit: int = 100,
    user: dict = Depends(current_user),
):
    ch = await db.channels.find_one({"id": cid})
    if not ch:
        raise HTTPException(404, "Canal no existe")
    if not _can_access_channel(user, ch):
        raise HTTPException(403, "Sin acceso a este canal")
    q: dict = {"channel_id": cid}
    if since:
        try:
            ts = datetime.fromisoformat(since.replace("Z", "+00:00"))
            q["created_at"] = {"$gt": ts}
        except Exception:
            pass
    if before:
        try:
            ts = datetime.fromisoformat(before.replace("Z", "+00:00"))
            q.setdefault("created_at", {})["$lt"] = ts
        except Exception:
            pass
    safe_limit = max(1, min(int(limit or 100), 200))
    cursor = db.messages.find(q).sort("created_at", -1).limit(safe_limit)
    raw = await cursor.to_list(length=safe_limit)
    raw.reverse()
    return [_message_out(it) for it in raw]


@api.post("/channels/{cid}/messages")
async def post_channel_message(cid: str, body: MessageIn, user: dict = Depends(current_user)):
    ch = await db.channels.find_one({"id": cid})
    if not ch:
        raise HTTPException(404, "Canal no existe")
    if not _can_access_channel(user, ch):
        raise HTTPException(403, "Sin acceso a este canal")
    # Regla asimétrica del Coordinador General (sólo aplica en directos).
    await _check_direct_send_rule(user, ch)
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Mensaje vacío")
    if len(text) > 2000:
        raise HTTPException(400, "Mensaje máximo 2000 caracteres")
    doc = {
        "id": str(uuid.uuid4()),
        "channel_id": cid,
        "project_id": ch["project_id"],
        "user_id": user["id"],
        "user_name": user["name"],
        "user_role": user["role"],
        "user_area": user.get("area"),
        "text": text,
        "created_at": datetime.now(timezone.utc),
    }
    await db.messages.insert_one(doc)
    return _message_out(doc)


# ---- Endpoints LEGACY: redirigen al canal General para mantener compatibilidad
@api.get("/projects/{pid}/messages")
async def list_messages_legacy(
    pid: str,
    since: Optional[str] = None,
    before: Optional[str] = None,
    limit: int = 100,
    user: dict = Depends(current_user),
):
    """Compat: lista mensajes del canal General del proyecto."""
    await ensure_project_access(user, pid)
    cid = await _general_channel_id(pid)
    if not cid:
        return []
    return await list_channel_messages(cid, since=since, before=before, limit=limit, user=user)


@api.post("/projects/{pid}/messages")
async def create_message_legacy(
    pid: str,
    body: MessageIn,
    user: dict = Depends(current_user),
):
    """Compat: publica en el canal General del proyecto."""
    await ensure_project_access(user, pid)
    cid = await _general_channel_id(pid)
    if not cid:
        raise HTTPException(500, "No se pudo asegurar el canal general")
    return await post_channel_message(cid, body, user)


@api.delete("/messages/{mid}")
async def delete_message(mid: str, user: dict = Depends(current_user)):
    """El autor o cualquier Coordinador General del proyecto puede eliminar."""
    m = await db.messages.find_one({"id": mid})
    if not m:
        raise HTTPException(404, "Mensaje no existe")
    is_author = m["user_id"] == user["id"]
    is_coord = user["role"] == ROLE_COORD and m["project_id"] in (user.get("project_ids") or [])
    if not (is_author or is_coord):
        raise HTTPException(403, "Sin permiso para eliminar este mensaje")
    await db.messages.delete_one({"id": mid})
    return {"ok": True}


# === MENSAJES NO LEÍDOS (badges en picker de proyectos) ====================
@api.post("/projects/{pid}/messages/seen")
async def mark_project_messages_seen(pid: str, user: dict = Depends(current_user)):
    """Marca como leídos todos los mensajes del proyecto para el usuario actual.
    Persiste `last_read_at = now()` en la colección `channel_reads`.
    """
    await ensure_project_access(user, pid)
    now = datetime.now(timezone.utc)
    await db.channel_reads.update_one(
        {"user_id": user["id"], "project_id": pid},
        {"$set": {"last_read_at": now}},
        upsert=True,
    )
    return {"ok": True, "last_read_at": now.isoformat()}


@api.get("/messages/unread_counts")
async def messages_unread_counts(user: dict = Depends(current_user)):
    """Devuelve `{project_id: count}` con el total de mensajes no leídos por
    proyecto para el usuario actual. Sólo cuenta mensajes ajenos (no enviados
    por el propio usuario).

    Optimizado para tableros: una sola pasada por todos los proyectos del
    usuario y un agregado en MongoDB por proyecto.
    """
    role = user.get("role")
    # 1) Determinar la lista de proyectos accesibles para el usuario.
    if role in (ROLE_COORD, ROLE_JEFE):
        projects = await db.projects.find({}, {"id": 1}).to_list(length=1000)
        pids = [p["id"] for p in projects]
    else:
        pids = list(user.get("project_ids") or [])
    if not pids:
        return {}
    # 2) Cargar last_read_at por proyecto en bloque.
    reads_cur = db.channel_reads.find(
        {"user_id": user["id"], "project_id": {"$in": pids}},
        {"project_id": 1, "last_read_at": 1, "_id": 0},
    )
    reads = {r["project_id"]: r.get("last_read_at") for r in await reads_cur.to_list(length=2000)}
    # 3) Por proyecto, calcular canales accesibles y contar mensajes nuevos.
    out: dict = {}
    for pid in pids:
        # Cargar canales del proyecto.
        ch_docs = await db.channels.find({"project_id": pid}).to_list(length=200)
        # Filtrar canales accesibles para este usuario.
        ch_ids = [c["id"] for c in ch_docs if _can_access_channel(user, c)]
        if not ch_ids:
            out[pid] = 0
            continue
        last_read = reads.get(pid)
        q: dict = {
            "channel_id": {"$in": ch_ids},
            "user_id": {"$ne": user["id"]},
        }
        if last_read:
            q["created_at"] = {"$gt": last_read}
        count = await db.messages.count_documents(q)
        out[pid] = int(count)
    return out


# === EVENTS (Calendario compartido) ========================================
class EventIn(BaseModel):
    title: str
    description: Optional[str] = None
    location: Optional[str] = None
    start_at: str  # ISO 8601
    end_at: Optional[str] = None
    area_id: Optional[str] = None


class EventPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    area_id: Optional[str] = None


def _event_out(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def _enrich_event_with_area(doc: dict) -> dict:
    """Adjunta area_name + area_color leyendo la colección areas (si hay area_id)."""
    aid = doc.get("area_id")
    if aid:
        a = await db.areas.find_one({"id": aid})
        if a:
            doc["area_name"] = a.get("name")
            doc["area_color"] = a.get("color")
        else:
            doc["area_name"] = None
            doc["area_color"] = None
    else:
        doc["area_name"] = None
        doc["area_color"] = None
    return doc


def _parse_iso(s: str) -> datetime:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, f"Fecha inválida: {s}")


@api.get("/projects/{pid}/events")
async def list_events(
    pid: str,
    range: str = "upcoming",  # upcoming | past | all
    limit: int = 500,
    user: dict = Depends(current_user),
):
    """Lista eventos. Cualquier miembro del proyecto puede leer."""
    await ensure_project_access(user, pid)
    q: dict = {"project_id": pid}
    now = datetime.now(timezone.utc)
    if range == "upcoming":
        # eventos desde inicio del día actual (UTC) en adelante
        start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        q["start_at"] = {"$gte": start_today}
    elif range == "past":
        q["start_at"] = {"$lt": now.replace(hour=0, minute=0, second=0, microsecond=0)}
    # 'all' → sin filtro

    sort_dir = 1 if range != "past" else -1
    safe_limit = max(1, min(int(limit or 500), 1000))
    cursor = db.events.find(q).sort("start_at", sort_dir).limit(safe_limit)
    items = await cursor.to_list(length=safe_limit)
    # Enriquecer con area_name + area_color (en batch).
    area_ids = {it.get("area_id") for it in items if it.get("area_id")}
    areas_by_id: dict = {}
    if area_ids:
        async for a in db.areas.find({"id": {"$in": list(area_ids)}}):
            areas_by_id[a["id"]] = {"name": a.get("name"), "color": a.get("color")}
    out = []
    for it in items:
        it = _event_out(it)
        aid = it.get("area_id")
        info = areas_by_id.get(aid) if aid else None
        it["area_name"] = (info or {}).get("name")
        it["area_color"] = (info or {}).get("color")
        out.append(it)
    return out


@api.post("/projects/{pid}/events")
async def create_event(
    pid: str,
    body: EventIn,
    user: dict = Depends(current_user),
):
    """Cualquier miembro del proyecto puede crear eventos."""
    await ensure_project_access(user, pid)
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "Título requerido")
    if len(title) > 140:
        raise HTTPException(400, "Título máximo 140 caracteres")
    start = _parse_iso(body.start_at)
    end = _parse_iso(body.end_at) if body.end_at else None
    if end and end < start:
        raise HTTPException(400, "La fecha de fin no puede ser anterior al inicio")
    desc = (body.description or "").strip() or None
    loc = (body.location or "").strip() or None
    if desc and len(desc) > 2000:
        raise HTTPException(400, "Descripción máximo 2000 caracteres")
    if loc and len(loc) > 200:
        raise HTTPException(400, "Ubicación máximo 200 caracteres")
    area_id_val = (body.area_id or None) or None
    if area_id_val:
        a = await db.areas.find_one({"id": area_id_val, "project_id": pid})
        if not a:
            raise HTTPException(400, "Área inválida para este proyecto")
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "project_id": pid,
        "title": title,
        "description": desc,
        "location": loc,
        "start_at": start,
        "end_at": end,
        "area_id": area_id_val,
        "author_id": user["id"],
        "author_name": user["name"],
        "author_role": user["role"],
        "created_at": now,
        "updated_at": now,
    }
    await db.events.insert_one(doc)
    return await _enrich_event_with_area(_event_out(doc))


@api.patch("/events/{eid}")
async def update_event(
    eid: str,
    body: EventPatch,
    user: dict = Depends(current_user),
):
    """Editable por el autor o por cualquier Coordinador General."""
    e = await db.events.find_one({"id": eid})
    if not e:
        raise HTTPException(404, "Evento no existe")
    await ensure_project_access(user, e["project_id"])
    is_author = e.get("author_id") == user["id"]
    is_coord = user["role"] == ROLE_COORD
    if not (is_author or is_coord):
        raise HTTPException(403, "Sólo el autor o un Coordinador puede editar")
    update: dict = {}
    if body.title is not None:
        t = body.title.strip()
        if not t:
            raise HTTPException(400, "Título no puede estar vacío")
        if len(t) > 140:
            raise HTTPException(400, "Título máximo 140 caracteres")
        update["title"] = t
    if body.description is not None:
        d = body.description.strip()
        if d and len(d) > 2000:
            raise HTTPException(400, "Descripción máximo 2000 caracteres")
        update["description"] = d or None
    if body.location is not None:
        loc = body.location.strip()
        if loc and len(loc) > 200:
            raise HTTPException(400, "Ubicación máximo 200 caracteres")
        update["location"] = loc or None
    if body.start_at is not None:
        update["start_at"] = _parse_iso(body.start_at)
    if body.end_at is not None:
        update["end_at"] = _parse_iso(body.end_at) if body.end_at else None
    if body.area_id is not None:
        aid = (body.area_id or None) or None
        if aid:
            a = await db.areas.find_one({"id": aid, "project_id": e["project_id"]})
            if not a:
                raise HTTPException(400, "Área inválida para este proyecto")
        update["area_id"] = aid
    start_final = update.get("start_at", e["start_at"])
    end_final = update.get("end_at", e.get("end_at"))
    if end_final and end_final < start_final:
        raise HTTPException(400, "La fecha de fin no puede ser anterior al inicio")
    if not update:
        return await _enrich_event_with_area(_event_out(e))
    update["updated_at"] = datetime.now(timezone.utc)
    await db.events.update_one({"id": eid}, {"$set": update})
    e = await db.events.find_one({"id": eid})
    return await _enrich_event_with_area(_event_out(e))


@api.delete("/events/{eid}")
async def delete_event(eid: str, user: dict = Depends(current_user)):
    """Eliminable por el autor o por cualquier Coordinador General."""
    e = await db.events.find_one({"id": eid})
    if not e:
        raise HTTPException(404, "Evento no existe")
    await ensure_project_access(user, e["project_id"])
    is_author = e.get("author_id") == user["id"]
    is_coord = user["role"] == ROLE_COORD
    if not (is_author or is_coord):
        raise HTTPException(403, "Sólo el autor o un Coordinador puede eliminar")
    await db.events.delete_one({"id": eid})
    return {"ok": True}


# === EXPORT (Excel "sábana plana" jerárquica) ===============================
def _flatten_tree_in_order(nodes_by_id: dict, root_ids: list) -> list:
    """Devuelve los nodos en pre-order (raíz → hijos por order), aplanando el árbol.
    Sólo retorna nodos hoja (los que pueden tener reportes asociados)."""
    out: list = []
    def visit(nid: str):
        n = nodes_by_id.get(nid)
        if not n:
            return
        if n.get("is_leaf"):
            out.append(n)
        # Recorre hijos ordenados
        children = sorted(
            [c for c in nodes_by_id.values() if c.get("parent_id") == nid],
            key=lambda x: (x.get("order", 0), x.get("name", "")),
        )
        for c in children:
            visit(c["id"])
    for rid in root_ids:
        visit(rid)
    return out


def _excel_safe(value) -> object:
    """Convierte valores no-nativos a algo que openpyxl pueda escribir."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        # openpyxl maneja datetime nativo; quitamos tz para Excel.
        return value.replace(tzinfo=None) if value.tzinfo else value
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value if v is not None and str(v).strip())
    if isinstance(value, dict):
        # Aplana dict simple
        return ", ".join(f"{k}={v}" for k, v in value.items() if v is not None)
    return value


@api.get("/projects/{pid}/export/reports.xlsx")
async def export_reports_xlsx(pid: str, user: dict = Depends(current_user)):
    """Exporta TODOS los reportes del proyecto en una sábana Excel plana,
    iterando los nodos en orden jerárquico (Tramo → Estación → Poste).
    Incluye ruta del nodo y coordenadas dictadas (X, Y, Z). Acceso para
    cualquier rol que pertenezca al proyecto (ensure_project_access)."""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
    except Exception as e:
        raise HTTPException(500, f"openpyxl no instalado: {e}")

    await ensure_project_access(user, pid)
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")

    # Carga árbol completo del proyecto
    nodes_raw = await db.location_nodes.find({"project_id": pid}).to_list(length=10000)
    nodes_by_id = {n["id"]: n for n in nodes_raw}
    root_ids = [n["id"] for n in nodes_raw if not n.get("parent_id")]
    # Ordena raíces por (order, name)
    root_ids.sort(key=lambda nid: (nodes_by_id[nid].get("order", 0), nodes_by_id[nid].get("name", "")))
    leaf_nodes = _flatten_tree_in_order(nodes_by_id, root_ids)
    leaf_ids = [n["id"] for n in leaf_nodes]
    leaf_index = {nid: i for i, nid in enumerate(leaf_ids)}

    # Trae todos los reportes y agrúpalos por node_id
    reports = await db.reports.find({"project_id": pid}).to_list(length=20000)

    # Áreas para resolver nombres
    areas = await db.areas.find({"project_id": pid}).to_list(length=500)
    areas_by_id = {a["id"]: a for a in areas}

    # Construir workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Reportes"

    headers = [
        "Orden",                   # índice de orden jerárquico del nodo hoja
        "Tipo de medición",
        "Ruta completa",            # Tramo > Estación > Poste
        "Nodo (hoja)",
        "Latitud objetivo (X)",
        "Longitud objetivo (Y)",
        "Elevación objetivo (Z)",
        "Valor capturado",          # measurement_value (string)
        "Avance",
        "Contratista",
        "Personal",
        "Equipo",
        "Notas / Observaciones",
        "Área",
        "Capturado por",
        "Fecha de captura",
        "ID Reporte",
    ]
    ws.append(headers)

    # Estilo cabecera
    header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=1, column=col_idx)
        c.fill = header_fill
        c.font = header_font
        c.alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = "A2"

    # Recorre los nodos hoja en orden y escribe sus reportes
    for n in leaf_nodes:
        node_reports = [r for r in reports if r.get("node_id") == n["id"]]
        # Orden secundario: por fecha de captura descendente
        node_reports.sort(key=lambda r: r.get("created_at") or datetime.min, reverse=True)
        full_path = " > ".join((await node_path_names(n["id"])))
        target_lat = n.get("target_lat")
        target_lon = n.get("target_lon")
        target_elev = n.get("target_elev")
        if not node_reports:
            # Aún así dejamos una fila por nodo hoja (vacía) para mantener trazabilidad.
            ws.append([
                leaf_index[n["id"]] + 1,
                n.get("measurement_type") or "",
                full_path,
                n.get("name"),
                target_lat if target_lat is not None else "",
                target_lon if target_lon is not None else "",
                target_elev if target_elev is not None else "",
                "(sin reporte)",
                "", "", "", "", "", "", "", "", "",
            ])
            continue
        for r in node_reports:
            personnel = r.get("personnel") or []
            equipment = r.get("equipment") or []
            ws.append([
                leaf_index[n["id"]] + 1,
                r.get("measurement_type") or n.get("measurement_type") or "",
                full_path,
                n.get("name"),
                _excel_safe(target_lat),
                _excel_safe(target_lon),
                _excel_safe(target_elev),
                _excel_safe(r.get("measurement_value")),
                _excel_safe(r.get("avance")),
                _excel_safe(r.get("contratista")),
                _excel_safe(personnel),
                _excel_safe(equipment),
                _excel_safe(r.get("notes")),
                _excel_safe(_normalize_area_name(
                    r.get("area_name") or (areas_by_id.get(r.get("area_id"), {}) or {}).get("name"),
                    user_role=user.get("role"),
                    user_area=user.get("area"),
                )),
                _excel_safe(r.get("captured_by_name")),
                _excel_safe(r.get("created_at")),
                r.get("id"),
            ])

    # Anchos de columna
    widths = [7, 18, 44, 22, 16, 16, 16, 24, 14, 18, 30, 26, 36, 18, 22, 22, 38]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w
    # Wrap en columnas largas
    wrap_cols = {3, 11, 12, 13}  # Ruta, Personal, Equipo, Notas
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            if cell.column in wrap_cols:
                cell.alignment = Alignment(wrap_text=True, vertical="top")

    # Cabecera del archivo: nombre del proyecto y fecha
    ws.insert_rows(1)
    ws.cell(row=1, column=1, value=f"SynCo · {proj.get('name','Proyecto')} · Reporte exportado {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(headers))
    title_cell = ws.cell(row=1, column=1)
    title_cell.font = Font(bold=True, size=12, color="1E3A8A")
    title_cell.alignment = Alignment(horizontal="left", vertical="center")
    ws.freeze_panes = "A3"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", proj.get("name", "proyecto"))[:60] or "proyecto"
    fname = f"synco_{safe_name}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# === PDF EXPORT (Motor paramétrico unificado v2) =============================
# Reglas:
#   - COORDINADOR: ve TODOS los reportes del proyecto.
#   - ESPECIALISTA: sólo ve los reportes que ÉL capturó (captured_by == user.id).
#   - SUB-COORDINADOR: ve sólo reportes cuyos nodos caen dentro de su scope_node_ids.
#   - Período: today | yesterday | week | month (ventana móvil sobre created_at).
#   - "Mes" = Mes-a-la-fecha (día 1 → ahora). NO últimos 30 días.
#   - Render reportlab CPU-bound se ejecuta en thread aparte (asyncio.to_thread)
#     para no bloquear el event loop de uvicorn en "week"/"month".
#   - Cálculo de Avance: por cada reporte → (Última lectura - Primera lectura),
#     donde Primera lectura = último valor capturado en el reporte anterior del
#     mismo nodo (o 0 si es el primer reporte histórico).
#   - Layout exacto por reporte: Fecha · Nombre · Actividad · No. De Contrato ·
#     Contratista · Ubicación · Reporte de avance · Personal · Equipo · Observaciones.

LOGO_PATH = Path(__file__).resolve().parent / "assets" / "logo_dirac.png"

_MESES_ES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

_MEASUREMENT_LABELS_ES = {
    "coord_latlon": "Coordenadas (Lat/Lon)",
    "cadenamiento": "Cadenamiento",
    "eje": "Eje",
    "nivel": "Nivel",
}


def _measurement_label(mtype: str) -> str:
    return _MEASUREMENT_LABELS_ES.get(mtype or "", mtype or "—")


def _fmt_fecha_es(dt: datetime) -> str:
    """Formato ej. '16 de Junio del 2026' en zona horaria America/Mexico_City."""
    try:
        if not isinstance(dt, datetime):
            return "—"
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(MX_TZ)
        return f"{dt.day} de {_MESES_ES[dt.month - 1]} del {dt.year}"
    except Exception:
        return dt.strftime("%Y-%m-%d") if isinstance(dt, datetime) else "—"


def _fmt_fecha_dd_mm_yyyy(dt) -> str:
    """Formato corto DD-MM-YYYY en zona horaria America/Mexico_City.

    Nunca regresa palabras como "Hoy" o "Ayer" — es el formato institucional
    requerido en exportaciones."""
    try:
        if not isinstance(dt, datetime):
            return "—"
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(MX_TZ)
        return dt.strftime("%d-%m-%Y")
    except Exception:
        return "—"


def _fmt_fecha_dd_mm_yyyy_hhmm(dt) -> str:
    """Formato DD-MM-YYYY HH:MM en zona horaria America/Mexico_City."""
    try:
        if not isinstance(dt, datetime):
            return "—"
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(MX_TZ)
        return dt.strftime("%d-%m-%Y %H:%M")
    except Exception:
        return "—"


_SEVERIDAD_ORDER = {"urgente": 0, "importante": 1, "informativo": 2}


def _severidad_label(sev: Optional[str]) -> str:
    s = (sev or "informativo").lower()
    return {"urgente": "Urgente", "importante": "Importante", "informativo": "Informativo"}.get(s, "Informativo")


def _severidad_hex(sev: Optional[str]) -> str:
    s = (sev or "informativo").lower()
    # Semáforo institucional: rojo / ámbar / azul.
    return {"urgente": "#DC2626", "importante": "#D97706", "informativo": "#1D4ED8"}.get(s, "#1D4ED8")


def _export_severity_filter(role: str) -> set:
    """Severidades incluidas en el documento exportado según rol del usuario.

    - Especialista: Importante + Urgente (excluye Informativo).
    - Supervisor (sub-coord, jefe, coord): Importante + Urgente.
    - Esta regla aplica a reportes Y noticias inyectadas."""
    return {"importante", "urgente"}


async def _announcements_for_node(
    pid: str,
    node_path_ids: List[str],
    start_dt: datetime,
    end_dt: datetime,
) -> List[dict]:
    """Devuelve noticias vinculadas al nodo o cualquiera de sus ancestros,
    con severidad Importante/Urgente, en el rango [start_dt, end_dt]."""
    if not node_path_ids:
        return []
    q = {
        "project_id": pid,
        "jerarquia": {"$in": ["importante", "urgente"]},
        "$or": [
            {"node_id": {"$in": node_path_ids}},
            {"node_path_ids": {"$elemMatch": {"$in": node_path_ids}}},
        ],
        "created_at": {"$gte": start_dt, "$lte": end_dt},
    }
    items = await db.announcements.find(q).sort("created_at", -1).to_list(length=200)
    return items


def _extract_numeric_reading(report: dict) -> Optional[float]:
    """Extrae el valor numérico capturado en el reporte según measurement_type.
    Retorna None si no se puede convertir a número (ej. 'eje', coordenadas)."""
    if not report:
        return None
    mtype = report.get("measurement_type")
    val = report.get("measurement_value") or {}
    try:
        if mtype == "nivel":
            v = val.get("nivel") if "nivel" in val else val.get("value")
            return float(v) if v is not None else None
        if mtype == "cadenamiento":
            v = val.get("cadenamiento") or val.get("value")
            if isinstance(v, str) and "+" in v:
                parts = v.split("+", 1)
                km = float(parts[0])
                m = float(parts[1])
                return km * 1000.0 + m
            return float(v) if v is not None else None
        # eje / coord_latlon → no numérico
        return None
    except Exception:
        return None


def _fmt_reading(v: Optional[float]) -> str:
    """Formato profesional con máximo 2 decimales (sin ceros sobrantes)."""
    if v is None:
        return "—"
    try:
        f = float(v)
    except Exception:
        return "—"
    if abs(f - round(f)) < 1e-9:
        return f"{int(round(f))}"
    s = f"{f:.2f}"
    # Quita ceros sobrantes a la derecha (p.ej. 12.50 → 12.5) pero respeta el
    # punto decimal: 12.00 ya quedaría como entero por la rama anterior.
    if "." in s:
        s = s.rstrip("0").rstrip(".") if s.endswith("0") else s
    return s


def _format_measurement_for_display(report: dict) -> str:
    """Cuando no hay valor numérico (ej. eje, coord), devolvemos representación legible."""
    mtype = (report or {}).get("measurement_type")
    val = (report or {}).get("measurement_value") or {}
    if mtype == "eje":
        return str(val.get("eje") or val.get("value") or "—")
    if mtype == "coord_latlon":
        lat = val.get("lat"); lon = val.get("lon")
        if lat is None or lon is None:
            return "—"
        try:
            return f"{float(lat):.6f}, {float(lon):.6f}"
        except Exception:
            return f"{lat}, {lon}"
    if mtype == "cadenamiento":
        return str(val.get("cadenamiento") or val.get("value") or "—")
    if mtype == "nivel":
        v = val.get("nivel") if "nivel" in val else val.get("value")
        return _fmt_reading(float(v)) if v is not None else "—"
    return "—"


def _period_range(period: str) -> tuple:
    """Devuelve (start_utc, end_utc, etiqueta_legible).

    Los rangos se calculan en horario local America/Mexico_City y se
    convierten a UTC para consultar Mongo. Esto garantiza:
      - "Hoy" = desde 00:00:00 CDMX del día actual.
      - "Ayer" = el día calendario anterior (00:00–24:00 CDMX).
      - "Mes" = REGLA ESTRICTA: día 1 del mes calendario actual CDMX 00:00:00 → ahora.
    """
    now_utc = datetime.now(timezone.utc)
    now_mx = now_utc.astimezone(MX_TZ)
    p = (period or "today").lower().strip()
    if p in ("today", "hoy"):
        start_mx = now_mx.replace(hour=0, minute=0, second=0, microsecond=0)
        return start_mx.astimezone(timezone.utc), now_utc, "Hoy"
    if p in ("yesterday", "ayer"):
        end_mx = now_mx.replace(hour=0, minute=0, second=0, microsecond=0)
        start_mx = end_mx - timedelta(days=1)
        return start_mx.astimezone(timezone.utc), end_mx.astimezone(timezone.utc), "Ayer"
    if p in ("week", "semana", "semanal"):
        start_mx = now_mx - timedelta(days=7)
        return start_mx.astimezone(timezone.utc), now_utc, "Última semana"
    if p in ("month", "mes", "mensual"):
        # REGLA ESTRICTA: Día 1 del mes calendario CDMX 00:00 → ahora.
        start_mx = now_mx.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return start_mx.astimezone(timezone.utc), now_utc, "Mes a la fecha"
    start_mx = now_mx.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_mx.astimezone(timezone.utc), now_utc, "Hoy"


# ============================================================================
# Categorización de reportes (Diario / Semanal / Mensual).
# ----------------------------------------------------------------------------
# Reglas institucionales pedidas por el cliente:
#   * "diario"   → hoy + ayer (desde ayer 00:00 CDMX). Incluye TODAS las
#                  severidades (informativo + importante + urgente).
#   * "semanal"  → últimos 7 días. Incluye TODAS las severidades.
#   * "mensual"  → mes calendario en curso (día 1 CDMX → ahora). SOLO
#                  reportes con severidad "importante" o "urgente".
# La lógica de filtrado es exclusivamente de datos; el motor de renderizado
# (`_clone_membrete`, escalado, márgenes) permanece intocado.
# ============================================================================
_PERIOD_TYPE_ALIASES = {
    "diario", "daily", "dia", "día",
    "semanal", "weekly",
    "mensual", "monthly", "mes",
}


def _normalize_period_type(period_type: Optional[str]) -> Optional[str]:
    """Normaliza el parámetro `period_type` a diario/semanal/mensual o None."""
    if not period_type:
        return None
    v = period_type.strip().lower()
    if v in ("diario", "daily", "dia", "día"):
        return "diario"
    if v in ("semanal", "weekly"):
        return "semanal"
    if v in ("mensual", "monthly", "mes"):
        return "mensual"
    return None


def _period_range_for_type(period_type: str) -> tuple:
    """Rango temporal `(start_utc, end_utc, etiqueta)` para cada categoría."""
    now_utc = datetime.now(timezone.utc)
    now_mx = now_utc.astimezone(MX_TZ)
    pt = _normalize_period_type(period_type)
    if pt == "diario":
        # Hoy + ayer: desde ayer 00:00 CDMX hasta ahora.
        today_start_mx = now_mx.replace(hour=0, minute=0, second=0, microsecond=0)
        start_mx = today_start_mx - timedelta(days=1)
        return (
            start_mx.astimezone(timezone.utc),
            now_utc,
            "Reporte Diario (hoy y ayer)",
        )
    if pt == "semanal":
        # Últimos 7 días (rolling window).
        start_mx = now_mx - timedelta(days=7)
        return (
            start_mx.astimezone(timezone.utc),
            now_utc,
            "Reporte Semanal (últimos 7 días)",
        )
    if pt == "mensual":
        # Mes calendario en curso (día 1 CDMX → ahora).
        start_mx = now_mx.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return (
            start_mx.astimezone(timezone.utc),
            now_utc,
            "Reporte Mensual (mes en curso)",
        )
    # Fallback prudente: hoy.
    start_mx = now_mx.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_mx.astimezone(timezone.utc), now_utc, "Hoy"


def _severity_set_for_period_type(
    period_type: Optional[str],
    default_set: set,
) -> set:
    """Devuelve el set de severidades permitidas para el `period_type`.

    Política institucional definitiva (Julio 2026 · reporte ejecutivo):
      - "informativo" NUNCA se incluye en las exportaciones categorizadas.
      - Diario   → importante + urgente.
      - Semanal  → importante + urgente.
      - Mensual  → SOLO urgente (destacados críticos del mes).
      - None (comportamiento clásico) → `default_set` por rol vía
        `_export_severity_filter`.
    """
    pt = _normalize_period_type(period_type)
    if pt in ("diario", "semanal"):
        return {"importante", "urgente"}
    if pt == "mensual":
        return {"urgente"}
    return default_set


def _strip_b64_prefix(s: str) -> str:
    if not isinstance(s, str):
        return ""
    if s.startswith("data:") and "," in s:
        return s.split(",", 1)[1]
    return s


# ============================================================================
# Regla de negocio: los reportes de "Sub supervisores" se agrupan bajo la
# disciplina "Obra Civil" en las exportaciones ejecutivas. Cualquier variante
# ortográfica (con/sin espacio, tildes, plural, mayúsculas) cae en la regla.
#
# Cuando el usuario que EXPORTA tiene rol `sub_coordinador`, TODOS los reportes
# se etiquetan bajo la disciplina que el Coordinador General le ASIGNÓ en la
# invitación (`user["area"]`). Si el sub-coordinador NO tiene área asignada,
# se usa "OBRA CIVIL" como fallback histórico (v2026-07).
# ============================================================================
def _normalize_area_name(
    area_name: Optional[str],
    user_role: Optional[str] = None,
    user_area: Optional[str] = None,
) -> str:
    # [Regla dura] Sub-coordinador exportando → usa su disciplina asignada;
    # si no tiene, cae al fallback histórico "OBRA CIVIL".
    if user_role == ROLE_SUB:
        assigned = (user_area or "").strip()
        return assigned.upper() if assigned else "OBRA CIVIL"
    raw = (area_name or "").strip()
    if not raw:
        return "SIN ÁREA"
    _lower = raw.lower()
    # Normalizar tildes y colapsar espacios/guiones
    import unicodedata as _ud
    _flat = "".join(
        ch for ch in _ud.normalize("NFD", _lower) if _ud.category(ch) != "Mn"
    )
    _flat = _flat.replace("-", " ").replace("_", " ")
    _flat = " ".join(_flat.split())  # colapsa espacios múltiples
    # Cubre: "sub supervisor", "sub supervisores", "subsupervisor",
    # "subsupervisores", "sub-supervisor", etc.
    if _flat in ("sub supervisor", "sub supervisores",
                 "subsupervisor", "subsupervisores"):
        return "OBRA CIVIL"
    if _flat.startswith("sub supervisor") or _flat.startswith("subsupervisor"):
        return "OBRA CIVIL"
    return raw



# ============================================================================
# Logo institucional por defecto (DIRAC) — cache en memoria.
# Si el proyecto NO tiene `constructora_logo` configurado, las exportaciones
# usan el logo DIRAC para que la cabecera/portada nunca quede vacía.
# ============================================================================
_DIRAC_LOGO_URL = (
    "https://customer-assets.emergentagent.com/"
    "job_offline-report-sync/artifacts/k58zlgpr_Logo%20dirac%20.png"
)
_DIRAC_LOGO_LOCAL = Path(__file__).resolve().parent / "assets" / "logo_dirac.png"
_DIRAC_LOGO_CACHE: dict = {"bytes": None, "tried": False}


def _get_default_logo_bytes() -> Optional[bytes]:
    """Devuelve los bytes del logo DIRAC (logotipo institucional con triángulo
    verde). Prioriza el archivo local en `backend/assets/logo_dirac.png` y, si
    no existe, intenta una descarga remota como fallback.

    Si todo falla, devuelve None y los exports renderizan sin logo.
    """
    if _DIRAC_LOGO_CACHE["bytes"] is not None:
        return _DIRAC_LOGO_CACHE["bytes"]
    if _DIRAC_LOGO_CACHE["tried"]:
        return None
    _DIRAC_LOGO_CACHE["tried"] = True
    # 1) Archivo local — preferido por confiabilidad y por evitar dependencias de red.
    try:
        if _DIRAC_LOGO_LOCAL.exists():
            data = _DIRAC_LOGO_LOCAL.read_bytes()
            if data:
                _DIRAC_LOGO_CACHE["bytes"] = data
                return data
    except Exception as e:  # pragma: no cover
        logging.warning("No se pudo leer logo DIRAC local: %s", e)
    # 2) Fallback remoto.
    try:
        import requests as _http
        resp = _http.get(_DIRAC_LOGO_URL, timeout=6)
        if resp.status_code == 200 and resp.content:
            _DIRAC_LOGO_CACHE["bytes"] = resp.content
            return resp.content
    except Exception as e:  # pragma: no cover
        logging.warning("No se pudo descargar logo DIRAC: %s", e)
    return None


def _resolve_export_logo_bytes(proj_logo_b64: Optional[str]) -> Optional[bytes]:
    """Devuelve los bytes del logo institucional priorizando el del proyecto.

    1) Si el proyecto tiene `constructora_logo` (base64), lo usa.
    2) Si no, cae al logo DIRAC por defecto (cacheado).
    3) Si todo falla, retorna None y las exportaciones omiten el logo.
    """
    import base64 as _b64
    if proj_logo_b64:
        try:
            return _b64.b64decode(_strip_b64_prefix(proj_logo_b64))
        except Exception:
            pass
    return _get_default_logo_bytes()


# ─── Plantillas de exportación (custom templates) ────────────────────────────
# El coordinador puede subir plantillas base institucionales (PDF/DOCX/PPTX).
# El motor de exportación las utiliza como fondo/base al construir el documento.
TEMPLATES_ROOT = Path("/app/backend/uploads/templates")
TEMPLATES_ROOT.mkdir(parents=True, exist_ok=True)

_TEMPLATE_KIND_EXT = {
    "pdf": ".pdf",
    "docx": ".docx",
    "pptx": ".pptx",
    # Imagen de mapa/ubicación institucional (para PPTX narrativo).
    # Se preserva la extensión original del archivo subido.
    "map": ".img",
}
_TEMPLATE_KIND_MIME = {
    "pdf": {"application/pdf"},
    "docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    },
    "pptx": {
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
    },
    "map": {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
    },
}
_TEMPLATE_KIND_FIELD = {
    "pdf": "template_pdf",
    "docx": "template_docx",
    "pptx": "template_pptx",
    "map": "template_map",
}


def _template_path_for(pid: str, kind: str, ext_override: Optional[str] = None) -> Path:
    ext = ext_override or _TEMPLATE_KIND_EXT[kind]
    return TEMPLATES_ROOT / pid / f"template{ext}"


def _get_project_template(project: dict, kind: str) -> Optional[str]:
    """Devuelve ruta absoluta a la plantilla si existe físicamente en disco."""
    field = _TEMPLATE_KIND_FIELD.get(kind)
    if not field:
        return None
    rel = (project or {}).get(field)
    if not rel:
        return None
    p = Path(rel) if os.path.isabs(rel) else (TEMPLATES_ROOT.parent.parent / rel)
    return str(p) if p.exists() else None


@api.post("/projects/{pid}/template/{kind}", response_model=ProjectOut)
async def upload_project_template(
    pid: str,
    kind: str,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    """Sube una plantilla PDF/DOCX/PPTX/MAP para un proyecto.
    - pdf/docx/pptx: se usan como fondo/base para exportaciones.
    - map: imagen (jpg/png/webp) que se incrustará en la slide 'Mapa/Ubicación' del PPTX
      narrativo, en la shape llamada 'MAPA' (o como fondo si no existe).
    Solo Coordinador General o Jefe de Proyecto.
    """
    kind = (kind or "").lower()
    if kind not in _TEMPLATE_KIND_EXT:
        raise HTTPException(400, "kind debe ser 'pdf', 'docx', 'pptx' o 'map'")
    if user.get("role") not in ("coordinador_general", "jefe_proyecto"):
        raise HTTPException(403, "Solo Coordinador o Jefe de Proyecto pueden subir plantillas")
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")

    content_type = (file.content_type or "").lower()
    allowed = _TEMPLATE_KIND_MIME[kind]
    if content_type and content_type not in allowed:
        raise HTTPException(415, f"Content-Type inválido para {kind}: {content_type}")

    # Para "map", preservar la extensión original (jpg/png/webp)
    if kind == "map":
        orig_name = (file.filename or "map.jpg").lower()
        ext = ".jpg"
        for cand in (".jpg", ".jpeg", ".png", ".webp"):
            if orig_name.endswith(cand):
                ext = cand
                break
        # Eliminar cualquier plantilla map previa (extensión distinta) para evitar residuos
        for cand_ext in (".jpg", ".jpeg", ".png", ".webp", ".img"):
            try:
                _template_path_for(pid, "map", cand_ext).unlink(missing_ok=True)
            except Exception:
                pass
        dest_path = _template_path_for(pid, "map", ext)
    else:
        dest_path = _template_path_for(pid, kind)

    dest_dir = TEMPLATES_ROOT / pid
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Escribir en disco (streaming, sin cargar todo en memoria)
    max_bytes = 25 * 1024 * 1024  # 25 MB duro
    total = 0
    tmp_path = dest_path.with_suffix(dest_path.suffix + ".tmp")
    with open(tmp_path, "wb") as out:
        while True:
            chunk = await file.read(1024 * 512)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                out.close()
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(413, f"Plantilla demasiado grande (máx {max_bytes // (1024 * 1024)} MB)")
            out.write(chunk)
    tmp_path.replace(dest_path)

    field = _TEMPLATE_KIND_FIELD[kind]
    rel_path = str(dest_path)  # ruta absoluta local; se resuelve dinámicamente en lectura
    await db.projects.update_one({"id": pid}, {"$set": {field: rel_path}})
    updated = await db.projects.find_one({"id": pid})
    return _project_public(updated)


@api.delete("/projects/{pid}/template/{kind}", response_model=ProjectOut)
async def delete_project_template(pid: str, kind: str, user: dict = Depends(current_user)):
    """Elimina la plantilla asociada al proyecto (borra archivo físico y campo en DB)."""
    kind = (kind or "").lower()
    if kind not in _TEMPLATE_KIND_EXT:
        raise HTTPException(400, "kind inválido")
    if user.get("role") not in ("coordinador_general", "jefe_proyecto"):
        raise HTTPException(403, "Solo Coordinador o Jefe de Proyecto")
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")
    try:
        if kind == "map":
            for cand_ext in (".jpg", ".jpeg", ".png", ".webp", ".img"):
                try:
                    _template_path_for(pid, "map", cand_ext).unlink(missing_ok=True)
                except Exception:
                    pass
        else:
            _template_path_for(pid, kind).unlink(missing_ok=True)
    except Exception:
        pass
    field = _TEMPLATE_KIND_FIELD[kind]
    await db.projects.update_one({"id": pid}, {"$set": {field: None}})
    updated = await db.projects.find_one({"id": pid})
    return _project_public(updated)


# ============================================================================
# DATOS GENERALES (ex-Mapa) — múltiples imágenes por proyecto.
# El campo `general_data_images` guarda un array de strings base64 (data URLs).
# Se renderizan como slides/páginas dedicadas al inicio de las exportaciones
# PPTX/PDF (presupuesto, programa, planos, mapa, etc.).
# ============================================================================
_GENERAL_DATA_MAX = 30           # tope de imágenes por proyecto
_GENERAL_DATA_MAX_BYTES = 5_000_000  # ~5 MB decoded por imagen


class GeneralDataImageIn(BaseModel):
    image: str  # data URL base64 (data:image/jpeg;base64,...)


class GeneralDataReplaceIn(BaseModel):
    images: List[str]  # reemplazo completo del array


@api.post("/projects/{pid}/general-data-images", response_model=ProjectOut)
async def add_general_data_image(
    pid: str,
    body: GeneralDataImageIn,
    user: dict = Depends(current_user),
):
    """Agrega UNA imagen a la sección Datos Generales del proyecto.
    Para múltiples imágenes, el frontend hace N POSTs (o usa PUT de reemplazo)."""
    if user.get("role") not in ("coordinador_general", "jefe_proyecto"):
        raise HTTPException(403, "Solo Coordinador o Jefe de Proyecto")
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")
    b64 = (body.image or "").strip()
    if not b64.startswith("data:image/"):
        raise HTTPException(400, "Formato inválido: se espera data URL base64 de imagen")
    # Validación de tamaño (aprox por len del base64)
    try:
        payload = b64.split(",", 1)[1] if "," in b64 else b64
        approx_bytes = (len(payload) * 3) // 4
        if approx_bytes > _GENERAL_DATA_MAX_BYTES:
            raise HTTPException(413, f"Imagen demasiado grande (máx {_GENERAL_DATA_MAX_BYTES // 1_000_000} MB)")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Base64 inválido")
    current = (proj.get("general_data_images") or [])
    if len(current) >= _GENERAL_DATA_MAX:
        raise HTTPException(400, f"Máximo {_GENERAL_DATA_MAX} imágenes por proyecto")
    current = current + [b64]
    await db.projects.update_one({"id": pid}, {"$set": {"general_data_images": current}})
    updated = await db.projects.find_one({"id": pid})
    return _project_public(updated)


@api.post("/projects/{pid}/general-data-images/upload-file", response_model=ProjectOut)
async def upload_general_data_image_file(
    pid: str,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    """Agrega UNA imagen a Datos Generales usando **multipart/form-data**
    (en vez de JSON base64). Es el path recomendado para dispositivos
    móviles: evita el bug "Network Request Failed" en Android por payloads
    JSON gigantes y libera el hilo principal del iPhone.

    - Acepta JPG/PNG/WebP hasta ~5 MB.
    - El backend genera internamente el `data URL base64` y lo persiste.
    - Devuelve el proyecto actualizado (mismo shape que el POST JSON).
    """
    if user.get("role") not in ("coordinador_general", "jefe_proyecto"):
        raise HTTPException(403, "Solo Coordinador o Jefe de Proyecto")
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")
    content_type = (file.content_type or "").lower() or "image/jpeg"
    if content_type not in _NODE_COVER_MIME:  # reutilizamos JPG/PNG/WebP
        raise HTTPException(415, f"Formato no soportado: {content_type}. Usa JPG/PNG/WebP.")
    raw = await file.read(_GENERAL_DATA_MAX_BYTES + 1)
    if len(raw) > _GENERAL_DATA_MAX_BYTES:
        raise HTTPException(413, f"Imagen demasiado grande (máx {_GENERAL_DATA_MAX_BYTES // 1_000_000} MB)")
    current = (proj.get("general_data_images") or [])
    if len(current) >= _GENERAL_DATA_MAX:
        raise HTTPException(400, f"Máximo {_GENERAL_DATA_MAX} imágenes por proyecto")
    import base64 as _b64
    b64_str = _b64.b64encode(raw).decode("ascii")
    data_url = f"data:{content_type};base64,{b64_str}"
    current = current + [data_url]
    await db.projects.update_one({"id": pid}, {"$set": {"general_data_images": current}})
    updated = await db.projects.find_one({"id": pid})
    return _project_public(updated)


# === UPLOAD GENÉRICO DE FOTO (para reportes) ===============================
# Preferido en móvil sobre el JSON base64 dentro de `POST /reports`.
# Devuelve un `data_url` que el frontend usa como identificador dentro del
# array `images` del reporte al crearlo. El backend almacena finalmente ese
# mismo data URL en Mongo (paridad con el flujo previo).
_REPORT_PHOTO_MAX_BYTES = 6_000_000  # ~6 MB decoded (~8 MB JPEG comprimido)


@api.post("/upload/photo")
async def upload_photo_multipart(
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
):
    """Sube UNA foto (JPG/PNG/WebP) y devuelve `{data_url: "data:image/..."}`
    para que el cliente lo referencie en `POST /reports` u otros flujos.

    Ventajas vs. base64 en JSON:
      - Android: usa la stack nativa (OkHttp), sin el bug "Network Request
        Failed" que sufre `fetch+FormData` con URIs de expo-image-picker.
      - iOS: usa NSURLSession, no bloquea el hilo principal ni infla la
        memoria del bridge con strings enormes.
    """
    content_type = (file.content_type or "").lower() or "image/jpeg"
    if content_type not in _NODE_COVER_MIME:
        raise HTTPException(415, f"Formato no soportado: {content_type}. Usa JPG/PNG/WebP.")
    raw = await file.read(_REPORT_PHOTO_MAX_BYTES + 1)
    if len(raw) > _REPORT_PHOTO_MAX_BYTES:
        raise HTTPException(413, f"Foto demasiado grande (máx {_REPORT_PHOTO_MAX_BYTES // 1_000_000} MB)")
    if not raw:
        raise HTTPException(400, "Archivo vacío")
    import base64 as _b64
    b64_str = _b64.b64encode(raw).decode("ascii")
    return {"data_url": f"data:{content_type};base64,{b64_str}"}


@api.put("/projects/{pid}/general-data-images", response_model=ProjectOut)
async def replace_general_data_images(
    pid: str,
    body: GeneralDataReplaceIn,
    user: dict = Depends(current_user),
):
    """Reemplaza el array completo de imágenes de Datos Generales.
    Útil para reordenar o eliminar múltiples en batch desde el frontend."""
    if user.get("role") not in ("coordinador_general", "jefe_proyecto"):
        raise HTTPException(403, "Solo Coordinador o Jefe de Proyecto")
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")
    imgs = body.images or []
    if len(imgs) > _GENERAL_DATA_MAX:
        raise HTTPException(400, f"Máximo {_GENERAL_DATA_MAX} imágenes por proyecto")
    for im in imgs:
        if not isinstance(im, str) or not im.startswith("data:image/"):
            raise HTTPException(400, "Cada imagen debe ser data URL base64 (data:image/...)")
    await db.projects.update_one({"id": pid}, {"$set": {"general_data_images": imgs}})
    updated = await db.projects.find_one({"id": pid})
    return _project_public(updated)


@api.delete("/projects/{pid}/general-data-images/{index}", response_model=ProjectOut)
async def delete_general_data_image(
    pid: str,
    index: int,
    user: dict = Depends(current_user),
):
    """Elimina la imagen `index` (0-based) del array de Datos Generales."""
    if user.get("role") not in ("coordinador_general", "jefe_proyecto"):
        raise HTTPException(403, "Solo Coordinador o Jefe de Proyecto")
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")
    imgs = list(proj.get("general_data_images") or [])
    if index < 0 or index >= len(imgs):
        raise HTTPException(404, "Índice fuera de rango")
    imgs.pop(index)
    await db.projects.update_one({"id": pid}, {"$set": {"general_data_images": imgs}})
    updated = await db.projects.find_one({"id": pid})
    return _project_public(updated)




@api.get("/projects/{pid}/export/reports.pdf")
async def export_reports_pdf(
    pid: str,
    period: str = Query("today", description="today|yesterday|week|month"),
    period_type: Optional[str] = Query(
        None,
        description="diario | semanal | mensual · categoría de reporte. "
                    "Si se envía, sobrescribe `period` y aplica la política "
                    "de severidad correspondiente.",
    ),
    area_id: Optional[str] = Query(None, description="Filtro por área (opcional)"),
    scope: Optional[str] = Query(None, description="mine|area (para especialistas)"),
    user: dict = Depends(current_user),
):
    """Motor PDF paramétrico.

    Filtros aplicados automáticamente (no negociables):
      - Severidad: SOLO Importante + Urgente (excluye Informativo).
      - Área: si `area_id` se especifica, filtra por esa área.
      - Especialistas con toggle `scope=mine` ven solo sus reportes.
    Render bloqueante (reportlab) en thread aparte."""
    try:
        import base64
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.units import cm
        from reportlab.lib.colors import HexColor
        from reportlab.lib.utils import ImageReader
        from reportlab.pdfgen import canvas as _canvas
    except Exception as e:
        raise HTTPException(500, f"reportlab no instalado: {e}")

    # Pillow: usado para crop-to-fill de fotos respetando EXIF-rotation.
    # Si no está disponible se hace fallback a preserveAspectRatio letterbox.
    try:
        from PIL import Image as _PILImage
        from PIL.ImageOps import exif_transpose as _pil_exif_transpose
        _HAS_PIL = True
    except Exception:
        _HAS_PIL = False

    scope_mine_only = (scope or "").lower() == "mine"
    data = await _gather_export_data(
        pid, period, user,
        area_id=area_id,
        scope_mine_only=scope_mine_only,
        period_type=period_type,
    )
    proj = data["proj"]
    leaf_nodes = data["leaf_nodes"]
    reports_by_node = data["reports_by_node"]
    announcements_by_node = data["announcements_by_node"]
    path_cache = data["path_cache"]
    start_dt = data["start_dt"]
    end_dt = data["end_dt"]
    prev_reading_by_node = data["prev_reading_by_node"]
    cover_ancestor_by_node = data.get("cover_ancestor_by_node", {})
    areas_by_id = data.get("areas_by_id", {})

    role = user["role"]

    # Snapshot inmutable para el thread bloqueante
    project_name = proj.get("name", "Proyecto")
    project_contract = proj.get("contract_number") or "—"
    project_constructora = proj.get("constructora") or "—"
    project_objeto = proj.get("objeto_contrato") or None
    project_cliente = (proj.get("cliente_principal") or "").strip() or None
    project_color = _sanitize_color_hex(proj.get("color_tema")) or "#003366"
    # Color configurable del pie de foto (texto de observaciones bajo la imagen).
    # Fallback: negro. Usuario puede setear cualquier hex (#RRGGBB).
    report_text_color = _sanitize_color_hex(proj.get("report_text_color")) or "#0F172A"
    constructora_logo_b64 = (proj.get("constructora_logo") or "").strip() or None
    user_name = user.get("name", "")
    user_email = user.get("email", "")
    role_label = (
        "Coordinador" if role == ROLE_COORD
        else ("Especialista" if role == ROLE_ESPECIALISTA else "Sub-Coordinador")
    )
    # Etiqueta de área seleccionada (para portada)
    area_label = "Todas las áreas"
    if area_id:
        area = await db.areas.find_one({"id": area_id, "project_id": pid})
        if area:
            area_label = f"Área: {area.get('name', '—')}"

    # Rango DD-MM-YYYY (sin "Hoy"/"Ayer")
    fechas_label = f"{_fmt_fecha_dd_mm_yyyy(start_dt)} a {_fmt_fecha_dd_mm_yyyy(end_dt)}"

    # ========================================================================
    # DIMENSIONES DINÁMICAS DEL CANVAS
    # Si el proyecto tiene plantilla PDF, adoptamos EXACTAMENTE las
    # dimensiones (width × height en puntos) de su primera página. Esto
    # garantiza que el overlay posterior sea pixel-perfect independientemente
    # de si la plantilla es apaisada, vertical, tabloide o formato custom.
    # Si no hay plantilla → fallback a landscape(A4).
    # ========================================================================
    tpl_pdf_path = _get_project_template(proj, "pdf")
    tpl_page_w: Optional[float] = None
    tpl_page_h: Optional[float] = None
    if tpl_pdf_path:
        try:
            from pypdf import PdfReader as _PdfReaderProbe
            _probe = _PdfReaderProbe(io.BytesIO(Path(tpl_pdf_path).read_bytes()))
            if _probe.pages:
                _mb = _probe.pages[0].mediabox
                tpl_page_w = float(_mb.width)
                tpl_page_h = float(_mb.height)
                log.info(
                    "[pdf] canvas dinámico adoptado desde plantilla: "
                    "%.1f x %.1f pts (%.2f x %.2f cm)",
                    tpl_page_w, tpl_page_h,
                    tpl_page_w / cm, tpl_page_h / cm,
                )
        except Exception as _e:
            log.warning("[pdf] no se pudo leer dimensiones de plantilla PDF: %s", _e)
            tpl_page_w = tpl_page_h = None

    # ========================================================================
    # GENERACIÓN BLOQUEANTE (CPU-bound) → asyncio.to_thread
    # ========================================================================
    def _build_pdf_blocking() -> tuple:
        """Genera el PDF y devuelve (bytes, section_page_indices).
        `section_page_indices` es la lista de índices 0-based en el PDF que
        corresponden a páginas 'Separadoras de Sección/Nodo' (una por nodo).
        Estas páginas se reemplazan por la página 2 del template PDF durante
        la fusión de superposición, si el usuario subió una plantilla PDF."""
        section_page_indices: List[int] = []
        buf = io.BytesIO()
        # Adopta las dimensiones exactas de la plantilla si existe;
        # caso contrario usa landscape(A4) = 29.7 × 21 cm.
        if tpl_page_w and tpl_page_h and tpl_page_w > 0 and tpl_page_h > 0:
            PAGE = (tpl_page_w, tpl_page_h)
        else:
            PAGE = landscape(A4)
        PW, PH = PAGE
        c = _canvas.Canvas(buf, pagesize=PAGE)

        BRAND = HexColor(project_color)
        MUTED = HexColor("#64748B")
        BORDER = HexColor("#E2E8F0")
        TEXT = HexColor("#0F172A")
        WHITE = HexColor("#FFFFFF")

        # Logos institucionales: purgados. La plantilla PDF (páginas 0 y 1)
        # YA los trae impresos en su fondo. Cualquier logo programático
        # generaba "ghost images" (X rojas) al fusionar con la plantilla.
        logo_bytes = None  # noqa: F841
        logo_reader = None  # noqa: F841

        def _draw_logo(x, y, max_w, max_h):
            """DEPRECATED · no-op: la plantilla PDF trae los logos incrustados."""
            return False

        def draw_header(page_num: int):
            """DEPRECATED · no-op.

            La plantilla PDF (página 2 = membrete "ACTIVIDADES GENERALES")
            ya trae logos, banda superior y demás elementos institucionales.
            Cualquier decoración programática se solapaba con el membrete y
            dejaba "ghost images". Se conserva la firma por compatibilidad.
            """
            return

        # Márgenes protegidos para no invadir el membrete del template PDF.
        # TOP_MARGIN_PDF reserva la banda superior donde el template imprime
        # logos y encabezado. BOTTOM_MARGIN_PDF reserva la banda inferior.
        TOP_MARGIN_PDF = 4.0 * cm
        BOTTOM_MARGIN_PDF = 2.0 * cm
        total_reportes = sum(len(v) for v in reports_by_node.values())

        # --- PORTADA INSTITUCIONAL ----------------------------------------
        # La página 0 del template PDF aporta el diseño y los logos. Aquí
        # inyectamos SOLO los textos ejecutivos (tipo de reporte, período,
        # proyecto), respetando la plantilla del cliente.
        #
        # IMPORTANTE (paridad con PPTX):
        #   • Fallback obligatorio de título → "REPORTE" si `period_type` viene vacío.
        #   • Los textos se dibujan AL FINAL del canvas actual, DESPUÉS del
        #     `setFillColor(WHITE)`, y con showPage al terminar. Como el
        #     `merge_page` en la etapa de fusión pinta el contenido SynCo
        #     ENCIMA del template (foreground), quedan visibles sobre el
        #     fondo magenta.
        page_num = 1
        _period_titles = {
            "diario": "REPORTE DIARIO",
            "semanal": "REPORTE SEMANAL",
            "mensual": "REPORTE MENSUAL",
        }
        # Fallback institucional: "REPORTE" si no hay period_type.
        _report_title = _period_titles.get((period_type or "").lower(), "REPORTE")
        try:
            _date_range_txt = f"{_fmt_fecha_dd_mm_yyyy(data['start_dt'])} a {_fmt_fecha_dd_mm_yyyy(data['end_dt'])}"
        except Exception:
            _date_range_txt = ""
        _proj_upper = (project_name or "").upper()

        # Layout de la portada (alineado a la izquierda como el PPTX).
        # Coordenadas en el sistema de reportlab (Y=0 en la BASE).
        _cover_x_left = 1.5 * cm
        _cover_w_full = PW - 3.0 * cm
        # Bloque de textos centrado verticalmente en el TERCIO INFERIOR
        # de la portada (no invade el logo/encabezado del template).
        _cover_block_top_y = PH * 0.55  # baseline superior del bloque
        # Título "REPORTE" (grande, blanco, izquierda).
        _title_size = 44
        while c.stringWidth(_report_title, "Helvetica-Bold", _title_size) > _cover_w_full and _title_size > 20:
            _title_size -= 2
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", _title_size)
        c.drawString(_cover_x_left, _cover_block_top_y, _report_title)
        # Rango de fechas (medio, blanco).
        _dates_y = _cover_block_top_y - 1.6 * cm
        if _date_range_txt:
            c.setFont("Helvetica-Bold", 20)
            c.drawString(_cover_x_left, _dates_y, _date_range_txt)
        # Nombre del proyecto (grande, blanco, hasta 2 líneas si es muy largo).
        _proj_y = _dates_y - 1.8 * cm
        if _proj_upper:
            _proj_size = 26
            while c.stringWidth(_proj_upper, "Helvetica-Bold", _proj_size) > _cover_w_full and _proj_size > 14:
                _proj_size -= 1
            c.setFont("Helvetica-Bold", _proj_size)
            # Si aún no cabe → envolver en máx 2 líneas por palabras (word-wrap inline).
            if c.stringWidth(_proj_upper, "Helvetica-Bold", _proj_size) > _cover_w_full:
                _words = _proj_upper.split()
                _cover_lines: List[str] = []
                _cur = ""
                for _w in _words:
                    _cand = (_cur + " " + _w).strip() if _cur else _w
                    if c.stringWidth(_cand, "Helvetica-Bold", _proj_size) <= _cover_w_full:
                        _cur = _cand
                    else:
                        if _cur:
                            _cover_lines.append(_cur)
                        _cur = _w
                        if len(_cover_lines) >= 2:
                            break
                if _cur and len(_cover_lines) < 2:
                    _cover_lines.append(_cur)
                _lh = _proj_size * 1.15
                _ly = _proj_y
                for _ln in _cover_lines[:2]:
                    c.drawString(_cover_x_left, _ly, _ln)
                    _ly -= _lh
            else:
                c.drawString(_cover_x_left, _proj_y, _proj_upper)
        c.showPage()
        page_num += 1

        # --- PÁGINAS DE DATOS GENERALES (ex-Mapa: array de imágenes) -----
        # Cada imagen del array `general_data_images` genera UNA página
        # dedicada usando el mismo membrete institucional (página 1+ del
        # template). Retro-compat: si el array está vacío pero existe el
        # legacy `template_map`, se emite ese archivo como única página.
        _gd_images: List[str] = list(proj.get("general_data_images") or [])
        _legacy_map_path = _get_project_template(proj, "map") if not _gd_images else None

        def _draw_gd_image(img_bytes: bytes) -> bool:
            try:
                _img = ImageReader(io.BytesIO(img_bytes))
                _map_x = 1.5 * cm
                _map_y = BOTTOM_MARGIN_PDF
                _map_h = PH - TOP_MARGIN_PDF - BOTTOM_MARGIN_PDF
                _map_w = PW - 3.0 * cm
                c.drawImage(
                    _img, _map_x, _map_y,
                    width=_map_w, height=_map_h,
                    preserveAspectRatio=True, anchor='c', mask='auto',
                )
                return True
            except Exception:
                return False

        if _gd_images:
            _gd_page_count = len(_gd_images)
            for _b64 in _gd_images:
                try:
                    raw = base64.b64decode(_strip_b64_prefix(_b64))
                except Exception:
                    raw = b""
                _draw_gd_image(raw)
                c.showPage()
                page_num += 1
        elif _legacy_map_path:
            _gd_page_count = 1
            try:
                _draw_gd_image(Path(_legacy_map_path).read_bytes())
            except Exception:
                pass
            c.showPage()
            page_num += 1
        else:
            _gd_page_count = 1
            c.setFillColor(MUTED)
            c.setFont("Helvetica-Oblique", 12)
            c.drawCentredString(PW / 2, PH / 2,
                                "Sube imágenes de Datos Generales para el proyecto (presupuesto, programa, planos, mapa…).")
            c.showPage()
            page_num += 1

        if total_reportes == 0:
            c.setFillColor(MUTED)
            c.setFont("Helvetica-Oblique", 14)
            c.drawCentredString(PW / 2, PH / 2, "No hay reportes para el período seleccionado.")
            c.showPage()
            c.save()
            return buf.getvalue(), section_page_indices, [], _gd_page_count

        # =====================================================================
        # LAYOUT EJECUTIVO (P0 REFACTOR 2026-07):
        #   1. Portadilla de Nodo (ya renderizada arriba en el bucle).
        #   2. Portadilla de Área (NUEVA) - clonada del fondo de portada.
        #   3. Slides de reporte: 2 fotos apaisadas (13.37 × 10 cm) lado a
        #      lado, con caption (máx 4 líneas) DEBAJO de cada foto.
        #   · Eliminado: tablas de campos, banner de severidad, "Notas y
        #     noticias". La densidad se movió al PDF ejecutivo.
        # =====================================================================
        area_page_indices: List[int] = []

        # Dimensiones del layout ejecutivo (2 fotos por página)
        EXEC_PHOTO_W = 13.37 * cm
        EXEC_PHOTO_H = 10.0 * cm
        EXEC_GAP_X   = 0.6 * cm       # separación horizontal entre fotos
        EXEC_CAPTION_H = 3.8 * cm     # alto del cuadro de observaciones (más aire)
        EXEC_CAPTION_LEADING = 17
        EXEC_CAPTION_SIZE = 14
        CAPTION_COLOR = HexColor(report_text_color)

        def _wrap_lines(txt: str, max_w: float, font: str, size: float, max_lines: int):
            """Word-wrap simple truncado a `max_lines` líneas.
            Devuelve lista de strings ya envueltos."""
            out = []
            words = (txt or "").strip().split()
            current = ""
            for w in words:
                cand = (current + " " + w).strip() if current else w
                if c.stringWidth(cand, font, size) <= max_w:
                    current = cand
                else:
                    if current:
                        out.append(current)
                        current = w
                    else:
                        # palabra sola más ancha que la caja → truncar
                        out.append(w)
                        current = ""
                    if len(out) >= max_lines:
                        break
            if current and len(out) < max_lines:
                out.append(current)
            # Última línea con elipsis si aún queda texto
            if len(out) == max_lines:
                cw = c.stringWidth(out[-1], font, size)
                remaining_words = len(words) - sum(len(l.split()) for l in out)
                if remaining_words > 0:
                    ellipsis = "…"
                    # recortar hasta que quepa
                    while cw + c.stringWidth(ellipsis, font, size) > max_w and out[-1]:
                        out[-1] = out[-1][:-1]
                        cw = c.stringWidth(out[-1], font, size)
                    out[-1] = out[-1] + ellipsis
            return out


        def draw_dynamic_cover_page(cover_name: str, cover_b64: str, page_num_val: int) -> None:
            """Portadilla de Nodo — LIMPIA sobre el membrete del template PDF.

            Contenido inyectado (SOLO esto, sin fondos ni bordes ni logos):
              1) `cover_image` del nodo (grande, centrada, aspect-ratio
                 preservado, dentro del área útil del membrete).
              2) Título del nodo (path institucional) debajo de la cover.
            El fondo y el membrete institucional los aporta la plantilla
            PDF durante la fusión posterior.
            """
            title_h = 1.2 * cm
            title_gap = 0.4 * cm
            avail_top = PH - TOP_MARGIN_PDF
            avail_bot = BOTTOM_MARGIN_PDF
            avail_h = avail_top - avail_bot - title_h - title_gap
            avail_w = PW - 3.0 * cm
            target_ratio = 4.0 / 3.0
            w_from_h = avail_h * target_ratio
            if w_from_h <= avail_w:
                img_w = w_from_h
                img_h = avail_h
            else:
                img_w = avail_w
                img_h = avail_w / target_ratio
            img_x = (PW - img_w) / 2
            img_y = avail_bot + title_h + title_gap + (avail_h - img_h) / 2
            drawn = False
            try:
                _b64_data = _strip_b64_prefix(cover_b64) if cover_b64 else None
                if _b64_data:
                    raw = base64.b64decode(_b64_data)
                    img = ImageReader(io.BytesIO(raw))
                    c.drawImage(
                        img, img_x, img_y, width=img_w, height=img_h,
                        preserveAspectRatio=True, anchor='c', mask='auto',
                    )
                    drawn = True
            except Exception:
                drawn = False
            _title = (cover_name or "SECCIÓN").upper()
            _size = 18
            while c.stringWidth(_title, "Helvetica-Bold", _size) > PW - 3 * cm and _size > 10:
                _size -= 1
            # Paridad PPTX: NODE_TITLE_COLOR = azul-oscuro casi negro para
            # que resalte sobre el fondo BLANCO del membrete (antes se usaba
            # `BRAND` magenta claro que quedaba ilegible sobre blanco).
            c.setFillColor(HexColor("#0F172A"))
            c.setFont("Helvetica-Bold", _size)
            title_y = img_y - title_gap - title_h / 2 if drawn else avail_bot + avail_h / 2
            c.drawCentredString(PW / 2, title_y, _title)

        def draw_area_cover_page(area_name: str) -> None:
            """Portadilla de Área — SÓLO el nombre del área centrado en blanco
            sobre el fondo magenta de la portada. Se coloca en la MISMA
            coordenada Y que usa el título "REPORTE X" en la portada principal
            (PH * 0.32 + 1.6cm) para preservar coherencia visual con la
            jerarquía institucional."""
            title = _normalize_area_name(area_name or "SIN ÁREA", user_role=user.get("role"), user_area=user.get("area")).upper()
            size = 34  # mismo tamaño que "REPORTE X" en la portada
            while c.stringWidth(title, "Helvetica-Bold", size) > PW - 3.0 * cm and size > 18:
                size -= 2
            c.setFillColor(WHITE)
            c.setFont("Helvetica-Bold", size)
            _y = PH * 0.32 + 1.6 * cm
            c.drawCentredString(PW / 2, _y, title)

        def _crop_to_fill_bytes(b64_img: str, target_w: float, target_h: float) -> Optional[bytes]:
            """Crop-to-fill: recorta la imagen conservando su aspect-ratio para
            llenar EXACTAMENTE una caja de `target_w × target_h` (en pts).
            - Respeta EXIF orientation (fotos móviles rotadas).
            - Devuelve bytes JPEG listos para `drawImage(..., preserveAspectRatio=False)`.
            - Si Pillow no está o la imagen es inválida → None.
            """
            if not _HAS_PIL or not b64_img:
                return None
            try:
                raw = base64.b64decode(_strip_b64_prefix(b64_img))
                pil = _PILImage.open(io.BytesIO(raw))
                pil = _pil_exif_transpose(pil)  # respeta rotación EXIF
                if pil.mode not in ("RGB", "L"):
                    pil = pil.convert("RGB")
                iw, ih = pil.size
                if iw <= 0 or ih <= 0:
                    return None
                target_ratio = float(target_w) / float(target_h)
                cur_ratio = iw / ih
                if abs(cur_ratio - target_ratio) > 1e-3:
                    if cur_ratio > target_ratio:
                        # más ancha que la caja → recortar horizontal
                        new_w = int(round(ih * target_ratio))
                        x0 = max(0, (iw - new_w) // 2)
                        pil = pil.crop((x0, 0, x0 + new_w, ih))
                    else:
                        # más alta que la caja → recortar vertical
                        new_h = int(round(iw / target_ratio))
                        y0 = max(0, (ih - new_h) // 2)
                        pil = pil.crop((0, y0, iw, y0 + new_h))
                out = io.BytesIO()
                pil.save(out, format="JPEG", quality=88, optimize=True)
                return out.getvalue()
            except Exception:
                return None

        def draw_photo_with_caption(x: float, y_photo: float,
                                    b64_img: Optional[str],
                                    caption: str) -> None:
            """Dibuja UNA foto apaisada 13.37×10 cm en (x, y_photo) con su
            caption (máx 4 líneas) DEBAJO. `y_photo` es la esquina inferior-
            izquierda de la foto. El caption va inmediatamente debajo.

            La foto se pinta con estrategia CROP-TO-FILL: llena exactamente
            la caja 13.37×10 cm conservando el aspect-ratio original y
            recortando el excedente (centrado). Nunca se deforma."""
            drawn = False
            if b64_img:
                # 1) Preferido: crop-to-fill con Pillow (llena la caja).
                cropped = _crop_to_fill_bytes(b64_img, EXEC_PHOTO_W, EXEC_PHOTO_H)
                if cropped is not None:
                    try:
                        img = ImageReader(io.BytesIO(cropped))
                        c.drawImage(
                            img, x, y_photo,
                            width=EXEC_PHOTO_W, height=EXEC_PHOTO_H,
                            preserveAspectRatio=False, anchor='c', mask='auto',
                        )
                        drawn = True
                    except Exception:
                        drawn = False
                # 2) Fallback: sin Pillow / error → preservar aspect (letterbox).
                if not drawn:
                    try:
                        raw = base64.b64decode(_strip_b64_prefix(b64_img))
                        img = ImageReader(io.BytesIO(raw))
                        c.drawImage(
                            img, x, y_photo,
                            width=EXEC_PHOTO_W, height=EXEC_PHOTO_H,
                            preserveAspectRatio=True, anchor='c', mask='auto',
                        )
                        drawn = True
                    except Exception:
                        drawn = False
            if not drawn:
                # Rectángulo placeholder discreto (sin ghost images)
                c.setStrokeColor(BORDER)
                c.setLineWidth(0.5)
                c.rect(x, y_photo, EXEC_PHOTO_W, EXEC_PHOTO_H, stroke=1, fill=0)
                c.setFillColor(MUTED)
                c.setFont("Helvetica-Oblique", 10)
                c.drawCentredString(x + EXEC_PHOTO_W / 2,
                                    y_photo + EXEC_PHOTO_H / 2,
                                    "(sin imagen)")
            # Caption debajo de la foto
            caption_top = y_photo - 0.35 * cm
            font = "Helvetica"
            wrapped = _wrap_lines(caption or "—",
                                  EXEC_PHOTO_W,
                                  font, EXEC_CAPTION_SIZE, 4)
            c.setFillColor(CAPTION_COLOR)
            c.setFont(font, EXEC_CAPTION_SIZE)
            cy = caption_top
            for ln in wrapped:
                c.drawString(x, cy, ln)
                cy -= EXEC_CAPTION_LEADING

        # =====================================================================
        # Agrupación jerárquica: Nodo (con cover) → Área → Reportes.
        # [FILTRO ESTRICTO 2b] Solo procesamos nodos cuyo árbol (nodo o
        # ancestro) tenga cover_image. Sin cover_image en toda la rama → OMITIR.
        #
        # FIX 2026-07-06 · UBICACIÓN COMPLETA EN PORTADILLA DE NODO
        # ─────────────────────────────────────────────────────────
        # Antes el PDF agrupaba las portadillas por `cover_id` (varios
        # nodos hoja con el mismo ancestor de cover compartían UNA sola
        # portadilla) y mostraba SÓLO `cover_meta.name` (p.ej. "SUBTRAMO
        # E1-E2") en vez del `node_path` completo ("TRAMO 1 › Subtramo
        # E1-E2 › C1"), lo cual perdía la ubicación institucional.
        # Solución (paridad con PPTX): emitir 1 portadilla por cada nodo
        # hoja y usar `node_path` como título.
        # =====================================================================
        for n in leaf_nodes:
            node_reps = reports_by_node.get(n["id"]) or []
            if not node_reps:
                continue
            cover_meta = cover_ancestor_by_node.get(n["id"])
            if not cover_meta:
                continue
            node_path = path_cache.get(n["id"]) or n.get("name", "")

            # === Portadilla de Nodo (1 por nodo hoja) ========================
            # Título: node_path COMPLETO (con separador ›), mismo formato
            # que el PPTX (`TRAMO 1 › Subtramo E1-E2 › C1`).
            draw_dynamic_cover_page(
                node_path,  # ubicación institucional completa
                cover_meta.get("cover_image"),
                page_num,
            )
            c.showPage()
            page_num += 1

            # === Sub-agrupación por Área dentro del nodo =====================
            # Bucket key = nombre normalizado del área (colapsa "Sub
            # supervisores" en "OBRA CIVIL" y estabiliza tildes/plurales).
            def _bucket_key_for_report(_r: dict) -> str:
                _aid = _r.get("area_id")
                if not _aid:
                    return "SIN ÁREA"
                _a = areas_by_id.get(_aid) or {}
                return _normalize_area_name(_a.get("name"), user_role=user.get("role"), user_area=user.get("area"))

            reports_by_area: Dict[str, list] = {}
            for r in node_reps:
                _bk = _bucket_key_for_report(r)
                reports_by_area.setdefault(_bk, []).append(r)

            # Orden estable de áreas (alfabético por nombre)
            def _area_name(bk: str) -> str:
                return bk or "SIN ÁREA"
            ordered_area_ids = sorted(reports_by_area.keys(), key=lambda a: _area_name(a))

            for aid in ordered_area_ids:
                area_reps = reports_by_area[aid]
                area_name = _area_name(aid)

                # === Portadilla de Área (fondo magenta de la portada) ========
                # Índice 0-based en el PDF actual = page_num - 1
                area_page_indices.append(page_num - 1)
                draw_area_cover_page(area_name)
                c.showPage()
                page_num += 1

                # === Slides de reportes: 2 fotos apaisadas + captions ========
                # TOPE ESTRICTO: cada reporte emite UNA sola página con
                # hasta 2 fotos (las 2 primeras). Cada foto usa su caption
                # individual (`photo_captions[i]`) con fallback a la
                # observación general del reporte.
                photo_items: List[tuple] = []
                for r in area_reps:
                    imgs = (r.get("images") or [])[:2]  # HARD-CAP 2 fotos
                    general_obs = (r.get("observaciones") or r.get("notes") or "").strip()
                    if not general_obs:
                        general_obs = (r.get("incidencias") or "").strip() or "—"
                    caps = r.get("photo_captions") or []

                    def _cap_at_pdf(_idx: int) -> str:
                        if _idx < len(caps):
                            _c = (caps[_idx] or "").strip()
                            if _c:
                                return _c
                        return general_obs

                    if not imgs:
                        photo_items.append((None, general_obs))
                        photo_items.append(("__PAGEBREAK__", ""))
                        continue
                    for _i, b64 in enumerate(imgs):
                        photo_items.append((b64, _cap_at_pdf(_i)))
                    # Salto de página tras cada reporte para respetar el
                    # tope estricto de 1 página por reporte.
                    photo_items.append(("__PAGEBREAK__", ""))

                # Repartir en páginas de 2 fotos
                PER_PAGE = 2
                avail_top = PH - TOP_MARGIN_PDF
                avail_bot = BOTTOM_MARGIN_PDF
                avail_h = avail_top - avail_bot
                block_h = EXEC_PHOTO_H + 0.35 * cm + EXEC_CAPTION_H
                # Centrado vertical del bloque foto+caption
                block_top_y = avail_top - max(0.0, (avail_h - block_h) / 2)
                photo_bottom_y = block_top_y - EXEC_PHOTO_H
                total_w = PER_PAGE * EXEC_PHOTO_W + (PER_PAGE - 1) * EXEC_GAP_X
                x0 = (PW - total_w) / 2

                # Iteración con sentinela __PAGEBREAK__: cada reporte añade
                # un marcador tras sus 1-2 fotos, forzando 1 página por
                # reporte (tope estricto). Los sentinels se filtran del
                # dibujo pero disparan showPage.
                #
                # FIX 2026-07-06 · DRIFT DE page_num
                # ─────────────────────────────────────────────────────────
                # Anteriormente `page_num += 1` se ejecutaba SIEMPRE en la
                # rama __PAGEBREAK__, incluso cuando `_flush_page()` no
                # generaba página (buffer vacío tras un flush por saturación).
                # El drift acumulado provocaba que `area_page_indices` de
                # nodos/áreas posteriores apuntaran a PDF indexes equivocados
                # → el overlay marcaba páginas de FOTOS como "portadilla de
                # área" (fondo magenta) y viceversa.
                # Solución: `_flush_page()` devuelve True solo si se emitió
                # una página real; page_num se incrementa acorde.
                _buffer: List[tuple] = []
                def _flush_page() -> bool:
                    """Emite una página real con las fotos del buffer.
                    Devuelve True si se llamó a c.showPage(), False si el
                    buffer estaba vacío (no hay página que emitir)."""
                    if not _buffer:
                        return False
                    for idx, (b64, cap) in enumerate(_buffer[:PER_PAGE]):
                        px = x0 + idx * (EXEC_PHOTO_W + EXEC_GAP_X)
                        draw_photo_with_caption(px, photo_bottom_y, b64, cap)
                    c.showPage()
                    _buffer.clear()
                    return True

                for _item in photo_items:
                    if _item[0] == "__PAGEBREAK__":
                        if _flush_page():
                            page_num += 1
                        continue
                    _buffer.append(_item)
                    if len(_buffer) >= PER_PAGE:
                        if _flush_page():
                            page_num += 1
                # Flush residual (por si algún reporte quedó sin sentinela).
                if _flush_page():
                    page_num += 1

        c.save()
        return buf.getvalue(), section_page_indices, area_page_indices, _gd_page_count

    # Render bloqueante en thread aparte → libera event loop
    pdf_bytes, section_page_indices, area_page_indices, gd_page_count = await asyncio.to_thread(_build_pdf_blocking)

    # ── Fusión con plantilla PDF institucional (si existe) ────────────────
    # Modo Superposición:
    #   - Página 0 del template = fondo de la portada.
    #   - Página 1 del template (si existe) = "Sección de Nodo": REEMPLAZA
    #     por completo cada página separadora de nodo del reporte SynCo.
    #   - Página 2+ del template (si existe) = base para las páginas de datos.
    #     Si no hay página 2, se recicla la última página del template.
    # Nota: `tpl_pdf_path` ya fue calculado arriba para dimensionar el canvas
    # dinámicamente, por lo que aquí lo reutilizamos sin releer el disco.
    tpl_pdf = tpl_pdf_path
    if tpl_pdf:
        try:
            pdf_bytes = await asyncio.to_thread(
                _overlay_pdf_on_template, pdf_bytes, tpl_pdf,
                section_page_indices, area_page_indices, gd_page_count,
            )
        except Exception as e:
            log.warning("template pdf merge failed: %s", e)

    fname = _safe_export_filename(proj.get("name", "proyecto"), period, "pdf")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


def _overlay_pdf_on_template(
    content_pdf: bytes,
    template_path: str,
    section_page_indices: Optional[List[int]] = None,  # deprecated (no-op)
    cover_bg_page_indices: Optional[List[int]] = None,  # portadillas de Área
    general_data_page_count: int = 1,  # nº de páginas de Datos Generales
) -> bytes:
    """Modo Superposición: fusiona el PDF generado por SynCo sobre la plantilla PDF.

    Convención de páginas del template (3 páginas base):
      • Página 0 → 'Portada'. Se usa una única vez como fondo de la portada
        institucional del reporte SynCo (índice 0 del contenido).
      • Página 1 → 'Mapa'. Se usa una única vez como fondo de la página
        MAPA del reporte SynCo (índice 1 del contenido, con el
        `template_map` incrustado).
      • Página 2..N-1 → 'Lienzo recurrente'. Se cicla como fondo para el
        resto de páginas de contenido del reporte (portadillas de nodo +
        páginas de reporte + galerías).

    Reglas de tolerancia (backward-compat):
      • Si la plantilla tiene 1 página → todas las páginas del contenido se
        pintan sobre esa única página.
      • Si la plantilla tiene 2 páginas → índice 0 para portada, índice 1
        para mapa Y también como lienzo del resto.
      • `section_page_indices` se mantiene en la firma pero es ignorado.
    """
    from pypdf import PdfReader, PdfWriter
    tpl_bytes = Path(template_path).read_bytes()
    content_reader = PdfReader(io.BytesIO(content_pdf))
    tpl_count = len(PdfReader(io.BytesIO(tpl_bytes)).pages)
    if tpl_count == 0:
        return content_pdf

    # Índice del lienzo recurrente (páginas 2..N-1 del template)
    content_base_start = 2 if tpl_count >= 3 else (1 if tpl_count == 2 else 0)
    content_base_last = tpl_count - 1

    writer = PdfWriter()
    content_cycle_idx = 0
    _area_cover_set = set(cover_bg_page_indices or [])
    _gd_count = max(1, int(general_data_page_count or 1))
    for i, cpage in enumerate(content_reader.pages):
        fresh = PdfReader(io.BytesIO(tpl_bytes))
        if i == 0:
            # Portada del reporte → fondo = página 0 del template
            base_idx = 0
        elif 1 <= i <= _gd_count:
            # Datos Generales (ex-Mapa) → fondo = página 1 del template
            base_idx = 1 if tpl_count >= 2 else 0
        elif i in _area_cover_set:
            # Portadilla de Área → fondo = página 0 del template (magenta)
            base_idx = 0
        else:
            # Lienzo recurrente: cicla entre content_base_start..content_base_last
            span = content_base_last - content_base_start + 1
            if span <= 0:
                base_idx = content_base_last
            else:
                base_idx = content_base_start + (content_cycle_idx % span)
                content_cycle_idx += 1
        base = fresh.pages[base_idx]
        try:
            base.merge_page(cpage)
        except Exception:
            writer.add_page(cpage)
            continue
        writer.add_page(base)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()



# === DOCX / PPTX EXPORT (Cero Huella Local - 100 % en RAM con BytesIO) ======
# Reglas idénticas al motor PDF (Coord = todos / Esp = propios / Sub = scope).
# Período: today | yesterday | week | month.
# Procesamiento ESTRICTAMENTE en memoria (io.BytesIO) - NO se escribe ningún
# archivo al disco del dispositivo ni del servidor.

async def _gather_export_data(
    pid: str,
    period: str,
    user: dict,
    area_id: Optional[str] = None,
    scope_mine_only: bool = False,
    period_type: Optional[str] = None,
) -> dict:
    """Carga proyecto, nodos, reportes, anuncios y rutas aplicando filtros.

    Reglas:
      - `period_type` (nuevo · opcional): categoriza el reporte en
          "diario", "semanal" o "mensual". Si se provee, TIENE PRIORIDAD
          sobre `period` para calcular el rango temporal y sobrescribe el
          filtro de severidad institucional según reglas:
            * diario/semanal → incluye TODAS las severidades.
            * mensual        → SOLO importante + urgente.
        Si no se provee, se conserva el comportamiento clásico (`period` +
        severidad por rol vía `_export_severity_filter`).
      - Área: si `area_id` viene, filtra reportes por esa área.
      - Scope:
        * Coord / Sub-coord / Jefe → ven todos (a menos que pasen area_id).
        * Especialista → ve sus propios por defecto; si `scope_mine_only=False`
          y tiene `area_id`, ve los reportes del área.
      - Noticias inyectables: Importante + Urgente vinculadas a cada nodo
        (o sus ancestros) dentro del periodo.
    """
    await ensure_project_access(user, pid)
    proj = await db.projects.find_one({"id": pid})
    if not proj:
        raise HTTPException(404, "Proyecto no existe")

    pt_norm = _normalize_period_type(period_type)
    if pt_norm:
        start_dt, end_dt, period_label = _period_range_for_type(pt_norm)
    else:
        start_dt, end_dt, period_label = _period_range(period)

    nodes_raw = await db.location_nodes.find({"project_id": pid}).to_list(length=10000)
    nodes_by_id = {n["id"]: n for n in nodes_raw}
    root_ids = [n["id"] for n in nodes_raw if not n.get("parent_id")]
    root_ids.sort(key=lambda nid: (nodes_by_id[nid].get("order", 0), nodes_by_id[nid].get("name", "")))
    leaf_nodes = _flatten_tree_in_order(nodes_by_id, root_ids)

    role = user["role"]
    # Severidad efectiva: si viene period_type, se aplica su política; si
    # no, se conserva la política institucional por rol.
    default_sev_filter = _export_severity_filter(role)
    sev_filter = _severity_set_for_period_type(pt_norm, default_sev_filter)

    # --- Construir query base con filtros institucionales ---
    q: dict = {
        "project_id": pid,
        "created_at": {"$gte": start_dt, "$lte": end_dt},
        "severidad": {"$in": list(sev_filter)},
    }

    # Scope
    if role == ROLE_ESPECIALISTA:
        # Especialista: por defecto solo sus propios reportes.
        # Si `scope_mine_only=False` y tiene area_id, ampliamos al área.
        my_area = user.get("area_id")
        if scope_mine_only or not my_area:
            q["captured_by"] = user["id"]
        else:
            q["area_id"] = my_area
    else:
        # Supervisor (sub/jefe/coord): ven todo, opcionalmente filtrado por área.
        if area_id:
            q["area_id"] = area_id

    # Filtro área explícito (cuando coordinador/sub pasa area_id sin importar
    # el rol — ya manejado arriba para supervisores; para especialista lo
    # tomamos en cuenta también si pasa area_id explícito y no scope_mine_only).
    if role == ROLE_ESPECIALISTA and area_id and not scope_mine_only:
        q["area_id"] = area_id

    reports = await db.reports.find(q).to_list(length=20000)
    reports_by_node: dict = {}
    for r in reports:
        reports_by_node.setdefault(r.get("node_id"), []).append(r)
    for nid, lst in reports_by_node.items():
        lst.sort(key=lambda r: r.get("created_at") or datetime.min)

    path_cache: dict = {}
    for nid in list(reports_by_node.keys()):
        names = await node_path_names(nid)
        path_cache[nid] = " › ".join(names)

    # --- Noticias por nodo (Importante+Urgente, vinculadas a nodo o ancestros)
    announcements_by_node: dict = {}
    for nid in list(reports_by_node.keys()):
        node = nodes_by_id.get(nid)
        if not node:
            continue
        # build_node_path devuelve [root, ..., leaf] usando parent_id (path en BD
        # puede no estar materializado).
        path_ids = await build_node_path(node)
        if nid not in path_ids:
            path_ids.append(nid)
        announcements_by_node[nid] = await _announcements_for_node(pid, path_ids, start_dt, end_dt)

    # --- Primera lectura previa por nodo (continuidad histórica) ---
    prev_reading_by_node: dict = {}
    for nid in reports_by_node.keys():
        pre_q: dict = {"project_id": pid, "node_id": nid, "created_at": {"$lt": start_dt}}
        if role == ROLE_ESPECIALISTA and scope_mine_only:
            pre_q["captured_by"] = user["id"]
        prev = await db.reports.find(pre_q).sort("created_at", -1).limit(1).to_list(length=1)
        prev_reading_by_node[nid] = _extract_numeric_reading(prev[0]) if prev else None

    # --- Portadilla dinámica por nodo (cover_image) ---
    # Para cada nodo con reportes, encontramos el ancestro más cercano (o sí
    # mismo) que tenga `cover_image`. Se agrupa por ese ancestro para insertar
    # UNA sola portadilla por grupo.
    cover_ancestor_by_node: dict = {}
    for nid in list(reports_by_node.keys()):
        cur_node = nodes_by_id.get(nid)
        found = None
        while cur_node:
            ci = cur_node.get("cover_image")
            if ci:
                found = {
                    "id": cur_node["id"],
                    "name": cur_node.get("name") or "",
                    "cover_image": ci,
                }
                break
            pid_parent = cur_node.get("parent_id")
            cur_node = nodes_by_id.get(pid_parent) if pid_parent else None
        cover_ancestor_by_node[nid] = found  # dict o None

    # --- Áreas del proyecto (para portadillas de Área en el reporte) ---
    areas_raw = await db.areas.find({"project_id": pid}).to_list(length=500)
    areas_by_id = {a["id"]: a for a in areas_raw}

    return {
        "proj": proj,
        "leaf_nodes": leaf_nodes,
        "reports_by_node": reports_by_node,
        "announcements_by_node": announcements_by_node,
        "path_cache": path_cache,
        "period_label": period_label,
        "start_dt": start_dt,
        "end_dt": end_dt,
        "prev_reading_by_node": prev_reading_by_node,
        "cover_ancestor_by_node": cover_ancestor_by_node,
        "areas_by_id": areas_by_id,
        "period_type": pt_norm,
        "user": user,
    }


def _safe_export_filename(name: str, period: str, ext: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", name or "proyecto")[:60] or "proyecto"
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    # Sin prefijo "synco_": el archivo debe ser 100% institucional.
    return f"reporte_{safe}_{period}_{ts}.{ext}"


@api.get("/projects/{pid}/export/reports.docx")
async def export_reports_docx(
    pid: str,
    period: str = Query("today", description="today|yesterday|week|month"),
    area_id: Optional[str] = Query(None, description="Filtro por área (opcional)"),
    scope: Optional[str] = Query(None, description="mine|area (para especialistas)"),
    user: dict = Depends(current_user),
):
    """Exporta reportes en formato Microsoft Word (.docx). 100 % en RAM.

    Filtros idénticos al PDF: severidad (Importante+Urgente), área opcional,
    y scope para especialistas."""
    try:
        import base64
        from docx import Document
        from docx.shared import Cm, Pt, RGBColor
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement
    except Exception as e:
        raise HTTPException(500, f"python-docx no instalado: {e}")

    scope_mine_only = (scope or "").lower() == "mine"
    data = await _gather_export_data(pid, period, user, area_id=area_id, scope_mine_only=scope_mine_only)
    proj = data["proj"]
    leaf_nodes = data["leaf_nodes"]
    reports_by_node = data["reports_by_node"]
    announcements_by_node = data["announcements_by_node"]
    path_cache = data["path_cache"]
    start_dt = data["start_dt"]
    end_dt = data["end_dt"]
    cover_ancestor_by_node = data.get("cover_ancestor_by_node", {})

    project_name = proj.get("name", "Proyecto")
    project_contract = proj.get("contract_number") or "—"
    project_constructora = proj.get("constructora") or "—"
    project_objeto = proj.get("objeto_contrato") or None
    project_cliente = (proj.get("cliente_principal") or "").strip() or None
    project_color = _sanitize_color_hex(proj.get("color_tema")) or "#003366"
    constructora_logo_b64 = (proj.get("constructora_logo") or "").strip() or None
    fechas_label = f"{_fmt_fecha_dd_mm_yyyy(start_dt)} a {_fmt_fecha_dd_mm_yyyy(end_dt)}"

    area_label = "Todas las áreas"
    if area_id:
        area = await db.areas.find_one({"id": area_id, "project_id": pid})
        if area:
            area_label = f"Área: {area.get('name', '—')}"

    def _build_docx_blocking() -> bytes:
        """Motor DOCX estrictamente MONOCROMÁTICO, enfocado a LECTURA
        (2026-07-06 · CDMX · Batch de Producción V2).

        Diseño solicitado:
          * Un solo reporte por página (page break forzoso al finalizar cada uno).
          * SIN imágenes ni columnas: puro texto ordenado y legible.
          * Encabezado repetido en cada página con logo de la empresa (o nombre
            del proyecto si no hay logo) + fecha de exportación (CDMX).
          * Cuerpo por reporte: Ubicación · Área/Disciplina · Fecha · Autor,
            descripciones individuales por foto (`photo_captions[i]`) y la
            observación general al final.
          * PALETA ESTRICTAMENTE B/N (ahorro de tinta, impresión ejecutiva):
              - Títulos/etiquetas fuertes → negro puro (0,0,0).
              - Cuerpo de texto            → negro puro (0,0,0).
              - Texto secundario/atenuado  → gris oscuro (0x59,0x59,0x59).
              - Etiquetas muy sutiles      → gris medio (0x8C,0x8C,0x8C).
            No se aplica `project_color` en ninguna parte del documento; el
            color de marca del proyecto sólo se conserva para el PDF/PPTX.
        """
        # Zona horaria institucional: America/Mexico_City.
        try:
            _CDMX = ZoneInfo("America/Mexico_City")  # type: ignore[name-defined]
        except Exception:
            _CDMX = timezone.utc  # type: ignore[assignment]

        def _fmt_cdmx(dt) -> str:
            if not dt:
                return "—"
            try:
                if isinstance(dt, str):
                    try:
                        dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
                    except Exception:
                        return dt
                if isinstance(dt, datetime):
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    dt = dt.astimezone(_CDMX)
                    return dt.strftime("%d/%m/%Y %H:%M")
            except Exception:
                pass
            return str(dt)

        # Fecha de exportación (para el header institucional).
        try:
            exported_at = datetime.now(_CDMX).strftime("%d/%m/%Y %H:%M CDMX")
        except Exception:
            exported_at = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")

        # Logo (bytes) o None → nombre proyecto en su lugar.
        logo_bytes = _resolve_export_logo_bytes(constructora_logo_b64)

        # ============================================================
        # PALETA ESTRICTAMENTE MONOCROMÁTICA (blanco y negro / gris)
        # ------------------------------------------------------------
        # Requerimiento ejecutivo (Batch Producción V2): la salida DOCX
        # NO usa colores de marca — sólo negro y grises — para impresión
        # profesional y lectura sin ruido visual. Todos los alias de
        # colores que existían antes (BRAND_RGB, TEXT_RGB, MUTED_RGB,
        # SUBTLE_RGB) se conservan pero apuntan a la misma escala de
        # grises, para minimizar el diff y no romper el layout.
        # ============================================================
        _BLACK = RGBColor(0x00, 0x00, 0x00)
        _DARK_GRAY = RGBColor(0x59, 0x59, 0x59)
        _MID_GRAY = RGBColor(0x8C, 0x8C, 0x8C)

        # Alias semánticos (todos ⊂ B/N — el color de proyecto NO se usa).
        BRAND_RGB = _BLACK        # títulos/etiquetas fuertes
        TEXT_RGB = _BLACK         # cuerpo del texto
        MUTED_RGB = _DARK_GRAY    # texto atenuado (fecha export, "sin datos")
        SUBTLE_RGB = _MID_GRAY    # etiquetas muy sutiles ("Reporte n de N")

        doc = Document()

        # ---- Ajuste de márgenes cómodos para lectura ----
        for section in doc.sections:
            section.top_margin = Cm(2.0)
            section.bottom_margin = Cm(2.0)
            section.left_margin = Cm(2.2)
            section.right_margin = Cm(2.2)

            # === Header institucional (aparece en TODAS las páginas) ======
            header = section.header
            # Limpiamos y añadimos una tabla 1×2: [logo/nombre] | [fecha export]
            for old in list(header.paragraphs):
                # python-docx no permite borrar el primer párrafo, lo reusamos.
                pass
            hdr_table = header.add_table(rows=1, cols=2, width=Cm(17))
            hdr_table.autofit = True
            left_cell = hdr_table.cell(0, 0)
            right_cell = hdr_table.cell(0, 1)

            # Celda izquierda: logo si hay bytes, si no el nombre del proyecto.
            left_p = left_cell.paragraphs[0]
            left_p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            if logo_bytes:
                try:
                    left_p.add_run().add_picture(io.BytesIO(logo_bytes), height=Cm(1.2))
                except Exception:
                    lr = left_p.add_run(project_name)
                    lr.bold = True
                    lr.font.size = Pt(11)
                    lr.font.color.rgb = BRAND_RGB
            else:
                lr = left_p.add_run(project_name)
                lr.bold = True
                lr.font.size = Pt(11)
                lr.font.color.rgb = BRAND_RGB

            # Celda derecha: fecha de exportación.
            right_p = right_cell.paragraphs[0]
            right_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            rr = right_p.add_run(f"Exportado: {exported_at}")
            rr.italic = True
            rr.font.size = Pt(9)
            rr.font.color.rgb = MUTED_RGB

        # ---- Portada (1 página) --------------------------------------
        cover_title = doc.add_paragraph()
        cover_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        # Aire vertical (~1/3 de página) usando párrafos vacíos.
        for _ in range(6):
            doc.add_paragraph()
        ct = cover_title.add_run(project_name)
        ct.bold = True
        ct.font.size = Pt(28)
        ct.font.color.rgb = BRAND_RGB

        sub = doc.add_paragraph()
        sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
        sr = sub.add_run("Reporte de actividades")
        sr.font.size = Pt(16)
        sr.font.color.rgb = TEXT_RGB

        # Datos del proyecto
        meta_lines = [
            ("Contrato", str(project_contract or "—")),
            ("Constructora", str(project_constructora or "—")),
        ]
        if project_cliente:
            meta_lines.append(("Cliente", project_cliente))
        if project_objeto:
            meta_lines.append(("Objeto", project_objeto))
        meta_lines.append(("Período", fechas_label))
        meta_lines.append(("Filtro", area_label))

        # Separador visual
        doc.add_paragraph()
        for k, v in meta_lines:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            k_r = p.add_run(f"{k}: ")
            k_r.bold = True
            k_r.font.size = Pt(11)
            k_r.font.color.rgb = MUTED_RGB
            v_r = p.add_run(v)
            v_r.font.size = Pt(11)
            v_r.font.color.rgb = TEXT_RGB

        # Un solo reporte por página → salto de página tras portada.
        doc.add_page_break()

        # ---- Iteración de reportes ------------------------------------
        any_data = False
        reports_flat = []  # lista lineal en orden de árbol
        for n in leaf_nodes:
            node_reps = reports_by_node.get(n["id"]) or []
            for r in node_reps:
                reports_flat.append((n, r))

        total_reports = len(reports_flat)
        for idx, (node, r) in enumerate(reports_flat):
            any_data = True

            # ---- Encabezado del reporte ----
            title_p = doc.add_paragraph()
            title_p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            title_r = title_p.add_run(f"Reporte {idx + 1} de {total_reports}")
            title_r.bold = True
            title_r.font.size = Pt(9)
            title_r.font.color.rgb = SUBTLE_RGB

            # Ubicación (jerarquía completa del nodo)
            path = path_cache.get(node["id"]) or [node.get("name", "—")]
            path_txt = " › ".join([str(x) for x in path if x])

            loc_p = doc.add_paragraph()
            l_lbl = loc_p.add_run("Ubicación:  ")
            l_lbl.bold = True
            l_lbl.font.size = Pt(12)
            l_lbl.font.color.rgb = BRAND_RGB
            l_val = loc_p.add_run(path_txt)
            l_val.font.size = Pt(12)
            l_val.font.color.rgb = TEXT_RGB

            # Área / Disciplina
            area_p = doc.add_paragraph()
            a_lbl = area_p.add_run("Área / Disciplina:  ")
            a_lbl.bold = True
            a_lbl.font.size = Pt(11)
            a_lbl.font.color.rgb = BRAND_RGB
            a_val = area_p.add_run(_normalize_area_name(
                r.get("area_name"), user_role=user.get("role"), user_area=user.get("area"),
            ))
            a_val.font.size = Pt(11)
            a_val.font.color.rgb = TEXT_RGB

            # Fecha + Autor (misma línea)
            fa_p = doc.add_paragraph()
            f_lbl = fa_p.add_run("Fecha:  ")
            f_lbl.bold = True
            f_lbl.font.size = Pt(11)
            f_lbl.font.color.rgb = BRAND_RGB
            f_val = fa_p.add_run(_fmt_cdmx(r.get("created_at")))
            f_val.font.size = Pt(11)
            f_val.font.color.rgb = TEXT_RGB
            sep_r = fa_p.add_run("        ")
            sep_r.font.size = Pt(11)
            au_lbl = fa_p.add_run("Autor:  ")
            au_lbl.bold = True
            au_lbl.font.size = Pt(11)
            au_lbl.font.color.rgb = BRAND_RGB
            au_val = fa_p.add_run(str(r.get("captured_by_name") or "—"))
            au_val.font.size = Pt(11)
            au_val.font.color.rgb = TEXT_RGB

            # Contratista, si viene informado.
            contratista_val = (r.get("contratista") or "").strip()
            if contratista_val:
                ct_p = doc.add_paragraph()
                ct_lbl = ct_p.add_run("Contratista:  ")
                ct_lbl.bold = True
                ct_lbl.font.size = Pt(11)
                ct_lbl.font.color.rgb = BRAND_RGB
                ct_val = ct_p.add_run(contratista_val)
                ct_val.font.size = Pt(11)
                ct_val.font.color.rgb = TEXT_RGB

            # Separador visual
            doc.add_paragraph()

            # ---- Descripciones por fotografía ----
            captions = r.get("photo_captions") or []
            images_count = len(r.get("images") or [])
            # Usamos el máximo real detectado, con mínimo 2 (spec del usuario).
            slots = max(2, images_count, len(captions))
            has_any_caption = False
            for i in range(slots):
                cap = (captions[i] if i < len(captions) else "") or ""
                cap = cap.strip()
                if not cap:
                    # Sólo omitimos los slots vacíos que excedan las 2 primeras
                    # cuando NO hay imagen para ellos. Los dos primeros siempre
                    # aparecen para dejar rastro documental.
                    if i >= 2 and i >= images_count:
                        continue

                cap_p = doc.add_paragraph()
                cap_lbl = cap_p.add_run(f"Fotografía {i + 1} — descripción:")
                cap_lbl.bold = True
                cap_lbl.font.size = Pt(11)
                cap_lbl.font.color.rgb = BRAND_RGB

                body_p = doc.add_paragraph()
                if cap:
                    body_r = body_p.add_run(cap)
                    body_r.font.size = Pt(11)
                    body_r.font.color.rgb = TEXT_RGB
                    has_any_caption = True
                else:
                    body_r = body_p.add_run("(Sin descripción capturada)")
                    body_r.italic = True
                    body_r.font.size = Pt(11)
                    body_r.font.color.rgb = MUTED_RGB

            # ---- Observación general ----
            obs = (r.get("observaciones") or "").strip()
            obs_p = doc.add_paragraph()
            obs_lbl = obs_p.add_run("Observación general:")
            obs_lbl.bold = True
            obs_lbl.font.size = Pt(11)
            obs_lbl.font.color.rgb = BRAND_RGB
            obs_body = doc.add_paragraph()
            if obs:
                obs_r = obs_body.add_run(obs)
                obs_r.font.size = Pt(11)
                obs_r.font.color.rgb = TEXT_RGB
            else:
                obs_r = obs_body.add_run("(Sin observaciones)")
                obs_r.italic = True
                obs_r.font.size = Pt(11)
                obs_r.font.color.rgb = MUTED_RGB

            # Avance / medición, si aparece.
            avance_val = (r.get("avance") or "").strip()
            if avance_val:
                av_p = doc.add_paragraph()
                av_lbl = av_p.add_run("Avance / medición:  ")
                av_lbl.bold = True
                av_lbl.font.size = Pt(11)
                av_lbl.font.color.rgb = BRAND_RGB
                av_val = av_p.add_run(f"{avance_val} {r.get('unidad') or ''}".strip())
                av_val.font.size = Pt(11)
                av_val.font.color.rgb = TEXT_RGB

            # Page break forzoso al finalizar cada reporte.
            doc.add_page_break()

        # ---- Empty state ---------------------------------------------
        if not any_data:
            empty = doc.add_paragraph()
            empty.alignment = WD_ALIGN_PARAGRAPH.CENTER
            er = empty.add_run("Sin reportes en el período seleccionado.")
            er.italic = True
            er.font.size = Pt(12)
            er.font.color.rgb = MUTED_RGB

        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    docx_bytes = await asyncio.to_thread(_build_docx_blocking)
    fname = _safe_export_filename(project_name, period, "docx")
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api.get("/projects/{pid}/export/reports.pptx")
async def export_reports_pptx(
    pid: str,
    period: str = Query("today", description="today|yesterday|week|month"),
    period_type: Optional[str] = Query(
        None,
        description="diario | semanal | mensual · categoría ejecutiva.",
    ),
    area_id: Optional[str] = Query(None, description="Filtro por área (opcional)"),
    scope: Optional[str] = Query(None, description="mine|area (para especialistas)"),
    user: dict = Depends(current_user),
):
    """Exporta reportes en formato PowerPoint (.pptx) — Layout Ejecutivo."""
    try:
        import base64
        from pptx import Presentation
        from pptx.util import Cm, Pt
        from pptx.dml.color import RGBColor as PRGBColor
        from pptx.enum.text import PP_ALIGN
    except Exception as e:
        raise HTTPException(500, f"python-pptx no instalado: {e}")

    # === Datos comunes del export ===========================================
    scope_mine_only = (scope or "").lower() == "mine"
    data = await _gather_export_data(
        pid, period, user,
        area_id=area_id,
        scope_mine_only=scope_mine_only,
        period_type=period_type,
    )
    proj = data["proj"]
    leaf_nodes = data["leaf_nodes"]
    reports_by_node = data["reports_by_node"]
    path_cache = data["path_cache"]
    start_dt = data["start_dt"]
    end_dt = data["end_dt"]
    cover_ancestor_by_node = data.get("cover_ancestor_by_node", {})
    areas_by_id = data.get("areas_by_id", {})
    pt_norm = data.get("period_type")

    project_name = proj.get("name", "Proyecto")
    project_contract = proj.get("contract_number") or "—"  # noqa: F841
    project_constructora = proj.get("constructora") or "—"  # noqa: F841
    project_color = _sanitize_color_hex(proj.get("color_tema")) or "#003366"
    _ch = project_color.lstrip("#")
    BRAND_RGB = (int(_ch[0:2], 16), int(_ch[2:4], 16), int(_ch[4:6], 16))
    fechas_label = f"{_fmt_fecha_dd_mm_yyyy(start_dt)} a {_fmt_fecha_dd_mm_yyyy(end_dt)}"

    # Título ejecutivo dependiendo del tipo de reporte.
    _report_title_map = {
        "diario": "REPORTE DIARIO",
        "semanal": "REPORTE SEMANAL",
        "mensual": "REPORTE MENSUAL",
    }
    report_title = _report_title_map.get(pt_norm or "", "REPORTE")

    area_label = "Todas las áreas"  # noqa: F841
    if area_id:
        area = await db.areas.find_one({"id": area_id, "project_id": pid})
        if area:
            area_label = f"Área: {area.get('name', '—')}"

    def _build_pptx_blocking() -> bytes:
        tpl_pptx = _get_project_template(proj, "pptx")

        # ==============================================================
        # Motor PPTX (v2): TODO fondo proviene del MEMBRETE del usuario.
        # Si la plantilla existe, la 1ª slide es el "membrete master" y
        # se clona para CADA nueva slide del reporte. NO se dibujan
        # rectángulos de color hardcoded, ni bandas, ni headers, ni
        # footers programáticos: solo se INYECTA contenido dinámico
        # (texto, imágenes) sobre copias del membrete.
        # Si no hay plantilla, se generan slides en blanco sin decoración.
        # ==============================================================
        # tpl_cover_slide  = Slide 0 de la plantilla → PORTADA (se deja 100% intacta).
        # tpl_master_slide = Slide 1 de la plantilla ("ACTIVIDADES GENERALES") →
        #                    fondo/membrete UNIVERSAL clonado para Mapa, Nodos,
        #                    Reportes, Notas, etc.
        tpl_cover_slide = None
        tpl_master_slide = None
        if tpl_pptx:
            try:
                prs = Presentation(tpl_pptx)
                _n_tpl_slides = len(prs.slides)
                if _n_tpl_slides > 0:
                    tpl_cover_slide = prs.slides[0]
                if _n_tpl_slides > 1:
                    tpl_master_slide = prs.slides[1]
                else:
                    # Plantilla con una sola diapositiva: se reutiliza esa misma
                    # como membrete universal.
                    tpl_master_slide = tpl_cover_slide
                if _n_tpl_slides == 0:
                    prs = Presentation()
                    prs.slide_width = Cm(29.7)
                    prs.slide_height = Cm(21.0)
            except Exception:
                prs = Presentation()
                prs.slide_width = Cm(29.7)
                prs.slide_height = Cm(21.0)
        else:
            prs = Presentation()
            prs.slide_width = Cm(29.7)
            prs.slide_height = Cm(21.0)
        SW, SH = prs.slide_width, prs.slide_height
        # Margen superior seguro para no invadir logos/encabezado del membrete.
        TOP_MARGIN = Cm(3.5)
        BOTTOM_MARGIN = Cm(2.0)
        blank = prs.slide_layouts[6]

        # Imports adicionales para shape fill
        from pptx.enum.shapes import MSO_SHAPE  # noqa: F401  (kept for compat)
        from pptx.oxml.ns import qn as _qn  # noqa: F401
        from lxml import etree as _ET  # noqa: F401
        from copy import deepcopy as _deepcopy

        def _clone_slide(source_slide):
            """Clona una slide arbitraria (portada o membrete) reparando rIds.

            Deep-copia los shapes reparando las relaciones (`r:embed`,
            `r:link`) de imágenes para apuntar a rIds válidos en la slide
            destino. Sirve para clonar TANTO el membrete (Slide 1) como
            la portada institucional (Slide 0, usada para portadillas de
            área).
            """
            if source_slide is None:
                return prs.slides.add_slide(blank)
            try:
                from pptx.oxml.ns import qn as _qn
                _IMG_REL = (
                    "http://schemas.openxmlformats.org/"
                    "officeDocument/2006/relationships/image"
                )
                _EMBED = _qn("r:embed")
                _LINK = _qn("r:link")
                new_slide = prs.slides.add_slide(source_slide.slide_layout)
                for shp in list(new_slide.shapes):
                    try:
                        shp.element.getparent().remove(shp.element)
                    except Exception:
                        pass
                for shp in source_slide.shapes:
                    try:
                        new_el = _deepcopy(shp.element)
                        _skip_shape = False
                        for blip in new_el.iter(_qn("a:blip")):
                            for _attr in (_EMBED, _LINK):
                                old_rid = blip.get(_attr)
                                if not old_rid:
                                    continue
                                try:
                                    image_part = source_slide.part.related_part(old_rid)
                                    new_rid = new_slide.part.relate_to(image_part, _IMG_REL)
                                    blip.set(_attr, new_rid)
                                except Exception:
                                    _skip_shape = True
                                    break
                            if _skip_shape:
                                break
                        if _skip_shape:
                            continue
                        new_slide.shapes._spTree.insert_element_before(new_el, "p:extLst")
                    except Exception:
                        continue
                return new_slide
            except Exception:
                return prs.slides.add_slide(blank)

        def _clone_membrete():
            """Clona el membrete institucional (Slide 1) para páginas de contenido."""
            return _clone_slide(tpl_master_slide)

        def _clone_cover_bg():
            """Clona el fondo de la portada (Slide 0) para portadillas de Área."""
            return _clone_slide(tpl_cover_slide) if tpl_cover_slide else _clone_membrete()

        def add_bg_rect(slide, x, y, w, h, rgb_tuple):
            """DEPRECATED · no-op: los fondos ahora provienen exclusivamente
            del membrete de la plantilla. Mantenida por compatibilidad."""
            return None

        def add_text(slide, x, y, w, h, text, *, size=14, bold=False, color=(0x0F, 0x17, 0x2A),
                     align=PP_ALIGN.LEFT, italic=False):
            tb = slide.shapes.add_textbox(x, y, w, h)
            tf = tb.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.alignment = align
            run = p.add_run()
            run.text = str(text)
            run.font.size = Pt(size)
            run.font.bold = bold
            run.font.italic = italic
            run.font.color.rgb = PRGBColor(*color)
            return tb

        # Logo institucional: eliminado — la plantilla ya trae los logos
        # del membrete. Cualquier logo adicional programático producía
        # "ghost images" en las esquinas del reporte.
        # (Se conserva la resolución del blob por compatibilidad con otros
        # motores; no se inserta ninguna imagen adicional en PPTX.)
        logo_bytes = None  # noqa: F841

        def add_logo(slide, x, y, w_cm: float, h_cm: float):
            """DEPRECATED · no-op: no se insertan logos adicionales en PPTX."""
            return False

        def add_header_footer(slide):
            """DEPRECATED · no-op: el encabezado/pie institucional ahora
            proviene exclusivamente del membrete de la plantilla clonada
            por `_clone_membrete()`. Se mantiene para compatibilidad con
            invocaciones existentes."""
            return None

        # ==============================================================
        # COLORES PARAMETRIZABLES (documentados para futura configuración
        # por proyecto vía DB). Todos son tuples RGB (0..255).
        # ==============================================================
        COVER_TEXT_COLOR = (0xFF, 0xFF, 0xFF)     # Portada principal: blanco
        AREA_TEXT_COLOR = (0xFF, 0xFF, 0xFF)      # Portadillas de Área: blanco
        NODE_TITLE_COLOR = (0x0F, 0x17, 0x2A)     # Título de nodo: azul oscuro
        PHOTO_CAPTION_COLOR = _sanitize_color_hex(proj.get("report_text_color")) or "#0F172A"
        # Convertir a tupla RGB para python-pptx
        _pcc = PHOTO_CAPTION_COLOR.lstrip("#")
        PHOTO_CAPTION_COLOR = (int(_pcc[0:2], 16), int(_pcc[2:4], 16), int(_pcc[4:6], 16))
        TEXT_MUTED = (0x64, 0x75, 0x8B)

        # ===== PORTADA PRINCIPAL (Slide 0 de la plantilla) =============
        # NOTA IMPORTANTE: los textos de la portada se inyectan AL FINAL
        # del render (después de todas las clonaciones de portadillas de
        # Área), para evitar que dichas portadillas hereden estos textos
        # al clonarse desde `tpl_cover_slide`. Aquí solo garantizamos que
        # existe la portada; los textos van al cierre del builder.
        if tpl_cover_slide is None and tpl_master_slide is None:
            # Sin plantilla: portada en blanco.
            prs.slides.add_slide(blank)

        # ===== SLIDES DATOS GENERALES (ex-Mapa: array de imágenes) =========
        # Cada imagen en `general_data_images` produce UNA slide dedicada
        # sobre el membrete institucional. Retro-compat: si el array está
        # vacío pero existe `template_map` (legacy), se emite ese archivo
        # como única slide. Si nada, slide con mensaje guía.
        _gd_images_p: List[str] = list(proj.get("general_data_images") or [])
        _legacy_map_pptx = _get_project_template(proj, "map") if not _gd_images_p else None

        def _emit_gd_slide_from_bytes(img_bytes: bytes) -> None:
            _sl = _clone_membrete()
            try:
                _map_x = Cm(1.0)
                _map_y = TOP_MARGIN
                _map_w = SW - Cm(2.0)
                _map_h = SH - _map_y - BOTTOM_MARGIN
                _sl.shapes.add_picture(
                    io.BytesIO(img_bytes),
                    _map_x, _map_y, width=_map_w, height=_map_h,
                )
            except Exception:
                pass

        if _gd_images_p:
            for _b64 in _gd_images_p:
                try:
                    raw = base64.b64decode(_strip_b64_prefix(_b64))
                    _emit_gd_slide_from_bytes(raw)
                except Exception:
                    _emit_gd_slide_from_bytes(b"")
        elif _legacy_map_pptx:
            try:
                _emit_gd_slide_from_bytes(Path(_legacy_map_pptx).read_bytes())
            except Exception:
                _emit_gd_slide_from_bytes(b"")
        else:
            _empty = _clone_membrete()
            add_text(_empty, Cm(1.0), SH / 2 - Cm(0.6), SW - Cm(2.0), Cm(1.2),
                     "Sube imágenes de Datos Generales para el proyecto (presupuesto, programa, planos, mapa…).",
                     size=14, italic=True, color=TEXT_MUTED,
                     align=PP_ALIGN.CENTER)

        # ================================================================
        # Helper: emite una slide ejecutiva con hasta 2 FOTOS (foto + pie).
        # Cada foto es apaisada 13.37 × 10 cm; debajo va un cuadro de texto
        # con la descripción/observación del reporte al que pertenece
        # (máx 4 líneas). Un reporte con 4 fotos genera 2 slides.
        # ================================================================
        PHOTO_W = Cm(13.37)
        PHOTO_H = Cm(10.0)
        GAP_X = Cm(0.6)
        CAPTION_H = Cm(3.8)  # holgura para caption a 14pt (≈ 4 líneas)
        CAPTION_GAP = Cm(0.25)
        CAPTION_FONT_PT = 14

        def _pair_slide(photo_pair):
            """Emite una slide con hasta 2 fotos (foto + pie de texto).
            `photo_pair` es una lista de tuplas (b64_img|None, caption_str)."""
            slide = _clone_membrete()
            total_w = 2 * PHOTO_W + GAP_X
            x0 = (SW - total_w) // 2
            avail_top = TOP_MARGIN
            avail_h = SH - TOP_MARGIN - BOTTOM_MARGIN
            block_h = PHOTO_H + CAPTION_GAP + CAPTION_H
            y_photo = avail_top + (avail_h - block_h) // 2
            for idx, item in enumerate(photo_pair):
                if item is None:
                    continue
                b64_img, caption = item
                cx = x0 + idx * (PHOTO_W + GAP_X)
                if b64_img:
                    try:
                        raw = base64.b64decode(_strip_b64_prefix(b64_img))
                        slide.shapes.add_picture(
                            io.BytesIO(raw), cx, y_photo,
                            width=PHOTO_W, height=PHOTO_H,
                        )
                    except Exception:
                        pass
                # Pie de foto: descripción/observación del reporte
                caption_txt = (caption or "").strip() or "—"
                if len(caption_txt) > 320:
                    caption_txt = caption_txt[:317] + "…"
                add_text(
                    slide, cx, y_photo + PHOTO_H + CAPTION_GAP,
                    PHOTO_W, CAPTION_H,
                    caption_txt, size=CAPTION_FONT_PT, bold=False,
                    color=PHOTO_CAPTION_COLOR, align=PP_ALIGN.LEFT,
                )
            return slide

        any_data = False
        for n in leaf_nodes:
            node_reps = reports_by_node.get(n["id"]) or []
            if not node_reps:
                continue
            cover_meta_pptx = cover_ancestor_by_node.get(n["id"])
            if not cover_meta_pptx:
                continue
            any_data = True
            node_path = path_cache.get(n["id"]) or n.get("name", "")

            # === Portadilla de nodo: cover_image grande + TÍTULO ===========
            s = _clone_membrete()
            _title_h = Cm(1.8)
            _title_gap = Cm(0.5)
            _cov_b64_p = _strip_b64_prefix(cover_meta_pptx.get("cover_image") or "")
            _cw = Cm(0)
            _ch2 = Cm(0)
            _cy = TOP_MARGIN
            if _cov_b64_p:
                try:
                    _avail_w = SW - Cm(2.0)
                    _avail_h = SH - TOP_MARGIN - BOTTOM_MARGIN - _title_h - _title_gap
                    _target_ratio = 4.0 / 3.0
                    _w_from_h = _avail_h * _target_ratio
                    if _w_from_h <= _avail_w:
                        _cw = _w_from_h
                        _ch2 = _avail_h
                    else:
                        _cw = _avail_w
                        _ch2 = _avail_w / _target_ratio
                    _cx = (SW - _cw) // 2
                    _cy = TOP_MARGIN + (_avail_h - _ch2) // 2
                    s.shapes.add_picture(
                        io.BytesIO(base64.b64decode(_cov_b64_p)),
                        _cx, _cy, width=_cw, height=_ch2,
                    )
                except Exception:
                    _ch2 = Cm(0)
            _title_y = (
                _cy + _ch2 + _title_gap
                if _ch2 and _ch2 > Cm(0)
                else TOP_MARGIN + (SH - TOP_MARGIN - BOTTOM_MARGIN) // 2 - _title_h // 2
            )
            add_text(
                s, Cm(1.0), _title_y, SW - Cm(2.0), _title_h,
                node_path,
                size=28, bold=True, color=NODE_TITLE_COLOR, align=PP_ALIGN.CENTER,
            )

            # === Sub-bucle por Área/Disciplina (bucket normalizado) ========
            # "Sub supervisores" → "OBRA CIVIL". Áreas con tildes/plurales
            # se colapsan al mismo bucket.
            reps_by_area: dict = {}
            for r in node_reps:
                _aid_r = r.get("area_id")
                if not _aid_r:
                    _bk = "SIN ÁREA"
                else:
                    _bk = _normalize_area_name(
                        (areas_by_id.get(_aid_r) or {}).get("name"),
                        user_role=user.get("role"),
                        user_area=user.get("area"),
                    )
                reps_by_area.setdefault(_bk, []).append(r)
            _sorted_area_ids = sorted(reps_by_area.keys(), key=lambda a: a.lower())
            for bkey in _sorted_area_ids:
                area_reps = reps_by_area[bkey]
                area_name = bkey  # ya normalizado

                # --- Portadilla de Área (clon del fondo de la portada) ----
                # Título posicionado en la MISMA Y que "REPORTE X" en la
                # portada principal, para preservar consistencia visual.
                a_slide = _clone_cover_bg()
                _area_y = SH * 0.32  # equivalente a PH*0.32 en el PDF
                add_text(
                    a_slide, Cm(1.5), _area_y, SW - Cm(3.0), Cm(4.0),
                    area_name.upper(),
                    size=44, bold=True,
                    color=AREA_TEXT_COLOR, align=PP_ALIGN.CENTER,
                )

                # --- Slides ejecutivas: 2 FOTOS por slide -----------------
                # TOPE ESTRICTO: cada reporte emite UNA sola slide con
                # máximo 2 fotos (las 2 primeras). Con captions individuales
                # por foto (`photo_captions[i]`), fallback a la observación
                # general si el caption individual está vacío.
                for _r in area_reps:
                    _all_imgs = _r.get("images") or []
                    _imgs = _all_imgs[:2]  # HARD-CAP: máximo 2 fotos
                    _general_obs = (
                        _r.get("observaciones") or _r.get("notes") or ""
                    ).strip() or (_r.get("incidencias") or "").strip() or "—"
                    _caps = _r.get("photo_captions") or []
                    def _cap_at(idx: int) -> str:
                        if idx < len(_caps):
                            _c = (_caps[idx] or "").strip()
                            if _c:
                                return _c
                        return _general_obs
                    if not _imgs:
                        # Reporte sin fotos → 1 slide con placeholder + obs.
                        _pair_slide([(None, _general_obs), None])
                        continue
                    _pair: list = []
                    for _i, _b64 in enumerate(_imgs):
                        _pair.append((_b64, _cap_at(_i)))
                    while len(_pair) < 2:
                        _pair.append(None)
                    _pair_slide(_pair)

        # ==============================================================
        # TEXTOS DE PORTADA PRINCIPAL — se inyectan al FINAL para que las
        # clonaciones previas de `tpl_cover_slide` (portadillas de Área) no
        # arrastren estos textos como fondo residual.
        # ==============================================================
        if tpl_cover_slide is not None:
            _cx_left = Cm(1.5)
            _cy_top = Cm(6.0)
            _cw_full = SW - Cm(3.0)
            add_text(
                tpl_cover_slide, _cx_left, _cy_top, _cw_full, Cm(3.0),
                report_title, size=54, bold=True,
                color=COVER_TEXT_COLOR, align=PP_ALIGN.LEFT,
            )
            add_text(
                tpl_cover_slide, _cx_left, _cy_top + Cm(3.2), _cw_full, Cm(1.2),
                fechas_label, size=22, bold=True,
                color=COVER_TEXT_COLOR, align=PP_ALIGN.LEFT,
            )
            add_text(
                tpl_cover_slide, _cx_left, _cy_top + Cm(4.6), _cw_full, Cm(2.0),
                project_name, size=28, bold=True,
                color=COVER_TEXT_COLOR, align=PP_ALIGN.LEFT,
            )

        if not any_data:
            s2 = _clone_membrete()
            add_text(s2, Cm(1.5), SH / 2 - Cm(1.0), SW - Cm(3.0), Cm(2.0),
                     "Sin reportes en el período seleccionado.",
                     size=20, italic=True, color=TEXT_MUTED,
                     align=PP_ALIGN.CENTER)

        # === [BLOQUE LEGACY PURGADO 2026-07-04] Layout viejo con tablas y 
        # 'Notas y noticias' eliminado tras refactor P0 → Layout Ejecutivo.


        # ================================================================
        # Eliminar la diapositiva de membrete original (índice 1) para que
        # no quede vacía en el PPTX final. Snippet exacto pedido por el
        # usuario · borra la relación de la Presentation-part y purga la
        # entrada del sldIdLst.
        # ================================================================
        try:
            rId = prs.slides._sldIdLst[1].rId
            prs.part.drop_rel(rId)
            del prs.slides._sldIdLst[1]
        except Exception:
            pass

        buf = io.BytesIO()
        prs.save(buf)
        return buf.getvalue()

    pptx_bytes = await asyncio.to_thread(_build_pptx_blocking)
    fname = _safe_export_filename(project_name, period, "pptx")
    return StreamingResponse(
        io.BytesIO(pptx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# === DAILY GOALS (Metas del día por proyecto) ==============================
class DailyGoalIn(BaseModel):
    text: str


class DailyGoalPatch(BaseModel):
    text: Optional[str] = None
    is_completed: Optional[bool] = None


def _goal_out(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


@api.get("/projects/{pid}/daily_goals")
async def list_daily_goals(pid: str, user: dict = Depends(current_user)):
    await ensure_project_access(user, pid)
    cur = db.daily_goals.find({"project_id": pid}).sort("created_at", 1)
    out = []
    async for d in cur:
        out.append(_goal_out(d))
    return out


@api.post("/projects/{pid}/daily_goals")
async def create_daily_goal(pid: str, body: DailyGoalIn, user: dict = Depends(current_user)):
    if user["role"] not in (ROLE_COORD, ROLE_JEFE, ROLE_SUB):
        raise HTTPException(403, "Solo coord, jefe o sub-coordinador pueden crear metas")
    await ensure_project_access(user, pid)
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "El texto es obligatorio")
    gid = str(uuid.uuid4())
    doc = {
        "id": gid,
        "project_id": pid,
        "text": text,
        "is_completed": False,
        "created_at": datetime.now(timezone.utc),
        "created_by": user["id"],
        "created_by_name": user.get("name", ""),
    }
    await db.daily_goals.insert_one(doc)
    return _goal_out(doc)


@api.patch("/projects/{pid}/daily_goals/{gid}")
async def update_daily_goal(pid: str, gid: str, body: DailyGoalPatch, user: dict = Depends(current_user)):
    if user["role"] not in (ROLE_COORD, ROLE_JEFE, ROLE_SUB):
        raise HTTPException(403, "Solo coord, jefe o sub-coordinador pueden modificar metas")
    await ensure_project_access(user, pid)
    upd: dict = {}
    if body.text is not None:
        t = body.text.strip()
        if not t:
            raise HTTPException(400, "Texto inválido")
        upd["text"] = t
    if body.is_completed is not None:
        upd["is_completed"] = bool(body.is_completed)
    if upd:
        res = await db.daily_goals.update_one({"id": gid, "project_id": pid}, {"$set": upd})
        if res.matched_count == 0:
            raise HTTPException(404, "Meta no encontrada")
    out = await db.daily_goals.find_one({"id": gid, "project_id": pid})
    if not out:
        raise HTTPException(404, "Meta no encontrada")
    return _goal_out(out)


@api.delete("/projects/{pid}/daily_goals/{gid}")
async def delete_daily_goal(pid: str, gid: str, user: dict = Depends(current_user)):
    if user["role"] not in (ROLE_COORD, ROLE_JEFE, ROLE_SUB):
        raise HTTPException(403, "Solo coord, jefe o sub-coordinador pueden eliminar metas")
    await ensure_project_access(user, pid)
    res = await db.daily_goals.delete_one({"id": gid, "project_id": pid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Meta no encontrada")
    return {"ok": True}


# === AI Summary (Resumen Ejecutivo con IA) ==================================
class AISummaryResponse(BaseModel):
    summary: str
    reports_count: int
    period_hours: int
    generated_at: datetime


@api.post("/projects/{pid}/ai_summary", response_model=AISummaryResponse)
async def project_ai_summary(pid: str, user: dict = Depends(current_user)):
    """Genera un resumen ejecutivo (3 viñetas) usando IA con base en los
    reportes de las últimas 24h del proyecto. Disponible para todos los roles
    con acceso al proyecto."""
    await ensure_project_access(user, pid)

    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "EMERGENT_LLM_KEY no configurada en el servidor.")

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    q: dict = {"project_id": pid, "created_at": {"$gte": since}}
    # Aplica el mismo scope RBAC que el feed.
    if user["role"] == ROLE_ESPECIALISTA:
        scope = user.get("scope_node_ids") or []
        q["node_id"] = {"$in": scope}
    # Sub-coordinador: scope GLOBAL (sin restricción).

    raw = await db.reports.find(q).sort("created_at", -1).to_list(length=500)

    if not raw:
        return AISummaryResponse(
            summary=(
                "• No se registraron reportes en las últimas 24 horas.\n"
                "• Equipo y personal sin movimientos capturados.\n"
                "• Recomendación: validar con sub-coordinadores el estado de avance del día."
            ),
            reports_count=0,
            period_hours=24,
            generated_at=datetime.now(timezone.utc),
        )

    # Formatea reportes como texto plano legible para el LLM.
    lines: List[str] = []
    for r in raw:
        path = " › ".join(r.get("node_path_names") or []) or "(sin nodo)"
        area = r.get("area_name") or "—"
        avance = r.get("avance") or "—"
        contratista = r.get("contratista") or "—"
        personnel = ", ".join(r.get("personnel") or []) or "—"
        equipment = ", ".join(r.get("equipment") or []) or "—"
        captured_by = r.get("captured_by_name") or "—"
        created = r.get("created_at")
        created_s = created.isoformat() if isinstance(created, datetime) else str(created)
        lines.append(
            f"- [{created_s}] {path} | Área: {area} | Avance: {avance} | "
            f"Contratista: {contratista} | Personal: {personnel} | "
            f"Equipo: {equipment} | Capturó: {captured_by}"
        )
    body = "\n".join(lines)

    system_message = (
        "ERES UN ANALISTA DE OBRA CIVIL DE NIVEL EJECUTIVO. TUS REGLAS SON INQUEBRANTABLES:\n"
        "1) NO PUEDES INVENTAR DATOS (ALUCINAR). SI NO HAY INFORMACIÓN, REPORTA QUE EL DATO NO ESTÁ DISPONIBLE.\n"
        "2) NO PUEDES FALLAR.\n"
        "3) TU ÚNICA FUNCIÓN ES RESUMIR EXACTAMENTE LO QUE DICEN LOS REPORTES SIN AGREGAR INTERPRETACIONES AJENAS.\n"
        "4) ESTRUCTURA: SOLO 3 VIÑETAS EJECUTIVAS Y NADA MÁS.\n\n"
        "Responde SIEMPRE en español. Cada viñeta debe iniciar con '• '. "
        "Distribución sugerida: una viñeta para avances, una para equipo/maquinaria y una para personal. "
        "Si alguna categoría no tiene datos, indícalo explícitamente como 'No disponible en los reportes'. "
        "Cero relleno, sin introducciones ni cierres."
    )
    user_text = (
        f"Reportes de las últimas 24 horas del proyecto (id={pid}). "
        f"Total: {len(raw)} entradas.\n\n{body}\n\n"
        "Genera el resumen ejecutivo solicitado."
    )

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = (
            LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"ai_summary_{pid}_{uuid.uuid4().hex[:8]}",
                system_message=system_message,
            )
            .with_model("openai", "gpt-4o-mini")
            .with_params(max_tokens=400)
        )
        reply = await chat.send_message(UserMessage(text=user_text))
        summary = (reply or "").strip() if isinstance(reply, str) else str(reply).strip()
        if not summary:
            raise RuntimeError("Respuesta vacía del LLM")
    except Exception as e:
        log.exception("[ai_summary] LLM error: %s", e)
        raise HTTPException(502, f"No se pudo generar el resumen con IA: {e}")

    return AISummaryResponse(
        summary=summary,
        reports_count=len(raw),
        period_hours=24,
        generated_at=datetime.now(timezone.utc),
    )


# =============================================================================
# HUB DE MINUTAS (Batch V2 · Fase 1 · 2026-07)
# -----------------------------------------------------------------------------
# Módulo de seguimiento de acuerdos y minutas de obra.
#
# Modelo (colección `minutas`):
#   { id, project_id, titulo, descripcion, area_ids[], area_names[],
#     fecha_reunion (ISO date), author_id, author_name, author_role,
#     acuerdos: [ { id, descripcion, responsable_id, responsable_name,
#                   fecha_limite (ISO date), estado (bool),
#                   completed_at, completed_by, completed_by_name } ],
#     created_at, updated_at }
#
# Reglas de negocio:
#   * Crear minutas: coord_general, jefe_proyecto, sub_coordinador.
#   * Ver minutas: cualquier miembro del proyecto (RBAC vía ensure_project_access).
#   * Marcar/desmarcar acuerdo como concluido: SOLO el autor de la minuta.
#     Esta regla se refuerza server-side (401/403) sin depender del front.
#   * Borrar minuta: SOLO el autor o un Coord General del proyecto.
# =============================================================================


class AcuerdoIn(BaseModel):
    descripcion: str
    responsable_id: str
    fecha_limite: str  # ISO date "YYYY-MM-DD"


class MinutaIn(BaseModel):
    titulo: str
    descripcion: Optional[str] = ""
    area_ids: List[str] = Field(default_factory=list)
    involved_ids: List[str] = Field(default_factory=list)
    fecha_reunion: Optional[str] = None  # ISO date; default hoy CDMX
    # Ubicación de la minuta: id de un nodo del árbol de ubicaciones del proyecto.
    # Requerido a nivel de negocio (validado en el endpoint), opcional en el modelo
    # para no romper minutas creadas antes del 2026-07 (backfill = null).
    ubicacion_id: Optional[str] = None
    acuerdos: List[AcuerdoIn] = Field(default_factory=list)


_MINUTA_CREATORS = {ROLE_COORD, ROLE_JEFE, ROLE_SUB}


def _minuta_out(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def _resolve_areas_for_minuta(pid: str, area_ids: List[str]) -> tuple[List[str], List[str]]:
    """Valida las áreas contra el proyecto y devuelve (ids_norm, names)."""
    if not area_ids:
        return [], []
    # Dedup + strip
    clean = [a.strip() for a in area_ids if a and a.strip()]
    clean = list(dict.fromkeys(clean))  # preserva orden, quita duplicados
    if not clean:
        return [], []
    cursor = db.areas.find({"project_id": pid, "id": {"$in": clean}})
    found = await cursor.to_list(length=len(clean))
    found_map = {a["id"]: a for a in found}
    missing = [aid for aid in clean if aid not in found_map]
    if missing:
        raise HTTPException(400, f"Áreas inválidas: {', '.join(missing)}")
    return clean, [found_map[a]["name"] for a in clean]


@api.post("/projects/{pid}/minutas")
async def create_minuta(pid: str, body: MinutaIn, user: dict = Depends(current_user)):
    await ensure_project_access(user, pid)
    if user["role"] not in _MINUTA_CREATORS:
        raise HTTPException(403, "Sólo Coordinación General, Jefes o Sub-Coordinadores pueden crear minutas")
    titulo = (body.titulo or "").strip()
    if not titulo:
        raise HTTPException(400, "Título requerido")
    if len(titulo) > 200:
        raise HTTPException(400, "Título máximo 200 caracteres")
    descripcion = (body.descripcion or "").strip()
    if len(descripcion) > 4000:
        raise HTTPException(400, "Descripción máximo 4000 caracteres")
    area_ids, area_names = await _resolve_areas_for_minuta(pid, body.area_ids or [])
    fecha_reunion = (body.fecha_reunion or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Ubicación (nodo del proyecto) — REQUERIDA por regla de negocio 2026-07.
    # Guardamos id + name + path para poder mostrar breadcrumb sin joins extra.
    ubicacion_raw = (body.ubicacion_id or "").strip()
    if not ubicacion_raw:
        raise HTTPException(400, "Ubicación requerida")
    ubi_doc = await db.location_nodes.find_one({"project_id": pid, "id": ubicacion_raw})
    if not ubi_doc:
        raise HTTPException(400, f"Ubicación inválida: {ubicacion_raw}")
    ubicacion_id = ubi_doc["id"]
    ubicacion_name = ubi_doc.get("name") or ""
    # Breadcrumb legible tipo "Torre A > Piso 3 > Zona Sur" caminando parent_id.
    ubicacion_path_names: List[str] = []
    _cur = ubi_doc
    _guard = 0
    while _cur and _guard < 50:
        ubicacion_path_names.insert(0, _cur.get("name") or "")
        parent_id = _cur.get("parent_id")
        if not parent_id:
            break
        _cur = await db.location_nodes.find_one({"project_id": pid, "id": parent_id})
        _guard += 1

    # Involucrados (opcional) — usuarios extra que ven la minuta en "Mis Minutas".
    involved_ids: List[str] = []
    involved_names: List[str] = []
    involved_clean = list(dict.fromkeys([x.strip() for x in (body.involved_ids or []) if x and x.strip()]))
    if involved_clean:
        u_cursor = db.users.find({"id": {"$in": involved_clean}})
        u_list = await u_cursor.to_list(length=len(involved_clean))
        u_map = {u["id"]: u for u in u_list}
        missing = [uid for uid in involved_clean if uid not in u_map]
        if missing:
            raise HTTPException(400, f"Involucrado(s) inválido(s): {', '.join(missing)}")
        involved_ids = involved_clean
        involved_names = [u_map[uid].get("name") or "Sin nombre" for uid in involved_clean]

    # Valida y normaliza acuerdos.
    if not body.acuerdos:
        raise HTTPException(400, "Debes registrar al menos un acuerdo")
    if len(body.acuerdos) > 50:
        raise HTTPException(400, "Máximo 50 acuerdos por minuta")
    # Precarga responsables en un solo query.
    resp_ids = list({(a.responsable_id or "").strip() for a in body.acuerdos if (a.responsable_id or "").strip()})
    users_map: dict = {}
    if resp_ids:
        u_cursor = db.users.find({"id": {"$in": resp_ids}})
        u_list = await u_cursor.to_list(length=len(resp_ids))
        users_map = {u["id"]: u for u in u_list}
    acuerdos_out: List[dict] = []
    for i, a in enumerate(body.acuerdos):
        desc = (a.descripcion or "").strip()
        if not desc:
            raise HTTPException(400, f"Acuerdo #{i+1}: descripción requerida")
        if len(desc) > 1200:
            raise HTTPException(400, f"Acuerdo #{i+1}: máximo 1200 caracteres")
        rid = (a.responsable_id or "").strip()
        if not rid or rid not in users_map:
            raise HTTPException(400, f"Acuerdo #{i+1}: responsable inválido")
        u = users_map[rid]
        # Nota: no forzamos que `project_ids` incluya `pid` porque los coords
        # generales tienen acceso implícito global y algunos usuarios legacy
        # pueden faltarlo. La verificación real de acceso al proyecto se hace
        # arriba en `ensure_project_access`.
        fl = (a.fecha_limite or "").strip()
        if not fl:
            raise HTTPException(400, f"Acuerdo #{i+1}: fecha límite requerida")
        # valida formato ISO "YYYY-MM-DD" simple
        try:
            datetime.strptime(fl, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, f"Acuerdo #{i+1}: fecha límite debe ser YYYY-MM-DD")
        acuerdos_out.append({
            "id": str(uuid.uuid4()),
            "descripcion": desc,
            "responsable_id": rid,
            "responsable_name": u.get("name") or "Sin nombre",
            "responsable_role": u.get("role"),
            "fecha_limite": fl,
            "estado": False,
            "completed_at": None,
            "completed_by": None,
            "completed_by_name": None,
        })

    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "project_id": pid,
        "titulo": titulo,
        "descripcion": descripcion,
        "area_ids": area_ids,
        "area_names": area_names,
        "ubicacion_id": ubicacion_id,
        "ubicacion_name": ubicacion_name,
        "ubicacion_path_names": ubicacion_path_names,
        "involved_ids": involved_ids,
        "involved_names": involved_names,
        "fecha_reunion": fecha_reunion,
        "author_id": user["id"],
        "author_name": user["name"],
        "author_role": user["role"],
        "acuerdos": acuerdos_out,
        "created_at": now,
        "updated_at": now,
    }
    await db.minutas.insert_one(doc)
    return _minuta_out(doc)


@api.get("/projects/{pid}/minutas")
async def list_minutas(
    pid: str,
    status: str = "all",   # "pending" | "done" | "all"
    mine: int = 0,
    q: Optional[str] = None,
    area_ids: Optional[str] = None,  # CSV
    ubicacion_ids: Optional[str] = None,  # CSV — filtra por node_id (regla 2026-07)
    user: dict = Depends(current_user),
):
    await ensure_project_access(user, pid)
    query: dict = {"project_id": pid}
    if area_ids:
        wanted = [a.strip() for a in area_ids.split(",") if a.strip()]
        if wanted:
            query["area_ids"] = {"$in": wanted}
    if ubicacion_ids:
        wanted_ubi = [a.strip() for a in ubicacion_ids.split(",") if a.strip()]
        if wanted_ubi:
            query["ubicacion_id"] = {"$in": wanted_ubi}
    if q:
        rx = re.escape(q.strip())
        if rx:
            query["$or"] = [
                {"titulo": {"$regex": rx, "$options": "i"}},
                {"descripcion": {"$regex": rx, "$options": "i"}},
                {"acuerdos.descripcion": {"$regex": rx, "$options": "i"}},
                {"acuerdos.responsable_name": {"$regex": rx, "$options": "i"}},
            ]
    if mine:
        # Autor, responsable en algún acuerdo, o involucrado explícito.
        query["$or"] = (query.get("$or") or []) + [
            {"author_id": user["id"]},
            {"acuerdos.responsable_id": user["id"]},
            {"involved_ids": user["id"]},
        ]
    cursor = db.minutas.find(query).sort("created_at", -1)
    items = await cursor.to_list(length=500)
    # Filtro por estado en Python (barato — pocas minutas por proyecto).
    def _minuta_status(m: dict) -> str:
        acs = m.get("acuerdos") or []
        if not acs:
            return "done"
        if all(bool(a.get("estado")) for a in acs):
            return "done"
        return "pending"
    if status in ("pending", "done"):
        items = [m for m in items if _minuta_status(m) == status]
    return [_minuta_out(m) for m in items]


@api.get("/minutas/{mid}")
async def get_minuta(mid: str, user: dict = Depends(current_user)):
    m = await db.minutas.find_one({"id": mid})
    if not m:
        raise HTTPException(404, "Minuta no existe")
    await ensure_project_access(user, m["project_id"])
    return _minuta_out(m)


class AcuerdoPatch(BaseModel):
    estado: bool


@api.patch("/minutas/{mid}/acuerdos/{aid}")
async def toggle_acuerdo(
    mid: str,
    aid: str,
    body: AcuerdoPatch,
    user: dict = Depends(current_user),
):
    """Marca/desmarca un acuerdo como concluido.

    Regla estricta: SOLO el autor de la minuta puede cambiar el estado.
    El servidor rechaza cualquier intento con 403 en caso contrario.
    """
    m = await db.minutas.find_one({"id": mid})
    if not m:
        raise HTTPException(404, "Minuta no existe")
    await ensure_project_access(user, m["project_id"])
    if m.get("author_id") != user["id"]:
        raise HTTPException(403, "Solo el autor de la minuta puede marcar acuerdos como concluidos")
    acs = list(m.get("acuerdos") or [])
    idx = next((i for i, a in enumerate(acs) if a.get("id") == aid), -1)
    if idx < 0:
        raise HTTPException(404, "Acuerdo no existe en esta minuta")
    now = datetime.now(timezone.utc)
    if body.estado:
        acs[idx]["estado"] = True
        acs[idx]["completed_at"] = now
        acs[idx]["completed_by"] = user["id"]
        acs[idx]["completed_by_name"] = user["name"]
    else:
        acs[idx]["estado"] = False
        acs[idx]["completed_at"] = None
        acs[idx]["completed_by"] = None
        acs[idx]["completed_by_name"] = None
    await db.minutas.update_one(
        {"id": mid},
        {"$set": {"acuerdos": acs, "updated_at": now}},
    )
    updated = await db.minutas.find_one({"id": mid})
    return _minuta_out(updated)


@api.delete("/minutas/{mid}")
async def delete_minuta(mid: str, user: dict = Depends(current_user)):
    m = await db.minutas.find_one({"id": mid})
    if not m:
        raise HTTPException(404, "Minuta no existe")
    await ensure_project_access(user, m["project_id"])
    is_author = m.get("author_id") == user["id"]
    is_coord = user.get("role") == ROLE_COORD
    if not (is_author or is_coord):
        raise HTTPException(403, "Solo el autor o Coordinación General puede eliminar la minuta")
    await db.minutas.delete_one({"id": mid})
    return {"ok": True}


@api.get("/projects/{pid}/minutas/badge")
async def minutas_badge(pid: str, user: dict = Depends(current_user)):
    """Cuenta acuerdos pendientes asignados al usuario en el proyecto y los
    'urgentes' (vencidos o que vencen HOY). Se usa para el badge del módulo.
    """
    await ensure_project_access(user, pid)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cursor = db.minutas.find({
        "project_id": pid,
        "acuerdos.responsable_id": user["id"],
    })
    minutas = await cursor.to_list(length=500)
    assigned_pending = 0
    urgent = 0
    for m in minutas:
        for a in (m.get("acuerdos") or []):
            if a.get("responsable_id") != user["id"]:
                continue
            if a.get("estado"):
                continue
            assigned_pending += 1
            fl = str(a.get("fecha_limite") or "")
            if fl and fl <= today:
                urgent += 1
    return {"assigned_pending": assigned_pending, "urgent": urgent}


# === MOUNT ==================================================================
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)