"""SynCo v2.0 — Backend end-to-end test for the Especialista flow + Reports.

Covers iteration 10 review request:
  - Coordinador General login
  - Create project + 2-level node tree (cadenamiento leaf + coord_latlon leaf in another branch)
  - Create area "Topografía"
  - POST /api/projects/{pid}/invitations (role=especialista, scope_node_ids=[2 leaves], area_id, puesto)
  - POST /api/invitations/accept  (note: review mentioned /api/auth/accept-invite, actual endpoint is /api/invitations/accept)
  - With especialista token: POST /api/reports including NEW fields avance + contratista
  - Verify response carries avance, contratista, personnel, equipment, images, area_name, node_path_names, measurement_type
  - GET /api/projects/{pid}/reports as especialista → only scoped reports
  - 403 when posting on node OUTSIDE scope
  - 400 when posting on NON-leaf node
  - 400 when measurement_value is invalid
  - Mongo persistence check via GET /api/reports/{rid}
"""
import os
import uuid
import base64
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

# 1x1 transparent PNG
B64_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAarVyFEAAAAASUVORK5CYII="
)


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
        "name": f"TEST_EspFlow_{suffix}",
        "constructora": "TEST_Constructora",
        "contract_number": f"TEST-{suffix}",
        "start_date": "2026-01-15",
        "end_date": "2026-12-31",
        "description": "End-to-end especialista flow test",
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
    """Build tree:
        - Tramo 1 (root)
            └── Estación 02+450 (leaf, cadenamiento) → hoja1
        - Frente B (root)
            └── PR-Geo (leaf, coord_latlon)            → hoja2
        - Otra Rama (root)
            └── Estación 03+200 (leaf, cadenamiento)   → OUT_OF_SCOPE
            └── Intermedio (non-leaf, with subchild)   → NON_LEAF + extra child
    """
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

    root1 = _create("Tramo 1")
    hoja1 = _create("Estación 02+450", parent_id=root1, is_leaf=True, mt="cadenamiento")

    root2 = _create("Frente B", order=1)
    hoja2 = _create("PR-Geo", parent_id=root2, is_leaf=True, mt="coord_latlon")

    root3 = _create("Otra Rama", order=2)
    out_of_scope = _create("Estación 03+200", parent_id=root3, is_leaf=True, mt="cadenamiento")
    intermedio = _create("Intermedio", parent_id=root3)
    # add child so intermedio stays non-leaf
    _create("Sub", parent_id=intermedio, is_leaf=True, mt="nivel")

    return {
        "root1": root1,
        "hoja1": hoja1,
        "root2": root2,
        "hoja2": hoja2,
        "root3": root3,
        "out_of_scope_leaf": out_of_scope,
        "non_leaf_node": intermedio,
    }


@pytest.fixture(scope="session")
def topografia_area(project_id, admin_headers):
    r = requests.post(
        f"{API}/projects/{project_id}/areas",
        headers=admin_headers,
        json={"project_id": project_id, "name": "Topografía", "color": "#1E40AF"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Area create failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def especialista_auth(project_id, admin_headers, tree, topografia_area):
    """Create invitation + accept it, return (token, user) for especialista."""
    suffix = uuid.uuid4().hex[:6]
    email = f"test_topografo_{suffix}@example.com"
    name = "Topógrafo de Prueba"

    inv_payload = {
        "project_id": project_id,
        "email": email,
        "name": name,
        "role": "especialista",
        "area_id": topografia_area["id"],
        "puesto": "Topógrafo Senior",
        "scope_node_ids": [tree["hoja1"], tree["hoja2"]],
    }
    r = requests.post(
        f"{API}/projects/{project_id}/invitations",
        headers=admin_headers,
        json=inv_payload,
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Invitation create failed: {r.status_code} {r.text}"
    inv = r.json()
    assert inv["role"] == "especialista"
    assert inv["puesto"] == "Topógrafo Senior"
    assert inv["status"] == "pending"
    assert sorted(inv["scope_node_ids"]) == sorted([tree["hoja1"], tree["hoja2"]])

    # Accept invite (real endpoint is /invitations/accept; review request mentioned
    # /auth/accept-invite — see report notes).
    ra = requests.post(
        f"{API}/invitations/accept",
        json={"token": inv["token"], "password": "Esp2026!"},
        timeout=TIMEOUT,
    )
    assert ra.status_code == 200, f"Accept-invite failed: {ra.status_code} {ra.text}"
    data = ra.json()
    assert "token" in data and "user" in data
    user = data["user"]
    assert user["role"] == "especialista"
    assert user["area"] == "Topografía", f"area mismatch: {user.get('area')}"
    assert user["puesto"] == "Topógrafo Senior"
    assert sorted(user["scope_node_ids"]) == sorted([tree["hoja1"], tree["hoja2"]])

    headers = {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"}
    return {"token": data["token"], "user": user, "headers": headers, "email": email}


# ============================================================================
# Tests
# ============================================================================
class TestEspecialistaInvitationFlow:
    """Steps 1-7: login → project → tree → area → invitation → accept."""

    def test_admin_login(self, admin_headers):
        # The fixture itself proves login works.
        assert "Authorization" in admin_headers

    def test_project_created(self, project_id):
        assert isinstance(project_id, str) and len(project_id) > 10

    def test_tree_built(self, tree):
        assert tree["hoja1"] != tree["hoja2"]
        assert tree["non_leaf_node"]
        assert tree["out_of_scope_leaf"]

    def test_area_topografia_created(self, topografia_area):
        assert topografia_area["name"] == "Topografía"

    def test_invitation_and_accept(self, especialista_auth, tree):
        u = especialista_auth["user"]
        assert u["role"] == "especialista"
        assert u["area"] == "Topografía"
        assert u["puesto"] == "Topógrafo Senior"
        assert sorted(u["scope_node_ids"]) == sorted([tree["hoja1"], tree["hoja2"]])


class TestEspecialistaReports:
    """Step 8: POST /api/reports with new avance + contratista fields."""

    def test_create_report_with_new_fields(
        self, project_id, tree, especialista_auth
    ):
        payload = {
            "project_id": project_id,
            "node_id": tree["hoja1"],
            "measurement_value": {"cadenamiento": "5+100"},
            "avance": "Colado de zapata Z-4 al 60%",
            "contratista": "CYPSA",
            "personnel": ["3 albañiles, 1 cabo"],
            "equipment": ["Retro CAT 320"],
            "images": [B64_PNG],
        }
        r = requests.post(
            f"{API}/reports",
            headers=especialista_auth["headers"],
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        rep = r.json()
        assert rep["avance"] == "Colado de zapata Z-4 al 60%"
        assert rep["contratista"] == "CYPSA"
        assert rep["personnel"] == ["3 albañiles, 1 cabo"]
        assert rep["equipment"] == ["Retro CAT 320"]
        assert len(rep["images"]) == 1
        assert rep["images"][0] == B64_PNG, "base64 image was transformed"
        assert rep["area_name"] == "Topografía"
        assert rep["node_path_names"] == ["Tramo 1", "Estación 02+450"]
        assert rep["measurement_type"] == "cadenamiento"
        assert rep["measurement_value"] == {"cadenamiento": "5+100"}
        assert rep["captured_by_name"] == "Topógrafo de Prueba"
        assert "_id" not in rep
        pytest.created_report_id = rep["id"]

    def test_get_single_report_persists_avance_contratista(
        self, especialista_auth
    ):
        rid = getattr(pytest, "created_report_id", None)
        assert rid, "Report was not created in previous step"
        r = requests.get(
            f"{API}/reports/{rid}",
            headers=especialista_auth["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        rep = r.json()
        # Mongo persistence verification
        assert rep["avance"] == "Colado de zapata Z-4 al 60%"
        assert rep["contratista"] == "CYPSA"
        assert rep["images"][0] == B64_PNG
        assert "_id" not in rep

    def test_list_reports_only_returns_scoped(
        self, project_id, tree, especialista_auth, admin_headers
    ):
        """Especialista must only see reports inside scope_node_ids."""
        # Admin creates a report on out_of_scope leaf (coord general can)
        out_payload = {
            "project_id": project_id,
            "node_id": tree["out_of_scope_leaf"],
            "measurement_value": {"cadenamiento": "10+000"},
            "avance": "Reporte fuera de scope",
        }
        ar = requests.post(
            f"{API}/reports", headers=admin_headers, json=out_payload, timeout=TIMEOUT
        )
        assert ar.status_code == 200, ar.text
        out_rid = ar.json()["id"]

        # Especialista lists reports — should NOT see out_rid
        r = requests.get(
            f"{API}/projects/{project_id}/reports",
            headers=especialista_auth["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        items = r.json()
        ids = [it["id"] for it in items]
        assert getattr(pytest, "created_report_id") in ids, "Own report not in scoped list"
        assert out_rid not in ids, "Especialista saw a report outside their scope"
        # All visible reports must be on scope nodes
        scope = {tree["hoja1"], tree["hoja2"]}
        for it in items:
            assert it["node_id"] in scope, (
                f"Report {it['id']} on node {it['node_id']} leaked outside scope"
            )


class TestEspecialistaRBAC:
    """Step 10: RBAC + validation restrictions."""

    def test_post_report_outside_scope_returns_403(
        self, project_id, tree, especialista_auth
    ):
        payload = {
            "project_id": project_id,
            "node_id": tree["out_of_scope_leaf"],
            "measurement_value": {"cadenamiento": "9+999"},
        }
        r = requests.post(
            f"{API}/reports",
            headers=especialista_auth["headers"],
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 403, f"Expected 403 got {r.status_code}: {r.text}"

    def test_post_report_on_non_leaf_returns_400(
        self, project_id, tree, especialista_auth, admin_headers
    ):
        """Trying to capture on a non-leaf node.

        Note: the especialista's scope is only hoja1/hoja2, so the scope check
        (403) would fire BEFORE the is_leaf check (400). We therefore use the
        ADMIN to verify the is_leaf gate (admin has global access and must
        still get 400 on a non-leaf node).
        """
        payload = {
            "project_id": project_id,
            "node_id": tree["non_leaf_node"],
            "measurement_value": {"cadenamiento": "1+000"},
        }
        r = requests.post(
            f"{API}/reports", headers=admin_headers, json=payload, timeout=TIMEOUT
        )
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"

    def test_post_report_invalid_measurement_returns_400(
        self, project_id, tree, especialista_auth
    ):
        # cadenamiento must match r'^\d+\+\d{1,4}(\.\d+)?$' → 'abc' is invalid
        payload = {
            "project_id": project_id,
            "node_id": tree["hoja1"],
            "measurement_value": {"cadenamiento": "abc"},
        }
        r = requests.post(
            f"{API}/reports",
            headers=especialista_auth["headers"],
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"

    def test_post_report_coord_latlon_in_scope(
        self, project_id, tree, especialista_auth
    ):
        """Sanity: hoja2 is coord_latlon, and IS in scope → must succeed."""
        payload = {
            "project_id": project_id,
            "node_id": tree["hoja2"],
            "measurement_value": {"lat": 19.4326, "lon": -99.1332},
            "avance": "Levantamiento geodésico inicial",
            "contratista": "CYPSA",
        }
        r = requests.post(
            f"{API}/reports",
            headers=especialista_auth["headers"],
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        rep = r.json()
        assert rep["measurement_type"] == "coord_latlon"
        assert rep["measurement_value"] == {"lat": 19.4326, "lon": -99.1332}
        assert rep["node_path_names"] == ["Frente B", "PR-Geo"]
        assert rep["area_name"] == "Topografía"
        assert rep["avance"] == "Levantamiento geodésico inicial"
        assert rep["contratista"] == "CYPSA"
