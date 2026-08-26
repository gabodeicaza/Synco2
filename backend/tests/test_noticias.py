"""Backend tests for SyncSite Noticias (Activities) feature + period summary AI.

Covers:
- /api/activities (GET/POST/DELETE) role-based filtering & permissions
- /api/ai/period-summary (daily/weekly/monthly, area filter)
- Regression: login, areas list, report creation, daily summary
"""
import os
import time
import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
# Fall back to frontend env file value
if not BASE:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE = line.split("=", 1)[1].strip()
            break
assert BASE, "EXPO_PUBLIC_BACKEND_URL must be set"
API = BASE + "/api"

COORD = ("coordinador@syncsite.com", "demo1234")
ESP_GEO = ("geotecnia@syncsite.com", "demo1234")
ESP_TOPO = ("topografia@syncsite.com", "demo1234")


# --- Helpers ----------------------------------------------------------------
def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def coord_tok():
    return _login(*COORD)["token"]


@pytest.fixture(scope="module")
def esp_geo():
    return _login(*ESP_GEO)


@pytest.fixture(scope="module")
def esp_topo():
    return _login(*ESP_TOPO)


@pytest.fixture(scope="module")
def created_ids():
    """Track all activity IDs created during tests for cleanup."""
    ids = []
    yield ids
    # Cleanup with coordinador
    tok = _login(*COORD)["token"]
    for aid in ids:
        try:
            requests.delete(f"{API}/activities/{aid}", headers=_h(tok), timeout=10)
        except Exception:
            pass


# --- Health -----------------------------------------------------------------
class TestHealth:
    def test_health(self):
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


# --- Auth regression --------------------------------------------------------
class TestAuth:
    def test_login_coord(self):
        d = _login(*COORD)
        assert d["user"]["role"] == "coordinador"
        assert d["token"]

    def test_login_esp(self):
        d = _login(*ESP_GEO)
        assert d["user"]["role"] == "especialista"
        assert d["user"]["area"] == "geotecnia"

    def test_login_bad(self):
        r = requests.post(f"{API}/auth/login", json={"email": "x@y.z", "password": "bad"}, timeout=10)
        assert r.status_code == 401


# --- Areas regression -------------------------------------------------------
class TestAreas:
    def test_list_areas(self, coord_tok):
        r = requests.get(f"{API}/areas", headers=_h(coord_tok), timeout=10)
        assert r.status_code == 200
        data = r.json()
        ids = [a["id"] for a in data]
        for needed in ("geotecnia", "topografia", "obracivil", "seguridad", "calidad"):
            assert needed in ids


# --- Reports regression -----------------------------------------------------
class TestReportsRegression:
    def test_create_and_list_report_esp(self, esp_geo):
        tok = esp_geo["token"]
        payload = {
            "title": "TEST_Reporte_Geotecnia",
            "comments": "Inspección de terreno en zona norte. Suelos estables.",
            "area": "geotecnia",
            "images": [],
        }
        r = requests.post(f"{API}/reports", headers=_h(tok), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        rep = r.json()
        assert rep["area"] == "geotecnia"
        assert rep["createdByRole"] == "especialista"

        # Verify it appears in listing
        r2 = requests.get(f"{API}/reports", headers=_h(tok), timeout=10)
        assert r2.status_code == 200
        assert any(x["id"] == rep["id"] for x in r2.json())


# --- Activities CRUD --------------------------------------------------------
class TestActivities:
    def test_create_activity_coord_global(self, coord_tok, created_ids):
        r = requests.post(
            f"{API}/activities",
            headers=_h(coord_tok),
            json={"title": "TEST_Noticia_Global", "description": "Reunión general 9am", "priority": 2},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["area"] is None
        assert a["areaName"] == "Global"
        assert a["priority"] == 2
        assert a["createdByRole"] == "coordinador"
        created_ids.append(a["id"])

    def test_create_activity_coord_area(self, coord_tok, created_ids):
        r = requests.post(
            f"{API}/activities",
            headers=_h(coord_tok),
            json={"title": "TEST_Noticia_Geo", "description": "Solo geotecnia", "priority": 3, "area": "geotecnia"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["area"] == "geotecnia"
        assert a["priority"] == 3
        created_ids.append(a["id"])

    def test_create_activity_esp_auto_area(self, esp_geo, created_ids):
        # Especialista posting -> area should auto-default to their area even if omitted
        r = requests.post(
            f"{API}/activities",
            headers=_h(esp_geo["token"]),
            json={"title": "TEST_Esp_Geo_News", "description": "Avance del frente A", "priority": 1},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["area"] == "geotecnia"  # auto-defaulted
        created_ids.append(a["id"])

    def test_create_activity_esp_cannot_post_to_other_area(self, esp_geo, created_ids):
        # Even if specialist sends area=topografia, backend forces own area
        r = requests.post(
            f"{API}/activities",
            headers=_h(esp_geo["token"]),
            json={"title": "TEST_Esp_Tries_Other", "priority": 2, "area": "topografia"},
            timeout=10,
        )
        # Implementation overrides; should succeed but area must be geotecnia
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["area"] == "geotecnia", "Especialista debe forzarse a su propia área"
        created_ids.append(a["id"])

    def test_create_activity_invalid_priority(self, coord_tok):
        r = requests.post(
            f"{API}/activities",
            headers=_h(coord_tok),
            json={"title": "BadPri", "priority": 5},
            timeout=10,
        )
        assert r.status_code == 422

    def test_create_activity_empty_title(self, coord_tok):
        r = requests.post(
            f"{API}/activities",
            headers=_h(coord_tok),
            json={"title": "   ", "priority": 1},
            timeout=10,
        )
        assert r.status_code == 400

    def test_list_activities_coord_sees_all(self, coord_tok):
        r = requests.get(f"{API}/activities", headers=_h(coord_tok), timeout=10)
        assert r.status_code == 200
        items = r.json()
        # Should include both global + area-specific from any area
        assert any(x.get("area") is None for x in items), "Coord debe ver global"
        assert any(x.get("area") == "geotecnia" for x in items), "Coord debe ver geotecnia"
        # Priority desc sorted
        prios = [x["priority"] for x in items]
        assert prios == sorted(prios, reverse=True), "Items deben estar ordenados por prioridad desc"

    def test_list_activities_esp_only_own_area_plus_global(self, esp_topo):
        tok = esp_topo["token"]
        r = requests.get(f"{API}/activities", headers=_h(tok), timeout=10)
        assert r.status_code == 200
        items = r.json()
        # Should NOT contain geotecnia-only news
        assert all(x.get("area") in (None, "topografia") for x in items), \
            f"Topo especialista no debe ver otras áreas: {[x.get('area') for x in items]}"

    def test_delete_activity_creator(self, esp_geo, created_ids):
        # Esp creates and deletes own
        r = requests.post(
            f"{API}/activities",
            headers=_h(esp_geo["token"]),
            json={"title": "TEST_Esp_ToDelete", "priority": 1},
            timeout=10,
        )
        assert r.status_code == 200
        aid = r.json()["id"]
        d = requests.delete(f"{API}/activities/{aid}", headers=_h(esp_geo["token"]), timeout=10)
        assert d.status_code == 200
        assert d.json()["ok"] is True

    def test_delete_activity_forbidden_other_esp(self, coord_tok, esp_topo, created_ids):
        # Coord creates targeting topografia, then geotecnia esp tries to delete (should fail)
        r = requests.post(
            f"{API}/activities",
            headers=_h(coord_tok),
            json={"title": "TEST_Coord_For_Topo", "priority": 1, "area": "topografia"},
            timeout=10,
        )
        aid = r.json()["id"]
        created_ids.append(aid)
        # esp_geo tries (different area, not creator) → forbidden
        geo_tok = _login(*ESP_GEO)["token"]
        d = requests.delete(f"{API}/activities/{aid}", headers=_h(geo_tok), timeout=10)
        assert d.status_code == 403

    def test_delete_activity_coord_can_delete_any(self, coord_tok, esp_geo, created_ids):
        r = requests.post(
            f"{API}/activities",
            headers=_h(esp_geo["token"]),
            json={"title": "TEST_ForCoordDel", "priority": 1},
            timeout=10,
        )
        aid = r.json()["id"]
        d = requests.delete(f"{API}/activities/{aid}", headers=_h(coord_tok), timeout=10)
        assert d.status_code == 200

    def test_delete_unknown(self, coord_tok):
        r = requests.delete(f"{API}/activities/nope-123", headers=_h(coord_tok), timeout=10)
        assert r.status_code == 404

    def test_unauthenticated(self):
        r = requests.get(f"{API}/activities", timeout=10)
        assert r.status_code == 401


# --- AI period summary ------------------------------------------------------
class TestPeriodSummary:
    def test_daily_coord(self, coord_tok):
        r = requests.post(
            f"{API}/ai/period-summary",
            headers=_h(coord_tok),
            json={"period": "daily"},
            timeout=45,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "summary" in body
        assert isinstance(body["summary"], str)
        assert len(body["summary"]) > 10

    def test_weekly_esp_forced_area(self, esp_geo):
        # Even if esp sends area=topografia, must be forced to their own
        r = requests.post(
            f"{API}/ai/period-summary",
            headers=_h(esp_geo["token"]),
            json={"period": "weekly", "area": "topografia"},
            timeout=45,
        )
        assert r.status_code == 200, r.text
        assert "summary" in r.json()

    def test_monthly_coord_area_filter(self, coord_tok):
        r = requests.post(
            f"{API}/ai/period-summary",
            headers=_h(coord_tok),
            json={"period": "monthly", "area": "geotecnia"},
            timeout=45,
        )
        assert r.status_code == 200
        assert "summary" in r.json()

    def test_invalid_period(self, coord_tok):
        r = requests.post(
            f"{API}/ai/period-summary",
            headers=_h(coord_tok),
            json={"period": "yearly"},
            timeout=10,
        )
        assert r.status_code == 422

    def test_unauth(self):
        r = requests.post(f"{API}/ai/period-summary", json={"period": "daily"}, timeout=10)
        assert r.status_code == 401


# --- Daily summary regression (existing flow) -------------------------------
class TestDailySummaryRegression:
    def test_daily_summary_coord(self, coord_tok):
        # Get today's reports
        r = requests.get(f"{API}/reports", headers=_h(coord_tok), timeout=10)
        reports = r.json()[:3]
        if not reports:
            pytest.skip("No reports to summarize")
        r2 = requests.post(
            f"{API}/ai/daily-summary",
            headers=_h(coord_tok),
            json={"reports": reports},
            timeout=45,
        )
        assert r2.status_code == 200, r2.text
        assert "summary" in r2.json()
