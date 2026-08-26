"""Backend tests — forma de la respuesta de usuario (`/auth/login`,
`/auth/me`), servida por `user_to_out()` en server.py.

Por qué existe: `user_to_out()` alimenta TODA la app (login, refresh de
sesión, `auth-context.tsx` del frontend) y no tenía ninguna prueba que
fijara su forma. Se le agregó `area_id` (antes solo existía el campo legacy
de texto libre `area`) para que la pantalla "Actividades Generales" supiera
el área del especialista sin inferencias frágiles — este test existe para
que un cambio futuro que filtre o reduzca esa forma (ej. si alguien más
tarde le pone `response_model=UserOut` a `/auth/login`/`/auth/me` y
`UserOut` queda desactualizada) rompa un test en vez de romper el login en
producción sin aviso.

Integración contra un backend vivo, mismo patrón que los demás tests.
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

# Claves que la app (frontend `User` en src/api.ts, auth-context.tsx) espera
# encontrar en el objeto `user` — ni más ni menos. Si esto falla, alguien
# agregó o quitó un campo de `user_to_out()` sin actualizar ambos lados.
EXPECTED_KEYS = {
    "id", "email", "name", "role", "area", "area_id", "puesto",
    "scope_node_id", "scope_node_ids", "project_ids", "expo_push_tokens", "created_at",
}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _assert_shape(user: dict, *, context: str):
    assert set(user.keys()) == EXPECTED_KEYS, (
        f"[{context}] forma de 'user' inesperada.\n"
        f"faltan: {EXPECTED_KEYS - set(user.keys())}\n"
        f"sobran: {set(user.keys()) - EXPECTED_KEYS}"
    )


@pytest.fixture(scope="session")
def admin_login() -> dict:
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=TIMEOUT)
    assert r.status_code == 200, f"Login admin falló: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def admin_headers(admin_login: dict) -> dict:
    return _headers(admin_login["token"])


@pytest.fixture(scope="session")
def project_id(admin_headers: dict) -> str:
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"TEST_AuthShape_{suffix}",
        "constructora": "TEST_Constructora",
        "contract_number": f"TEST-{suffix}",
        "start_date": "2026-01-15",
        "end_date": "2026-12-31",
        "description": "Proyecto de prueba para forma de /auth",
    }
    r = requests.post(f"{API}/projects", headers=admin_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, f"Crear proyecto falló: {r.status_code} {r.text}"
    pid = r.json()["id"]
    yield pid
    requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=TIMEOUT)


@pytest.fixture(scope="session")
def root_node_id(admin_headers: dict, project_id: str) -> str:
    r = requests.post(
        f"{API}/projects/{project_id}/nodes", headers=admin_headers,
        json={"project_id": project_id, "parent_id": None, "name": "Tramo 1", "order": 0, "is_leaf": False},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def leaf_node_id(admin_headers: dict, project_id: str, root_node_id: str) -> str:
    r = requests.post(
        f"{API}/projects/{project_id}/nodes", headers=admin_headers,
        json={
            "project_id": project_id, "parent_id": root_node_id, "name": "Poste 1",
            "order": 0, "is_leaf": True, "measurement_type": "nivel",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="session")
def area_id(admin_headers: dict, project_id: str) -> str:
    r = requests.post(f"{API}/projects/{project_id}/areas", headers=admin_headers,
                       json={"project_id": project_id, "name": "Área de prueba"}, timeout=TIMEOUT)
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
    return r2.json()  # {"token": ..., "user": {...}}


@pytest.fixture(scope="session")
def sub_coord_login(admin_headers, project_id, root_node_id) -> dict:
    return _invite_and_accept(admin_headers, project_id, "sub_coordinador", "Test SubCoord", {"scope_node_id": root_node_id})


@pytest.fixture(scope="session")
def especialista_login(admin_headers, project_id, area_id, leaf_node_id) -> dict:
    return _invite_and_accept(
        admin_headers, project_id, "especialista", "Test Especialista",
        {"area_id": area_id, "scope_node_ids": [leaf_node_id]},
    )


@pytest.fixture(scope="session")
def jefe_login(admin_headers, project_id, root_node_id) -> dict:
    return _invite_and_accept(admin_headers, project_id, "jefe_proyecto", "Test Jefe", {"scope_node_id": root_node_id})


# ============================================================================
def test_login_devuelve_la_forma_esperada_para_los_4_roles(
    admin_login, sub_coord_login, especialista_login, jefe_login,
):
    for context, body in (
        ("coordinador_general", admin_login),
        ("sub_coordinador", sub_coord_login),
        ("especialista", especialista_login),
        ("jefe_proyecto", jefe_login),
    ):
        assert "token" in body and "user" in body, f"[{context}] respuesta de login sin token/user: {body}"
        _assert_shape(body["user"], context=f"login:{context}")


def test_me_devuelve_exactamente_la_misma_forma_que_login(especialista_login):
    r = requests.get(f"{API}/auth/me", headers=_headers(especialista_login["token"]), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    me_user = r.json()
    _assert_shape(me_user, context="me:especialista")
    assert set(me_user.keys()) == set(especialista_login["user"].keys()), (
        "/auth/me y /auth/login devuelven formas distintas para el mismo usuario"
    )


def test_area_id_correcto_por_rol(admin_login, sub_coord_login, especialista_login, jefe_login, area_id):
    # Roles sin área asignada: area_id debe ser None, no el string vacío ni
    # faltar la clave (ya lo cubre _assert_shape).
    assert admin_login["user"]["area_id"] is None
    assert sub_coord_login["user"]["area_id"] is None
    assert jefe_login["user"]["area_id"] is None
    # especialista: coincide EXACTO con el área de invitación — es el campo
    # del que depende el RBAC de Actividades Generales en el cliente.
    assert especialista_login["user"]["area_id"] == area_id
