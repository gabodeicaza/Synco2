"""Ficha del proyecto y resumen del periodo (formato Innova): datos_contrato con los
campos de la ficha, captura/consulta del resumen y su salida en los informes
diario / semanal / mensual. Mongo simulada (`mongomock-motor`)."""
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_ficha_resumen")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from pydantic import ValidationError  # noqa: E402

import server  # noqa: E402

pytest.importorskip("mongomock_motor")
COORD = {"id": "u1", "role": server.ROLE_COORD, "name": "Coord", "email": "c@x.mx", "project_ids": ["p1"]}
CATS = ("reportes_diarios", "reportes_semanales", "reportes_mensuales")
INNOVA = {
    "id": "p1", "name": "Villa del Real", "constructora": "Constructora Base", "contract_number": "C-BASE",
    "cliente_principal": "Innova Schools", "start_date": "2026-01-05", "end_date": "2026-12-18",
    "modulos": {c: {"ficha_proyecto": True, "resumen_periodo": True} for c in CATS},
    "datos_contrato": {
        "obra": {"empresa": "ALFA SA", "contrato": "INV-VR-01", "ubicacion": "Tecámac, Estado de México",
                 "monto": "$10,000,000.00", "plazo_dias": "347"},
        "supervision": {"servicio": "Supervisión técnica y control de calidad", "residente": "Ing. Ana Pérez"},
    },
}


def _con_db(fn):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    old = server.db
    server.db = db
    try:
        return asyncio.run(fn(db))
    finally:
        server.db = old


def _ventana(dia: str, dias: int = 0):
    from datetime import timedelta
    fin = datetime.fromisoformat(dia).replace(tzinfo=server.MX_TZ) + timedelta(hours=23, minutes=59)
    return fin - timedelta(days=dias, hours=23, minutes=59), fin


# ------------------------------------------------------------------ ficha
def test_ficha_junta_datos_del_contrato_y_base_del_proyecto():
    filas = dict((k, v) for k, v in server._ficha_proyecto_filas(INNOVA))
    assert filas["CLIENTE"] == "Innova Schools"
    assert filas["SERVICIO"] == "Supervisión técnica y control de calidad"
    assert filas["UBICACIÓN"] == "Tecámac, Estado de México"
    assert filas["CONTRATO"] == "INV-VR-01" and filas["CONTRATISTA DE OBRA"] == "ALFA SA"
    assert filas["PLAZO"] == "347 días · 05/01/2026 – 18/12/2026"
    assert filas["RESIDENTE DE SUPERVISIÓN"] == "Ing. Ana Pérez"
    assert filas["MONTO DE OBRA SUPERVISADA"] == "$10,000,000.00"


def test_ficha_omite_lo_que_no_tiene_y_cae_a_los_datos_base():
    filas = server._ficha_proyecto_filas({"id": "x", "constructora": "Base SA", "contract_number": "C-9"})
    assert filas == [["CONTRATO", "C-9"], ["CONTRATISTA DE OBRA", "Base SA"]]
    assert server._ficha_proyecto_filas({"id": "x"}) == []


def test_los_campos_de_ficha_no_cambian_la_hoja_de_contrato():
    # Solo residente / servicio / plazo: la hoja "DATOS DE CONTRATO" no debe aparecer
    proj = {"id": "x", "datos_contrato": {"supervision": {"residente": "Ing. X", "servicio": "S"},
                                          "obra": {"plazo_dias": "100"}}}
    assert server._contrato_bloques(proj) == []
    assert server._sanitize_datos_contrato(proj["datos_contrato"])["supervision"]["residente"] == "Ing. X"


# ------------------------------------------------------------------ semáforo
@pytest.mark.parametrize("fisico,programado,esperado", [
    (50.0, 50.0, "verde"), (47.0, 50.0, "verde"), (45.0, 50.0, "verde"),   # −5 es el límite verde
    (44.9, 50.0, "ambar"), (35.0, 50.0, "ambar"), (34.9, 50.0, "rojo"), (10.0, 80.0, "rojo"),
    (60.0, 50.0, "verde"),
])
def test_estatus_sale_de_la_desviacion(fisico, programado, esperado):
    assert server._resumen_estatus({"avance_fisico": fisico, "programado": programado}) == esperado


def test_estatus_capturado_manda_y_sin_datos_no_hay_estatus():
    assert server._resumen_estatus({"avance_fisico": 10, "programado": 80, "estatus": "verde"}) == "verde"
    assert server._resumen_estatus({"avance_fisico": 10}) is None
    assert server._resumen_estatus({}) is None


def test_bloques_del_resumen():
    doc = {"avance_fisico": 42.5, "programado": 45.0, "avance_financiero": 40.0, "estimado": "$4,000,000.00",
           "mensajes": ["Se coló la losa", "  ", "Falta definir acabado"]}
    b = server._resumen_periodo_bloques(doc)
    assert b[0] == {"type": "summary", "text": "ESTATUS GENERAL: EN TIEMPO"}
    filas = dict((r[0], r[1]) for r in b[1]["rows"])
    assert filas["Avance físico"] == "42.5%" and filas["Avance físico programado"] == "45%"
    assert filas["Desviación"] == "-2.5 pts vs. programa" and filas["Monto estimado"] == "$4,000,000.00"
    assert [i["body"] for i in b[2]["items"]] == ["Se coló la losa", "Falta definir acabado"]
    assert [i["title"] for i in b[2]["items"]] == ["01", "02"]
    assert server._resumen_periodo_bloques({}) == []


# ------------------------------------------------------------------ captura
def test_validaciones_del_resumen():
    base = dict(jerarquia="semanal", fecha_corte="2026-11-01")
    with pytest.raises(ValidationError):
        server.ResumenPeriodoIn(**base, avance_fisico=101)
    with pytest.raises(ValidationError):
        server.ResumenPeriodoIn(**base, estatus="azul")
    with pytest.raises(ValidationError):
        server.ResumenPeriodoIn(**base, mensajes=["a"] * 6)
    with pytest.raises(ValidationError):
        server.ResumenPeriodoIn(jerarquia="anual", fecha_corte="2026-11-01")


def test_upsert_un_solo_resumen_por_informe_y_borrado():
    async def go(db):
        await db.projects.insert_one(dict(INNOVA))
        a = await server.upsert_resumen_periodo(
            "p1", server.ResumenPeriodoIn(jerarquia="semanal", fecha_corte="2026-11-01", avance_fisico=40, programado=50,
                                          mensajes=["uno", " "]), COORD)
        assert a["desviacion"] == -10.0 and a["estatus_efectivo"] == "ambar" and a["mensajes"] == ["uno"]
        b = await server.upsert_resumen_periodo(
            "p1", server.ResumenPeriodoIn(jerarquia="semanal", fecha_corte="2026-11-01", avance_fisico=48, programado=50,
                                          estimado="  $1.00 "), COORD)
        assert b["id"] == a["id"] and b["estatus_efectivo"] == "verde" and b["estimado"] == "$1.00"
        otro = await server.upsert_resumen_periodo(
            "p1", server.ResumenPeriodoIn(jerarquia="mensual", fecha_corte="2026-11-01"), COORD)
        assert otro["id"] != a["id"]
        assert len(await server.list_resumenes_periodo("p1", None, 50, COORD)) == 2
        assert [r["id"] for r in await server.list_resumenes_periodo("p1", "mensual", 50, COORD)] == [otro["id"]]
        with pytest.raises(HTTPException) as e:
            await server.upsert_resumen_periodo(
                "p1", server.ResumenPeriodoIn(jerarquia="semanal", fecha_corte="01/11/2026"), COORD)
        assert e.value.status_code == 400
        await server.delete_resumen_periodo("p1", a["id"], COORD)
        with pytest.raises(HTTPException) as e:
            await server.delete_resumen_periodo("p1", a["id"], COORD)
        assert e.value.status_code == 404
    _con_db(go)


def test_no_se_captura_con_el_modulo_apagado():
    async def go(db):
        await db.projects.insert_one({"id": "p1", "name": "X", "modulos": {c: {} for c in CATS}})
        with pytest.raises(HTTPException) as e:
            await server.upsert_resumen_periodo(
                "p1", server.ResumenPeriodoIn(jerarquia="diario", fecha_corte="2026-11-01"), COORD)
        assert e.value.status_code == 403
    _con_db(go)


# ------------------------------------------------------------------ informes
def test_el_informe_imprime_ficha_y_el_resumen_de_su_jerarquia():
    async def go(db):
        await db.projects.insert_one(dict(INNOVA))
        for jer, fisico in (("diario", 11), ("semanal", 22), ("mensual", 33)):
            await server.upsert_resumen_periodo(
                "p1", server.ResumenPeriodoIn(jerarquia=jer, fecha_corte="2026-11-01", avance_fisico=fisico, programado=fisico), COORD)
        for cat, fisico in (("reportes_diarios", "11%"), ("reportes_semanales", "22%"), ("reportes_mensuales", "33%")):
            ini, fin = _ventana("2026-11-01", 6 if cat == "reportes_semanales" else 0)
            proj = await db.projects.find_one({"id": "p1"})
            out = await server._gather_modulos_export_data("p1", proj, ini, fin, cat)
            assert out["ficha_proyecto"]["titulo"] == "FICHA DEL PROYECTO"
            assert fisico in repr(out["resumen_periodo"]), cat
            # ficha y resumen abren el informe
            claves = [k for k, v in out.items() if v]
            assert claves[:2] == ["ficha_proyecto", "resumen_periodo"]
    _con_db(go)


def test_sin_resumen_en_la_ventana_o_con_el_modulo_apagado_no_se_imprime():
    async def go(db):
        await db.projects.insert_one(dict(INNOVA))
        await server.upsert_resumen_periodo(
            "p1", server.ResumenPeriodoIn(jerarquia="semanal", fecha_corte="2026-10-01", avance_fisico=5), COORD)
        proj = await db.projects.find_one({"id": "p1"})
        ini, fin = _ventana("2026-11-01", 6)
        out = await server._gather_modulos_export_data("p1", proj, ini, fin, "reportes_semanales")
        assert out["resumen_periodo"] is None and out["ficha_proyecto"] is not None
        apagado = dict(proj, modulos={c: {} for c in CATS})
        out = await server._gather_modulos_export_data("p1", apagado, ini, fin, "reportes_semanales")
        assert out["ficha_proyecto"] is None and out["resumen_periodo"] is None
    _con_db(go)


def test_edificacion_enciende_ficha_y_resumen_en_los_tres_informes():
    m = server.modulos_por_defecto_de_tipo("edificacion")
    assert all(m[c]["ficha_proyecto"] and m[c]["resumen_periodo"] for c in CATS)
    g = server.modulos_por_defecto_de_tipo("generica")
    assert not any(g[c]["ficha_proyecto"] or g[c]["resumen_periodo"] for c in CATS)
