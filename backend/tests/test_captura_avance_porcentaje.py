"""Tests de Etapa 4: captura de avance en % (modo_avance=PORCENTAJE) y
cadencia de reporte configurable.

Cubre la diferencia semántica más importante de esta etapa:
  - modo_avance=CANTIDAD: cada RegistroAvance es un incremento físico, el
    acumulado es la SUMA de todos.
  - modo_avance=PORCENTAJE: cada RegistroAvance es el ESTADO al que llegó
    el concepto ("va al 45%"), el acumulado es la captura MÁS RECIENTE por
    fecha -- sumar duplicaría el avance reportado.

Grupo puro (_acumulado_desde_avances, sin DB) + integración HTTP (validación
0-100, retroceso marcado, cadencia del proyecto) -- mismo criterio que el
resto de la suite.
"""
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_avance_porcentaje")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

from server import _acumulado_desde_avances, to_decimal

_FRONT_ENV = dotenv_values(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = (_FRONT_ENV.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "gabriel@synco.mx"
ADMIN_PASSWORD = "SynCo2026!Coord"
TIMEOUT = 30


# ============================================================================
# Puros — _acumulado_desde_avances, sin DB
# ============================================================================
def _av(fecha, cantidad, creado_en=None):
    return {"fecha": fecha, "cantidad_ejecutada": cantidad, "creado_en": creado_en or datetime.now(timezone.utc)}


def test_cantidad_suma_todas_las_capturas():
    avances = [_av("2026-01-01", "10"), _av("2026-01-02", "5"), _av("2026-01-03", "3")]
    assert _acumulado_desde_avances(avances, "CANTIDAD") == "18"


def test_porcentaje_toma_la_captura_mas_reciente_no_la_suma():
    # Si sumara, sería 20+45+30=95 -- pero el residente reportó "va al 30%"
    # el último día, así que el acumulado debe ser 30, no 95.
    avances = [_av("2026-01-01", "20"), _av("2026-01-15", "45"), _av("2026-01-20", "30")]
    assert _acumulado_desde_avances(avances, "PORCENTAJE") == "30"


def test_porcentaje_orden_de_insercion_no_importa_solo_la_fecha():
    avances = [_av("2026-01-20", "30"), _av("2026-01-01", "20"), _av("2026-01-15", "45")]
    assert _acumulado_desde_avances(avances, "PORCENTAJE") == "30"


def test_porcentaje_desempata_por_creado_en_si_misma_fecha():
    primero = _av("2026-01-01", "20", creado_en=datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc))
    segundo = _av("2026-01-01", "35", creado_en=datetime(2026, 1, 1, 17, 0, tzinfo=timezone.utc))
    assert _acumulado_desde_avances([primero, segundo], "PORCENTAJE") == "35"


def test_sin_avances_es_cero_en_cualquier_modo():
    assert _acumulado_desde_avances([], "CANTIDAD") == "0"
    assert _acumulado_desde_avances([], "PORCENTAJE") == "0"


def test_matriz_se_comporta_como_cantidad():
    avances = [_av("2026-01-01", "2"), _av("2026-01-02", "3")]
    assert _acumulado_desde_avances(avances, "MATRIZ") == "5"


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
def project_porcentaje(admin_headers) -> str:
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"TEST_AvancePct_{suffix}", "constructora": "TEST_Constructora",
        "contract_number": f"TEST-PCT-{suffix}", "start_date": "2026-01-15", "end_date": "2026-12-31",
    }
    r = requests.post(f"{API}/projects", headers=admin_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]

    r2 = requests.put(f"{API}/projects/{pid}", headers=admin_headers, json={"modo_avance": "PORCENTAJE"}, timeout=TIMEOUT)
    assert r2.status_code == 200, r2.text

    yield pid
    requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=TIMEOUT)


def _crear_partida(admin_headers, pid, clave) -> dict:
    r = requests.post(
        f"{API}/partidas", headers=admin_headers,
        json={"project_id": pid, "clave": clave, "nombre": "Rama test", "orden": 0}, timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _crear_concepto(admin_headers, partida_id, clave) -> dict:
    r = requests.post(
        f"{API}/conceptos", headers=admin_headers,
        json={
            "partida_id": partida_id, "clave": clave, "descripcion": f"Concepto {clave}",
            "unidad": "PZA", "cantidad": "1", "precio_unitario": "1000.00", "meta": "1", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_cadencia_reporte_default_mensual_y_configurable(admin_headers, project_porcentaje):
    r = requests.get(f"{API}/projects/{project_porcentaje}", headers=admin_headers, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    assert r.json()["cadencia_reporte"] == "MENSUAL"
    assert r.json()["dia_inicio_semana"] == "LUNES"

    r2 = requests.put(
        f"{API}/projects/{project_porcentaje}", headers=admin_headers,
        json={"cadencia_reporte": "SEMANAL", "dia_inicio_semana": "SABADO"}, timeout=TIMEOUT,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["cadencia_reporte"] == "SEMANAL"
    assert r2.json()["dia_inicio_semana"] == "SABADO"


def test_captura_porcentaje_solo_rechaza_cero_negativo_y_texto(admin_headers, project_porcentaje):
    """A-01/A-02: ya NO hay tope de 100% (el excedente se permite y se hace visible);
    lo que se rechaza es cero, negativos y texto."""
    partida = _crear_partida(admin_headers, project_porcentaje, "PCT.1")
    concepto = _crear_concepto(admin_headers, partida["id"], "PCT.1.1")
    url = f"{API}/avances"

    def post(valor):
        return requests.post(
            url, headers=admin_headers,
            json={"concepto_id": concepto["id"], "fecha": "2026-06-01", "cantidad_ejecutada": valor}, timeout=TIMEOUT,
        )

    assert post("-5").status_code == 400
    assert post("0").status_code == 400
    assert post("abc").status_code in (400, 422)
    assert post("101").status_code == 200  # excede 100%: se permite


def test_captura_porcentaje_es_acumulativa_no_incremental(admin_headers, project_porcentaje):
    partida = _crear_partida(admin_headers, project_porcentaje, "PCT.2")
    concepto = _crear_concepto(admin_headers, partida["id"], "PCT.2.1")

    requests.post(
        f"{API}/avances", headers=admin_headers,
        json={"concepto_id": concepto["id"], "fecha": "2026-06-01", "cantidad_ejecutada": "20"}, timeout=TIMEOUT,
    )
    requests.post(
        f"{API}/avances", headers=admin_headers,
        json={"concepto_id": concepto["id"], "fecha": "2026-06-15", "cantidad_ejecutada": "45"}, timeout=TIMEOUT,
    )

    r = requests.get(f"{API}/partidas/{partida['id']}/conceptos", headers=admin_headers, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    c = next(x for x in r.json() if x["id"] == concepto["id"])
    # Si sumara sería 65 -- el acumulado correcto es el más reciente: 45.
    assert c["cantidad_ejecutada_acumulada"] == "45"


def test_retroceso_se_permite_y_se_marca(admin_headers, project_porcentaje):
    partida = _crear_partida(admin_headers, project_porcentaje, "PCT.3")
    concepto = _crear_concepto(admin_headers, partida["id"], "PCT.3.1")

    r1 = requests.post(
        f"{API}/avances", headers=admin_headers,
        json={"concepto_id": concepto["id"], "fecha": "2026-06-01", "cantidad_ejecutada": "50"}, timeout=TIMEOUT,
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["es_retroceso"] is False

    r2 = requests.post(
        f"{API}/avances", headers=admin_headers,
        json={"concepto_id": concepto["id"], "fecha": "2026-06-02", "cantidad_ejecutada": "30"}, timeout=TIMEOUT,
    )
    assert r2.status_code == 200, r2.text  # se permite, no se rechaza
    assert r2.json()["es_retroceso"] is True
