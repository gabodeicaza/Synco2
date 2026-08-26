"""SynCo - Chat (direct + area) + reference-points PUT + smoke regression.

Targets the public EXPO_PUBLIC_BACKEND_URL (Kubernetes ingress -> /api -> 8001).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback: read directly from frontend .env (testing-only convenience)
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"
API = f"{BASE_URL}/api"

SUPERVISOR = {"email": "coordinador@syncsite.com", "password": "demo1234"}
TOPO = {"email": "topografia@syncsite.com", "password": "demo1234"}
GEO = {"email": "geotecnia@syncsite.com", "password": "demo1234"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    data = r.json()
    return data["token"], data["user"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- Fixtures ---------------------------------------------------------------
@pytest.fixture(scope="module")
def auth():
    sup_token, sup_user = _login(SUPERVISOR)
    topo_token, topo_user = _login(TOPO)
    geo_token, geo_user = _login(GEO)
    return {
        "sup": {"token": sup_token, "user": sup_user},
        "topo": {"token": topo_token, "user": topo_user},
        "geo": {"token": geo_token, "user": geo_user},
    }


# ============================================================================
# SMOKE REGRESSION
# ============================================================================
class TestSmokeRegression:
    def test_login_supervisor(self, auth):
        assert auth["sup"]["user"]["role"] == "coordinador"
        assert auth["sup"]["user"]["email"] == "coordinador@syncsite.com"

    def test_login_especialista(self, auth):
        assert auth["topo"]["user"]["role"] == "especialista"
        assert auth["topo"]["user"]["area"] == "topografia"

    def test_get_areas(self, auth):
        r = requests.get(f"{API}/areas", headers=_h(auth["sup"]["token"]))
        assert r.status_code == 200
        areas = r.json()
        assert isinstance(areas, list) and len(areas) >= 5
        ids = {a["id"] for a in areas}
        assert {"geotecnia", "topografia", "obracivil", "seguridad", "calidad"} <= ids

    def test_get_reference_points(self, auth):
        r = requests.get(f"{API}/reference-points", headers=_h(auth["sup"]["token"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_and_delete_reference_point(self, auth):
        name = f"TEST_RP_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/reference-points",
            headers=_h(auth["sup"]["token"]),
            json={"name": name, "location": "L1", "coordinates": "10,20", "area": None},
        )
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        assert r.json()["name"] == name
        # Cleanup
        d = requests.delete(f"{API}/reference-points/{pid}", headers=_h(auth["sup"]["token"]))
        assert d.status_code == 200
        assert d.json().get("ok") is True

    def test_get_activities(self, auth):
        r = requests.get(f"{API}/activities", headers=_h(auth["sup"]["token"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ============================================================================
# PUT /api/reference-points/{id}  (edit)
# ============================================================================
class TestUpdateReferencePoint:
    _created: list = []

    def test_create_then_update_all_fields(self, auth):
        token = auth["sup"]["token"]
        name = f"TEST_RP_EDIT_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/reference-points",
            headers=_h(token),
            json={"name": name, "location": "Loc A", "coordinates": "1,2", "area": None},
        )
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        type(self)._created.append((pid, token))

        new_name = name + "_v2"
        upd = requests.put(
            f"{API}/reference-points/{pid}",
            headers=_h(token),
            json={
                "name": new_name,
                "location": "Loc B",
                "coordinates": "9,9",
                "area": "topografia",
            },
        )
        assert upd.status_code == 200, upd.text
        body = upd.json()
        assert body["name"] == new_name
        assert body["location"] == "Loc B"
        assert body["coordinates"] == "9,9"
        assert body["area"] == "topografia"
        assert body["areaName"] == "Topografía"

        # GET verifies persistence
        g = requests.get(f"{API}/reference-points", headers=_h(token))
        assert g.status_code == 200
        match = [p for p in g.json() if p["id"] == pid]
        assert match, "Point missing after update"
        m = match[0]
        assert m["name"] == new_name
        assert m["location"] == "Loc B"
        assert m["coordinates"] == "9,9"
        assert m["area"] == "topografia"

    def test_update_404_unknown_id(self, auth):
        r = requests.put(
            f"{API}/reference-points/{uuid.uuid4()}",
            headers=_h(auth["sup"]["token"]),
            json={"name": "x"},
        )
        assert r.status_code == 404

    def test_update_requires_token(self, auth):
        r = requests.put(
            f"{API}/reference-points/anyid",
            json={"name": "x"},
        )
        assert r.status_code == 401

    @classmethod
    def teardown_class(cls):
        for pid, token in cls._created:
            try:
                requests.delete(f"{API}/reference-points/{pid}", headers=_h(token), timeout=10)
            except Exception:
                pass


# ============================================================================
# CHAT — DIRECT (1:1)
# ============================================================================
class TestChatDirect:
    def test_chat_users_requires_auth(self):
        r = requests.get(f"{API}/chat/users")
        assert r.status_code == 401

    def test_chat_users_shape(self, auth):
        r = requests.get(f"{API}/chat/users", headers=_h(auth["sup"]["token"]))
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) >= 1
        sup_id = auth["sup"]["user"]["id"]
        # self excluded
        assert all(u["id"] != sup_id for u in users)
        # required keys
        for u in users:
            for k in ("id", "name", "email", "role", "unread"):
                assert k in u, f"Missing key {k}"
            assert "lastMessage" in u
            assert "lastAt" in u
            assert "areaName" in u
            assert "puesto" in u

    def test_send_validation_empty(self, auth):
        topo_id = auth["topo"]["user"]["id"]
        r = requests.post(
            f"{API}/chat/send",
            headers=_h(auth["sup"]["token"]),
            json={"to_user": topo_id, "text": "   "},
        )
        assert r.status_code == 400

    def test_send_validation_too_long(self, auth):
        topo_id = auth["topo"]["user"]["id"]
        r = requests.post(
            f"{API}/chat/send",
            headers=_h(auth["sup"]["token"]),
            json={"to_user": topo_id, "text": "x" * 2001},
        )
        assert r.status_code == 400

    def test_send_to_self_400(self, auth):
        sup_id = auth["sup"]["user"]["id"]
        r = requests.post(
            f"{API}/chat/send",
            headers=_h(auth["sup"]["token"]),
            json={"to_user": sup_id, "text": "hola"},
        )
        assert r.status_code == 400

    def test_send_to_unknown_user_404(self, auth):
        r = requests.post(
            f"{API}/chat/send",
            headers=_h(auth["sup"]["token"]),
            json={"to_user": str(uuid.uuid4()), "text": "hola"},
        )
        assert r.status_code == 404

    def test_full_chat_flow(self, auth):
        sup_token = auth["sup"]["token"]
        sup_id = auth["sup"]["user"]["id"]
        topo_token = auth["topo"]["token"]
        topo_id = auth["topo"]["user"]["id"]

        # Step 1: read all current messages to flush unread for topo
        requests.get(f"{API}/chat/messages/{sup_id}", headers=_h(topo_token))

        # Baseline unread for topo
        base = requests.get(f"{API}/chat/unread-total", headers=_h(topo_token)).json()["unread"]

        # Step 2: Supervisor sends a message to Topografía
        text1 = f"TEST_MSG_{uuid.uuid4().hex[:6]}"
        snd = requests.post(
            f"{API}/chat/send",
            headers=_h(sup_token),
            json={"to_user": topo_id, "text": text1},
        )
        assert snd.status_code == 200, snd.text
        m = snd.json()
        assert m["text"] == text1
        assert m["from_user"] == sup_id
        assert m["to_user"] == topo_id
        assert m["read"] is False

        # Step 3: Topografía sees unread=1 (relative) + lastMessage
        users = requests.get(f"{API}/chat/users", headers=_h(topo_token)).json()
        sup_entry = next(u for u in users if u["id"] == sup_id)
        assert sup_entry["unread"] >= 1
        assert sup_entry["lastMessage"] == text1

        topo_total = requests.get(f"{API}/chat/unread-total", headers=_h(topo_token)).json()["unread"]
        assert topo_total >= base + 1

        # Step 4: Topografía opens conversation -> messages ascending + marks read
        msgs = requests.get(f"{API}/chat/messages/{sup_id}", headers=_h(topo_token)).json()
        assert isinstance(msgs, list) and len(msgs) >= 1
        # Ascending order
        assert msgs == sorted(msgs, key=lambda x: x["createdAt"])
        # Latest must be ours
        assert msgs[-1]["text"] == text1

        # Now unread for topo for that peer should be 0
        users2 = requests.get(f"{API}/chat/users", headers=_h(topo_token)).json()
        sup_entry2 = next(u for u in users2 if u["id"] == sup_id)
        assert sup_entry2["unread"] == 0, f"Expected 0, got {sup_entry2['unread']}"
        topo_total2 = requests.get(f"{API}/chat/unread-total", headers=_h(topo_token)).json()["unread"]
        assert topo_total2 <= base, f"Unread should have decremented. base={base} now={topo_total2}"

        # Step 5: Topografía replies; Supervisor sees unread>=1
        # Flush sup unread first
        requests.get(f"{API}/chat/messages/{topo_id}", headers=_h(sup_token))
        sup_base = requests.get(f"{API}/chat/unread-total", headers=_h(sup_token)).json()["unread"]

        text2 = f"TEST_REPLY_{uuid.uuid4().hex[:6]}"
        rep = requests.post(
            f"{API}/chat/send",
            headers=_h(topo_token),
            json={"to_user": sup_id, "text": text2},
        )
        assert rep.status_code == 200

        sup_users = requests.get(f"{API}/chat/users", headers=_h(sup_token)).json()
        topo_entry = next(u for u in sup_users if u["id"] == topo_id)
        assert topo_entry["unread"] >= 1
        assert topo_entry["lastMessage"] == text2

        sup_total = requests.get(f"{API}/chat/unread-total", headers=_h(sup_token)).json()["unread"]
        assert sup_total >= sup_base + 1

        # Cleanup: mark all as read so we don't leave noise
        requests.get(f"{API}/chat/messages/{topo_id}", headers=_h(sup_token))

    def test_messages_unknown_peer_404(self, auth):
        r = requests.get(
            f"{API}/chat/messages/{uuid.uuid4()}",
            headers=_h(auth["sup"]["token"]),
        )
        assert r.status_code == 404

    def test_messages_requires_auth(self):
        r = requests.get(f"{API}/chat/messages/whatever")
        assert r.status_code == 401

    def test_unread_total_requires_auth(self):
        r = requests.get(f"{API}/chat/unread-total")
        assert r.status_code == 401


# ============================================================================
# CHAT — AREA (broadcast)
# ============================================================================
class TestChatArea:
    def test_areas_requires_auth(self):
        r = requests.get(f"{API}/chat/areas")
        assert r.status_code == 401

    def test_areas_rooms(self, auth):
        r = requests.get(f"{API}/chat/areas", headers=_h(auth["sup"]["token"]))
        assert r.status_code == 200
        rooms = r.json()
        ids = [room["id"] for room in rooms]
        assert "general" in ids
        # At least the 5 seeded areas
        for a in ("geotecnia", "topografia", "obracivil", "seguridad", "calidad"):
            assert a in ids, f"Missing area room {a}"
        # Every room has the required shape
        for room in rooms:
            for k in ("id", "name", "lastMessage", "lastAt", "lastFrom"):
                assert k in room

    def test_send_general(self, auth):
        text = f"TEST_AREA_GEN_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/chat/area/send",
            headers=_h(auth["sup"]["token"]),
            json={"area_id": "general", "text": text},
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["area_id"] == "general"
        assert m["area_name"] == "General (todos)"
        assert m["text"] == text
        assert m["from_user"] == auth["sup"]["user"]["id"]

    def test_send_existing_area(self, auth):
        text = f"TEST_AREA_TOPO_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/chat/area/send",
            headers=_h(auth["topo"]["token"]),
            json={"area_id": "topografia", "text": text},
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["area_id"] == "topografia"
        assert m["area_name"] == "Topografía"

    def test_send_unknown_area_404(self, auth):
        r = requests.post(
            f"{API}/chat/area/send",
            headers=_h(auth["sup"]["token"]),
            json={"area_id": f"no_existe_{uuid.uuid4().hex[:6]}", "text": "hi"},
        )
        assert r.status_code == 404

    def test_send_empty_400(self, auth):
        r = requests.post(
            f"{API}/chat/area/send",
            headers=_h(auth["sup"]["token"]),
            json={"area_id": "general", "text": "   "},
        )
        assert r.status_code == 400

    def test_send_too_long_400(self, auth):
        r = requests.post(
            f"{API}/chat/area/send",
            headers=_h(auth["sup"]["token"]),
            json={"area_id": "general", "text": "x" * 2001},
        )
        assert r.status_code == 400

    def test_area_messages_ascending(self, auth):
        # Send two then read
        t1 = f"TEST_ORD_A_{uuid.uuid4().hex[:6]}"
        t2 = f"TEST_ORD_B_{uuid.uuid4().hex[:6]}"
        requests.post(
            f"{API}/chat/area/send",
            headers=_h(auth["sup"]["token"]),
            json={"area_id": "general", "text": t1},
        )
        requests.post(
            f"{API}/chat/area/send",
            headers=_h(auth["topo"]["token"]),
            json={"area_id": "general", "text": t2},
        )
        r = requests.get(
            f"{API}/chat/area/general/messages",
            headers=_h(auth["sup"]["token"]),
        )
        assert r.status_code == 200
        msgs = r.json()
        assert isinstance(msgs, list) and len(msgs) >= 2
        assert msgs == sorted(msgs, key=lambda x: x["createdAt"])
        texts = [m["text"] for m in msgs]
        assert t1 in texts and t2 in texts

    def test_area_messages_requires_auth(self):
        r = requests.get(f"{API}/chat/area/general/messages")
        assert r.status_code == 401

    def test_area_rooms_lastmessage_updates(self, auth):
        # send a unique message to topografia and verify it shows up in rooms.lastMessage
        text = f"TEST_LAST_{uuid.uuid4().hex[:6]}"
        requests.post(
            f"{API}/chat/area/send",
            headers=_h(auth["topo"]["token"]),
            json={"area_id": "topografia", "text": text},
        )
        rooms = requests.get(f"{API}/chat/areas", headers=_h(auth["sup"]["token"])).json()
        topo_room = next(r for r in rooms if r["id"] == "topografia")
        assert topo_room["lastMessage"] == text
        assert topo_room["lastFrom"] == auth["topo"]["user"]["name"]
