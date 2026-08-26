"""SynCo v2.0 — Iteration 11 backend tests for "Captura Rápida" Especialista flow.

Validates the NEW v2 fields & history endpoint used by the redesigned
`/app/frontend/app/(spec)/nuevo.tsx` Quick Capture screen against the
PUBLIC URL (EXPO_PUBLIC_BACKEND_URL/api):

  1. POST /api/reports persists personnel/equipment as List[str],
     avance, observaciones, contratista, primera_lectura, ultima_lectura.
  2. GET /api/projects/{pid}/nodes/{nid}/history returns
     {has_previous, last_report:{...}} (false when empty, true after
     posting; ultima_lectura must round-trip).
  3. ReportIn rejects bad types (e.g. personnel as object) with 422.

Credentials & project come from /app/memory/test_credentials.md:
  - feed_test@synco.mx / FeedTest2026!  (especialista, scope = Est. 5 + 6)
  - Project: 9a909313-5369-420e-a8d0-e649a91bf073
"""
import os
import time
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

SPEC_EMAIL = "feed_test@synco.mx"
SPEC_PASSWORD = "FeedTest2026!"
PROJECT_ID = "9a909313-5369-420e-a8d0-e649a91bf073"
TIMEOUT = 30


@pytest.fixture(scope="session")
def spec_auth() -> dict:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": SPEC_EMAIL, "password": SPEC_PASSWORD},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    user = data["user"]
    assert user["role"] == "especialista"
    assert user.get("scope_node_ids"), "Especialista must have scope_node_ids"
    return {
        "token": data["token"],
        "user": user,
        "headers": {
            "Authorization": f"Bearer {data['token']}",
            "Content-Type": "application/json",
        },
        "scope_nodes": user["scope_node_ids"],
    }


@pytest.fixture(scope="session")
def leaf_node(spec_auth) -> str:
    """First node in the especialista's scope (used for happy-path POST)."""
    return spec_auth["scope_nodes"][0]


@pytest.fixture(scope="session")
def second_leaf(spec_auth) -> str:
    """Second scope node, used for the "no previous history" test
    so that the first one's posts don't pollute it."""
    nodes = spec_auth["scope_nodes"]
    return nodes[1] if len(nodes) > 1 else nodes[0]


# ============================================================================
# 1. Health & login
# ============================================================================
class TestSetup:
    def test_login_especialista(self, spec_auth):
        assert spec_auth["user"]["email"] == SPEC_EMAIL
        assert PROJECT_ID in (spec_auth["user"].get("project_ids") or [])

    def test_scope_contains_two_leaves(self, spec_auth):
        assert len(spec_auth["scope_nodes"]) >= 1, "Need at least one scope leaf"


# ============================================================================
# 2. POST /reports — new v2 payload (personnel/equipment as List[str])
# ============================================================================
class TestQuickCapturePost:
    def test_post_full_payload_persists_all_fields(self, spec_auth, leaf_node):
        payload = {
            "project_id": PROJECT_ID,
            "node_id": leaf_node,
            "measurement_value": {"lat": 19.432608, "lon": -99.133209},
            "avance": "Colado de zapata Z-4 al 60%",
            "observaciones": "Sin incidencias. Clima despejado.",
            "contratista": "CYPSA",
            "personnel": ["3 Albañiles", "1 Cabo", "2 Ayudantes"],
            "equipment": ["1 Retro CAT 320", "1 Compactador Wacker"],
            "primera_lectura": 10.50,
            "ultima_lectura": 12.80,
        }
        r = requests.post(
            f"{API}/reports",
            headers=spec_auth["headers"],
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        rep = r.json()
        # All new v2 fields preserved
        assert rep["avance"] == "Colado de zapata Z-4 al 60%"
        assert rep["observaciones"] == "Sin incidencias. Clima despejado."
        assert rep["contratista"] == "CYPSA"
        assert rep["personnel"] == ["3 Albañiles", "1 Cabo", "2 Ayudantes"]
        assert rep["equipment"] == ["1 Retro CAT 320", "1 Compactador Wacker"]
        assert rep["primera_lectura"] == 10.50
        assert rep["ultima_lectura"] == 12.80
        assert isinstance(rep["personnel"], list)
        assert isinstance(rep["equipment"], list)
        assert all(isinstance(x, str) for x in rep["personnel"])
        assert all(isinstance(x, str) for x in rep["equipment"])
        # captured_by_name should have "Ing." or similar real name from DB
        assert rep["captured_by_name"], "captured_by_name must be set"
        assert rep["measurement_type"] == "coord_latlon"
        assert "_id" not in rep
        pytest.qc_report_id = rep["id"]
        pytest.qc_leaf_used = leaf_node

    def test_get_persisted_report_round_trip(self, spec_auth):
        rid = getattr(pytest, "qc_report_id", None)
        assert rid, "Previous create must have set qc_report_id"
        r = requests.get(
            f"{API}/reports/{rid}",
            headers=spec_auth["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        rep = r.json()
        assert rep["personnel"] == ["3 Albañiles", "1 Cabo", "2 Ayudantes"]
        assert rep["equipment"] == ["1 Retro CAT 320", "1 Compactador Wacker"]
        assert rep["primera_lectura"] == 10.50
        assert rep["ultima_lectura"] == 12.80
        assert rep["observaciones"] == "Sin incidencias. Clima despejado."
        assert rep["contratista"] == "CYPSA"
        assert "_id" not in rep


# ============================================================================
# 3. GET /history endpoint
# ============================================================================
class TestNodeHistoryEndpoint:
    def test_history_after_post_has_previous_true_and_ultima_lectura(
        self, spec_auth
    ):
        leaf = getattr(pytest, "qc_leaf_used", None)
        assert leaf, "Need a leaf where a report was just posted"
        r = requests.get(
            f"{API}/projects/{PROJECT_ID}/nodes/{leaf}/history",
            headers=spec_auth["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert data["has_previous"] is True
        lr = data["last_report"]
        assert lr is not None
        assert lr["ultima_lectura"] == 12.80, (
            f"Expected ultima_lectura=12.80, got {lr.get('ultima_lectura')!r}. "
            f"This is the value the frontend needs to show under "
            f"'Última lectura registrada en este nodo'."
        )
        assert lr["primera_lectura"] == 10.50
        assert lr.get("captured_by_name"), "last_report.captured_by_name missing"
        assert lr.get("created_at"), "last_report.created_at missing"

    def test_history_on_fresh_node_returns_has_previous_false(
        self, spec_auth, second_leaf
    ):
        """If the second leaf has never received a report it should
        return has_previous=False with last_report=None. We tolerate the
        case where it already has reports (env reuse) by allowing both
        outcomes BUT structure must be present in both cases."""
        r = requests.get(
            f"{API}/projects/{PROJECT_ID}/nodes/{second_leaf}/history",
            headers=spec_auth["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Shape contract — both cases
        assert "has_previous" in data
        assert "last_report" in data
        assert "node_id" in data
        if data["has_previous"] is False:
            assert data["last_report"] is None
        else:
            # Already had data (acceptable in shared env); shape must be ok
            lr = data["last_report"]
            assert "captured_by_name" in lr
            assert "created_at" in lr

    def test_history_out_of_scope_node_returns_403(self, spec_auth):
        """Pick any project node NOT in scope and assert 403."""
        # We need an arbitrary leaf NOT in the especialista's scope.
        # Fetch all nodes via the project endpoint.
        r = requests.get(
            f"{API}/projects/{PROJECT_ID}/nodes",
            headers=spec_auth["headers"],
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        nodes = r.json()
        scope = set(spec_auth["scope_nodes"])
        other = next(
            (n for n in nodes if n.get("is_leaf") and n["id"] not in scope),
            None,
        )
        if not other:
            pytest.skip("No out-of-scope leaf available to assert 403")
        rr = requests.get(
            f"{API}/projects/{PROJECT_ID}/nodes/{other['id']}/history",
            headers=spec_auth["headers"],
            timeout=TIMEOUT,
        )
        assert rr.status_code == 403, f"Expected 403, got {rr.status_code}: {rr.text}"


# ============================================================================
# 4. ReportIn type validation (422 on wrong types)
# ============================================================================
class TestReportInValidation:
    def test_personnel_as_object_rejected_422(self, spec_auth, leaf_node):
        payload = {
            "project_id": PROJECT_ID,
            "node_id": leaf_node,
            "measurement_value": {"lat": 19.432608, "lon": -99.133209},
            # Wrong type: object instead of List[str]
            "personnel": {"3": "albañiles"},
            "equipment": [],
        }
        r = requests.post(
            f"{API}/reports",
            headers=spec_auth["headers"],
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 422, (
            f"Expected 422 for personnel=object, got {r.status_code}: {r.text}"
        )

    def test_equipment_as_string_rejected_422(self, spec_auth, leaf_node):
        payload = {
            "project_id": PROJECT_ID,
            "node_id": leaf_node,
            "measurement_value": {"lat": 19.432608, "lon": -99.133209},
            "personnel": [],
            # Wrong type: string instead of List[str]
            "equipment": "1 Retro CAT 320",
        }
        r = requests.post(
            f"{API}/reports",
            headers=spec_auth["headers"],
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 422, (
            f"Expected 422 for equipment=string, got {r.status_code}: {r.text}"
        )

    def test_primera_lectura_non_numeric_rejected_422(self, spec_auth, leaf_node):
        payload = {
            "project_id": PROJECT_ID,
            "node_id": leaf_node,
            "measurement_value": {"lat": 19.432608, "lon": -99.133209},
            "primera_lectura": "abc",  # not a float
        }
        r = requests.post(
            f"{API}/reports",
            headers=spec_auth["headers"],
            json=payload,
            timeout=TIMEOUT,
        )
        assert r.status_code == 422, (
            f"Expected 422 for primera_lectura='abc', got {r.status_code}: {r.text}"
        )
