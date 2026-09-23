"""/api/health es el ping de la app (NetInfo), del banner "Sin conexión" y de los
monitores: 200 con {"ok": true} solo si Mongo responde; 503 si no. Acepta HEAD.
Usa un `db` falso: no requiere Mongo ni backend vivo."""
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_health")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def _cliente(ping):
    server.db = MagicMock()
    server.db.command = ping
    return TestClient(server.app)


def test_health_ok_cuando_mongo_responde():
    r = _cliente(AsyncMock(return_value={"ok": 1})).get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True and r.json()["db"] is True


def test_health_503_si_mongo_no_responde():
    r = _cliente(AsyncMock(side_effect=RuntimeError("caído"))).get("/api/health")
    assert r.status_code == 503
    assert r.json()["ok"] is False


def test_health_acepta_head():
    assert _cliente(AsyncMock(return_value={"ok": 1})).head("/api/health").status_code == 200
