"""Publicación de reportes en el grupo de WhatsApp de cada proyecto (Whapi.cloud).

Whapi y Mongo van simulados: se verifica a qué grupo/endpoint se envía, que no
se envíe nada sin grupo, y la validación del ID del grupo."""
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_whatsapp")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import server  # noqa: E402

_PNG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
_GRUPO = "120363430765044545@g.us"


class _Resp:
    status_code = 200
    text = "{}"


class _FakeClient:
    llamadas: list = []

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        _FakeClient.llamadas.append((url, headers, json))
        return _Resp()


class _FakeProjects:
    def __init__(self, proyecto):
        self.proyecto = proyecto

    async def find_one(self, *a, **k):
        return self.proyecto


class _FakeDb:
    def __init__(self, proyecto):
        self.projects = _FakeProjects(proyecto)


@pytest.fixture
def whapi(monkeypatch):
    _FakeClient.llamadas = []
    monkeypatch.setattr(server.httpx, "AsyncClient", _FakeClient)
    monkeypatch.setattr(server, "WHAPI_TOKEN", "tok")
    monkeypatch.setattr(server, "WHAPI_URL", "https://gate.whapi.cloud/")
    return _FakeClient


def _doc(images=None):
    return {
        "id": "r1", "project_id": "p1", "title": "Colado de losa",
        "node_path_names": ["Tramo 1", "Eje A"], "actividades": "Colado", "avance": "40%",
        "captured_by_name": "Ana", "created_at": datetime(2026, 10, 6, 15, 30, tzinfo=timezone.utc),
        "images": images or [],
    }


def test_con_foto_usa_messages_image_y_el_grupo_del_proyecto(whapi, monkeypatch):
    monkeypatch.setattr(server, "db", _FakeDb({"name": "Prueba", "whatsapp_group_id": _GRUPO}))
    asyncio.run(server._whatsapp_enviar_reporte(_doc([_PNG])))
    (url, headers, body), = whapi.llamadas
    assert url == "https://gate.whapi.cloud/messages/image"
    assert headers["Authorization"] == "Bearer tok"
    assert body["to"] == _GRUPO
    assert body["media"].startswith("data:image/jpeg;base64,")
    assert "Colado de losa" in body["caption"] and "Tramo 1 > Eje A" in body["caption"]


def test_sin_foto_usa_messages_text(whapi, monkeypatch):
    monkeypatch.setattr(server, "db", _FakeDb({"name": "Prueba", "whatsapp_group_id": _GRUPO}))
    asyncio.run(server._whatsapp_enviar_reporte(_doc()))
    (url, _h, body), = whapi.llamadas
    assert url == "https://gate.whapi.cloud/messages/text"
    assert body["to"] == _GRUPO and "Avance:* 40%" in body["body"]


@pytest.mark.parametrize("proyecto", [{"name": "X"}, {"name": "X", "whatsapp_group_id": None}, None])
def test_sin_grupo_en_el_proyecto_no_envia(whapi, monkeypatch, proyecto):
    monkeypatch.setattr(server, "db", _FakeDb(proyecto))
    asyncio.run(server._whatsapp_enviar_reporte(_doc([_PNG])))
    assert whapi.llamadas == []


def test_sin_token_no_envia(whapi, monkeypatch):
    monkeypatch.setattr(server, "WHAPI_TOKEN", "")
    monkeypatch.setattr(server, "db", _FakeDb({"name": "P", "whatsapp_group_id": _GRUPO}))
    asyncio.run(server._whatsapp_enviar_reporte(_doc()))
    assert whapi.llamadas == []


def test_error_de_whapi_no_propaga(whapi, monkeypatch):
    class _Boom(_FakeClient):
        async def post(self, *a, **k):
            raise RuntimeError("red caída")

    monkeypatch.setattr(server.httpx, "AsyncClient", _Boom)
    monkeypatch.setattr(server, "db", _FakeDb({"name": "P", "whatsapp_group_id": _GRUPO}))
    asyncio.run(server._whatsapp_enviar_reporte(_doc()))  # no lanza


def test_validacion_del_id_de_grupo():
    s = server._sanitize_whatsapp_group_id
    assert s(f"  {_GRUPO} ") == _GRUPO
    assert s("") is None and s(None) is None
    for malo in ("120363430765044545", "abc@g.us", "5215512345678@s.whatsapp.net"):
        with pytest.raises(HTTPException):
            s(malo)
