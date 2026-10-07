"""Asistencia (server.py): se deriva del primer reporte del día (hora CDMX y
ubicación), el Sub-Coordinador puede justificar faltas de Especialistas y
registrar la suya. Contra una Mongo simulada (`mongomock-motor`)."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_asistencia")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import server  # noqa: E402

pytest.importorskip("mongomock_motor")

HOY = datetime.now(server.MX_TZ).date()
AYER = HOY - timedelta(days=1)
ANTEAYER = HOY - timedelta(days=2)
COORD = {"id": "c1", "role": server.ROLE_COORD, "name": "Coord"}
SUB = {"id": "s1", "role": server.ROLE_SUB, "name": "Sub", "project_ids": ["p1"]}
SUB2 = {"id": "s2", "role": server.ROLE_SUB, "name": "Sub Dos", "project_ids": ["p1"]}
ESP_USER = {"id": "e1", "role": server.ROLE_ESPECIALISTA, "name": "Esp", "project_ids": ["p1"]}


def _mx(d, hh, mm):
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=server.MX_TZ).astimezone(timezone.utc)


def _con_db(coro_fn):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    old = server.db
    server.db = db
    try:
        return asyncio.run(coro_fn(db))
    finally:
        server.db = old


async def _sembrar(db):
    await db.projects.insert_one({"id": "p1", "name": "Demo"})
    viejo = datetime.now(timezone.utc) - timedelta(days=90)
    for u in (SUB, SUB2, ESP_USER, {"id": "e2", "role": server.ROLE_ESPECIALISTA, "name": "Ana", "project_ids": ["p1"]}):
        await db.users.insert_one({**u, "created_at": viejo})
    # e1 reporta ayer dos veces (gana la de las 08:10) y hoy a las 09:00
    for hh, mm, nodo in ((11, 30, ["Tramo 1", "S2"]), (8, 10, ["Tramo 1", "S1"])):
        await db.reports.insert_one({"project_id": "p1", "captured_by": "e1", "created_at": _mx(AYER, hh, mm),
                                     "node_path_names": nodo, "measurement_value": {"lat": 19.4, "lon": -99.1}})
    await db.reports.insert_one({"project_id": "p1", "captured_by": "e1", "created_at": _mx(HOY, 9, 0),
                                 "node_path_names": ["Tramo 2"], "measurement_value": {}})


def test_primer_reporte_del_dia_marca_asistencia_con_hora_y_ubicacion():
    async def go(db):
        await _sembrar(db)
        return await server.get_asistencia("p1", ANTEAYER.isoformat(), HOY.isoformat(), COORD)
    r = _con_db(go)
    assert [p["id"] for p in r["personas"]] == ["s2", "s1", "e2", "e1"] or r["personas"][0]["role"] == server.ROLE_SUB
    reg = r["registros"][f"e1|{AYER.isoformat()}"]
    assert reg["estado"] == "asistio" and reg["hora"] == "08:10" and reg["ubicacion"] == "Tramo 1 › S1"
    assert reg["lat"] == 19.4 and reg["fuente"] == "reporte"
    assert r["registros"][f"e1|{HOY.isoformat()}"]["hora"] == "09:00"
    assert f"e1|{ANTEAYER.isoformat()}" not in r["registros"] and f"e2|{AYER.isoformat()}" not in r["registros"]


def test_subcoord_justifica_falta_de_especialista_y_puede_volver_a_auto():
    async def go(db):
        await _sembrar(db)
        await server.put_asistencia("p1", "e2", ANTEAYER.isoformat(),
                                    server.AsistenciaEditIn(estado="justificada", nota="Cita médica"), SUB)
        r1 = await server.get_asistencia("p1", ANTEAYER.isoformat(), HOY.isoformat(), SUB)
        await server.put_asistencia("p1", "e2", ANTEAYER.isoformat(), server.AsistenciaEditIn(estado="auto"), SUB)
        r2 = await server.get_asistencia("p1", ANTEAYER.isoformat(), HOY.isoformat(), SUB)
        return r1, r2
    r1, r2 = _con_db(go)
    reg = r1["registros"][f"e2|{ANTEAYER.isoformat()}"]
    assert reg["estado"] == "justificada" and reg["nota"] == "Cita médica" and reg["fuente"] == "manual"
    assert f"e2|{ANTEAYER.isoformat()}" not in r2["registros"]


def test_subcoord_se_registra_solo_y_no_edita_a_otro_subcoord():
    async def go(db):
        await _sembrar(db)
        a = await server.registrar_asistencia("p1", server.AsistenciaRegistrarIn(lat=19.43, lon=-99.13), SUB)
        b = await server.registrar_asistencia("p1", server.AsistenciaRegistrarIn(), SUB)
        r = await server.get_asistencia("p1", HOY.isoformat(), HOY.isoformat(), SUB)
        with pytest.raises(HTTPException) as e:
            await server.put_asistencia("p1", "s2", HOY.isoformat(), server.AsistenciaEditIn(estado="falta"), SUB)
        await server.put_asistencia("p1", "s1", AYER.isoformat(), server.AsistenciaEditIn(estado="justificada"), SUB)
        await server.put_asistencia("p1", "s2", AYER.isoformat(), server.AsistenciaEditIn(estado="justificada"), COORD)
        return a, b, r, e.value.status_code
    a, b, r, code = _con_db(go)
    assert a["ya_registrada"] is False and b["ya_registrada"] is True and code == 403
    reg = r["registros"][f"s1|{HOY.isoformat()}"]
    assert reg["fuente"] == "registro" and reg["lat"] == 19.43 and reg["hora"]


def test_validaciones():
    async def go(db):
        await _sembrar(db)
        for args in (("p1", "2020-01-01", "2020-12-31", COORD), ("p1", HOY.isoformat(), ANTEAYER.isoformat(), COORD),
                     ("p1", "x", "y", COORD)):
            with pytest.raises(HTTPException) as e:
                await server.get_asistencia(*args)
            assert e.value.status_code == 400
        with pytest.raises(HTTPException) as e:
            await server.put_asistencia("p1", "e1", (HOY + timedelta(days=1)).isoformat(),
                                        server.AsistenciaEditIn(estado="falta"), COORD)
        assert e.value.status_code == 400
        with pytest.raises(HTTPException) as e:
            await server.put_asistencia("p1", "nadie", HOY.isoformat(), server.AsistenciaEditIn(estado="falta"), COORD)
        assert e.value.status_code == 404
    _con_db(go)
