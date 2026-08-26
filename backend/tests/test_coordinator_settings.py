"""Backend tests for Coordinator Settings tab:
- GET/PUT /api/site-config (role-protected)
- GET/POST/DELETE /api/reference-points (role-protected)
- GET /api/areas (5 seeded)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
API = BASE_URL + "/api"

COORD_EMAIL = "coordinador@syncsite.com"
ESP_EMAIL = "geotecnia@syncsite.com"
PASSWORD = "demo1234"


# --- fixtures ----------------------------------------------------------------
@pytest.fixture(scope="module")
def coord_token():
    r = requests.post(f"{API}/auth/login", json={"email": COORD_EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"coord login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def esp_token():
    r = requests.post(f"{API}/auth/login", json={"email": ESP_EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"esp login failed: {r.text}"
    return r.json()["token"]


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# --- /api/areas -------------------------------------------------------------
class TestAreas:
    def test_list_areas_seeded(self, coord_token):
        r = requests.get(f"{API}/areas", headers=auth(coord_token), timeout=15)
        assert r.status_code == 200
        areas = r.json()
        assert isinstance(areas, list)
        ids = {a["id"] for a in areas}
        # 5 seeded areas
        expected = {"geotecnia", "topografia", "obracivil", "seguridad", "calidad"}
        assert expected.issubset(ids), f"Missing seeded areas. got={ids}"
        assert len(areas) >= 5

    def test_list_areas_requires_auth(self):
        r = requests.get(f"{API}/areas", timeout=15)
        assert r.status_code == 401


# --- /api/site-config -------------------------------------------------------
class TestSiteConfig:
    def test_get_site_config_schema(self, coord_token):
        r = requests.get(f"{API}/site-config", headers=auth(coord_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        # required schema keys
        for key in ("contract", "contractor", "updatedAt", "updatedBy"):
            assert key in data, f"missing key {key} in {data}"
        # types
        assert isinstance(data["contract"], str)
        assert isinstance(data["contractor"], str)

    def test_get_site_config_especialista_allowed(self, esp_token):
        # GET should be allowed for any authenticated user
        r = requests.get(f"{API}/site-config", headers=auth(esp_token), timeout=15)
        assert r.status_code == 200

    def test_get_site_config_requires_auth(self):
        r = requests.get(f"{API}/site-config", timeout=15)
        assert r.status_code == 401

    def test_put_site_config_coordinador_persists(self, coord_token):
        new_contract = f"TEST_C-{uuid.uuid4().hex[:6]}"
        new_contractor = f"TEST_Contratista-{uuid.uuid4().hex[:6]}"
        r = requests.put(
            f"{API}/site-config",
            headers=auth(coord_token),
            json={"contract": new_contract, "contractor": new_contractor},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["contract"] == new_contract
        assert body["contractor"] == new_contractor
        assert body["updatedAt"]
        # updatedBy is the user's name (Carlos Coordinador)
        assert body["updatedBy"]

        # Verify GET returns same values
        r2 = requests.get(f"{API}/site-config", headers=auth(coord_token), timeout=15)
        assert r2.status_code == 200
        got = r2.json()
        assert got["contract"] == new_contract
        assert got["contractor"] == new_contractor
        assert got["updatedAt"] == body["updatedAt"]

    def test_put_site_config_especialista_forbidden(self, esp_token):
        r = requests.put(
            f"{API}/site-config",
            headers=auth(esp_token),
            json={"contract": "X", "contractor": "Y"},
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_put_site_config_requires_auth(self):
        r = requests.put(f"{API}/site-config", json={"contract": "x", "contractor": "y"}, timeout=15)
        assert r.status_code == 401


# --- /api/reference-points --------------------------------------------------
class TestReferencePoints:
    created_ids: list = []

    def test_create_global_point_coordinador(self, coord_token):
        name = f"TEST_Punto_Global_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/reference-points",
            headers=auth(coord_token),
            json={
                "name": name,
                "location": "Km 0+000",
                "coordinates": "10.0,-74.0",
                "area": None,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == name
        assert data["area"] is None
        assert data["areaName"] == "Global"
        assert data["location"] == "Km 0+000"
        assert data["coordinates"] == "10.0,-74.0"
        assert "id" in data and data["id"]
        assert data["createdByName"]
        TestReferencePoints.created_ids.append(data["id"])

    def test_create_area_point_coordinador(self, coord_token):
        name = f"TEST_Punto_Geo_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/reference-points",
            headers=auth(coord_token),
            json={
                "name": name,
                "location": "Km 1+200",
                "coordinates": "10.1,-74.1",
                "area": "geotecnia",
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["area"] == "geotecnia"
        assert data["areaName"] == "Geotecnia"
        TestReferencePoints.created_ids.append(data["id"])

    def test_create_point_invalid_area(self, coord_token):
        r = requests.post(
            f"{API}/reference-points",
            headers=auth(coord_token),
            json={"name": f"TEST_x_{uuid.uuid4().hex[:6]}", "area": "no-existe"},
            timeout=15,
        )
        assert r.status_code == 400

    def test_create_point_duplicate(self, coord_token):
        name = f"TEST_Dup_{uuid.uuid4().hex[:6]}"
        payload = {"name": name, "area": None}
        r1 = requests.post(f"{API}/reference-points", headers=auth(coord_token), json=payload, timeout=15)
        assert r1.status_code == 200
        TestReferencePoints.created_ids.append(r1.json()["id"])
        r2 = requests.post(f"{API}/reference-points", headers=auth(coord_token), json=payload, timeout=15)
        assert r2.status_code == 400, f"expected 400 dup, got {r2.status_code}"

    def test_create_point_empty_name(self, coord_token):
        r = requests.post(
            f"{API}/reference-points", headers=auth(coord_token), json={"name": "   "}, timeout=15
        )
        assert r.status_code == 400

    def test_list_points_coordinador_sees_all(self, coord_token):
        r = requests.get(f"{API}/reference-points", headers=auth(coord_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        ids = {p["id"] for p in data}
        # Created in earlier tests should appear
        for cid in TestReferencePoints.created_ids:
            assert cid in ids, f"point {cid} missing from coord list"
        # check schema
        sample = data[0]
        for key in ("id", "name", "area", "areaName", "createdBy", "createdByName", "createdAt"):
            assert key in sample

    def test_list_points_especialista_filtered(self, esp_token, coord_token):
        # Create a point in 'topografia' area (esp is in geotecnia) — should NOT be visible to esp
        topo_name = f"TEST_TopoOnly_{uuid.uuid4().hex[:6]}"
        rc = requests.post(
            f"{API}/reference-points",
            headers=auth(coord_token),
            json={"name": topo_name, "area": "topografia"},
            timeout=15,
        )
        assert rc.status_code == 200
        topo_id = rc.json()["id"]
        TestReferencePoints.created_ids.append(topo_id)

        r = requests.get(f"{API}/reference-points", headers=auth(esp_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        ids = {p["id"] for p in data}
        # Esp must NOT see topografia-only point
        assert topo_id not in ids, "Especialista de geotecnia no debería ver puntos de topografía"
        # All visible items: area is None or 'geotecnia'
        for p in data:
            assert p["area"] in (None, "geotecnia"), f"unexpected area {p['area']} for esp geo"

    def test_create_point_especialista_forced_to_own_area(self, esp_token):
        # Especialista should be able to create; backend forces area to their own
        name = f"TEST_EspGeo_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/reference-points",
            headers=auth(esp_token),
            json={"name": name, "area": None},  # tries global but should be coerced
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["area"] == "geotecnia"
        TestReferencePoints.created_ids.append(data["id"])

    def test_delete_point_coordinador(self, coord_token):
        # Use the first created point
        if not TestReferencePoints.created_ids:
            pytest.skip("no created points")
        pid = TestReferencePoints.created_ids[0]
        r = requests.delete(f"{API}/reference-points/{pid}", headers=auth(coord_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify GET no longer includes it
        r2 = requests.get(f"{API}/reference-points", headers=auth(coord_token), timeout=15)
        ids = {p["id"] for p in r2.json()}
        assert pid not in ids
        TestReferencePoints.created_ids.remove(pid)

    def test_delete_point_not_found(self, coord_token):
        r = requests.delete(f"{API}/reference-points/non-existent-id", headers=auth(coord_token), timeout=15)
        assert r.status_code == 404

    def test_delete_point_especialista_others_forbidden(self, esp_token, coord_token):
        # Create a coord-owned point, then try to delete with esp
        name = f"TEST_CoordOwned_{uuid.uuid4().hex[:6]}"
        rc = requests.post(
            f"{API}/reference-points",
            headers=auth(coord_token),
            json={"name": name, "area": None},
            timeout=15,
        )
        assert rc.status_code == 200
        pid = rc.json()["id"]
        TestReferencePoints.created_ids.append(pid)

        r = requests.delete(f"{API}/reference-points/{pid}", headers=auth(esp_token), timeout=15)
        assert r.status_code == 403

    def test_list_requires_auth(self):
        r = requests.get(f"{API}/reference-points", timeout=15)
        assert r.status_code == 401


# --- cleanup ----------------------------------------------------------------
@pytest.fixture(scope="module", autouse=True)
def cleanup(request, coord_token):
    yield
    # Delete every TEST_ point created
    for pid in list(TestReferencePoints.created_ids):
        try:
            requests.delete(f"{API}/reference-points/{pid}", headers=auth(coord_token), timeout=10)
        except Exception:
            pass
