"""Backend tests — Catálogo de Conceptos (Partidas / Conceptos / Avances).

Integración contra un backend vivo, mismo patrón que
test_areas_invitations_nodes.py: login admin, crea un proyecto TEST_ propio
(con su árbol de nodos), invita un sub_coordinador y un especialista NUEVOS
(los demo accounts de otros tests ya pertenecen a otro proyecto y la regla
"1 usuario = 1 proyecto" los bloquearía aquí), y limpia (archiva el proyecto)
al final.

Cubre:
  - RBAC: sub_coordinador y coordinador_general crean/editan partidas y
    conceptos y editan PU/meta; el resto de los roles no.
  - Bitácora: cambios de PU/meta quedan registrados con valor anterior/nuevo.
  - Calculados: importeContratado, numeroConceptos, importeContratadoPartida
    nunca se envían en el body — el servidor los calcula.
  - Orden de claves: el comparador numérico jerárquico, no orden de texto.
  - Registro de avance: especialista puede, jefe_proyecto no (solo lectura).
  - Búsqueda global sin acentos/mayúsculas.
"""
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

_FRONT_ENV = dotenv_values(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = (_FRONT_ENV.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "gabriel@synco.mx"
ADMIN_PASSWORD = "SynCo2026!Coord"
TIMEOUT = 30


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============================================================================
# Fixtures
# ============================================================================
@pytest.fixture(scope="session")
def admin_token() -> str:
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=TIMEOUT)
    assert r.status_code == 200, f"Login admin falló: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token: str) -> dict:
    return _headers(admin_token)


@pytest.fixture(scope="session")
def project_id(admin_headers: dict) -> str:
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"TEST_Catalogo_{suffix}",
        "constructora": "TEST_Constructora",
        "contract_number": f"TEST-{suffix}",
        "start_date": "2026-01-15",
        "end_date": "2026-12-31",
        "description": "Proyecto de prueba para Catálogo de Conceptos",
    }
    r = requests.post(f"{API}/projects", headers=admin_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, f"Crear proyecto falló: {r.status_code} {r.text}"
    pid = r.json()["id"]
    yield pid
    requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=TIMEOUT)


@pytest.fixture(scope="session")
def root_node_id(admin_headers: dict, project_id: str) -> str:
    r = requests.post(
        f"{API}/projects/{project_id}/nodes",
        headers=admin_headers,
        json={"project_id": project_id, "parent_id": None, "name": "Tramo 1", "order": 0, "is_leaf": False},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def leaf_node_id(admin_headers: dict, project_id: str, root_node_id: str) -> str:
    r = requests.post(
        f"{API}/projects/{project_id}/nodes",
        headers=admin_headers,
        json={
            "project_id": project_id, "parent_id": root_node_id, "name": "Estación 1",
            "order": 0, "is_leaf": True, "measurement_type": "nivel",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def area_id(admin_headers: dict, project_id: str) -> str:
    r = requests.post(
        f"{API}/projects/{project_id}/areas",
        headers=admin_headers,
        json={"project_id": project_id, "name": "Obra Civil"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _invite_and_accept(admin_headers, project_id, role, name, extra: dict) -> dict:
    suffix = uuid.uuid4().hex[:10]
    email = f"test_{role}_{suffix}@synco-test.mx"
    payload = {"project_id": project_id, "email": email, "name": name, "role": role, **extra}
    r = requests.post(f"{API}/projects/{project_id}/invitations", headers=admin_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, f"Invitar {role} falló: {r.status_code} {r.text}"
    token = r.json()["token"]
    r2 = requests.post(f"{API}/invitations/accept", json={"token": token, "password": "TestPass123!"}, timeout=TIMEOUT)
    assert r2.status_code == 200, f"Aceptar invitación {role} falló: {r2.status_code} {r2.text}"
    body = r2.json()
    return {"token": body["token"], "user": body["user"], "headers": _headers(body["token"])}


@pytest.fixture(scope="session")
def sub_coord(admin_headers, project_id, root_node_id) -> dict:
    return _invite_and_accept(admin_headers, project_id, "sub_coordinador", "Test SubCoord", {"scope_node_id": root_node_id})


@pytest.fixture(scope="session")
def especialista(admin_headers, project_id, area_id, leaf_node_id) -> dict:
    return _invite_and_accept(
        admin_headers, project_id, "especialista", "Test Especialista",
        {"area_id": area_id, "scope_node_ids": [leaf_node_id]},
    )


@pytest.fixture(scope="session")
def jefe_proyecto(admin_headers, project_id, root_node_id) -> dict:
    return _invite_and_accept(admin_headers, project_id, "jefe_proyecto", "Test Jefe", {"scope_node_id": root_node_id})


@pytest.fixture(scope="session")
def partida_id(sub_coord, project_id) -> str:
    r = requests.post(
        f"{API}/partidas", headers=sub_coord["headers"],
        json={"project_id": project_id, "clave": "3.3", "nombre": "Albañilerías", "orden": 1},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ============================================================================
# RBAC — sub_coordinador y coordinador_general escriben catálogo
# ============================================================================
def test_coordinador_general_puede_crear_partida(admin_headers, project_id):
    """Coordinador General tiene acceso completo al catálogo de conceptos,
    igual que sub_coordinador (god mode también sobre este módulo)."""
    r = requests.post(
        f"{API}/partidas", headers=admin_headers,
        json={"project_id": project_id, "clave": "9.9", "nombre": "Creada por Coord General", "orden": 1},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text


def test_especialista_no_puede_crear_concepto(especialista, partida_id):
    r = requests.post(
        f"{API}/conceptos", headers=especialista["headers"],
        json={
            "partida_id": partida_id, "clave": "3.3.1", "descripcion": "No debería crearse",
            "unidad": "M2", "cantidad": "10", "precio_unitario": "100", "meta": "1", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 403


def test_sub_coordinador_crea_concepto_y_calcula_importe(sub_coord, partida_id):
    r = requests.post(
        f"{API}/conceptos", headers=sub_coord["headers"],
        json={
            "partida_id": partida_id, "clave": "3.3.2", "descripcion": "Muro de block hueco 15cm",
            "unidad": "M2", "cantidad": "200", "precio_unitario": "185.50", "meta": "40", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # importeContratado = cantidad × PU = 200 × 185.50 = 37100 — calculado por el
    # servidor, nunca aceptado del cliente.
    assert body["importe_contratado"] == "37100.00" or body["importe_contratado"] == "37100"
    return body["id"]


def test_pu_y_meta_generan_bitacora(sub_coord, partida_id):
    r = requests.post(
        f"{API}/conceptos", headers=sub_coord["headers"],
        json={
            "partida_id": partida_id, "clave": "3.3.3", "descripcion": "Aplanado fino",
            "unidad": "M2", "cantidad": "50", "precio_unitario": "80", "meta": "10", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    concepto_id = r.json()["id"]

    r2 = requests.patch(
        f"{API}/conceptos/{concepto_id}", headers=sub_coord["headers"],
        json={"precio_unitario": "95", "meta": "12"}, timeout=TIMEOUT,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["precio_unitario"] == "95"

    r3 = requests.get(f"{API}/conceptos/{concepto_id}/bitacora", headers=sub_coord["headers"], timeout=TIMEOUT)
    assert r3.status_code == 200
    cambios = r3.json()
    tipos = {c["tipo"] for c in cambios}
    assert "pu" in tipos and "meta" in tipos
    pu_change = next(c for c in cambios if c["tipo"] == "pu")
    assert pu_change["valor_anterior"] == "80" and pu_change["valor_nuevo"] == "95"


# ============================================================================
# Orden de claves — comparador numérico, no texto
# ============================================================================
def test_conceptos_ordenados_numericamente(sub_coord, project_id):
    r = requests.post(
        f"{API}/partidas", headers=sub_coord["headers"],
        json={"project_id": project_id, "clave": "10.3", "nombre": "Orden claves", "orden": 2},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    pid_orden = r.json()["id"]

    for clave in ["1.10", "1.2", "1.9"]:
        rc = requests.post(
            f"{API}/conceptos", headers=sub_coord["headers"],
            json={
                "partida_id": pid_orden, "clave": clave, "descripcion": f"Concepto {clave}",
                "unidad": "PZA", "cantidad": "1", "precio_unitario": "1", "meta": "1", "periodicidad_meta": "SEMANAL",
            },
            timeout=TIMEOUT,
        )
        assert rc.status_code == 200, rc.text

    r2 = requests.get(f"{API}/partidas/{pid_orden}/conceptos", headers=sub_coord["headers"], timeout=TIMEOUT)
    assert r2.status_code == 200
    claves = [c["clave"] for c in r2.json()]
    assert claves == ["1.2", "1.9", "1.10"], f"Orden incorrecto: {claves}"


# ============================================================================
# Registro de avance — RBAC de solo-lectura para Jefe de Proyecto
# ============================================================================
def test_especialista_puede_registrar_avance(especialista, sub_coord, partida_id):
    concepto = requests.post(
        f"{API}/conceptos", headers=sub_coord["headers"],
        json={
            "partida_id": partida_id, "clave": "3.3.4", "descripcion": "Concepto para avance",
            "unidad": "M2", "cantidad": "100", "precio_unitario": "50", "meta": "20", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    ).json()
    r = requests.post(
        f"{API}/avances", headers=especialista["headers"],
        json={"concepto_id": concepto["id"], "fecha": "2026-08-11", "cantidad_ejecutada": "15"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    assert r.json()["cantidad_ejecutada"] == "15"


def test_jefe_proyecto_no_puede_registrar_avance(jefe_proyecto, sub_coord, partida_id):
    concepto = requests.post(
        f"{API}/conceptos", headers=sub_coord["headers"],
        json={
            "partida_id": partida_id, "clave": "3.3.5", "descripcion": "Otro concepto",
            "unidad": "M2", "cantidad": "100", "precio_unitario": "50", "meta": "20", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    ).json()
    r = requests.post(
        f"{API}/avances", headers=jefe_proyecto["headers"],
        json={"concepto_id": concepto["id"], "fecha": "2026-08-11", "cantidad_ejecutada": "5"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 403


# ============================================================================
# Búsqueda global — sin acentos/mayúsculas
# ============================================================================
def test_busqueda_global_sin_acentos(sub_coord, project_id, partida_id):
    requests.post(
        f"{API}/conceptos", headers=sub_coord["headers"],
        json={
            "partida_id": partida_id, "clave": "3.3.6", "descripcion": "Colocación de impermeabilización",
            "unidad": "M2", "cantidad": "30", "precio_unitario": "120", "meta": "5", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    )
    r = requests.get(f"{API}/projects/{project_id}/conceptos/search", headers=sub_coord["headers"], params={"q": "impermeabilizacion"}, timeout=TIMEOUT)
    assert r.status_code == 200
    resultados = r.json()
    assert any("impermeabilización" in c["descripcion"].lower() for c in resultados)
    assert all("partida_clave" in c for c in resultados)


# ============================================================================
# Etapa 4 — rango de fechas INCLUSIVO en ambos extremos (Visualizar avance)
# ============================================================================
def test_rango_de_fechas_es_inclusivo_en_ambos_extremos(especialista, sub_coord, project_id, partida_id):
    concepto = requests.post(
        f"{API}/conceptos", headers=sub_coord["headers"],
        json={
            "partida_id": partida_id, "clave": "3.3.7", "descripcion": "Concepto para rango de fechas",
            "unidad": "M2", "cantidad": "100", "precio_unitario": "10", "meta": "10", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    ).json()

    desde, hasta = "2026-03-01", "2026-03-10"
    # Un avance EXACTAMENTE en la fecha inicial, otro EXACTAMENTE en la
    # final, y uno claramente fuera del rango (control negativo).
    r1 = requests.post(
        f"{API}/avances", headers=especialista["headers"],
        json={"concepto_id": concepto["id"], "fecha": desde, "cantidad_ejecutada": "1"},
        timeout=TIMEOUT,
    )
    r2 = requests.post(
        f"{API}/avances", headers=especialista["headers"],
        json={"concepto_id": concepto["id"], "fecha": hasta, "cantidad_ejecutada": "2"},
        timeout=TIMEOUT,
    )
    r_fuera = requests.post(
        f"{API}/avances", headers=especialista["headers"],
        json={"concepto_id": concepto["id"], "fecha": "2026-03-11", "cantidad_ejecutada": "3"},
        timeout=TIMEOUT,
    )
    assert r1.status_code == 200 and r2.status_code == 200 and r_fuera.status_code == 200, (r1.text, r2.text, r_fuera.text)

    r = requests.get(
        f"{API}/projects/{project_id}/avances", headers=sub_coord["headers"],
        params={"desde": desde, "hasta": hasta, "concepto_id": concepto["id"]},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    fechas = {a["fecha"] for a in r.json()}
    assert desde in fechas, f"la fecha inicial ({desde}) debe entrar en el rango (inclusivo)"
    assert hasta in fechas, f"la fecha final ({hasta}) debe entrar en el rango (inclusivo)"
    assert "2026-03-11" not in fechas, "una fecha fuera del rango no debe entrar"
