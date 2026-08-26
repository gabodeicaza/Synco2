"""SynCo v2.0 — Backend tests: Areas, Invitations, Node DELETE cascade.

Covers iteration 9 review request:
  - Areas CRUD (list/create/delete + 409 duplicate, 400 empty name)
  - Invitations CRUD (sub_coordinador, especialista, revoke, by-token preview)
  - Node DELETE cascade (3-level tree, deleted_count correct)
  - Persistence verification via GET after mutation
"""
import os
import re
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import dotenv_values

# Load EXPO_PUBLIC_BACKEND_URL from frontend/.env (the public URL the user sees)
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
def admin_token() -> str:
    """Login as coordinador_general and return the JWT token."""
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    assert data["user"]["role"] == "coordinador_general"
    return data["token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token: str) -> dict:
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def project_id(auth_headers: dict) -> str:
    """Create a dedicated TEST_ project for this run. Archived (DELETE) at end."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"TEST_AreasInv_{suffix}",
        "constructora": "TEST_Constructora",
        "contract_number": f"TEST-{suffix}",
        "start_date": "2026-01-15",
        "end_date": "2026-12-31",
        "description": "Test project for areas/invitations/nodes regression",
    }
    r = requests.post(f"{API}/projects", headers=auth_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, f"Project create failed: {r.status_code} {r.text}"
    pid = r.json()["id"]
    yield pid
    # Teardown: archive the project (best-effort)
    try:
        requests.delete(f"{API}/projects/{pid}", headers=auth_headers, timeout=TIMEOUT)
    except Exception:
        pass


# ============================================================================
# Smoke: health & auth
# ============================================================================
class TestHealth:
    def test_health(self):
        r = requests.get(f"{API}/health", timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json().get("ok") is True or "status" in r.json()

    def test_login_returns_token_and_user(self):
        r = requests.post(
            f"{API}/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["token"], str) and len(d["token"]) > 20
        assert d["user"]["email"] == ADMIN_EMAIL
        assert d["user"]["role"] == "coordinador_general"


# ============================================================================
# Areas CRUD
# ============================================================================
class TestAreas:
    """CRUD for /api/projects/{pid}/areas + DELETE /api/areas/{aid}."""

    def test_list_areas_initially_empty_or_list(self, project_id, auth_headers):
        r = requests.get(f"{API}/projects/{project_id}/areas", headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_create_area_success(self, project_id, auth_headers):
        payload = {"project_id": project_id, "name": "TEST_Topografía", "color": "#FF5733"}
        r = requests.post(
            f"{API}/projects/{project_id}/areas",
            headers=auth_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        area = r.json()
        assert area["name"] == "TEST_Topografía"
        assert area["color"] == "#FF5733"
        assert area["project_id"] == project_id
        assert "id" in area and area["id"]
        assert "_id" not in area  # no Mongo ObjectId leak
        # Persistence: GET list and find it
        rl = requests.get(
            f"{API}/projects/{project_id}/areas", headers=auth_headers, timeout=TIMEOUT
        )
        assert rl.status_code == 200
        ids = [a["id"] for a in rl.json()]
        assert area["id"] in ids, "Created area not persisted in list"
        # Save for later tests
        pytest.area_id_to_delete = area["id"]

    def test_create_area_duplicate_returns_409(self, project_id, auth_headers):
        # Re-POST same name
        payload = {"project_id": project_id, "name": "TEST_Topografía", "color": "#000000"}
        r = requests.post(
            f"{API}/projects/{project_id}/areas",
            headers=auth_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 409, f"Expected 409 got {r.status_code}: {r.text}"

    def test_create_area_empty_name_returns_400(self, project_id, auth_headers):
        payload = {"project_id": project_id, "name": "   ", "color": "#123456"}
        r = requests.post(
            f"{API}/projects/{project_id}/areas",
            headers=auth_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"

    def test_create_area_mismatched_project_id_returns_400(self, project_id, auth_headers):
        payload = {"project_id": "wrong-pid", "name": "TEST_X", "color": "#abcdef"}
        r = requests.post(
            f"{API}/projects/{project_id}/areas",
            headers=auth_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 400

    def test_delete_area_success(self, auth_headers):
        aid = getattr(pytest, "area_id_to_delete", None)
        if not aid:
            pytest.skip("Area not created in earlier step")
        r = requests.delete(f"{API}/areas/{aid}", headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_delete_area_not_found_returns_404(self, auth_headers):
        r = requests.delete(
            f"{API}/areas/non-existent-{uuid.uuid4().hex}",
            headers=auth_headers,
            timeout=TIMEOUT,
        )
        assert r.status_code == 404


# ============================================================================
# Nodes (build a tree to be reused by invitations + DELETE cascade)
# ============================================================================
@pytest.fixture(scope="session")
def node_tree(project_id, auth_headers):
    """Create a 3-level tree:
        root (Frente A)
        ├── child1 (Tramo 1)
        │   ├── leaf1 (PR-001) [leaf, cadenamiento]
        │   └── leaf2 (PR-002) [leaf, cadenamiento]
        └── child2 (Tramo 2)
            └── leaf3 (PR-003) [leaf, eje]
    Returns dict with all ids.
    """
    def _create(name, parent_id=None, is_leaf=False, measurement_type=None, order=0):
        payload = {
            "project_id": project_id,
            "parent_id": parent_id,
            "name": name,
            "order": order,
            "is_leaf": is_leaf,
            "measurement_type": measurement_type,
        }
        r = requests.post(
            f"{API}/projects/{project_id}/nodes",
            headers=auth_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"Node create failed: {r.status_code} {r.text}"
        return r.json()["id"]

    root = _create("TEST_Frente A")
    child1 = _create("TEST_Tramo 1", parent_id=root, order=0)
    child2 = _create("TEST_Tramo 2", parent_id=root, order=1)
    leaf1 = _create("TEST_PR-001", parent_id=child1, is_leaf=True, measurement_type="cadenamiento")
    leaf2 = _create("TEST_PR-002", parent_id=child1, is_leaf=True, measurement_type="cadenamiento")
    leaf3 = _create("TEST_PR-003", parent_id=child2, is_leaf=True, measurement_type="eje")
    return {
        "root": root,
        "child1": child1,
        "child2": child2,
        "leaf1": leaf1,
        "leaf2": leaf2,
        "leaf3": leaf3,
    }


# ============================================================================
# Invitations CRUD
# ============================================================================
class TestInvitations:
    """CRUD for /api/projects/{pid}/invitations + DELETE + by-token preview."""

    def test_list_invitations_returns_list(self, project_id, auth_headers):
        r = requests.get(
            f"{API}/projects/{project_id}/invitations",
            headers=auth_headers,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_sub_coordinador_invitation(self, project_id, auth_headers, node_tree):
        suffix = uuid.uuid4().hex[:6]
        payload = {
            "project_id": project_id,
            "email": f"test_subcoord_{suffix}@example.com",
            "name": "TEST_SubCoord User",
            "role": "sub_coordinador",
            "scope_node_id": node_tree["child1"],
        }
        r = requests.post(
            f"{API}/projects/{project_id}/invitations",
            headers=auth_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        inv = r.json()
        assert inv["role"] == "sub_coordinador"
        assert inv["scope_node_id"] == node_tree["child1"]
        assert inv["status"] == "pending"
        assert inv["project_id"] == project_id
        # Token alphanumeric (urlsafe = [A-Za-z0-9_-])
        tok = inv["token"]
        assert isinstance(tok, str) and len(tok) >= 20
        assert re.fullmatch(r"[A-Za-z0-9_\-]+", tok), f"Token not urlsafe: {tok}"
        assert "_id" not in inv
        pytest.subcoord_invitation = inv

    def test_create_sub_coordinador_missing_scope_returns_400(
        self, project_id, auth_headers
    ):
        suffix = uuid.uuid4().hex[:6]
        payload = {
            "project_id": project_id,
            "email": f"test_subnoscope_{suffix}@example.com",
            "name": "TEST_NoScope",
            "role": "sub_coordinador",
        }
        r = requests.post(
            f"{API}/projects/{project_id}/invitations",
            headers=auth_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 400

    def test_create_especialista_invitation(self, project_id, auth_headers, node_tree):
        # Need a fresh area
        suffix = uuid.uuid4().hex[:6]
        ar = requests.post(
            f"{API}/projects/{project_id}/areas",
            headers=auth_headers,
            json={"project_id": project_id, "name": f"TEST_Area_{suffix}", "color": "#1E40AF"},
            timeout=TIMEOUT,
        )
        assert ar.status_code == 200, ar.text
        area = ar.json()
        pytest.area_for_especialista = area["id"]

        payload = {
            "project_id": project_id,
            "email": f"test_especialista_{suffix}@example.com",
            "name": "TEST_Especialista User",
            "role": "especialista",
            "area_id": area["id"],
            "puesto": "Topógrafo Senior",
            "scope_node_ids": [node_tree["leaf1"], node_tree["leaf2"]],
        }
        r = requests.post(
            f"{API}/projects/{project_id}/invitations",
            headers=auth_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        inv = r.json()
        assert inv["role"] == "especialista"
        assert inv["area_id"] == area["id"]
        assert inv["puesto"] == "Topógrafo Senior"
        assert sorted(inv["scope_node_ids"]) == sorted(
            [node_tree["leaf1"], node_tree["leaf2"]]
        )
        assert inv["status"] == "pending"
        tok = inv["token"]
        assert re.fullmatch(r"[A-Za-z0-9_\-]+", tok)
        pytest.especialista_invitation = inv

    def test_create_especialista_with_non_leaf_returns_400(
        self, project_id, auth_headers, node_tree
    ):
        suffix = uuid.uuid4().hex[:6]
        area_id = getattr(pytest, "area_for_especialista", None)
        assert area_id, "Area for especialista not created"
        payload = {
            "project_id": project_id,
            "email": f"test_esp_nonleaf_{suffix}@example.com",
            "name": "TEST_BadEsp",
            "role": "especialista",
            "area_id": area_id,
            "puesto": "X",
            "scope_node_ids": [node_tree["child1"]],  # internal node, not leaf
        }
        r = requests.post(
            f"{API}/projects/{project_id}/invitations",
            headers=auth_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"

    def test_invitation_by_token_preview_public(self, project_id, auth_headers):
        inv = getattr(pytest, "subcoord_invitation", None)
        assert inv, "sub_coordinador invitation not created"
        # NO auth headers (public endpoint)
        r = requests.get(f"{API}/invitations/by-token/{inv['token']}", timeout=TIMEOUT)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        preview = r.json()
        assert preview["email"] == inv["email"]
        assert preview["name"] == inv["name"]
        assert preview["role"] == "sub_coordinador"
        assert preview["project_name"]  # non-empty

    def test_invitation_by_token_invalid_returns_404(self):
        r = requests.get(f"{API}/invitations/by-token/nonexistent_token_xyz", timeout=TIMEOUT)
        assert r.status_code == 404

    def test_invitation_persisted_in_list(self, project_id, auth_headers):
        inv = getattr(pytest, "subcoord_invitation", None)
        assert inv
        r = requests.get(
            f"{API}/projects/{project_id}/invitations",
            headers=auth_headers,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        ids = [i["id"] for i in r.json()]
        assert inv["id"] in ids

    def test_revoke_invitation(self, auth_headers):
        inv = getattr(pytest, "subcoord_invitation", None)
        assert inv
        r = requests.delete(
            f"{API}/invitations/{inv['id']}", headers=auth_headers, timeout=TIMEOUT
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # by-token should now return 410 (status revoked)
        r2 = requests.get(f"{API}/invitations/by-token/{inv['token']}", timeout=TIMEOUT)
        assert r2.status_code == 410, f"Expected 410 got {r2.status_code}: {r2.text}"

    def test_revoke_already_revoked_returns_404(self, auth_headers):
        inv = getattr(pytest, "subcoord_invitation", None)
        assert inv
        r = requests.delete(
            f"{API}/invitations/{inv['id']}", headers=auth_headers, timeout=TIMEOUT
        )
        assert r.status_code == 404


# ============================================================================
# Node DELETE cascade (regression of bug fix — backend was already correct)
# ============================================================================
class TestNodeDeleteCascade:
    """DELETE /api/nodes/{nid} must delete the node and ALL its descendants."""

    def test_delete_node_cascade(self, project_id, auth_headers):
        """Build a fresh 3-level tree, delete the root, verify cascade."""
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
                headers=auth_headers,
                json=payload,
                timeout=TIMEOUT,
            )
            assert r.status_code == 200, f"{r.status_code} {r.text}"
            return r.json()["id"]

        # Tree: root → child → leaf (3 levels), plus a sibling child with 2 leaves
        root = _create("TEST_DEL_Root")
        child_a = _create("TEST_DEL_ChildA", parent_id=root)
        child_b = _create("TEST_DEL_ChildB", parent_id=root)
        leaf_a1 = _create("TEST_DEL_LeafA1", parent_id=child_a, is_leaf=True, mt="nivel")
        leaf_a2 = _create("TEST_DEL_LeafA2", parent_id=child_a, is_leaf=True, mt="nivel")
        leaf_b1 = _create("TEST_DEL_LeafB1", parent_id=child_b, is_leaf=True, mt="eje")
        # Total = 6 nodes
        all_ids = {root, child_a, child_b, leaf_a1, leaf_a2, leaf_b1}

        # Verify all 6 exist via list
        rl = requests.get(
            f"{API}/projects/{project_id}/nodes", headers=auth_headers, timeout=TIMEOUT
        )
        assert rl.status_code == 200
        listed = {n["id"] for n in rl.json()}
        assert all_ids.issubset(listed), "Tree did not persist before delete"

        # DELETE root
        r = requests.delete(f"{API}/nodes/{root}", headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("deleted_count") == 6, (
            f"Expected deleted_count=6, got {body.get('deleted_count')}. Body: {body}"
        )

        # Verify all 6 are gone
        rl2 = requests.get(
            f"{API}/projects/{project_id}/nodes", headers=auth_headers, timeout=TIMEOUT
        )
        assert rl2.status_code == 200
        listed2 = {n["id"] for n in rl2.json()}
        for nid in all_ids:
            assert nid not in listed2, f"Node {nid} survived cascade delete"

    def test_delete_node_not_found_returns_404(self, auth_headers):
        r = requests.delete(
            f"{API}/nodes/nonexistent-{uuid.uuid4().hex}",
            headers=auth_headers,
            timeout=TIMEOUT,
        )
        assert r.status_code == 404

    def test_delete_leaf_only_deletes_self(self, project_id, auth_headers):
        """Deleting a leaf should report deleted_count=1."""
        # Create standalone leaf
        payload = {
            "project_id": project_id,
            "parent_id": None,
            "name": f"TEST_SoloLeaf_{uuid.uuid4().hex[:6]}",
            "order": 99,
            "is_leaf": True,
            "measurement_type": "coord_latlon",
        }
        r = requests.post(
            f"{API}/projects/{project_id}/nodes",
            headers=auth_headers,
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        nid = r.json()["id"]
        rd = requests.delete(f"{API}/nodes/{nid}", headers=auth_headers, timeout=TIMEOUT)
        assert rd.status_code == 200
        assert rd.json().get("deleted_count") == 1
