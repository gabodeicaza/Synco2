"""Backend tests — migración estacion_id → nodo_id en RegistroAvance.

RegistroAvance tenía un campo estacion_id que nunca se validó ni se usó en
ninguna pantalla (confirmado por búsqueda en todo el frontend) y se renombró
a nodo_id. Como el campo pudo haber viajado en payloads de la cola offline de
un dispositivo sin sincronizar, o quedar guardado en algún documento anterior
al rename, server.py acepta AMBAS llaves en la entrada y las resuelve también
al leer documentos existentes — ver los TODOs en RegistroAvanceIn.estacion_id
y en _registro_avance_out.

Cubre exactamente los 4 casos pedidos:
  - Entrada con solo estacion_id -> se acepta y queda como nodo_id.
  - Entrada con ambas, valores distintos -> gana nodo_id.
  - Lectura de un documento viejo (guardado directo en Mongo, sin nodo_id,
    con estacion_id apuntando a un nodo real) -> se lee con nodo_id resuelto.
  - Lectura de un documento viejo con estacion_id apuntando a un nodo que ya
    no existe -> nodo_id null, sin excepción (nunca se rechaza una lectura).
"""
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

_FRONT_ENV = dotenv_values(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = (_FRONT_ENV.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"

_BACKEND_ENV = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
MONGO_URL = _BACKEND_ENV.get("MONGO_URL") or os.environ.get("MONGO_URL")
DB_NAME = _BACKEND_ENV.get("DB_NAME") or os.environ.get("DB_NAME")

ADMIN_EMAIL = "gabriel@synco.mx"
ADMIN_PASSWORD = "SynCo2026!Coord"
TIMEOUT = 30


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="session")
def admin_headers() -> dict:
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=TIMEOUT)
    assert r.status_code == 200, f"Login admin falló: {r.status_code} {r.text}"
    return _headers(r.json()["token"])


@pytest.fixture(scope="session")
def project_id(admin_headers) -> str:
    suffix = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/projects", headers=admin_headers,
        json={
            "name": f"TEST_Migracion_{suffix}", "constructora": "TEST_Constructora",
            "contract_number": f"TEST-MIG-{suffix}", "start_date": "2026-01-15", "end_date": "2026-12-31",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield pid
    requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=TIMEOUT)


@pytest.fixture(scope="session")
def node_real(admin_headers, project_id) -> str:
    r = requests.post(
        f"{API}/projects/{project_id}/nodes", headers=admin_headers,
        json={"project_id": project_id, "parent_id": None, "name": "Nodo migración", "order": 0, "is_leaf": False},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def concepto_id(admin_headers, project_id) -> str:
    r_partida = requests.post(
        f"{API}/partidas", headers=admin_headers,
        json={"project_id": project_id, "clave": "MIG.1", "nombre": "Partida migración", "orden": 0},
        timeout=TIMEOUT,
    )
    assert r_partida.status_code == 200, r_partida.text
    partida_id = r_partida.json()["id"]
    r_concepto = requests.post(
        f"{API}/conceptos", headers=admin_headers,
        json={
            "partida_id": partida_id, "clave": "MIG.1.1", "descripcion": "Concepto migración",
            "unidad": "UNIVERSAL", "cantidad": "10", "precio_unitario": "10", "meta": "1", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    )
    assert r_concepto.status_code == 200, r_concepto.text
    return r_concepto.json()["id"]


# ============================================================================
# Entrada — payload con estacion_id (legado)
# ============================================================================
def test_entrada_solo_estacion_id_queda_como_nodo_id(admin_headers, concepto_id, node_real):
    r = requests.post(
        f"{API}/avances", headers=admin_headers,
        json={"concepto_id": concepto_id, "fecha": "2026-07-01", "cantidad_ejecutada": "1", "estacion_id": node_real},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    assert r.json()["nodo_id"] == node_real


def test_entrada_con_ambas_distintas_gana_nodo_id(admin_headers, project_id, concepto_id, node_real):
    r_otro_nodo = requests.post(
        f"{API}/projects/{project_id}/nodes", headers=admin_headers,
        json={"project_id": project_id, "parent_id": None, "name": "Otro nodo", "order": 1, "is_leaf": False},
        timeout=TIMEOUT,
    )
    assert r_otro_nodo.status_code == 200, r_otro_nodo.text
    otro_nodo_id = r_otro_nodo.json()["id"]

    r = requests.post(
        f"{API}/avances", headers=admin_headers,
        json={
            "concepto_id": concepto_id, "fecha": "2026-07-02", "cantidad_ejecutada": "1",
            "nodo_id": node_real, "estacion_id": otro_nodo_id,
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    assert r.json()["nodo_id"] == node_real, "debe ganar nodo_id, nunca estacion_id, cuando ambos vienen y difieren"


# ============================================================================
# Lectura — documentos "viejos" insertados directo en Mongo, sin pasar por
# create_avance, simulando datos guardados ANTES del rename.
# ============================================================================
def _insertar_doc_viejo(mongo_db, admin_headers, project_id, concepto_id, estacion_id, fecha) -> str:
    aid = str(uuid.uuid4())
    doc = {
        "id": aid,
        "concepto_id": concepto_id,
        "project_id": project_id,
        "fecha": fecha,
        "cantidad_ejecutada": "1",
        "estacion_id": estacion_id,  # llave vieja — a propósito, sin "nodo_id" en el doc
        "reporte_id": None,
        "fotos": [],
        "photo_captions": [],
        "capturado_por": "test-migracion",
        "capturado_por_nombre": "Test Migración",
        "creado_en": datetime.now(timezone.utc),
        "sincronizado": True,
        "editado_en": None,
        "client_id": None,
    }
    mongo_db.registros_avance.insert_one(doc)
    return aid


def test_lectura_documento_viejo_con_estacion_id_valido_resuelve_nodo_id(mongo_db, admin_headers, project_id, concepto_id, node_real):
    aid = _insertar_doc_viejo(mongo_db, admin_headers, project_id, concepto_id, node_real, "2026-07-03")
    r = requests.get(
        f"{API}/projects/{project_id}/avances", headers=admin_headers,
        params={"concepto_id": concepto_id}, timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    match = next((a for a in r.json() if a["id"] == aid), None)
    assert match is not None, "el documento viejo debe poder leerse (no se rechaza una lectura)"
    assert match["nodo_id"] == node_real


def test_lectura_documento_viejo_con_estacion_id_de_nodo_inexistente_da_null_sin_excepcion(mongo_db, admin_headers, project_id, concepto_id):
    aid = _insertar_doc_viejo(mongo_db, admin_headers, project_id, concepto_id, "nodo-que-ya-no-existe", "2026-07-04")
    r = requests.get(
        f"{API}/projects/{project_id}/avances", headers=admin_headers,
        params={"concepto_id": concepto_id}, timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    match = next((a for a in r.json() if a["id"] == aid), None)
    assert match is not None
    assert match["nodo_id"] is None
