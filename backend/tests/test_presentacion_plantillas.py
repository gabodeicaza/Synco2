"""Plantillas de presentación: la "semanal" integrada, las propias del Coordinador
(crear / editar / borrar) y la creación de una presentación a partir de ellas.

Mongo simulada (`mongomock-motor`) y llamadas directas a las funciones de los
endpoints — sin HTTP ni auth real."""
import asyncio
import os
import sys
import uuid
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_presentacion_plantillas")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from pydantic import ValidationError  # noqa: E402

import server  # noqa: E402


mongomock_motor = pytest.importorskip("mongomock_motor")


@pytest.fixture(autouse=True)
def _db_simulada():
    """Cada prueba con su base vacía; se restaura la de `server` al terminar."""
    original = server.db
    server.db = mongomock_motor.AsyncMongoMockClient()["t"]
    yield
    server.db = original


def _run(coro):
    return asyncio.run(coro)


def _user(pid):
    return {"id": str(uuid.uuid4()), "name": "Coord", "role": server.ROLE_COORD, "project_ids": [pid]}


def _plantilla_in(**kw):
    base = dict(
        nombre=f"Innova {uuid.uuid4().hex[:6]}",
        secciones=[
            {"tipo": "portada"}, {"tipo": "divisor", "titulo": "  AVANCE DE OBRA  "},
            {"tipo": "reportes_semana"}, {"tipo": "calidad"}, {"tipo": "cierre"},
        ])
    base.update(kw)
    return server.PresPlantillaIn(**base)


def test_semanal_integrada_va_primero_y_conserva_su_esqueleto():
    async def go():
        lista = await server.list_presentacion_plantillas({})
        assert lista[0]["id"] == "semanal" and lista[0]["integrada"] is True
        assert lista[0]["incluir_estaciones"] is True
        tipos = [s["tipo"] for s in lista[0]["secciones"]]
        assert tipos[0] == "portada" and tipos[-1] == "cierre" and "reportes_semana" in tipos
        # el helper histórico sigue entregando el mismo esqueleto, en orden
        viejo = server._secciones_plantilla_semanal()
        assert [s["tipo"] for s in viejo] == tipos and [s["orden"] for s in viejo] == list(range(len(tipos)))
    _run(go())


def test_la_integrada_no_se_edita_ni_se_borra():
    async def go():
        user = _user("p")
        with pytest.raises(HTTPException) as e1:
            await server.update_presentacion_plantilla("semanal", server.PresPlantillaPatch(nombre="x"), user)
        assert e1.value.status_code == 400
        with pytest.raises(HTTPException) as e2:
            await server.delete_presentacion_plantilla("semanal", user)
        assert e2.value.status_code == 400
    _run(go())


def test_crud_de_plantilla_propia():
    async def go():
        user = _user("p")
        creada = await server.create_presentacion_plantilla(_plantilla_in(nombre="  Innova Centro Escolar  "), user)
        try:
            assert creada["nombre"] == "Innova Centro Escolar" and creada["integrada"] is False
            assert [s["titulo"] for s in creada["secciones"]] == [None, "AVANCE DE OBRA", None, None, None]
            assert any(p["id"] == creada["id"] for p in await server.list_presentacion_plantillas({}))

            editada = await server.update_presentacion_plantilla(
                creada["id"],
                server.PresPlantillaPatch(secciones=[{"tipo": "portada"}, {"tipo": "cierre"}], incluir_estaciones=True), user)
            assert [s["tipo"] for s in editada["secciones"]] == ["portada", "cierre"]
            assert editada["incluir_estaciones"] is True and editada["nombre"] == "Innova Centro Escolar"
        finally:
            await server.delete_presentacion_plantilla(creada["id"], user)
        assert all(p["id"] != creada["id"] for p in await server.list_presentacion_plantillas({}))
        with pytest.raises(HTTPException) as e:
            await server.delete_presentacion_plantilla(creada["id"], user)
        assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            await server.update_presentacion_plantilla(creada["id"], server.PresPlantillaPatch(nombre="x"), user)
        assert e.value.status_code == 404
    _run(go())


def test_validaciones_de_plantilla():
    with pytest.raises(ValidationError):
        server.PresPlantillaIn(nombre="", secciones=[])
    with pytest.raises(ValidationError):
        server.PresPlantillaIn(nombre="x", secciones=[{"tipo": "no_existe"}])
    with pytest.raises(ValidationError):  # el croquis depende de una estación concreta
        server.PresPlantillaIn(nombre="x", secciones=[{"tipo": "croquis_estacion"}])
    with pytest.raises(ValidationError):
        server.PresPlantillaPatch(secciones=[{"tipo": "croquis_estacion"}])


def test_presentacion_desde_plantilla_propia():
    async def go():
        pid = str(uuid.uuid4())
        user = _user(pid)
        await server.db.projects.insert_one({"id": pid, "name": "P"})
        # estación en el árbol: una plantilla SIN estaciones no debe traerla
        await server.db.location_nodes.insert_one(
            {"id": str(uuid.uuid4()), "project_id": pid, "parent_id": None, "name": "ESTACIÓN 1",
             "order": 0, "tipo_nodo": "estacion", "cover_image": None})
        tpl = await server.create_presentacion_plantilla(_plantilla_in(), user)
        tpl_est = await server.create_presentacion_plantilla(_plantilla_in(incluir_estaciones=True), user)
        try:
            pres = await server.create_presentacion(
                pid, server.PresentacionIn(project_id=pid, fecha="2026-11-02", plantilla=tpl["id"]), user)
            secs = sorted(pres["secciones"], key=lambda s: s["orden"])
            assert [s["tipo"] for s in secs] == ["portada", "divisor", "reportes_semana", "calidad", "cierre"]
            assert secs[1]["titulo"] == "AVANCE DE OBRA" and [s["orden"] for s in secs] == [0, 1, 2, 3, 4]
            assert pres["plantilla_id"] == tpl["id"]
            assert len({s["id"] for s in secs}) == 5

            con_est = await server.create_presentacion(
                pid, server.PresentacionIn(project_id=pid, fecha="2026-11-02", plantilla=tpl_est["id"]), user)
            tipos = [s["tipo"] for s in sorted(con_est["secciones"], key=lambda s: s["orden"])]
            assert tipos.count("informacion_particular") == 1 and tipos[-1] == "cierre"

            vacia = await server.create_presentacion(pid, server.PresentacionIn(project_id=pid, fecha="2026-11-02"), user)
            assert vacia["secciones"] == [] and "plantilla_id" not in vacia

            with pytest.raises(HTTPException) as e:
                await server.create_presentacion(
                    pid, server.PresentacionIn(project_id=pid, fecha="2026-11-02", plantilla="no-existe"), user)
            assert e.value.status_code == 400

            # borrar la plantilla no toca la presentación ya creada
            await server.delete_presentacion_plantilla(tpl["id"], user)
            assert len((await server.get_presentacion(pid, pres["id"], user))["secciones"]) == 5
        finally:
            await server.db.presentacion_plantillas.delete_many({"id": {"$in": [tpl["id"], tpl_est["id"]]}})
            await server.db.presentaciones.delete_many({"project_id": pid})
            await server.db.location_nodes.delete_many({"project_id": pid})
            await server.db.projects.delete_many({"id": pid})
    _run(go())
