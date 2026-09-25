"""Vigencia de noticias (G-05): 6, 24, 48 o 168 horas, por defecto 24, editable (el reloj se
reinicia desde la edición), sin migración para noticias anteriores y sin listar las expiradas.
Pruebas sin Mongo (db falso)."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_noticias_vigencia")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

USER = {"id": "u1", "name": "Ana", "role": server.ROLE_COORD}


def _coincide(doc, filtro):
    for campo, cond in filtro.items():
        valor = doc.get(campo)
        if isinstance(cond, dict):
            if "$gt" in cond:
                v = valor if valor is None or valor.tzinfo else valor.replace(tzinfo=timezone.utc)
                if v is None or not v > cond["$gt"]:
                    return False
        elif valor != cond:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *_a, **_k):
        return self

    async def to_list(self, length=None):
        return [dict(d) for d in self.docs]


class _Coleccion:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def find_one(self, filtro, *a, **k):
        for d in self.docs:
            if _coincide(d, filtro):
                return dict(d)
        return None

    def find(self, filtro, *a, **k):
        return _Cursor([d for d in self.docs if _coincide(d, filtro)])

    async def update_one(self, filtro, cambio):
        for d in self.docs:
            if _coincide(d, filtro):
                d.update(cambio["$set"])


class _Db:
    def __init__(self, noticias=None):
        self.announcements = _Coleccion(noticias)
        self.areas = _Coleccion()
        self.location_nodes = _Coleccion()


@pytest.fixture
def db(monkeypatch):
    fake = _Db()
    monkeypatch.setattr(server, "db", fake)

    async def acceso(user, pid):
        return {"id": pid}

    monkeypatch.setattr(server, "ensure_project_access", acceso)
    return fake


def _crear(**extra):
    cuerpo = server.AnnouncementIn(title="Aviso", body="Texto", **extra)
    return asyncio.run(server.create_announcement("p1", cuerpo, USER))


def _horas_de_vida(noticia):
    return round((noticia["expires_at"] - noticia["created_at"]).total_seconds() / 3600)


def test_por_defecto_dura_24_horas(db):
    n = _crear()
    assert n["vigencia_horas"] == 24
    assert _horas_de_vida(n) == 24


@pytest.mark.parametrize("horas", [6, 24, 48, 168])
def test_acepta_las_vigencias_permitidas(db, horas):
    n = _crear(vigencia_horas=horas)
    assert n["vigencia_horas"] == horas
    assert _horas_de_vida(n) == horas
    assert db.announcements.docs[0]["vigencia_horas"] == horas


@pytest.mark.parametrize("horas", [0, 1, 12, 72, 169, 720, -6])
def test_rechaza_cualquier_otra_vigencia_con_mensaje_legible(db, horas):
    with pytest.raises(HTTPException) as e:
        _crear(vigencia_horas=horas)
    assert e.value.status_code == 400
    assert "6, 24, 48, 168" in e.value.detail and "7 días" in e.value.detail
    assert db.announcements.docs == []


def test_validar_vigencia_no_acepta_booleanos_ni_texto():
    for malo in (True, "24", 24.0, None):
        with pytest.raises(ValueError):
            server.validar_vigencia_horas(malo)


def test_noticia_anterior_sin_el_campo_se_reporta_con_24(db):
    ahora = datetime.now(timezone.utc)
    db.announcements.docs.append({
        "id": "vieja", "project_id": "p1", "title": "Vieja", "body": "x",
        "created_at": ahora - timedelta(hours=2), "expires_at": ahora + timedelta(hours=22),
    })
    salida = asyncio.run(server.list_announcements("p1", USER))
    assert [n["id"] for n in salida] == ["vieja"]
    assert salida[0]["vigencia_horas"] == 24


def test_la_lista_no_devuelve_noticias_expiradas(db):
    ahora = datetime.now(timezone.utc)
    db.announcements.docs.extend([
        {"id": "viva", "project_id": "p1", "title": "a", "body": "x", "created_at": ahora, "expires_at": ahora + timedelta(hours=1)},
        {"id": "vencida", "project_id": "p1", "title": "b", "body": "x", "created_at": ahora, "expires_at": ahora - timedelta(minutes=1)},
    ])
    assert [n["id"] for n in asyncio.run(server.list_announcements("p1", USER))] == ["viva"]


def test_editar_la_vigencia_reinicia_el_reloj_desde_la_edicion(db):
    n = _crear(vigencia_horas=6)
    antes = datetime.now(timezone.utc)
    editada = asyncio.run(server.update_announcement("%s" % n["id"], server.AnnouncementPatch(vigencia_horas=168), USER))
    assert editada["vigencia_horas"] == 168
    vence = editada["expires_at"]
    if vence.tzinfo is None:
        vence = vence.replace(tzinfo=timezone.utc)
    assert timedelta(hours=167, minutes=59) < vence - antes < timedelta(hours=168, minutes=1)
    assert vence > datetime.now(timezone.utc)


def test_editar_con_vigencia_invalida_no_cambia_nada(db):
    n = _crear(vigencia_horas=24)
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.update_announcement(n["id"], server.AnnouncementPatch(vigencia_horas=100), USER))
    assert e.value.status_code == 400
    assert db.announcements.docs[0]["vigencia_horas"] == 24


def test_no_se_puede_cambiar_la_vigencia_de_una_noticia_ya_expirada(db):
    ahora = datetime.now(timezone.utc)
    db.announcements.docs.append({
        "id": "vencida", "project_id": "p1", "title": "b", "body": "x", "author_id": "u1",
        "created_at": ahora - timedelta(hours=30), "expires_at": ahora - timedelta(hours=6),
    })
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.update_announcement("vencida", server.AnnouncementPatch(vigencia_horas=48), USER))
    assert e.value.status_code == 400 and "expiró" in e.value.detail


def test_editar_otros_campos_no_toca_la_vigencia(db):
    n = _crear(vigencia_horas=48)
    vence_antes = db.announcements.docs[0]["expires_at"]
    editada = asyncio.run(server.update_announcement(n["id"], server.AnnouncementPatch(title="Nuevo título"), USER))
    assert editada["title"] == "Nuevo título"
    assert editada["vigencia_horas"] == 48
    assert db.announcements.docs[0]["expires_at"] == vence_antes
