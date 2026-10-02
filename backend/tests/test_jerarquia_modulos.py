"""Jerarquía por registro en los módulos de captura: cada registro llega a UN
solo informe (diario / semanal / mensual); "informativo" a ninguno; un registro
sin jerarquía (legado) sigue saliendo en todos los informes donde el módulo
esté encendido."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_jerarquia")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import server  # noqa: E402
from server import ROLE_COORD  # noqa: E402

pytest.importorskip("mongomock_motor")
COORD = {"id": "u1", "role": ROLE_COORD, "name": "C", "email": "c@x.mx", "project_ids": ["p1"]}
CATS = ("reportes_diarios", "reportes_semanales", "reportes_mensuales")
MODS = ("forestal_arbolado", "seguridad_higiene", "gestion_riesgos", "estudios_proyecto", "impacto_ambiental",
        "pruebas_calidad", "control_calidad", "actividades_particulares")
ACTIVO = {c: {m: True for m in MODS} for c in CATS}
# (clave de salida en gather, jerarquía) → una por informe + informativo + legado
JERARQUIAS = ("diario", "semanal", "mensual", "informativo", None)


def _con_db(fn):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    old = server.db
    server.db = db
    try:
        return asyncio.run(fn(db))
    finally:
        server.db = old


def _texto(bloque) -> str:
    return repr(bloque).lower()


async def _sembrar(db):
    hoy = datetime.now(server.MX_TZ).date().isoformat()
    ahora = datetime.now(timezone.utc)
    await db.projects.insert_one({"id": "p1", "name": "Demo", "modulos": ACTIVO})
    await db.act_part_cat.insert_one({"id": "c1", "project_id": "p1", "nombre": "CAT", "subcategorias": [], "orden": 1})
    await db.location_nodes.insert_one({"id": "n1", "project_id": "p1", "name": "ESTACIÓN 1", "parent_id": None,
                                        "depth": 0, "order": 0, "is_leaf": True})
    for j in JERARQUIAS:
        tag = j or "legado"
        extra = {"jerarquia": j} if j else {}  # legado = sin el campo
        base = {"project_id": "p1", "fecha": hoy, "created_at": ahora, "updated_at": ahora, **extra}
        await db.forestal_registros.insert_one({**base, "id": f"f-{tag}", "tipo": "poda", "cantidad": 1})
        await db.seguridad_reportes.insert_one({**base, "id": f"s-{tag}", "tipo_registro": "incidente",
                                                "descripcion": f"SEG-{tag}"})
        await db.riesgos_registros.insert_one({**base, "id": f"r-{tag}", "estacion_nombre": "E1", "porcentaje_avance": 10,
                                               "descripcion_riesgo": f"RIESGO-{tag}", "propuesta_control": "x", "numerar": True})
        await db.estudios_bitacora.insert_one({**base, "id": f"e-{tag}", "disciplina": "topografia", "texto": f"EST-{tag}"})
        await db.ambiental_auditoria.insert_one({**base, "id": f"a-{tag}", "tipo": "cumplimiento", "descripcion": f"AMB-{tag}"})
        await db.pruebas_calidad.insert_one({**base, "id": f"p-{tag}", "frente": f"FRENTE-{tag}", "node_id": "n1"})
        await db.control_calidad.insert_one({**base, "id": f"c-{tag}", "grupo": f"GRUPO-{tag}",
                                             "foto": "data:image/jpeg;base64,/9j/", "thumb": "x"})
        await db.actividades_particulares.insert_one({**base, "id": f"ap-{tag}", "node_id": "n1", "categoria_id": "c1",
                                                      "categoria_nombre": "CAT", "texto": f"ACT-{tag}"})


async def _export(db, categoria):
    proj = await db.projects.find_one({"id": "p1"})
    ini = datetime.now(timezone.utc) - timedelta(days=1)
    fin = datetime.now(timezone.utc) + timedelta(days=1)
    return await server._gather_modulos_export_data("p1", proj, ini, fin, categoria)


def test_cada_registro_llega_solo_a_su_informe_y_el_legado_a_todos():
    async def go(db):
        await _sembrar(db)
        esperado = {"reportes_diarios": "diario", "reportes_semanales": "semanal", "reportes_mensuales": "mensual"}
        for cat, jer in esperado.items():
            out = await _export(db, cat)
            for clave, marca in (("seguridad", "SEG"), ("riesgos", "RIESGO"), ("estudios", "EST"), ("ambiental", "AMB"),
                                 ("pruebas_calidad", "FRENTE"), ("control_calidad", "GRUPO"),
                                 ("actividades_particulares", "ACT")):
                t = _texto(out[clave])
                assert f"-{jer}" in t, (cat, clave)
                assert "-legado" in t, (cat, clave)
                for otra in ("diario", "semanal", "mensual", "informativo"):
                    if otra != jer:
                        assert f"{marca.lower()}-{otra}" not in t, (cat, clave, otra)
            # forestal: cuenta por registro (1 por jerarquía que aplica: la suya + legado)
            assert out["forestal"]["blocks"][0]["contadores"]["poda"] == 2, cat
    _con_db(go)


def test_informativo_no_sale_en_ningun_informe():
    async def go(db):
        await _sembrar(db)
        for cat in CATS:
            out = await _export(db, cat)
            assert "informativo" not in _texto(out["estudios"]) and "informativo" not in _texto(out["ambiental"])
    _con_db(go)


def test_captura_nueva_nace_diaria_y_valida_la_jerarquia():
    async def go(db):
        await db.projects.insert_one({"id": "p1", "name": "Demo", "modulos": ACTIVO})
        r = await server.create_estudio_bitacora(
            "p1", server.EstudioBitacoraIn(disciplina="topografia", texto="a"), COORD)
        assert r["jerarquia"] == "diario"
        r2 = await server.create_estudio_bitacora(
            "p1", server.EstudioBitacoraIn(disciplina="topografia", texto="b", jerarquia=" Semanal "), COORD)
        assert r2["jerarquia"] == "semanal"
        with pytest.raises(HTTPException) as e:
            await server.create_estudio_bitacora(
                "p1", server.EstudioBitacoraIn(disciplina="topografia", texto="c", jerarquia="urgente"), COORD)
        assert e.value.status_code == 400
        # edición: cambiar la jerarquía de una prueba
        p = await server.create_prueba_calidad("p1", server.PruebaCalidadIn(frente="F"), COORD)
        assert p["jerarquia"] == "diario"
        p = await server.update_prueba_calidad("p1", p["id"], server.PruebaCalidadPatch(jerarquia="mensual"), COORD)
        assert p["jerarquia"] == "mensual"
    _con_db(go)


# ── Pendientes generales: "resueltos en el período" (semanal y mensual) ────
def test_pendientes_resueltos_en_el_periodo_bloque():
    ini, fin = datetime(2026, 9, 21, tzinfo=timezone.utc), datetime(2026, 9, 27, tzinfo=timezone.utc)
    regs = [
        {"contrato": "obra", "titulo": "Abierto"},
        {"contrato": "obra", "titulo": "Cerrado en la semana", "resuelto": True,
         "resuelto_at": datetime(2026, 9, 23, 18, tzinfo=timezone.utc)},
        {"contrato": "obra", "titulo": "Cerrado antes", "resuelto": True,
         "resuelto_at": datetime(2026, 8, 1, tzinfo=timezone.utc)},
        {"contrato": "supervision", "titulo": "Legado cerrado", "resuelto": True,
         "updated_at": datetime(2026, 9, 25, tzinfo=timezone.utc)},
    ]
    obra, sup = server.PENDIENTE_AMBITO_HEADING["obra"], server.PENDIENTE_AMBITO_HEADING["supervision"]
    assert [b["heading"] for b in server._pendientes_bloques(regs)] == [obra]  # sin rango: solo vigentes
    titulos = {b["heading"]: b for b in server._pendientes_bloques(regs, ini, fin)}
    sufijo = " · RESUELTOS EN EL PERÍODO"
    assert [i["title"] for i in titulos[obra]["items"]] == ["Abierto"]
    assert [i["title"] for i in titulos[obra + sufijo]["items"]] == ["Cerrado en la semana"]
    assert titulos[obra + sufijo]["items"][0]["meta"] == "Resuelto el 23/09/2026"
    assert [i["title"] for i in titulos[sup + sufijo]["items"]] == ["Legado cerrado"]


def test_pendientes_resolver_guarda_fecha_y_el_export_solo_la_usa_en_semanal_mensual():
    async def go(db):
        mod = {c: {"pendientes_generales": True} for c in CATS}
        await db.projects.insert_one({"id": "p1", "name": "Demo", "modulos": mod})
        a = await server.create_pendiente_general("p1", server.PendienteIn(contrato="obra", titulo="A"), COORD)
        await server.create_pendiente_general("p1", server.PendienteIn(contrato="obra", titulo="B"), COORD)
        r = await server.update_pendiente_general("p1", a["id"], server.PendientePatch(resuelto=True), COORD)
        assert r["resuelto_at"] is not None
        for cat, esperado in (("reportes_diarios", False), ("reportes_semanales", True), ("reportes_mensuales", True)):
            out = await _export(db, cat)
            texto = repr(out["pendientes_generales"])
            assert ("RESUELTOS EN EL PERÍODO" in texto) is esperado, cat
            assert "'B'" in texto
        r = await server.update_pendiente_general("p1", a["id"], server.PendientePatch(resuelto=False), COORD)
        assert r["resuelto_at"] is None
    _con_db(go)
