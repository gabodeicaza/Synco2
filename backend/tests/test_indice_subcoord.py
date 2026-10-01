"""El Sub-Coordinador puede leer y guardar el índice de informes; el
Especialista no (require_role en los endpoints del índice)."""
import asyncio
import inspect
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_indice_sub")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import server  # noqa: E402

pytest.importorskip("mongomock_motor")


def test_subcoordinador_lee_y_guarda_el_indice():
    from mongomock_motor import AsyncMongoMockClient

    db = AsyncMongoMockClient()["t"]
    old, server.db = server.db, db
    try:
        async def go():
            await db.projects.insert_one({"id": "p1", "name": "P"})
            sub = {"id": "u2", "role": server.ROLE_SUB, "name": "S", "email": "s@x.mx", "project_ids": ["p1"]}
            r = await server.put_indice_config("p1", "semanal", {"titulo": "Contenido", "order": ["a"]}, sub)
            assert r["config"]["titulo"] == "Contenido"
            g = await server.get_indice_config("p1", "semanal", sub)
            assert g["config"]["order"] == ["a"]
            # Cada periodo es independiente.
            assert (await server.get_indice_config("p1", "diario", sub))["config"]["order"] == []
        asyncio.run(go())
    finally:
        server.db = old


def _roles_permitidos(endpoint):
    """Roles que acepta la dependencia require_role del parámetro `user`."""
    dep = inspect.signature(endpoint).parameters["user"].default.dependency
    out = set()
    for role in (server.ROLE_COORD, server.ROLE_SUB, server.ROLE_ESPECIALISTA, server.ROLE_JEFE):
        try:
            res = dep({"id": "x", "role": role})
            if inspect.isawaitable(res):
                asyncio.run(res)
            out.add(role)
        except HTTPException:
            pass
        except TypeError:
            # dependencia con sub-dependencias: se resuelve vía su closure
            raise
    return out


def test_solo_coordinador_y_subcoordinador_acceden_al_indice():
    for ep in (server.get_indice_config, server.put_indice_config):
        assert _roles_permitidos(ep) == {server.ROLE_COORD, server.ROLE_SUB}
