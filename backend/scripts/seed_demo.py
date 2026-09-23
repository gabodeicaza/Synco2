"""Seed de la cuenta demo para los revisores de Google Play / App Store (T-03).

Crea (o completa, si ya existe) un proyecto "Proyecto Demo (PRUEBA)" con catálogo,
avances, una minuta y un plano, y una cuenta de Sub-coordinador que SOLO ve ese
proyecto. Usa la API HTTP del backend, así que respeta todas sus validaciones.

Es idempotente: cada paso busca lo que ya existe (por nombre/clave/título) y solo
crea lo que falta. Nunca borra ni modifica nada existente, y se niega a trabajar
sobre un proyecto cuyo nombre no lleve la marca "(PRUEBA)".

Uso (las credenciales van SOLO por variables de entorno):

    export SEED_ADMIN_EMAIL=...        # un Coordinador General
    export SEED_ADMIN_PASSWORD=...
    export SEED_DEMO_PASSWORD=...      # opcional: si falta, se genera y se imprime
    python backend/scripts/seed_demo.py --base-url https://apm-app.mx/api --confirmar

    --dry-run    muestra qué haría sin escribir nada
"""
import argparse
import io
import os
import secrets
import struct
import sys
import zlib
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

NOMBRE_PROYECTO = "Proyecto Demo (PRUEBA)"
TZ_PROYECTO = ZoneInfo("America/Mexico_City")
CORREO_DEMO_DEFECTO = "revisor.demo@example.com"

# Vocabulario propio de un proyecto real: el demo debe ser genérico.
PALABRAS_PROHIBIDAS = ("poste", "estacion", "estación", "intertramo", "perforadora", "cablebus", "cablebús")


def hoy_proyecto() -> date:
    """"Hoy" en la zona horaria del proyecto (nunca UTC ni la del equipo)."""
    return datetime.now(TZ_PROYECTO).date()


def construir_plan(hoy: date) -> Dict[str, Any]:
    """Datos del demo. Función pura: sin red ni reloj, para poder probarla."""
    inicio = hoy - timedelta(days=45)
    fin = hoy + timedelta(days=135)
    partidas = [
        {"clave": "1", "nombre": "Trabajos preliminares", "padre": None},
        {"clave": "2", "nombre": "Cimentación", "padre": None},
        {"clave": "3", "nombre": "Estructura", "padre": None},
        {"clave": "3.1", "nombre": "Columnas y trabes", "padre": "3"},
    ]
    conceptos = [
        {"partida": "1", "clave": "1.1", "descripcion": "Trazo y nivelación del terreno", "unidad": "M2", "cantidad": "2400", "pu": "18.50"},
        {"partida": "1", "clave": "1.2", "descripcion": "Limpieza y desmonte", "unidad": "M2", "cantidad": "3000", "pu": "12.00"},
        {"partida": "2", "clave": "2.1", "descripcion": "Excavación para zapatas", "unidad": "M3", "cantidad": "850", "pu": "145.00"},
        {"partida": "2", "clave": "2.2", "descripcion": "Concreto en zapatas f'c=250", "unidad": "M3", "cantidad": "320", "pu": "2450.00"},
        {"partida": "2", "clave": "2.3", "descripcion": "Acero de refuerzo en cimentación", "unidad": "TON", "cantidad": "28", "pu": "21800.00"},
        {"partida": "3.1", "clave": "3.1.1", "descripcion": "Cimbra en columnas", "unidad": "M2", "cantidad": "1100", "pu": "310.00"},
        {"partida": "3.1", "clave": "3.1.2", "descripcion": "Concreto en columnas f'c=300", "unidad": "M3", "cantidad": "210", "pu": "2890.00"},
    ]
    # Avance: fracción de la cantidad ya ejecutada, repartida en los últimos días.
    avance_por_concepto = {"1.1": 1.0, "1.2": 1.0, "2.1": 0.8, "2.2": 0.55, "2.3": 0.4, "3.1.1": 0.2, "3.1.2": 0.0}
    avances: List[Dict[str, str]] = []
    for c in conceptos:
        frac = avance_por_concepto.get(c["clave"], 0.0)
        if frac <= 0:
            continue
        total = int(float(c["cantidad"]) * frac)
        partes = 4
        for i in range(partes):
            dias_atras = 21 - i * 6  # 21, 15, 9, 3 días atrás: nunca fechas futuras
            cant = total // partes if i < partes - 1 else total - (total // partes) * (partes - 1)
            if cant > 0:
                avances.append({"concepto": c["clave"], "fecha": (hoy - timedelta(days=dias_atras)).isoformat(), "cantidad": str(cant)})
    return {
        "proyecto": {
            "name": NOMBRE_PROYECTO,
            "constructora": "Constructora Demo S.A. de C.V.",
            "contract_number": "DEMO-001",
            "objeto_contrato": "Obra de demostración para revisión de la aplicación.",
            "cliente_principal": "Cliente Demo",
            "color_institucional": "#1E40AF",
            "start_date": inicio.isoformat(),
            "end_date": fin.isoformat(),
            "description": "Proyecto de ejemplo con datos ficticios. No corresponde a una obra real.",
            "nombres_niveles_partida": ["Capítulo", "Subcapítulo"],
        },
        "nodos": [
            {"name": "Zona Norte", "parent": None, "is_leaf": False},
            {"name": "Frente 1", "parent": "Zona Norte", "is_leaf": True},
            {"name": "Frente 2", "parent": "Zona Norte", "is_leaf": True},
        ],
        "partidas": partidas,
        "conceptos": conceptos,
        "avances": avances,
        "minuta": {
            "titulo": "Reunión de arranque de cimentación",
            "descripcion": "Se revisó el programa de cimentación y las necesidades de suministro.",
            "ubicacion": "Frente 1",
            "acuerdo": "Confirmar la entrega de acero de refuerzo para la siguiente semana.",
            "dias_para_limite": 7,
        },
        "plano": {"nombre": "Plano general del demo"},
    }


def png_de_ejemplo(ancho: int = 640, alto: int = 400) -> bytes:
    """PNG sencillo (cuadrícula) generado sin dependencias externas."""
    filas = []
    for y in range(alto):
        fila = bytearray([0])
        for x in range(ancho):
            linea = x % 80 == 0 or y % 80 == 0
            fila += bytes((30, 64, 175)) if linea else bytes((241, 245, 249))
        filas.append(bytes(fila))
    crudo = b"".join(filas)

    def chunk(tipo: bytes, datos: bytes) -> bytes:
        cuerpo = tipo + datos
        return struct.pack(">I", len(datos)) + cuerpo + struct.pack(">I", zlib.crc32(cuerpo) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(crudo, 9))
        + chunk(b"IEND", b"")
    )


class ApiDemo:
    def __init__(self, base_url: str, dry_run: bool):
        import requests  # import local: los tests de construir_plan no lo necesitan

        self.s = requests.Session()
        self.base = base_url.rstrip("/")
        self.dry = dry_run

    def _llamar(self, metodo: str, ruta: str, token: Optional[str], **kw):
        headers = kw.pop("headers", {})
        if token:
            headers["Authorization"] = f"Bearer {token}"
        r = self.s.request(metodo, self.base + ruta, headers=headers, timeout=60, **kw)
        return r

    def pedir(self, metodo: str, ruta: str, token: Optional[str], **kw):
        r = self._llamar(metodo, ruta, token, **kw)
        if r.status_code >= 300:
            raise SystemExit(f"[error] {metodo} {ruta} -> HTTP {r.status_code}: {r.text[:300]}")
        return r.json() if r.content else None

    def login(self, email: str, password: str) -> Optional[dict]:
        r = self._llamar("POST", "/auth/login", None, json={"email": email, "password": password})
        return r.json() if r.status_code == 200 else None


def _avisar(dry: bool, texto: str) -> None:
    print(("[dry-run] " if dry else "") + texto)


def sembrar(api: ApiDemo, admin_email: str, admin_password: str, demo_email: str, demo_password: str) -> None:
    plan = construir_plan(hoy_proyecto())
    dry = api.dry

    admin = api.login(admin_email, admin_password)
    if not admin:
        raise SystemExit("[error] Credenciales de administrador inválidas (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).")
    tok_admin = admin["token"]

    # 1) Proyecto (solo se reutiliza uno marcado "(PRUEBA)").
    proyectos = api.pedir("GET", "/projects", tok_admin)
    existente = next((p for p in proyectos if p["name"] == NOMBRE_PROYECTO), None)
    if existente:
        pid = existente["id"]
        print(f"Proyecto ya existe: {pid}")
    elif dry:
        _avisar(dry, f"crearía el proyecto '{NOMBRE_PROYECTO}'")
        pid = "(nuevo)"
    else:
        pid = api.pedir("POST", "/projects", tok_admin, json=plan["proyecto"])["id"]
        print(f"Proyecto creado: {pid}")
    if dry and pid == "(nuevo)":
        _avisar(dry, "crearía nodos, partidas, conceptos, avances, minuta, plano y la cuenta demo")
        return
    if "(PRUEBA)" not in NOMBRE_PROYECTO:
        raise SystemExit("[error] El proyecto demo debe llevar la marca (PRUEBA).")

    # 2) Cuenta demo (Sub-coordinador: ve solo este proyecto).
    demo = api.login(demo_email, demo_password)
    if demo:
        print(f"Cuenta demo ya existe: {demo_email}")
    elif dry:
        _avisar(dry, f"crearía la cuenta demo {demo_email}")
        demo = None
    else:
        inv = api.pedir("POST", f"/projects/{pid}/invitations", tok_admin, json={
            "project_id": pid, "email": demo_email, "name": "Revisor Demo", "role": "sub_coordinador",
        })
        demo = api.pedir("POST", "/invitations/accept", None, json={"token": inv["token"], "password": demo_password})
        print(f"Cuenta demo creada: {demo_email}")
    tok_demo = demo["token"] if demo else tok_admin
    demo_id = demo["user"]["id"] if demo else None

    # 3) Nodos.
    nodos = {n["name"]: n for n in api.pedir("GET", f"/projects/{pid}/nodes", tok_admin)}
    for n in plan["nodos"]:
        if n["name"] in nodos:
            continue
        if dry:
            _avisar(dry, f"crearía el nodo {n['name']}")
            continue
        body = {"project_id": pid, "name": n["name"], "is_leaf": n["is_leaf"],
                "parent_id": nodos[n["parent"]]["id"] if n["parent"] else None}
        if n["is_leaf"]:
            body["measurement_type"] = "cadenamiento"
        nodos[n["name"]] = api.pedir("POST", f"/projects/{pid}/nodes", tok_admin, json=body)

    # 4) Partidas y conceptos.
    partidas = {p["clave"]: p for p in api.pedir("GET", f"/projects/{pid}/partidas?incluir_inactivas=true", tok_admin)}
    for p in plan["partidas"]:
        if p["clave"] in partidas:
            continue
        if dry:
            _avisar(dry, f"crearía la partida {p['clave']} {p['nombre']}")
            continue
        partidas[p["clave"]] = api.pedir("POST", "/partidas", tok_admin, json={
            "project_id": pid, "clave": p["clave"], "nombre": p["nombre"],
            "partida_padre_id": partidas[p["padre"]]["id"] if p["padre"] else None,
        })
    conceptos: Dict[str, dict] = {}
    for p in plan["partidas"]:
        if p["clave"] not in partidas:
            continue
        for c in api.pedir("GET", f"/partidas/{partidas[p['clave']]['id']}/conceptos?incluir_inactivos=true", tok_admin):
            conceptos[c["clave"]] = c
    for c in plan["conceptos"]:
        if c["clave"] in conceptos:
            continue
        if dry:
            _avisar(dry, f"crearía el concepto {c['clave']}")
            continue
        conceptos[c["clave"]] = api.pedir("POST", "/conceptos", tok_admin, json={
            "partida_id": partidas[c["partida"]]["id"], "clave": c["clave"], "descripcion": c["descripcion"],
            "unidad": c["unidad"], "cantidad": c["cantidad"], "precio_unitario": c["pu"], "meta": "0",
        })

    # 5) Avances: solo en conceptos que todavía no tienen ninguno (idempotente).
    for a in plan["avances"]:
        c = conceptos.get(a["concepto"])
        if not c or to_num(c.get("cantidad_ejecutada_acumulada")) > 0:
            continue
        if dry:
            _avisar(dry, f"registraría {a['cantidad']} en {a['concepto']} el {a['fecha']}")
            continue
        api.pedir("POST", "/avances", tok_demo, json={
            "concepto_id": c["id"], "fecha": a["fecha"], "cantidad_ejecutada": a["cantidad"],
            "client_id": f"seed-{pid}-{a['concepto']}-{a['fecha']}",  # idempotencia del propio backend
        })

    # 6) Minuta.
    m = plan["minuta"]
    minutas = api.pedir("GET", f"/projects/{pid}/minutas", tok_admin)
    lista = minutas if isinstance(minutas, list) else minutas.get("items", [])
    if not any(x.get("titulo") == m["titulo"] for x in lista):
        if dry or not demo_id or m["ubicacion"] not in nodos:
            _avisar(dry, f"crearía la minuta '{m['titulo']}'")
        else:
            hoy = hoy_proyecto()
            api.pedir("POST", f"/projects/{pid}/minutas", tok_demo, json={
                "tipo": "compromiso", "titulo": m["titulo"], "descripcion": m["descripcion"],
                "fecha_reunion": hoy.isoformat(), "ubicacion_id": nodos[m["ubicacion"]]["id"],
                "involved_ids": [demo_id],
                "acuerdos": [{"descripcion": m["acuerdo"], "responsable_id": demo_id,
                              "fecha_limite": (hoy + timedelta(days=m["dias_para_limite"])).isoformat()}],
            })

    # 7) Plano.
    planos = api.pedir("GET", f"/projects/{pid}/planos-avance", tok_admin)
    if not any(x.get("nombre") == plan["plano"]["nombre"] for x in planos):
        if dry:
            _avisar(dry, "subiría el plano de ejemplo")
        else:
            api.pedir("POST", f"/projects/{pid}/planos-avance", tok_admin,
                      params={"nombre": plan["plano"]["nombre"]},
                      files={"file": ("plano_demo.png", io.BytesIO(png_de_ejemplo()), "image/png")})

    print("\nListo. Cuenta para los revisores:")
    print(f"  usuario:    {demo_email}")
    print("  contraseña: (la de SEED_DEMO_PASSWORD; no se vuelve a mostrar)")


def to_num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default=os.environ.get("SEED_BASE_URL"), help="URL de la API, con /api al final")
    ap.add_argument("--demo-email", default=os.environ.get("SEED_DEMO_EMAIL", CORREO_DEMO_DEFECTO))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--confirmar", action="store_true", help="Requerido para escribir (evita correrlo por accidente)")
    args = ap.parse_args(argv)

    if not args.base_url:
        print("Falta --base-url (o SEED_BASE_URL).")
        return 2
    if not args.dry_run and not args.confirmar:
        print("Esto escribe datos en el servidor indicado. Repite con --confirmar (o usa --dry-run).")
        return 2
    admin_email = os.environ.get("SEED_ADMIN_EMAIL")
    admin_password = os.environ.get("SEED_ADMIN_PASSWORD")
    if not admin_email or not admin_password:
        print("Faltan SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD en el entorno.")
        return 2
    demo_password = os.environ.get("SEED_DEMO_PASSWORD")
    if not demo_password:
        demo_password = secrets.token_urlsafe(12)
        print(f"SEED_DEMO_PASSWORD no definida: se usará esta contraseña generada -> {demo_password}")
    sembrar(ApiDemo(args.base_url, args.dry_run), admin_email, admin_password, args.demo_email, demo_password)
    return 0


if __name__ == "__main__":
    sys.exit(main())
