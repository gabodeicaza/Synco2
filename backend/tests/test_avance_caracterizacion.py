"""Pruebas de CARACTERIZACIÓN del cálculo de avance en modo CANTIDAD — Etapa 1
de la Ampliación del Catálogo de Conceptos (modo_avance / nodo_id / MATRIZ).

Estas pruebas NO validan una spec nueva: fijan el comportamiento que ya tiene
hoy `_concepto_ejecutado_acumulado` (server.py) y sus llamadores
(`_concepto_out`, `_partida_out`), tal como está, ANTES de tocar una sola
línea de esa función. Se corren primero contra el código sin modificar y
deben seguir en verde después de la extracción de la base común (Ajuste 1) y
durante toda la Etapa 1 — si alguna cambia de resultado en algún punto
posterior, es señal de una regresión o de un bug preexistente recién
descubierto, y ninguna de las dos cosas se resuelve ajustando el test.

No son pruebas del modo MATRIZ ni PORCENTAJE: son la red de seguridad de que
los proyectos existentes (modo CANTIDAD, el único que existe hoy) no cambian
de números.
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
# Fixtures — mismo patrón que test_catalogo_conceptos.py: proyecto TEST_
# propio, un sub_coordinador que puede crear/editar catálogo Y registrar
# avance (create_avance solo bloquea jefe_proyecto vía _assert_write_allowed,
# no exige require_role(ROLE_SUB, ROLE_COORD) — no hace falta un fixture de
# especialista aparte para estas pruebas).
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
        "name": f"TEST_Caracterizacion_{suffix}",
        "constructora": "TEST_Constructora",
        "contract_number": f"TEST-CAR-{suffix}",
        "start_date": "2026-01-15",
        "end_date": "2026-12-31",
        "description": "Proyecto de prueba — caracterización de avance (Etapa 1)",
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
def sub_coord(admin_headers, project_id, root_node_id) -> dict:
    suffix = uuid.uuid4().hex[:10]
    email = f"test_subcoord_{suffix}@synco-test.mx"
    payload = {
        "project_id": project_id, "email": email, "name": "Test SubCoord Caracterizacion",
        "role": "sub_coordinador", "scope_node_id": root_node_id,
    }
    r = requests.post(f"{API}/projects/{project_id}/invitations", headers=admin_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, f"Invitar sub_coordinador falló: {r.status_code} {r.text}"
    token = r.json()["token"]
    r2 = requests.post(f"{API}/invitations/accept", json={"token": token, "password": "TestPass123!"}, timeout=TIMEOUT)
    assert r2.status_code == 200, f"Aceptar invitación falló: {r2.status_code} {r2.text}"
    body = r2.json()
    return {"token": body["token"], "user": body["user"], "headers": _headers(body["token"])}


# ============================================================================
# Helpers — no fixtures, solo para no repetir el armado de requests
# ============================================================================
def crear_partida(headers, project_id, clave, nombre, orden=0, partida_padre_id=None) -> dict:
    payload = {"project_id": project_id, "clave": clave, "nombre": nombre, "orden": orden}
    if partida_padre_id:
        payload["partida_padre_id"] = partida_padre_id
    r = requests.post(f"{API}/partidas", headers=headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def crear_concepto(headers, partida_id, clave, cantidad, precio_unitario, descripcion=None) -> dict:
    payload = {
        "partida_id": partida_id, "clave": clave, "descripcion": descripcion or f"Concepto {clave}",
        "unidad": "PZA", "cantidad": cantidad, "precio_unitario": precio_unitario,
        "meta": "1", "periodicidad_meta": "SEMANAL",
    }
    r = requests.post(f"{API}/conceptos", headers=headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


def registrar_avance(headers, concepto_id, fecha, cantidad_ejecutada) -> dict:
    r = requests.post(
        f"{API}/avances", headers=headers,
        json={"concepto_id": concepto_id, "fecha": fecha, "cantidad_ejecutada": cantidad_ejecutada},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def get_concepto(headers, partida_id, concepto_id, incluir_inactivos=False) -> dict:
    r = requests.get(
        f"{API}/partidas/{partida_id}/conceptos", headers=headers,
        params={"incluir_inactivos": incluir_inactivos}, timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    match = next((c for c in r.json() if c["id"] == concepto_id), None)
    assert match is not None, f"Concepto {concepto_id} no apareció en la lista (incluir_inactivos={incluir_inactivos})"
    return match


def get_partida(headers, project_id, partida_id) -> dict:
    r = requests.get(f"{API}/projects/{project_id}/partidas", headers=headers, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    match = next((p for p in r.json() if p["id"] == partida_id), None)
    assert match is not None, f"Partida {partida_id} no apareció en la lista"
    return match


# ============================================================================
# a) Concepto sin ningún avance → ejecutado 0, avance 0%, sin división entre cero
# ============================================================================
def test_a_concepto_sin_avances_ejecutado_cero(sub_coord, project_id):
    partida = crear_partida(sub_coord["headers"], project_id, "CAR.A", "Caracterización A", orden=1)
    concepto = crear_concepto(sub_coord["headers"], partida["id"], "CAR.A.1", cantidad="50", precio_unitario="20.00")

    c = get_concepto(sub_coord["headers"], partida["id"], concepto["id"])
    assert c["cantidad_ejecutada_acumulada"] == "0"

    p = get_partida(sub_coord["headers"], project_id, partida["id"])
    assert p["importe_contratado_partida"] == "1000.00"  # 50 × 20.00, sin redondear (ya trae 2 decimales de origen)
    assert p["porcentaje_avance_partida"] == "0.00"


# ============================================================================
# b) Varios avances en fechas distintas → suma EXACTA en Decimal
#    (10.33 + 5.67 + 0.10 = 16.10 exacto; en float esta suma arrastra error
#    de representación binaria — esta prueba fija que aquí NO pasa)
# ============================================================================
def test_b_suma_de_avances_es_decimal_exacta(sub_coord, project_id):
    partida = crear_partida(sub_coord["headers"], project_id, "CAR.B", "Caracterización B", orden=2)
    concepto = crear_concepto(sub_coord["headers"], partida["id"], "CAR.B.1", cantidad="100", precio_unitario="10.00")

    registrar_avance(sub_coord["headers"], concepto["id"], "2026-02-01", "10.33")
    registrar_avance(sub_coord["headers"], concepto["id"], "2026-02-05", "5.67")
    registrar_avance(sub_coord["headers"], concepto["id"], "2026-02-10", "0.10")

    c = get_concepto(sub_coord["headers"], partida["id"], concepto["id"])
    assert c["cantidad_ejecutada_acumulada"] == "16.10"


# ============================================================================
# c) Ejecutado supera la cantidad contratada → el % pasa de 100 y NO se
#    recorta. Fija el comportamiento actual tal cual es (sin opinar si
#    debería recortar): hoy _partida_out no aplica ningún min(...,100).
# ============================================================================
def test_c_ejecutado_excede_contratado_no_se_recorta(sub_coord, project_id):
    partida = crear_partida(sub_coord["headers"], project_id, "CAR.C", "Caracterización C", orden=3)
    concepto = crear_concepto(sub_coord["headers"], partida["id"], "CAR.C.1", cantidad="10.00", precio_unitario="50.00")

    # 15 ejecutadas contra 10 contratadas = 150%
    registrar_avance(sub_coord["headers"], concepto["id"], "2026-03-01", "15.00")

    c = get_concepto(sub_coord["headers"], partida["id"], concepto["id"])
    assert c["cantidad_ejecutada_acumulada"] == "15.00"  # el propio registro tampoco se recorta

    p = get_partida(sub_coord["headers"], project_id, partida["id"])
    # importe = 10.00 × 50.00 = 500.00; pct_c = 15.00/10.00 = 1.5 → 150%
    assert p["porcentaje_avance_partida"] == "150.00", (
        "Comportamiento actual documentado: el % de avance de una partida NO se "
        "recorta a 100 cuando un concepto se sobre-ejecuta. Si esta prueba cambia "
        "de valor, es una decisión de producto, no un bug a silenciar."
    )


# ============================================================================
# d) Partida con conceptos de importes DISTINTOS → promedio PONDERADO por
#    importe, no promedio simple. Con importes iguales esta prueba no
#    distinguiría un cálculo del otro, así que se usan 1000.00 vs 100.00.
# ============================================================================
def test_d_partida_pondera_por_importe_no_promedio_simple(sub_coord, project_id):
    partida = crear_partida(sub_coord["headers"], project_id, "CAR.D", "Caracterización D", orden=4)
    # C1: importe 1000.00, 100% ejecutado
    c1 = crear_concepto(sub_coord["headers"], partida["id"], "CAR.D.1", cantidad="10.00", precio_unitario="100.00")
    registrar_avance(sub_coord["headers"], c1["id"], "2026-04-01", "10.00")
    # C2: importe 100.00, 0% ejecutado (sin avances)
    crear_concepto(sub_coord["headers"], partida["id"], "CAR.D.2", cantidad="10.00", precio_unitario="10.00")

    p = get_partida(sub_coord["headers"], project_id, partida["id"])
    # Simple: (100% + 0%) / 2 = 50.00% — NO es esto.
    # Ponderado: (1000.00×1.0 + 100.00×0) / (1000.00+100.00) = 1000/1100 = 90.9090...% → 90.91 (HALF_UP)
    assert p["porcentaje_avance_partida"] == "90.91"
    assert p["porcentaje_avance_partida"] != "50.00"


# ============================================================================
# e) Subpartidas anidadas A DOS NIVELES → una partida raíz agrega TODO su
#    subárbol (nietos incluidos), no solo hijos directos.
# ============================================================================
def test_e_partida_raiz_agrega_subarbol_de_dos_niveles(sub_coord, project_id):
    raiz = crear_partida(sub_coord["headers"], project_id, "CAR.E", "Caracterización E raíz", orden=5)
    hija = crear_partida(sub_coord["headers"], project_id, "CAR.E.1", "Caracterización E hija", orden=1, partida_padre_id=raiz["id"])
    nieta = crear_partida(sub_coord["headers"], project_id, "CAR.E.1.1", "Caracterización E nieta", orden=1, partida_padre_id=hija["id"])

    # El único concepto vive dos niveles abajo de la raíz, en la nieta.
    # cantidad SIN decimales a propósito: compute_importe no normaliza
    # exponentes (cantidad con 2 decimales × PU con 2 decimales da 4
    # decimales en importe_contratado_partida, ej. "1000.0000" — ver test_g
    # y la nota en su docstring). Aquí solo se quiere aislar la agregación
    # del subárbol, no ese comportamiento de formateo.
    concepto = crear_concepto(sub_coord["headers"], nieta["id"], "CAR.E.1.1.1", cantidad="10", precio_unitario="100.00")
    registrar_avance(sub_coord["headers"], concepto["id"], "2026-05-01", "5.00")  # 50%

    p_raiz = get_partida(sub_coord["headers"], project_id, raiz["id"])
    p_hija = get_partida(sub_coord["headers"], project_id, hija["id"])

    for p, nombre in [(p_raiz, "raíz"), (p_hija, "hija")]:
        assert p["numero_conceptos"] == 1, f"la partida {nombre} debe ver el concepto de su nieta"
        assert p["importe_contratado_partida"] == "1000.00", f"la partida {nombre} debe agregar el importe de su nieta"
        assert p["porcentaje_avance_partida"] == "50.00", f"la partida {nombre} debe agregar el avance de su nieta"


# ============================================================================
# f) Importe total cero (dos variantes) → no truena, devuelve 0.
#    f1: partida sin ningún concepto.
#    f2: partida con un concepto de cantidad 0 (ejercita el otro guard de
#        división entre cero: pct_c cuando cantidad_contratada == 0).
# ============================================================================
def test_f1_partida_vacia_no_truena(sub_coord, project_id):
    partida = crear_partida(sub_coord["headers"], project_id, "CAR.F1", "Caracterización F1 vacía", orden=6)
    p = get_partida(sub_coord["headers"], project_id, partida["id"])
    assert p["numero_conceptos"] == 0
    assert p["importe_contratado_partida"] == "0"
    assert p["porcentaje_avance_partida"] == "0.00"


def test_f2_concepto_con_cantidad_cero_no_truena(sub_coord, project_id):
    partida = crear_partida(sub_coord["headers"], project_id, "CAR.F2", "Caracterización F2 cantidad cero", orden=7)
    crear_concepto(sub_coord["headers"], partida["id"], "CAR.F2.1", cantidad="0", precio_unitario="0")
    p = get_partida(sub_coord["headers"], project_id, partida["id"])
    assert p["numero_conceptos"] == 1
    assert p["importe_contratado_partida"] == "0"
    assert p["porcentaje_avance_partida"] == "0.00"


# ============================================================================
# g) Concepto desactivado (activo=false) → fija si entra o no al cálculo de
#    su partida. Comportamiento actual: `_partida_out` solo agrega conceptos
#    con activo=True, así que desactivar un concepto lo saca POR COMPLETO de
#    numero_conceptos / importe_contratado_partida / porcentaje_avance_partida
#    de su partida — no se queda con peso 0, desaparece del agregado.
# NOTA de formateo descubierta al escribir esta prueba: compute_importe no
# normaliza exponentes decimales (cantidad="10.00" × PU="10.00" da
# "100.0000", no "100.00" — el redondeo a 2 decimales solo se aplica al
# porcentaje, nunca al importe agregado). Por eso aquí cantidad va SIN
# decimales: aísla la prueba de activo=False del comportamiento de formateo,
# que es un hallazgo aparte, no algo que esta prueba deba fijar.
# ============================================================================
def test_g_concepto_desactivado_sale_del_calculo_de_la_partida(sub_coord, project_id):
    partida = crear_partida(sub_coord["headers"], project_id, "CAR.G", "Caracterización G", orden=8)
    c1 = crear_concepto(sub_coord["headers"], partida["id"], "CAR.G.1", cantidad="10", precio_unitario="10.00")   # importe 100.00
    c2 = crear_concepto(sub_coord["headers"], partida["id"], "CAR.G.2", cantidad="10", precio_unitario="50.00")   # importe 500.00

    p_antes = get_partida(sub_coord["headers"], project_id, partida["id"])
    assert p_antes["numero_conceptos"] == 2
    assert p_antes["importe_contratado_partida"] == "600.00"

    r = requests.patch(f"{API}/conceptos/{c2['id']}", headers=sub_coord["headers"], json={"activo": False}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text

    p_despues = get_partida(sub_coord["headers"], project_id, partida["id"])
    assert p_despues["numero_conceptos"] == 1, "el concepto desactivado debe salir de numero_conceptos"
    assert p_despues["importe_contratado_partida"] == "100.00", "el concepto desactivado debe salir del importe agregado"

    # Sigue existiendo y consultable explícitamente con incluir_inactivos=True.
    c2_out = get_concepto(sub_coord["headers"], partida["id"], c2["id"], incluir_inactivos=True)
    assert c2_out["activo"] is False
    # Con la lista por defecto (incluir_inactivos=False) ya no aparece — lo
    # confirma que get_concepto(..., incluir_inactivos=False) para c1 no truene
    # y c2 no esté:
    r_default = requests.get(f"{API}/partidas/{partida['id']}/conceptos", headers=sub_coord["headers"], timeout=TIMEOUT)
    ids_default = {c["id"] for c in r_default.json()}
    assert c2["id"] not in ids_default
    assert c1["id"] in ids_default
