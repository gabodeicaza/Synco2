"""Backend tests — configuración de proyecto para genericidad multiproyecto
(Etapa 1 de la Ampliación del Catálogo de Conceptos): tipo_contrato,
modo_avance, unidades_personalizadas, nodo_id en RegistroAvance.

Cubre:
  - Defaults que preservan el comportamiento actual para proyectos que no
    configuran nada de esto (tipo_contrato=PRECIOS_UNITARIOS,
    modo_avance=CANTIDAD, listas vacías).
  - Unidades extensibles por proyecto: una unidad personalizada de UN
    proyecto no es válida en OTRO (el caso que se escapa al mover la
    validación de un Literal estático a un chequeo dinámico).
  - Los dos flags de confirmación (modo_avance / tipo_contrato) son
    independientes y bloquean el cambio silencioso cuando ya hay datos.
  - nodo_id en RegistroAvance: opcional y nunca bloqueante en CANTIDAD,
    obligatorio y validado contra location_nodes en MATRIZ.
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


def _crear_proyecto(admin_headers, nombre_suffix) -> str:
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"TEST_{nombre_suffix}_{suffix}",
        "constructora": "TEST_Constructora",
        "contract_number": f"TEST-{nombre_suffix}-{suffix}",
        "start_date": "2026-01-15",
        "end_date": "2026-12-31",
    }
    r = requests.post(f"{API}/projects", headers=admin_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, f"Crear proyecto falló: {r.status_code} {r.text}"
    return r.json()["id"]


@pytest.fixture(scope="session")
def project_a(admin_headers) -> str:
    pid = _crear_proyecto(admin_headers, "GenA")
    yield pid
    requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=TIMEOUT)


@pytest.fixture(scope="session")
def project_b(admin_headers) -> str:
    pid = _crear_proyecto(admin_headers, "GenB")
    yield pid
    requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=TIMEOUT)


@pytest.fixture(scope="session")
def root_node_a(admin_headers, project_a) -> str:
    r = requests.post(
        f"{API}/projects/{project_a}/nodes", headers=admin_headers,
        json={"project_id": project_a, "parent_id": None, "name": "Nodo raíz A", "order": 0, "is_leaf": False},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _crear_partida(admin_headers, project_id, clave, nombre="Partida test") -> dict:
    r = requests.post(
        f"{API}/partidas", headers=admin_headers,
        json={"project_id": project_id, "clave": clave, "nombre": nombre, "orden": 0},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _crear_concepto(admin_headers, partida_id, clave, unidad="UNIVERSAL") -> requests.Response:
    return requests.post(
        f"{API}/conceptos", headers=admin_headers,
        json={
            "partida_id": partida_id, "clave": clave, "descripcion": f"Concepto {clave}",
            "unidad": unidad, "cantidad": "10", "precio_unitario": "10.00", "meta": "1", "periodicidad_meta": "SEMANAL",
        },
        timeout=TIMEOUT,
    )


def _get_project(admin_headers, project_id) -> dict:
    r = requests.get(f"{API}/projects/{project_id}", headers=admin_headers, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json()


# ============================================================================
# Defaults — proyecto que no configura nada de esto se comporta como hoy
# ============================================================================
def test_defaults_preservan_comportamiento_actual(admin_headers, project_a):
    p = _get_project(admin_headers, project_a)
    assert p["tipo_contrato"] == "PRECIOS_UNITARIOS"
    assert p["modo_avance"] == "CANTIDAD"
    assert p["nombres_niveles_partida"] == []
    assert p["nombre_nivel_concepto"] == ""
    assert p["unidades_personalizadas"] == []
    assert p["titulo_modulo_catalogo"] == ""


# ============================================================================
# Título del módulo de catálogo — texto libre completo, nunca derivado
# ============================================================================
def test_titulo_modulo_catalogo_configurable_y_no_derivado(admin_headers, project_a):
    # Sin configurar: el PDF cae al nombre histórico "catalogo_conceptos_...",
    # no a una versión sanitizada del título fallback con acentos.
    r_pdf_default = requests.get(
        f"{API}/projects/{project_a}/export/catalogo.pdf", headers=admin_headers, timeout=TIMEOUT,
    )
    assert r_pdf_default.status_code == 200, r_pdf_default.text
    assert "catalogo_conceptos_" in r_pdf_default.headers["content-disposition"]

    r = requests.put(
        f"{API}/projects/{project_a}", headers=admin_headers,
        json={"titulo_modulo_catalogo": "Catálogo de Insumos"}, timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    assert r.json()["titulo_modulo_catalogo"] == "Catálogo de Insumos"
    assert _get_project(admin_headers, project_a)["titulo_modulo_catalogo"] == "Catálogo de Insumos"

    # El PDF y su nombre de archivo reflejan el título configurado, no el
    # fallback ni una pluralización de nombre_nivel_concepto.
    r_pdf = requests.get(
        f"{API}/projects/{project_a}/export/catalogo.pdf", headers=admin_headers, timeout=TIMEOUT,
    )
    assert r_pdf.status_code == 200, r_pdf.text
    assert "Insumos" in r_pdf.headers["content-disposition"]
    assert "catalogo_conceptos_" not in r_pdf.headers["content-disposition"]


# ============================================================================
# Unidades extensibles por proyecto
# ============================================================================
def test_unidad_personalizada_se_acepta(admin_headers, project_a):
    r = requests.put(
        f"{API}/projects/{project_a}", headers=admin_headers,
        json={"unidades_personalizadas": ["BULTO"]}, timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    assert "BULTO" in r.json()["unidades_personalizadas"]

    partida = _crear_partida(admin_headers, project_a, "GEN.U.1")
    r2 = _crear_concepto(admin_headers, partida["id"], "GEN.U.1.1", unidad="BULTO")
    assert r2.status_code == 200, r2.text
    assert r2.json()["unidad"] == "BULTO"


def test_unidad_de_otro_proyecto_es_rechazada(admin_headers, project_a, project_b):
    # "BULTO" es válida en B (test anterior la agregó a A; aquí la agregamos
    # a B con OTRO nombre para no depender de orden de ejecución de tests).
    r = requests.put(
        f"{API}/projects/{project_b}", headers=admin_headers,
        json={"unidades_personalizadas": ["TAMBO"]}, timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text

    # project_a NO tiene "TAMBO" en su lista (solo "BULTO", del test anterior).
    partida_a = _crear_partida(admin_headers, project_a, "GEN.U.2")
    r2 = _crear_concepto(admin_headers, partida_a["id"], "GEN.U.2.1", unidad="TAMBO")
    assert r2.status_code == 400, r2.text
    detail = r2.json()["detail"]
    assert "TAMBO" in detail, "el mensaje debe decir qué unidad se envió"
    assert "UNIVERSAL" in detail, "el mensaje debe listar las unidades válidas para ESTE proyecto"
    assert "TAMBO" not in detail.split(":", 1)[1], "TAMBO no debe aparecer en la lista de válidas de A"


# ============================================================================
# Confirmación explícita — modo_avance y tipo_contrato son ejes
# independientes, cada uno con su propia bandera
# ============================================================================
def test_cambiar_modo_avance_con_avances_existentes_requiere_confirmacion(admin_headers, project_a, root_node_a):
    partida = _crear_partida(admin_headers, project_a, "GEN.M.1")
    concepto = _crear_concepto(admin_headers, partida["id"], "GEN.M.1.1").json()
    r_avance = requests.post(
        f"{API}/avances", headers=admin_headers,
        json={"concepto_id": concepto["id"], "fecha": "2026-06-01", "cantidad_ejecutada": "1"},
        timeout=TIMEOUT,
    )
    assert r_avance.status_code == 200, r_avance.text

    # Sin confirmar: rechazado.
    r_sin_confirmar = requests.put(
        f"{API}/projects/{project_a}", headers=admin_headers,
        json={"modo_avance": "MATRIZ"}, timeout=TIMEOUT,
    )
    assert r_sin_confirmar.status_code == 400, r_sin_confirmar.text
    assert _get_project(admin_headers, project_a)["modo_avance"] == "CANTIDAD", "no debe cambiar en silencio"

    # Confirmando: aceptado.
    r_confirmado = requests.put(
        f"{API}/projects/{project_a}", headers=admin_headers,
        json={"modo_avance": "MATRIZ", "confirmar_cambio_modo_avance": True}, timeout=TIMEOUT,
    )
    assert r_confirmado.status_code == 200, r_confirmado.text
    assert _get_project(admin_headers, project_a)["modo_avance"] == "MATRIZ"


def test_cambiar_tipo_contrato_con_conceptos_existentes_requiere_confirmacion(admin_headers, project_b):
    _crear_partida(admin_headers, project_b, "GEN.T.1")
    partida = requests.get(f"{API}/projects/{project_b}/partidas", headers=admin_headers, timeout=TIMEOUT).json()[0]
    r_concepto = _crear_concepto(admin_headers, partida["id"], "GEN.T.1.1")
    assert r_concepto.status_code == 200, r_concepto.text

    r_sin_confirmar = requests.put(
        f"{API}/projects/{project_b}", headers=admin_headers,
        json={"tipo_contrato": "PRECIO_ALZADO"}, timeout=TIMEOUT,
    )
    assert r_sin_confirmar.status_code == 400, r_sin_confirmar.text
    assert _get_project(admin_headers, project_b)["tipo_contrato"] == "PRECIOS_UNITARIOS"

    r_confirmado = requests.put(
        f"{API}/projects/{project_b}", headers=admin_headers,
        json={"tipo_contrato": "PRECIO_ALZADO", "confirmar_cambio_tipo_contrato": True}, timeout=TIMEOUT,
    )
    assert r_confirmado.status_code == 200, r_confirmado.text
    assert _get_project(admin_headers, project_b)["tipo_contrato"] == "PRECIO_ALZADO"

    # Confirmar tipo_contrato NO debe haber requerido (ni tocado) modo_avance
    # — son ejes independientes, no se conflatan.
    assert _get_project(admin_headers, project_b)["modo_avance"] == "CANTIDAD"


# ============================================================================
# nodo_id en RegistroAvance — obligatorio solo en MATRIZ, validado si viene
# ============================================================================
def test_nodo_id_opcional_y_no_bloqueante_en_modo_cantidad(admin_headers, project_b, root_node_a):
    # project_b sigue en modo CANTIDAD (el cambio anterior fue solo tipo_contrato).
    partida = _crear_partida(admin_headers, project_b, "GEN.N.1")
    concepto = _crear_concepto(admin_headers, partida["id"], "GEN.N.1.1").json()

    r_sin_nodo = requests.post(
        f"{API}/avances", headers=admin_headers,
        json={"concepto_id": concepto["id"], "fecha": "2026-06-02", "cantidad_ejecutada": "1"},
        timeout=TIMEOUT,
    )
    assert r_sin_nodo.status_code == 200, r_sin_nodo.text
    assert r_sin_nodo.json()["nodo_id"] is None


def test_modo_matriz_exige_nodo_id_valido(admin_headers, project_a, root_node_a):
    # No depende del orden de ejecución de los otros tests: fuerza MATRIZ
    # aquí mismo (con confirmar=True, ya probado aparte arriba).
    r_modo = requests.put(
        f"{API}/projects/{project_a}", headers=admin_headers,
        json={"modo_avance": "MATRIZ", "confirmar_cambio_modo_avance": True}, timeout=TIMEOUT,
    )
    assert r_modo.status_code == 200, r_modo.text
    assert _get_project(admin_headers, project_a)["modo_avance"] == "MATRIZ"
    partida = _crear_partida(admin_headers, project_a, "GEN.N.2")
    concepto = _crear_concepto(admin_headers, partida["id"], "GEN.N.2.1").json()

    r_sin_nodo = requests.post(
        f"{API}/avances", headers=admin_headers,
        json={"concepto_id": concepto["id"], "fecha": "2026-06-03", "cantidad_ejecutada": "1"},
        timeout=TIMEOUT,
    )
    assert r_sin_nodo.status_code == 400, r_sin_nodo.text

    r_nodo_falso = requests.post(
        f"{API}/avances", headers=admin_headers,
        json={"concepto_id": concepto["id"], "fecha": "2026-06-03", "cantidad_ejecutada": "1", "nodo_id": "no-existe"},
        timeout=TIMEOUT,
    )
    assert r_nodo_falso.status_code == 404, r_nodo_falso.text

    r_nodo_real = requests.post(
        f"{API}/avances", headers=admin_headers,
        json={"concepto_id": concepto["id"], "fecha": "2026-06-03", "cantidad_ejecutada": "1", "nodo_id": root_node_a},
        timeout=TIMEOUT,
    )
    assert r_nodo_real.status_code == 200, r_nodo_real.text
    assert r_nodo_real.json()["nodo_id"] == root_node_a
