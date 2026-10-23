"""Trazabilidad (server.py): archivos adjuntos al árbol de nodos del proyecto
(`location_nodes`). Cada archivo lleva categoría y características editables.
Contra una Mongo simulada (`mongomock-motor`)."""
import asyncio
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_trazabilidad")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import server  # noqa: E402

pytest.importorskip("mongomock_motor")

COORD = {"id": "c1", "role": server.ROLE_COORD, "name": "Coord"}
SUB = {"id": "s1", "role": server.ROLE_SUB, "name": "Sub", "project_ids": ["p1"]}


def _con_db(coro_fn):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    old_db, old_up = server.db, server.UPLOADS_DIR
    server.db = db
    with tempfile.TemporaryDirectory() as tmp:
        server.UPLOADS_DIR = Path(tmp)
        try:
            return asyncio.run(coro_fn(db))
        finally:
            server.db, server.UPLOADS_DIR = old_db, old_up


def _subida(nombre, contenido):
    async def _leer():
        return contenido
    return SimpleNamespace(filename=nombre, read=_leer)


async def _sembrar(db):
    await db.projects.insert_one({"id": "p1", "name": "Demo"})
    await db.location_nodes.insert_many([
        {"id": "t1", "project_id": "p1", "parent_id": None, "name": "Tramo 1", "depth": 0, "order": 0},
        {"id": "e1", "project_id": "p1", "parent_id": "t1", "name": "Estación 1", "depth": 1, "order": 0,
         "tipo_nodo": "estacion"},
        {"id": "x", "project_id": "otro", "parent_id": None, "name": "Ajeno", "depth": 0, "order": 0},
    ])


def test_lista_el_arbol_de_nodos_del_proyecto_con_categorias_base():
    async def go(db):
        await _sembrar(db)
        return await server.traz_listar("p1", SUB)
    r = _con_db(go)
    assert [n["id"] for n in r["nodes"]] == ["t1", "e1"]
    assert r["files"] == [] and r["categorias"] == server.TRAZ_CATEGORIAS_BASE
    assert "A3012 · Proyecto Arquitectónico" in r["categorias"]


def test_adjuntar_reemplazar_editar_descargar_y_borrar():
    async def go(db):
        await _sembrar(db)
        r1 = await server.traz_subir_archivo("p1", "e1", _subida("plano.pdf", b"%PDF-1"), "A3012 · Proyecto Arquitectónico", COORD)
        ed = await server.traz_editar_archivo("p1", r1["file"]["id"], server.TrazArchivoPatch(
            rev="B", oficio="DIR-CL4-150-2026", fecha="29/04/2026", obs="Con observaciones"), COORD)
        r2 = await server.traz_subir_archivo("p1", "e1", _subida("PLANO.pdf", b"%PDF-2"), "A3012 · Proyecto Arquitectónico", COORD)
        otra = await server.traz_subir_archivo("p1", "e1", _subida("plano.pdf", b"x"), "A3015 · Proyecto Estructural", COORD)
        dwg = await server.traz_subir_archivo("p1", "t1", _subida("base.dwg", b"AC1032"), "", COORD)
        lista = await server.traz_listar("p1", SUB)
        resp = await server.traz_descargar("p1", r1["file"]["id"], SUB)
        contenido = Path(resp.path).read_bytes()
        await server.traz_borrar_archivo("p1", r1["file"]["id"], COORD)
        return r1, ed, r2, otra, dwg, lista, contenido, await server.traz_listar("p1", SUB)
    r1, ed, r2, otra, dwg, lista, contenido, despues = _con_db(go)
    assert r1["reemplazado"] is False and r2["reemplazado"] is True
    assert r2["file"]["id"] == r1["file"]["id"] and r2["file"]["rev"] == "B"  # conserva características
    assert ed["fecha"] == "2026-04-29" and ed["oficio"] == "DIR-CL4-150-2026"
    assert otra["reemplazado"] is False  # misma nombre pero otra categoría = otro archivo
    assert len(lista["files"]) == 3 and "path" not in lista["files"][0]
    assert contenido == b"%PDF-2"
    assert len(despues["files"]) == 2


def test_validaciones_de_archivo_nodo_y_fecha():
    async def go(db):
        await _sembrar(db)
        with pytest.raises(HTTPException) as e1:
            await server.traz_subir_archivo("p1", "e1", _subida("virus.exe", b"MZ"), "", COORD)
        with pytest.raises(HTTPException) as e2:
            await server.traz_subir_archivo("p1", "x", _subida("a.pdf", b"x"), "", COORD)  # nodo de otro proyecto
        with pytest.raises(HTTPException) as e3:
            await server.traz_subir_archivo("p1", "e1", _subida("a.pdf", b""), "", COORD)
        ok = await server.traz_subir_archivo("p1", "e1", _subida("a.pdf", b"x"), "", COORD)
        with pytest.raises(HTTPException) as e4:
            await server.traz_editar_archivo("p1", ok["file"]["id"], server.TrazArchivoPatch(fecha="31/02/2026"), COORD)
        return e1.value.status_code, e2.value.status_code, e3.value.status_code, e4.value.status_code
    assert _con_db(go) == (400, 404, 400, 400)


def test_categorias_editables_por_proyecto():
    async def go(db):
        await _sembrar(db)
        r = await server.traz_guardar_categorias(
            "p1", server.TrazCategoriasIn(categorias=["  Planos  ", "planos", "", "Memorias"]), COORD)
        return r, (await server.traz_listar("p1", SUB))["categorias"]
    r, lista = _con_db(go)
    assert r["categorias"] == ["Planos", "Memorias"] and lista == ["Planos", "Memorias"]
