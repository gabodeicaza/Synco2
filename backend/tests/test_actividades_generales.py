"""Backend tests — Actividades Generales (capa curada sobre reportes).

Integración contra un backend vivo, mismo patrón que
test_catalogo_conceptos.py: login admin, crea un proyecto TEST_ propio (con
su árbol de nodos), invita un sub_coordinador y dos especialistas de áreas
DISTINTAS, y limpia (archiva el proyecto) al final.

Árbol de prueba (para poder probar el nivel SUBTRAMO derivado por
profundidad, no solo por "es hoja"):

    Tramo 1 (depth 0)
      └─ Subtramo A (depth 1, NO hoja)
           ├─ Poste A1 (depth 2, hoja)
           ├─ Poste A2 (depth 2, hoja)
           └─ Poste A3 (depth 2, hoja)
      └─ Estación B (depth 1, SÍ hoja — sin postes hijos)

Cubre:
  - Identidad de actividades 'virtual:{reporte_id}': tres reportes con tres
    textos de actividad DISTINTOS nunca comparten id, y editar uno no muta
    los otros dos (ni en la capa curada ni en el reporte original).
  - Nivel por defecto derivado de la PROFUNDIDAD del nodo del reporte, no de
    si es hoja: un reporte en "Estación B" (hoja a depth 1) debe salir como
    SUBTRAMO, no como NODO.
  - "Revertir" usa el snapshot guardado al materializar, no relee el reporte.
  - RBAC: especialista no puede editar actividades de un área ajena.
  - "Mover" cambia el nivel/nodo de agrupación pero conserva
    node_id_origen intacto.
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
        "name": f"TEST_ActividadesGenerales_{suffix}",
        "constructora": "TEST_Constructora",
        "contract_number": f"TEST-{suffix}",
        "start_date": "2026-01-15",
        "end_date": "2026-12-31",
        "description": "Proyecto de prueba para Actividades Generales",
    }
    r = requests.post(f"{API}/projects", headers=admin_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, f"Crear proyecto falló: {r.status_code} {r.text}"
    pid = r.json()["id"]
    yield pid
    requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=TIMEOUT)


def _create_node(admin_headers, project_id, **kw) -> str:
    payload = {"project_id": project_id, "order": 0, **kw}
    r = requests.post(f"{API}/projects/{project_id}/nodes", headers=admin_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def tramo_id(admin_headers, project_id) -> str:
    return _create_node(admin_headers, project_id, parent_id=None, name="Tramo 1", is_leaf=False)


@pytest.fixture(scope="session")
def subtramo_a_id(admin_headers, project_id, tramo_id) -> str:
    return _create_node(admin_headers, project_id, parent_id=tramo_id, name="Subtramo A", is_leaf=False)


@pytest.fixture(scope="session")
def poste_a1_id(admin_headers, project_id, subtramo_a_id) -> str:
    return _create_node(admin_headers, project_id, parent_id=subtramo_a_id, name="Poste A1",
                         is_leaf=True, measurement_type="nivel")


@pytest.fixture(scope="session")
def poste_a2_id(admin_headers, project_id, subtramo_a_id) -> str:
    return _create_node(admin_headers, project_id, parent_id=subtramo_a_id, name="Poste A2",
                         is_leaf=True, measurement_type="nivel")


@pytest.fixture(scope="session")
def poste_a3_id(admin_headers, project_id, subtramo_a_id) -> str:
    return _create_node(admin_headers, project_id, parent_id=subtramo_a_id, name="Poste A3",
                         is_leaf=True, measurement_type="nivel")


@pytest.fixture(scope="session")
def estacion_b_id(admin_headers, project_id, tramo_id) -> str:
    """Hoja a depth 1 — una 'Estación' sin postes hijos. Sirve para probar
    que el nivel por defecto se deriva de la profundidad, no de is_leaf."""
    return _create_node(admin_headers, project_id, parent_id=tramo_id, name="Estación B",
                         is_leaf=True, measurement_type="nivel")


@pytest.fixture(scope="session")
def area_a_id(admin_headers, project_id) -> str:
    r = requests.post(f"{API}/projects/{project_id}/areas", headers=admin_headers,
                       json={"project_id": project_id, "name": "Área A"}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def area_z_id(admin_headers, project_id) -> str:
    r = requests.post(f"{API}/projects/{project_id}/areas", headers=admin_headers,
                       json={"project_id": project_id, "name": "Área Z (ajena)"}, timeout=TIMEOUT)
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
def sub_coord(admin_headers, project_id, tramo_id) -> dict:
    return _invite_and_accept(admin_headers, project_id, "sub_coordinador", "Test SubCoord", {"scope_node_id": tramo_id})


@pytest.fixture(scope="session")
def especialista_a(admin_headers, project_id, area_a_id, poste_a1_id, poste_a2_id, poste_a3_id, estacion_b_id) -> dict:
    return _invite_and_accept(
        admin_headers, project_id, "especialista", "Test Especialista A",
        {"area_id": area_a_id, "scope_node_ids": [poste_a1_id, poste_a2_id, poste_a3_id, estacion_b_id]},
    )


@pytest.fixture(scope="session")
def especialista_z(admin_headers, project_id, area_z_id, poste_a1_id) -> dict:
    """Especialista de un área DISTINTA — usado solo para probar el límite
    de RBAC (no debe poder editar actividades del Área A)."""
    return _invite_and_accept(
        admin_headers, project_id, "especialista", "Test Especialista Z",
        {"area_id": area_z_id, "scope_node_ids": [poste_a1_id]},
    )


def _crear_reporte(headers, project_id, node_id, actividades: str, measurement_value=None,
                   severidad: str = "diario") -> dict:
    # "informativo" no llega al hub de Actividades Generales, así que por
    # defecto el helper crea reportes "diario" para que sus actividades cuenten.
    payload = {
        "project_id": project_id, "node_id": node_id,
        "measurement_value": measurement_value or {"nivel": 1.0},
        "actividades": actividades,
        "severidad": severidad,
    }
    r = requests.post(f"{API}/reports", headers=headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def _get_actividades(headers, project_id, **params) -> list:
    r = requests.get(f"{API}/projects/{project_id}/actividades_generales", headers=headers, params=params, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


# ============================================================================
# 1) Identidad 'virtual:{reporte_id}' — sin colisión ni contaminación cruzada
# ============================================================================
def test_reporte_informativo_no_llega_al_hub(especialista_a, project_id, poste_a1_id, poste_a2_id):
    """Un reporte solo 'informativo' no aparece en el hub de Actividades
    Generales (ni, por lo mismo, en lo que se imprime); uno 'diario' sí."""
    r_info = _crear_reporte(especialista_a["headers"], project_id, poste_a1_id,
                            "Actividad informativa", severidad="informativo")
    r_diario = _crear_reporte(especialista_a["headers"], project_id, poste_a2_id,
                              "Actividad diaria", severidad="diario")
    ids = {it.get("reporte_origen_id") for it in _get_actividades(especialista_a["headers"], project_id)}
    assert r_diario["id"] in ids
    assert r_info["id"] not in ids


def test_editar_una_actividad_no_afecta_a_las_otras(especialista_a, project_id, poste_a1_id, poste_a2_id, poste_a3_id):
    """Aislamiento ENTRE REPORTES distintos (complementa
    test_editar_una_linea_no_afecta_a_las_otras_lineas_del_mismo_reporte,
    que cubre el aislamiento DENTRO de un mismo reporte multilínea). Tres
    reportes de una sola línea cada uno; editar el del medio no debe tocar
    los otros dos. Con `FEATURE_SPLIT_ACTIVIDADES_POR_LINEA` activa, el id
    virtual de un bloque de una sola línea sigue siendo
    'virtual:{reporte_id}:0' — el índice 0 siempre está presente, pero para
    un bloque de una línea es un no-op frente al comportamiento anterior."""
    r1 = _crear_reporte(especialista_a["headers"], project_id, poste_a1_id, "Excavación de zanja en Poste A1")
    r2 = _crear_reporte(especialista_a["headers"], project_id, poste_a2_id, "Colado de losa en Poste A2")
    r3 = _crear_reporte(especialista_a["headers"], project_id, poste_a3_id, "Instalación de poste en Poste A3")

    items = _get_actividades(especialista_a["headers"], project_id)
    by_report = {it["reporte_origen_id"]: it for it in items if it.get("reporte_origen_id") in (r1["id"], r2["id"], r3["id"])}
    assert set(by_report.keys()) == {r1["id"], r2["id"], r3["id"]}

    ids = {it["id"] for it in by_report.values()}
    assert len(ids) == 3, f"ids de actividad no son únicos: {ids}"
    assert all(i.startswith("virtual:") for i in ids), "aún no se editó nada, deberían seguir siendo virtuales"

    item2 = by_report[r2["id"]]
    assert item2["id"] == f"virtual:{r2['id']}:0"

    # Editar SOLO la actividad del reporte 2.
    patch = requests.patch(
        f"{API}/projects/{project_id}/actividades_generales/{item2['id']}",
        headers=especialista_a["headers"], json={"texto_editado": "Colado de losa — EDITADO"}, timeout=TIMEOUT,
    )
    assert patch.status_code == 200, patch.text
    item2_updated = patch.json()
    assert item2_updated["texto"] == "Colado de losa — EDITADO"
    assert item2_updated["editada"] is True
    assert not item2_updated["id"].startswith("virtual:"), "debió materializarse a un id real"

    # Releer la lista completa: 1 y 3 deben seguir intactos y virtuales.
    items2 = _get_actividades(especialista_a["headers"], project_id)
    by_report2 = {it["reporte_origen_id"]: it for it in items2 if it.get("reporte_origen_id") in (r1["id"], r2["id"], r3["id"])}

    assert by_report2[r1["id"]]["texto"] == "Excavación de zanja en Poste A1"
    assert by_report2[r1["id"]]["editada"] is False
    assert by_report2[r1["id"]]["id"] == f"virtual:{r1['id']}:0", "no debió materializarse"

    assert by_report2[r3["id"]]["texto"] == "Instalación de poste en Poste A3"
    assert by_report2[r3["id"]]["editada"] is False
    assert by_report2[r3["id"]]["id"] == f"virtual:{r3['id']}:0", "no debió materializarse"

    assert by_report2[r2["id"]]["texto"] == "Colado de losa — EDITADO"
    assert by_report2[r2["id"]]["id"] == item2_updated["id"]

    # El reporte original 2 NUNCA se mutó (verificación explícita del
    # criterio de aceptación "editar aquí no cambia el reporte").
    rep2_check = requests.get(f"{API}/reports/{r2['id']}", headers=especialista_a["headers"], timeout=TIMEOUT)
    assert rep2_check.status_code == 200, rep2_check.text
    assert rep2_check.json()["actividades"] == "Colado de losa en Poste A2"

    # Revertir: vuelve exactamente al snapshot original (no relee el reporte).
    rev = requests.post(
        f"{API}/projects/{project_id}/actividades_generales/{item2_updated['id']}/revertir",
        headers=especialista_a["headers"], timeout=TIMEOUT,
    )
    assert rev.status_code == 200, rev.text
    assert rev.json()["texto"] == "Colado de losa en Poste A2"
    assert rev.json()["editada"] is False


def test_editar_una_linea_no_afecta_a_las_otras_lineas_del_mismo_reporte(especialista_a, project_id, poste_a1_id):
    """El escenario ORIGINAL que se pidió antes de saber cómo era el dato
    (un reporte con 3 actividades, editar la segunda, confirmar que la
    primera y la tercera no cambian) — ahora sí representa el modelo real,
    con `FEATURE_SPLIT_ACTIVIDADES_POR_LINEA` activa. Un solo reporte, un
    bloque de 3 líneas."""
    bloque = "Excavación de zanja\nColado de losa\nInstalación de poste"
    rep = _crear_reporte(especialista_a["headers"], project_id, poste_a1_id, bloque)

    items = _get_actividades(especialista_a["headers"], project_id)
    del_reporte = [it for it in items if it.get("reporte_origen_id") == rep["id"]]
    assert len(del_reporte) == 3, f"esperaba 3 líneas del mismo reporte, salieron {len(del_reporte)}"

    by_id = {it["id"]: it for it in del_reporte}
    ids = set(by_id.keys())
    assert ids == {f"virtual:{rep['id']}:0", f"virtual:{rep['id']}:1", f"virtual:{rep['id']}:2"}, (
        f"ids inesperados: {ids}"
    )
    assert by_id[f"virtual:{rep['id']}:0"]["texto"] == "Excavación de zanja"
    assert by_id[f"virtual:{rep['id']}:1"]["texto"] == "Colado de losa"
    assert by_id[f"virtual:{rep['id']}:2"]["texto"] == "Instalación de poste"

    # Editar SOLO la línea del medio (índice 1).
    linea_media_id = f"virtual:{rep['id']}:1"
    patch = requests.patch(
        f"{API}/projects/{project_id}/actividades_generales/{linea_media_id}",
        headers=especialista_a["headers"], json={"texto_editado": "Colado de losa — EDITADO"}, timeout=TIMEOUT,
    )
    assert patch.status_code == 200, patch.text
    linea_media_actualizada = patch.json()
    assert linea_media_actualizada["texto"] == "Colado de losa — EDITADO"
    assert not linea_media_actualizada["id"].startswith("virtual:"), "debió materializarse a un id real"

    # Releer: la primera y la tercera línea del MISMO reporte deben seguir
    # intactas y virtuales — la materialización de una línea no debe tocar
    # a sus hermanas.
    items2 = _get_actividades(especialista_a["headers"], project_id)
    del_reporte2 = {it["id"]: it for it in items2 if it.get("reporte_origen_id") == rep["id"] or it["id"] == linea_media_actualizada["id"]}

    primera = del_reporte2[f"virtual:{rep['id']}:0"]
    assert primera["texto"] == "Excavación de zanja"
    assert primera["editada"] is False

    tercera = del_reporte2[f"virtual:{rep['id']}:2"]
    assert tercera["texto"] == "Instalación de poste"
    assert tercera["editada"] is False

    media = del_reporte2[linea_media_actualizada["id"]]
    assert media["texto"] == "Colado de losa — EDITADO"
    assert media["editada"] is True

    # El reporte original NUNCA se mutó: sigue con el bloque completo de 3
    # líneas tal cual se capturó, sin el " — EDITADO".
    rep_check = requests.get(f"{API}/reports/{rep['id']}", headers=especialista_a["headers"], timeout=TIMEOUT)
    assert rep_check.status_code == 200, rep_check.text
    assert rep_check.json()["actividades"] == bloque


# ============================================================================
# 2) Nivel por defecto: profundidad, no "es hoja"
# ============================================================================
def test_nivel_por_defecto_usa_profundidad_no_es_hoja(especialista_a, project_id, estacion_b_id, poste_a1_id):
    """Estación B es hoja a depth 1 (sin postes hijos) — su actividad debe
    agruparse como SUBTRAMO, no como NODO, aunque sea técnicamente una hoja."""
    rep_estacion = _crear_reporte(especialista_a["headers"], project_id, estacion_b_id, "Recorrido general de Estación B")
    rep_poste = _crear_reporte(especialista_a["headers"], project_id, poste_a1_id, "Trabajo puntual en Poste A1 (nivel)")

    items = _get_actividades(especialista_a["headers"], project_id)
    by_report = {it["reporte_origen_id"]: it for it in items}

    it_estacion = by_report[rep_estacion["id"]]
    assert it_estacion["nivel"] == "SUBTRAMO", "una hoja a depth 1 debe agruparse como Subtramo/Estación"
    assert it_estacion["node_id"] == estacion_b_id
    assert it_estacion["node_id_origen"] == estacion_b_id

    it_poste = by_report[rep_poste["id"]]
    assert it_poste["nivel"] == "NODO"
    assert it_poste["node_id"] == poste_a1_id


# ============================================================================
# 3) RBAC: especialista no edita actividades de un área ajena
# ============================================================================
def test_especialista_no_puede_editar_actividad_de_otra_area(especialista_a, especialista_z, project_id, poste_a1_id):
    rep = _crear_reporte(especialista_a["headers"], project_id, poste_a1_id, "Actividad exclusiva del Área A")
    items = _get_actividades(especialista_a["headers"], project_id)
    item = next(it for it in items if it.get("reporte_origen_id") == rep["id"])
    assert item["puede_editar"] is True  # para el dueño del área

    # especialista_z (Área Z) la ve (especialista ve TODO el proyecto) pero
    # con puede_editar=False, y el backend debe rechazar la escritura.
    items_z = _get_actividades(especialista_z["headers"], project_id)
    item_z = next(it for it in items_z if it.get("reporte_origen_id") == rep["id"])
    assert item_z["puede_editar"] is False

    r = requests.patch(
        f"{API}/projects/{project_id}/actividades_generales/{item_z['id']}",
        headers=especialista_z["headers"], json={"texto_editado": "Intento de edición ajena"}, timeout=TIMEOUT,
    )
    assert r.status_code == 403, r.text


# ============================================================================
# 4) Mover: cambia nivel/nodo de agrupación, conserva node_id_origen
# ============================================================================
def test_mover_conserva_node_id_origen(sub_coord, project_id, poste_a2_id, subtramo_a_id, especialista_a):
    rep = _crear_reporte(especialista_a["headers"], project_id, poste_a2_id, "Actividad a promover a su Estación")
    items = _get_actividades(sub_coord["headers"], project_id)
    item = next(it for it in items if it.get("reporte_origen_id") == rep["id"])
    assert item["nivel"] == "NODO"

    r = requests.post(
        f"{API}/projects/{project_id}/actividades_generales/{item['id']}/mover",
        headers=sub_coord["headers"], json={"nivel": "SUBTRAMO"}, timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    moved = r.json()
    assert moved["nivel"] == "SUBTRAMO"
    assert moved["node_id"] == subtramo_a_id, "debió auto-resolver al Subtramo ancestro del poste"
    assert moved["node_id_origen"] == poste_a2_id, "el nodo original del reporte nunca debe cambiar"
