"""Tests de peso-por-rama (adelanto de Etapa 7, preparado antes de que el
equipo confirme si el peso de cada rama sale del importe contratado o es
criterio de supervisión — ver PartidaPatch.peso_manual en server.py).

Dos grupos:
  - Puros (sin red/DB): validación de Pydantic sobre peso_manual negativo.
  - Integración (HTTP, requieren backend+Mongo vivos, mismo criterio que
    test_project_genericidad_config.py): default calculado, override manual,
    y volver a calculado con quitar_peso_manual.
"""
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_peso_por_rama")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

from server import PartidaIn, PartidaPatch

_FRONT_ENV = dotenv_values(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = (_FRONT_ENV.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "gabriel@synco.mx"
ADMIN_PASSWORD = "SynCo2026!Coord"
TIMEOUT = 30


# ============================================================================
# Puros — validación de Pydantic, sin red
# ============================================================================
def test_partida_patch_rechaza_peso_manual_negativo():
    with pytest.raises(ValidationError):
        PartidaPatch(peso_manual="-1")


def test_partida_in_rechaza_peso_manual_negativo():
    with pytest.raises(ValidationError):
        PartidaIn(project_id="p1", clave="A1", nombre="Test", peso_manual="-0.01")


def test_partida_patch_acepta_peso_manual_cero_y_positivo():
    PartidaPatch(peso_manual="0")  # no debe lanzar
    PartidaPatch(peso_manual="1000.50")  # no debe lanzar


def test_partida_patch_default_no_toca_peso_manual():
    body = PartidaPatch()
    assert body.peso_manual is None
    assert body.quitar_peso_manual is False


# ============================================================================
# Integración (HTTP) — requieren backend + Mongo vivos
# ============================================================================
def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_token() -> str:
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=TIMEOUT)
    assert r.status_code == 200, f"Login admin falló: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token: str) -> dict:
    return _headers(admin_token)


@pytest.fixture(scope="session")
def project_id(admin_headers) -> str:
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"TEST_PesoRama_{suffix}", "constructora": "TEST_Constructora",
        "contract_number": f"TEST-PESO-{suffix}", "start_date": "2026-01-15", "end_date": "2026-12-31",
    }
    r = requests.post(f"{API}/projects", headers=admin_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, f"Crear proyecto falló: {r.status_code} {r.text}"
    pid = r.json()["id"]
    yield pid
    requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=TIMEOUT)


def _crear_partida(admin_headers, pid, clave, nombre="Rama test") -> dict:
    r = requests.post(
        f"{API}/partidas", headers=admin_headers,
        json={"project_id": pid, "clave": clave, "nombre": nombre, "orden": 0}, timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _crear_concepto(admin_headers, partida_id, clave, cantidad="10", pu="100.00") -> dict:
    r = requests.post(
        f"{API}/conceptos", headers=admin_headers,
        json={
            "partida_id": partida_id, "clave": clave, "descripcion": f"Concepto {clave}",
            "unidad": "PZA", "cantidad": cantidad, "precio_unitario": pu, "meta": "1", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_default_peso_efectivo_es_el_calculado_desde_importe(admin_headers, project_id):
    partida = _crear_partida(admin_headers, project_id, "PESO.1")
    _crear_concepto(admin_headers, partida["id"], "PESO.1.1", cantidad="10", pu="100.00")  # importe = 1000.00

    r = requests.get(f"{API}/projects/{project_id}/partidas", headers=admin_headers, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    p = next(x for x in r.json() if x["id"] == partida["id"])
    assert p["peso_manual"] is None
    assert p["peso_es_manual"] is False
    assert p["peso_efectivo"] == p["importe_contratado_partida"] == "1000.00"


def test_peso_manual_sobrescribe_el_calculado_con_marca_visible(admin_headers, project_id):
    partida = _crear_partida(admin_headers, project_id, "PESO.2")
    _crear_concepto(admin_headers, partida["id"], "PESO.2.1", cantidad="10", pu="100.00")  # importe = 1000.00

    r = requests.patch(f"{API}/partidas/{partida['id']}", headers=admin_headers, json={"peso_manual": "250"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["peso_manual"] == "250"
    assert p["peso_es_manual"] is True
    assert p["peso_efectivo"] == "250"
    # El calculado se sigue mostrando (para que la UI pueda comparar ambos),
    # pero NO es el que se usa — peso_efectivo es el que manda.
    assert p["importe_contratado_partida"] == "1000.00"
    assert p["peso_efectivo"] != p["importe_contratado_partida"]


def test_quitar_peso_manual_vuelve_al_calculado(admin_headers, project_id):
    partida = _crear_partida(admin_headers, project_id, "PESO.3")
    _crear_concepto(admin_headers, partida["id"], "PESO.3.1", cantidad="5", pu="60.00")  # importe = 300.00

    r1 = requests.patch(f"{API}/partidas/{partida['id']}", headers=admin_headers, json={"peso_manual": "999"}, timeout=TIMEOUT)
    assert r1.status_code == 200, r1.text
    assert r1.json()["peso_es_manual"] is True

    r2 = requests.patch(f"{API}/partidas/{partida['id']}", headers=admin_headers, json={"quitar_peso_manual": True}, timeout=TIMEOUT)
    assert r2.status_code == 200, r2.text
    p = r2.json()
    assert p["peso_manual"] is None
    assert p["peso_es_manual"] is False
    assert p["peso_efectivo"] == "300.00"


def test_peso_manual_negativo_rechazado_por_la_api(admin_headers, project_id):
    partida = _crear_partida(admin_headers, project_id, "PESO.4")
    r = requests.patch(f"{API}/partidas/{partida['id']}", headers=admin_headers, json={"peso_manual": "-5"}, timeout=TIMEOUT)
    assert r.status_code == 422, r.text
