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


class _Col:
    def __init__(self, doc):
        self.doc = doc

    async def find_one(self, *a, **k):
        return self.doc


class _FakeDb:
    def __init__(self, proyecto, usuario=None, plantilla=None):
        self.projects = _Col(proyecto)
        self.users = _Col(usuario)
        self.report_templates = _Col(plantilla)


@pytest.fixture
def whapi(monkeypatch):
    _FakeClient.llamadas = []
    monkeypatch.setattr(server.httpx, "AsyncClient", _FakeClient)
    monkeypatch.setattr(server, "WHAPI_TOKEN", "tok")
    monkeypatch.setattr(server, "WHAPI_URL", "https://gate.whapi.cloud/")
    return _FakeClient


_PROYECTO = {"name": "Bdhd", "constructora": "Jeje", "contract_number": "Jruei", "whatsapp_group_id": _GRUPO}


def _doc(images=None):
    return {
        "id": "r1", "project_id": "p1", "captured_by": "u1", "captured_by_name": "Gabriel",
        "node_path_names": ["TRAMO 1", "Subtramo E2-E3", "C19"], "actividades": "Actividades",
        "observaciones": "A ver si funciona", "personnel": ["1 ING. Civil"],
        "equipment": ["1 Cortadora de varilla"],
        # 6 oct 2026 20:00 UTC = 14:00 CDMX; y 7 oct 02:00 UTC = 6 oct 20:00 CDMX
        "created_at": datetime(2026, 10, 7, 2, 0, tzinfo=timezone.utc),
        "images": images or [],
    }


def test_texto_identico_a_la_vista_previa():
    t = server._whatsapp_texto_reporte(_doc(), _PROYECTO, None)
    assert t == (
        "6 de octubre de 2026.\nGabriel\n\n\n"
        "Constructora: Jeje\nNo de contrato: Jruei\n\n"
        "C19\n\n"
        "*Actividades:*\nActividades\n\n"
        "*Observaciones:*\nA ver si funciona\n\n"
        "Personal:\n1 ING. Civil\n\n"
        "Equipo:\n1 Cortadora de varilla"
    )


def test_texto_con_puesto_incidencias_y_datos_dinamicos():
    d = _doc()
    d.update(incidencias="Lluvia", personnel=[], equipment=[], dynamic_data={"k1": True, "k2": ["a", "b"], "k3": ""})
    t = server._whatsapp_texto_reporte(d, _PROYECTO, "Residente", [{"key": "k1", "label": "Casco"}])
    assert "Gabriel\nResidente" in t
    assert "*Datos del reporte:*\nCasco: Sí\nk2: a, b\nk3: -" in t
    assert "Incidencias:\nLluvia" in t and "Personal:\n-\n\nEquipo:\n-" in t


def test_todas_las_fotos_y_el_texto_va_en_la_ultima(whapi, monkeypatch):
    monkeypatch.setattr(server, "db", _FakeDb(_PROYECTO, {"puesto": "Residente"}))
    asyncio.run(server._whatsapp_enviar_reporte(_doc([_PNG, _PNG, _PNG])))
    assert len(whapi.llamadas) == 3
    assert all(u == "https://gate.whapi.cloud/messages/image" and h["Authorization"] == "Bearer tok"
               and b["to"] == _GRUPO and b["media"].startswith("data:image/jpeg;base64,")
               for u, h, b in whapi.llamadas)
    caps = [b["caption"] for _u, _h, b in whapi.llamadas]
    assert caps[0] == "" and caps[1] == ""
    assert caps[2].startswith("6 de octubre de 2026.\nGabriel\nResidente") and "Constructora: Jeje" in caps[2]


def test_texto_largo_no_cabe_de_pie_de_foto_se_manda_aparte(whapi, monkeypatch):
    monkeypatch.setattr(server, "db", _FakeDb(_PROYECTO))
    d = _doc([_PNG, _PNG])
    d["observaciones"] = "x" * 1500
    asyncio.run(server._whatsapp_enviar_reporte(d))
    assert [u.rsplit("/", 1)[1] for u, _h, _b in whapi.llamadas] == ["image", "image", "text"]
    assert all(b["caption"] == "" for _u, _h, b in whapi.llamadas[:2])
    assert "x" * 1500 in whapi.llamadas[2][2]["body"]


def test_sin_foto_usa_messages_text(whapi, monkeypatch):
    monkeypatch.setattr(server, "db", _FakeDb(_PROYECTO))
    asyncio.run(server._whatsapp_enviar_reporte(_doc()))
    (url, _h, body), = whapi.llamadas
    assert url == "https://gate.whapi.cloud/messages/text"
    assert body["to"] == _GRUPO and body["body"].startswith("6 de octubre de 2026.")


@pytest.mark.parametrize("proyecto", [{"name": "X"}, {"name": "X", "whatsapp_group_id": None}, None])
def test_sin_grupo_en_el_proyecto_no_envia(whapi, monkeypatch, proyecto):
    monkeypatch.setattr(server, "db", _FakeDb(proyecto))
    asyncio.run(server._whatsapp_enviar_reporte(_doc([_PNG])))
    assert whapi.llamadas == []


def test_sin_token_no_envia(whapi, monkeypatch):
    monkeypatch.setattr(server, "WHAPI_TOKEN", "")
    monkeypatch.setattr(server, "db", _FakeDb(_PROYECTO))
    asyncio.run(server._whatsapp_enviar_reporte(_doc()))
    assert whapi.llamadas == []


def test_error_de_whapi_no_propaga(whapi, monkeypatch):
    class _Boom(_FakeClient):
        async def post(self, *a, **k):
            raise RuntimeError("red caída")

    monkeypatch.setattr(server.httpx, "AsyncClient", _Boom)
    monkeypatch.setattr(server, "db", _FakeDb(_PROYECTO))
    asyncio.run(server._whatsapp_enviar_reporte(_doc()))  # no lanza


def test_validacion_del_id_de_grupo():
    s = server._sanitize_whatsapp_group_id
    assert s(f"  {_GRUPO} ") == _GRUPO
    assert s("") is None and s(None) is None
    for malo in ("120363430765044545", "abc@g.us", "5215512345678@s.whatsapp.net"):
        with pytest.raises(HTTPException):
            s(malo)
