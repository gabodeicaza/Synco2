"""Captura tolerante en los módulos nuevos (Estimaciones no dejaba guardar fechas
tipo 08/12/2025 ni importes con "N/A" pegados de Excel) y asignación de Área a
cada módulo por el Coordinador General (agrupa el hub de módulos)."""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_modulos_areas")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import server  # noqa: E402

pytest.importorskip("mongomock_motor")
COORD = {"id": "u1", "role": server.ROLE_COORD, "name": "C", "email": "c@x.mx", "project_ids": ["p1"]}
ACTIVO = {"reportes_diarios": {}, "reportes_semanales": {"estimaciones": True}, "reportes_mensuales": {}}


def _con_db(coro_fn):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    old = server.db
    server.db = db
    try:
        async def go():
            await db.projects.insert_one({"id": "p1", "name": "P", "modulos": ACTIVO})
            await db.areas.insert_many([{"id": "a1", "project_id": "p1", "name": "Calidad"},
                                        {"id": "a9", "project_id": "otro", "name": "Ajena"}])
            return await coro_fn(db)
        return asyncio.run(go())
    finally:
        server.db = old


@pytest.mark.parametrize("texto,iso", [
    ("2025-12-08", "2025-12-08"), ("08/12/2025", "2025-12-08"), ("8-12-2025", "2025-12-08"),
    ("08.12.25", "2025-12-08"), ("2025/12/08", "2025-12-08"), ("2025-12-08T10:00:00", "2025-12-08"),
])
def test_fecha_flexible(texto, iso):
    assert server._fecha_flexible(texto).isoformat() == iso


@pytest.mark.parametrize("malo", ["", "ayer", "31/02/2025", "2025-13-01", "12/2025"])
def test_fecha_flexible_rechaza_lo_que_no_es_fecha(malo):
    with pytest.raises(ValueError):
        server._fecha_flexible(malo)


def test_estimacion_guarda_fechas_y_importes_pegados_de_excel():
    async def go(db):
        body = server.EstimacionIn(numero=3, periodo_inicio="08/12/2025", periodo_fin="31-12-2025", estatus="LIBERADA",
                                   obra_ejecutada="$ 5,978,451.30", amortizacion="N/A", iva=" - ",
                                   pct_amortizacion_anticipo="22%", fecha_pago="Por pagar")
        out = await server.create_estimacion("p1", body, COORD)
        assert out["periodo_inicio"] == "2025-12-08" and out["periodo_fin"] == "2025-12-31"
        assert out["obra_ejecutada"] == "5978451.30" and out["amortizacion"] is None and out["iva"] is None
        assert out["fecha_pago"] == "Por pagar"
        upd = await server.update_estimacion("p1", out["id"], server.EstimacionPatch(fecha_pago="15/01/2026"), COORD)
        assert upd["fecha_pago"] == "2026-01-15"
    _con_db(go)


def test_estimacion_error_dice_que_campo_esta_mal():
    async def go(db):
        with pytest.raises(HTTPException) as e:
            await server.create_estimacion("p1", server.EstimacionIn(numero=1, total_neto="mucho"), COORD)
        assert e.value.status_code == 400 and "Total neto" in e.value.detail
        with pytest.raises(HTTPException) as e:
            await server.create_estimacion("p1", server.EstimacionIn(numero=1, periodo_fin="nunca"), COORD)
        assert "Periodo: fin" in e.value.detail
    _con_db(go)


def test_asignar_area_a_modulo_y_quitarla():
    async def go(db):
        p = await server.set_project_modulos_areas("p1", {"estimaciones": "a1", "pruebas_calidad": "a1"}, COORD)
        assert p["modulos_areas"] == {"estimaciones": "a1", "pruebas_calidad": "a1"}
        p = await server.set_project_modulos_areas("p1", {"estimaciones": None}, COORD)  # parcial: quita solo una
        assert p["modulos_areas"] == {"pruebas_calidad": "a1"}
        with pytest.raises(HTTPException):
            await server.set_project_modulos_areas("p1", {"no_existe": "a1"}, COORD)
        with pytest.raises(HTTPException):  # área de OTRO proyecto
            await server.set_project_modulos_areas("p1", {"estimaciones": "a9"}, COORD)
        with pytest.raises(HTTPException):
            await server.set_project_modulos_areas("zzz", {"estimaciones": "a1"}, COORD)
        got = await server.get_project("p1", COORD)
        assert got["modulos_areas"] == {"pruebas_calidad": "a1"}
    _con_db(go)


def test_proyecto_sin_asignaciones_devuelve_dict_vacio():
    async def go(db):
        assert (await server.get_project("p1", COORD))["modulos_areas"] == {}
    _con_db(go)
