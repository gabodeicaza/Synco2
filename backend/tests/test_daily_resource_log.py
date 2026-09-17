"""SynCo v2.0 — Backend end-to-end test for Corte de Caja Diario
(DailyResourceLog).

Covers:
  - Coordinador General login
  - Create project + 2 root Tramos (+ 1 child node under a tramo, used to
    verify the "root node only" rejection)
  - PUT /api/projects/{pid}/resource_logs upserts (create + overwrite same
    day/node, never duplicates)
  - 400 when node_id is not a root node
  - GET /api/projects/{pid}/resource_logs/{node_id} returns null when there's
    no log yet for the requested day
  - GET /api/projects/{pid}/resource_logs/summary aggregates totals across
    tramos correctly (total_personal, total_maquinaria, maquinaria_activa)
  - Sub-coordinador scoping: can upsert their own tramo, 403 on another tramo
"""
import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import dotenv_values

_FRONT_ENV = dotenv_values(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = (
    _FRONT_ENV.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "gabriel@synco.mx"
ADMIN_PASSWORD = "SynCo2026!Coord"
TIMEOUT = 30


# ============================================================================
# Fixtures
# ============================================================================
@pytest.fixture(scope="session")
def admin_headers() -> dict:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    tok = r.json()["token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def project_id(admin_headers) -> str:
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"TEST_CorteCaja_{suffix}",
        "constructora": "TEST_Constructora",
        "contract_number": f"TEST-{suffix}",
        "description": "Corte de caja diario e2e test",
    }
    r = requests.post(f"{API}/projects", headers=admin_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, f"Project create failed: {r.status_code} {r.text}"
    pid = r.json()["id"]
    yield pid
    try:
        requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=TIMEOUT)
    except Exception:
        pass


@pytest.fixture(scope="session")
def tree(project_id, admin_headers):
    """Tramo A (root) -> Subtramo (child, non-root, used for 400 test)
       Tramo B (root)"""
    def _create(name, parent_id=None, is_leaf=False, mt=None, order=0):
        payload = {
            "project_id": project_id,
            "parent_id": parent_id,
            "name": name,
            "order": order,
            "is_leaf": is_leaf,
            "measurement_type": mt,
        }
        r = requests.post(
            f"{API}/projects/{project_id}/nodes",
            headers=admin_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"Node '{name}' create failed: {r.status_code} {r.text}"
        return r.json()["id"]

    tramo_a = _create("Tramo A")
    subtramo_a = _create("Subtramo A.1", parent_id=tramo_a, is_leaf=True, mt="cadenamiento")
    tramo_b = _create("Tramo B", order=1)

    return {"tramo_a": tramo_a, "subtramo_a": subtramo_a, "tramo_b": tramo_b}


@pytest.fixture(scope="session")
def subcoord_auth(project_id, admin_headers, tree):
    """Invite + accept a sub-coordinador scoped to Tramo A."""
    suffix = uuid.uuid4().hex[:6]
    email = f"test_subcoord_{suffix}@example.com"
    inv_payload = {
        "project_id": project_id,
        "email": email,
        "name": "Sub Coordinador de Prueba",
        "role": "sub_coordinador",
        "scope_node_id": tree["tramo_a"],
    }
    r = requests.post(
        f"{API}/projects/{project_id}/invitations",
        headers=admin_headers,
        json=inv_payload,
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Invitation create failed: {r.status_code} {r.text}"
    inv = r.json()

    ra = requests.post(
        f"{API}/invitations/accept",
        json={"token": inv["token"], "password": "SubCoord2026!"},
        timeout=TIMEOUT,
    )
    assert ra.status_code == 200, f"Accept-invite failed: {ra.status_code} {ra.text}"
    data = ra.json()
    headers = {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"}
    return {"token": data["token"], "user": data["user"], "headers": headers}


# ============================================================================
# Tests
# ============================================================================
class TestSetup:
    def test_admin_login(self, admin_headers):
        assert "Authorization" in admin_headers

    def test_project_created(self, project_id):
        assert isinstance(project_id, str) and len(project_id) > 10

    def test_tree_built(self, tree):
        assert tree["tramo_a"] != tree["tramo_b"]
        assert tree["subtramo_a"]


class TestUpsert:
    def test_upsert_creates_log(self, project_id, tree, admin_headers):
        payload = {
            "node_id": tree["tramo_a"],
            "personal": [{"rol": "Topografo", "cantidad": 5}, {"rol": "Cadenero", "cantidad": 2}],
            "maquinaria": [{"equipo": "Retro CAT 320", "cantidad": 2, "estado": "activo"}],
        }
        r = requests.put(
            f"{API}/projects/{project_id}/resource_logs",
            headers=admin_headers, json=payload, timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        doc = r.json()
        assert doc["node_id"] == tree["tramo_a"]
        assert doc["node_name"] == "Tramo A"
        assert len(doc["personal"]) == 2
        assert doc["maquinaria"][0]["cantidad"] == 2
        assert "_id" not in doc
        assert doc["fecha_cdmx"]
        pytest.tramo_a_fecha = doc["fecha_cdmx"]

    def test_upsert_overwrites_same_day(self, project_id, tree, admin_headers):
        payload = {
            "node_id": tree["tramo_a"],
            "personal": [{"rol": "Topografo", "cantidad": 9}],
            "maquinaria": [],
        }
        r = requests.put(
            f"{API}/projects/{project_id}/resource_logs",
            headers=admin_headers, json=payload, timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert len(doc["personal"]) == 1
        assert doc["personal"][0]["cantidad"] == 9
        assert doc["maquinaria"] == []

        # Confirm it replaced (not duplicated) via the single-day GET.
        g = requests.get(
            f"{API}/projects/{project_id}/resource_logs/{tree['tramo_a']}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert g.status_code == 200, g.text
        got = g.json()
        assert got is not None
        assert len(got["personal"]) == 1
        assert got["personal"][0]["cantidad"] == 9

    def test_upsert_rejects_non_root_node(self, project_id, tree, admin_headers):
        payload = {
            "node_id": tree["subtramo_a"],
            "personal": [{"rol": "Topografo", "cantidad": 1}],
            "maquinaria": [],
        }
        r = requests.put(
            f"{API}/projects/{project_id}/resource_logs",
            headers=admin_headers, json=payload, timeout=TIMEOUT,
        )
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"

    def test_get_missing_log_returns_null(self, project_id, tree, admin_headers):
        r = requests.get(
            f"{API}/projects/{project_id}/resource_logs/{tree['tramo_b']}",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        assert r.json() is None


class TestSummary:
    def test_summary_aggregates_across_tramos(self, project_id, tree, admin_headers):
        # Tramo A already has personal=[Topografo:9], maquinaria=[] (from TestUpsert).
        # Now log Tramo B too.
        payload = {
            "node_id": tree["tramo_b"],
            "personal": [{"rol": "Topografo", "cantidad": 3}, {"rol": "Cadenero", "cantidad": 1}],
            "maquinaria": [
                {"equipo": "Retro CAT 320", "cantidad": 1, "estado": "activo"},
                {"equipo": "Compactadora", "cantidad": 1, "estado": "mantenimiento"},
            ],
        }
        r = requests.put(
            f"{API}/projects/{project_id}/resource_logs",
            headers=admin_headers, json=payload, timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

        s = requests.get(
            f"{API}/projects/{project_id}/resource_logs/summary",
            headers=admin_headers, timeout=TIMEOUT,
        )
        assert s.status_code == 200, s.text
        summary = s.json()
        # total_personal = 9 (Tramo A) + 3 + 1 (Tramo B) = 13
        assert summary["total_personal"] == 13
        # total_maquinaria = 0 (Tramo A) + 1 + 1 (Tramo B) = 2
        assert summary["total_maquinaria"] == 2
        # maquinaria_activa = only the "activo" Retro CAT 320 (1)
        assert summary["maquinaria_activa"] == 1
        assert summary["tramos_reportados"] == 2
        assert summary["tramos_totales"] == 2
        by_rol = {r["rol"]: r["cantidad"] for r in summary["by_rol"]}
        assert by_rol["Topografo"] == 12  # 9 + 3
        assert by_rol["Cadenero"] == 1
        by_equipo = {e["equipo"]: e for e in summary["by_equipo"]}
        assert by_equipo["Retro CAT 320"]["cantidad"] == 1
        assert by_equipo["Retro CAT 320"]["activo"] == 1
        assert by_equipo["Compactadora"]["activo"] == 0


class TestSubcoordScope:
    def test_subcoord_can_upsert_own_tramo(self, project_id, tree, subcoord_auth):
        payload = {
            "node_id": tree["tramo_a"],
            "personal": [{"rol": "Topografo", "cantidad": 4}],
            "maquinaria": [],
        }
        r = requests.put(
            f"{API}/projects/{project_id}/resource_logs",
            headers=subcoord_auth["headers"], json=payload, timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"

    def test_subcoord_rejected_on_other_tramo(self, project_id, tree, subcoord_auth):
        payload = {
            "node_id": tree["tramo_b"],
            "personal": [{"rol": "Topografo", "cantidad": 1}],
            "maquinaria": [],
        }
        r = requests.put(
            f"{API}/projects/{project_id}/resource_logs",
            headers=subcoord_auth["headers"], json=payload, timeout=TIMEOUT,
        )
        assert r.status_code == 403, f"Expected 403 got {r.status_code}: {r.text}"
