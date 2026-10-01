"""Seguridad e Higiene — registro de accidentes (server.py).

Formato de la bitácora: Fecha, Mes, Nombre del trabajador, Contratista,
Registro (Sin accidentes / Daño a la propiedad / Incidente / Accidente leve —
primeros auxilios / Incapacitante / Grave), Ubicación, Descripción, Foto y
Seguimiento. Tests puros + prueba de punta a punta de PDF, PPTX y DOCX contra
una Mongo simulada (`mongomock-motor`, se omite si no está instalado).
"""
import asyncio
import io
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_seguridad")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

import server  # noqa: E402
from server import (  # noqa: E402
    SEGURIDAD_TIPO_LABEL, SEGURIDAD_TIPOS, _seguridad_mes, _seguridad_out, _seguridad_registro_label,
)


def test_los_seis_registros_pedidos_existen_con_su_etiqueta():
    assert SEGURIDAD_TIPOS == ("sin_accidentes", "dano_propiedad", "incidente",
                               "accidente_leve", "incapacitante", "grave")
    assert [SEGURIDAD_TIPO_LABEL[t] for t in SEGURIDAD_TIPOS] == [
        "Sin accidentes", "Daño a la propiedad", "Incidente",
        "Accidente leve / primeros auxilios", "Incapacitante", "Grave",
    ]


def test_mes_se_deriva_de_la_fecha():
    assert _seguridad_mes("2026-10-01") == "Octubre"
    assert _seguridad_mes("2026-01-31") == "Enero"
    assert _seguridad_mes("") == "" and _seguridad_mes("basura") == "" and _seguridad_mes(None) == ""


def test_reportes_anteriores_al_formato_muestran_su_severidad():
    assert _seguridad_registro_label({"severidad": "moderado"}) == "Moderado"
    assert _seguridad_registro_label({"tipo_registro": "incapacitante", "severidad": "moderado"}) == "Incapacitante"
    out = _seguridad_out({"_id": 1, "fecha": "2026-03-05", "severidad": "grave"})
    assert "_id" not in out and out["mes"] == "Marzo" and out["registro_label"] == "Grave"


# ── Punta a punta (Mongo simulada) ─────────────────────────────────────────
mongomock_motor = pytest.importorskip("mongomock_motor")

_PNG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
USER = {"id": "u1", "role": server.ROLE_COORD, "name": "Coord", "email": "c@x.mx"}


def _db():
    from mongomock_motor import AsyncMongoMockClient
    return AsyncMongoMockClient()["t"]


async def _proyecto(db, fecha_hoy):
    await db.projects.insert_one({
        "id": "p1", "name": "Proyecto Demo", "color_institucional": "#003366",
        "modulos": {"reportes_diarios": {"seguridad_higiene": True}, "reportes_semanales": {}, "reportes_mensuales": {}},
    })
    await db.location_nodes.insert_one({"id": "n1", "project_id": "p1", "name": "TRAMO 1", "parent_id": None,
                                        "depth": 0, "order": 0, "is_leaf": True})


async def _alta_via_endpoint(db):
    """Crea los renglones por el endpoint real (valida el contrato de entrada)."""
    hoy = datetime.now(server.MX_TZ).date().isoformat()
    await server.create_seguridad_reporte("p1", server.SeguridadReporteIn(
        fecha=hoy, trabajador="Juan Pérez", contratista="Alfa", tipo_registro="incapacitante",
        ubicacion="Estación 3, poste S65", descripcion="Caída de andamio", images=[_PNG],
    ), USER)
    await server.create_seguridad_reporte("p1", server.SeguridadReporteIn(
        fecha=hoy, tipo_registro="sin_accidentes"), USER)


def _exportar(formato):
    db = _db()
    old = server.db
    server.db = db
    try:
        async def go():
            await _proyecto(db, None)
            await _alta_via_endpoint(db)
            common = dict(pid="p1", period="today", period_type="diario", area_id=None, scope=None, user=USER)
            if formato == "pdf":
                resp = await server.export_reports_pdf(
                    **common, recuento_nivel=None, recuento_node_ids=None, recuento_sin_datos=None,
                    estructura_solo=False)
            elif formato == "pptx":
                resp = await server.export_reports_pptx(
                    **common, recuento_nivel=None, recuento_node_ids=None, recuento_sin_datos=None)
            else:
                resp = await server.export_reports_docx(**common)
            return b"".join([c async for c in resp.body_iterator])
        return asyncio.run(go())
    finally:
        server.db = old


def _texto(formato, data):
    # Las celdas parten el texto en varias líneas: se compara con espacios colapsados.
    return " ".join(_texto_crudo(formato, data).split())


def _texto_crudo(formato, data):
    if formato == "pdf":
        from pypdf import PdfReader
        return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(data)).pages)
    if formato == "pptx":
        from pptx import Presentation
        prs = Presentation(io.BytesIO(data))
        return "\n".join(sh.text_frame.text for sl in prs.slides for sh in sl.shapes if sh.has_text_frame)
    from docx import Document
    d = Document(io.BytesIO(data))
    celdas = [c.text for t in d.tables for r in t.rows for c in r.cells]
    return "\n".join([p.text for p in d.paragraphs] + celdas)


@pytest.mark.parametrize("formato", ["pdf", "pptx", "docx"])
def test_el_informe_imprime_el_registro_de_accidentes_completo(formato):
    texto = _texto(formato, _exportar(formato))
    for esperado in ("Registro de accidentes", "Juan Pérez", "Alfa", "Incapacitante", "Estación 3, poste S65",
                     "Caída de andamio", "Sin accidentes"):
        assert esperado in texto, f"falta {esperado!r} en el {formato}"
    hoy = datetime.now(server.MX_TZ).date()
    assert hoy.isoformat() in texto and server._SEGURIDAD_MESES[hoy.month - 1] in texto
    for col in ("Fecha", "Mes", "Trabajador", "Contratista", "Registro", "Ubicación", "Descripción", "Foto",
                "Seguimiento"):
        assert col in texto, f"falta la columna {col!r} en el {formato}"


def test_la_foto_va_dentro_de_la_tabla_en_pdf_y_docx():
    from docx import Document
    d = Document(io.BytesIO(_exportar("docx")))
    assert any(r._element.xpath(".//pic:pic") for t in d.tables for row in t.rows for c in row.cells
               for r in c.paragraphs[0].runs), "la foto debe estar en una celda de la tabla"
    from pptx import Presentation
    prs = Presentation(io.BytesIO(_exportar("pptx")))
    assert any(sh.shape_type == 13 for sl in prs.slides for sh in sl.shapes), "foto como imagen en el pptx"


def test_seguimiento_se_agrega_despues_y_aparece_en_el_informe():
    db = _db()
    old = server.db
    server.db = db
    try:
        async def go():
            await _proyecto(db, None)
            await _alta_via_endpoint(db)
            lista = await server.list_seguridad_reportes("p1", USER)
            inc = next(r for r in lista if r["tipo_registro"] == "incapacitante")
            assert inc["registro_label"] == "Incapacitante" and inc["mes"]
            upd = await server.update_seguridad_reporte(
                "p1", inc["id"], server.SeguridadReportePatch(seguimiento="  Se reforzó el andamio  "), USER)
            assert upd["seguimiento"] == "Se reforzó el andamio"
            resp = await server.export_reports_pdf(
                pid="p1", period="today", period_type="diario", area_id=None, scope=None, user=USER,
                recuento_nivel=None, recuento_node_ids=None, recuento_sin_datos=None, estructura_solo=False)
            return b"".join([c async for c in resp.body_iterator])
        data = asyncio.run(go())
    finally:
        server.db = old
    assert "Se reforzó el andamio" in _texto("pdf", data)


def test_validaciones_del_alta():
    from fastapi import HTTPException
    db = _db()
    old = server.db
    server.db = db
    try:
        async def go():
            await _proyecto(db, None)
            with pytest.raises(HTTPException) as e1:  # incidente sin descripción
                await server.create_seguridad_reporte("p1", server.SeguridadReporteIn(tipo_registro="incidente"), USER)
            assert e1.value.status_code == 400
            with pytest.raises(HTTPException) as e2:  # fecha inválida
                await server.create_seguridad_reporte("p1", server.SeguridadReporteIn(
                    fecha="31/12/2026", descripcion="x", tipo_registro="grave"), USER)
            assert e2.value.status_code == 400
            # formato anterior (solo severidad): sigue funcionando
            r = await server.create_seguridad_reporte("p1", server.SeguridadReporteIn(
                descripcion="viejo", severidad="moderado"), USER)
            assert r["severidad"] == "moderado" and r["registro_label"] == "Moderado"
            # tipo => severidad derivada
            g = await server.create_seguridad_reporte("p1", server.SeguridadReporteIn(
                descripcion="x", tipo_registro="grave"), USER)
            assert g["severidad"] == "grave"
        asyncio.run(go())
    finally:
        server.db = old
