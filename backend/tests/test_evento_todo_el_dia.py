"""Editar un evento a "todo el día" (G-04): el PATCH acepta all_day, ancla el inicio a las
00:00 del día del proyecto y quita el fin. Pruebas sin Mongo (db falso)."""
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_evento_todo_el_dia")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402


class _Coleccion:
    def __init__(self, docs):
        self.docs = docs
        self.actualizados = []

    async def find_one(self, filtro, *a, **k):
        for d in self.docs:
            if all(d.get(c) == v for c, v in filtro.items()):
                return dict(d)
        return None

    async def update_one(self, filtro, cambio):
        self.actualizados.append(cambio["$set"])
        for d in self.docs:
            if d["id"] == filtro["id"]:
                d.update(cambio["$set"])


class _Db:
    def __init__(self, evento):
        self.events = _Coleccion([evento])


def _evento():
    return {
        "id": "e1", "project_id": "p1", "title": "Junta", "author_id": "u1",
        "start_at": datetime(2026, 9, 24, 3, 30, tzinfo=timezone.utc),  # 23 sep 21:30 en CDMX
        "end_at": datetime(2026, 9, 24, 4, 30, tzinfo=timezone.utc),
        "attendee_ids": [], "attendee_names": [],
    }


def _editar(monkeypatch, cuerpo):
    evento = _evento()
    db = _Db(evento)
    monkeypatch.setattr(server, "db", db)

    async def acceso(user, pid):
        return {"id": pid, "zona_horaria": "America/Mexico_City"}

    async def enriquecer(doc):
        return doc

    monkeypatch.setattr(server, "ensure_project_access", acceso)
    monkeypatch.setattr(server, "_enrich_event_with_area", enriquecer)
    user = {"id": "u1", "role": server.ROLE_COORD, "name": "Ana"}
    return asyncio.run(server.update_event("e1", server.EventPatch(**cuerpo), user)), db


def test_patch_acepta_all_day():
    assert server.EventPatch(all_day=True).all_day is True
    assert server.EventPatch().all_day is None


def test_pasar_a_todo_el_dia_ancla_al_dia_del_proyecto_y_quita_el_fin(monkeypatch):
    salida, db = _editar(monkeypatch, {"all_day": True})
    cambio = db.events.actualizados[0]
    assert cambio["all_day"] is True
    assert cambio["end_at"] is None
    # El evento era el 23 sep a las 21:30 en CDMX (24 sep en UTC): sigue siendo el 23 a las 00:00 locales.
    assert cambio["start_at"] == datetime(2026, 9, 23, 6, 0, tzinfo=timezone.utc)
    assert salida["all_day"] is True


def test_sin_all_day_no_toca_esos_campos(monkeypatch):
    _, db = _editar(monkeypatch, {"title": "Junta semanal"})
    cambio = db.events.actualizados[0]
    assert "all_day" not in cambio and "end_at" not in cambio
