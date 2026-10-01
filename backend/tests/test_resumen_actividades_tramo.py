"""Resumen de actividades por Tramo (PDF/PPTX) — server.py.

1. Tests puros de `_actividades_resumen_por_tramo` (agrupación/orden).
2. Prueba de punta a punta de los DOS motores contra una Mongo simulada en
   memoria (`mongomock-motor`, se omite si no está instalado): se siembra un
   proyecto con actividades del hub y se verifica sobre el documento
   resultante que el resumen se imprime con las actividades del hub, en el
   período del informe, y JUSTO ANTES de la Tabla Resumen.
"""
import asyncio
import io
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_resumen_tramo")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

import server  # noqa: E402
from server import (  # noqa: E402
    NIVEL_GENERAL, NIVEL_NODO, NIVEL_SUBTRAMO, _actividades_resumen_por_tramo,
)

NODES = {
    "r1": {"id": "r1", "name": "TRAMO 1", "parent_id": None, "depth": 0, "order": 0},
    "r2": {"id": "r2", "name": "TRAMO 2", "parent_id": None, "depth": 0, "order": 1},
    "s1": {"id": "s1", "name": "Estación 1", "parent_id": "r1", "depth": 1, "order": 0},
    "s2": {"id": "s2", "name": "Estación 2", "parent_id": "r1", "depth": 1, "order": 1},
    "s3": {"id": "s3", "name": "Estación 3", "parent_id": "r2", "depth": 1, "order": 2},
    "p1": {"id": "p1", "name": "Poste S65", "parent_id": "s2", "depth": 2, "order": 0},
}


def _it(texto, nivel, node_id=None, path=None, area="OBRA CIVIL"):
    return {"texto": texto, "nivel": nivel, "node_id": node_id, "area_name": area,
            "node_path_names": path or [], "node_name": (NODES.get(node_id) or {}).get("name")}


def test_agrupa_por_tramo_con_general_primero_y_filas_por_subtramo():
    items = [
        _it("de poste en E2", NIVEL_NODO, "p1", ["TRAMO 1", "Estación 2", "Poste S65"]),
        _it("de E3", NIVEL_SUBTRAMO, "s3", ["TRAMO 2", "Estación 3"]),
        _it("de E2", NIVEL_SUBTRAMO, "s2", ["TRAMO 1", "Estación 2"]),
        _it("de E1", NIVEL_SUBTRAMO, "s1", ["TRAMO 1", "Estación 1"]),
        _it("general", NIVEL_GENERAL, area="SEGURIDAD"),
    ]
    out = _actividades_resumen_por_tramo(items, NODES)
    assert [g["tramo"] for g in out] == ["General", "TRAMO 1", "TRAMO 2"]
    t1 = out[1]["rows"]
    # E1, luego E2 (el del propio subtramo antes que el de su poste)
    assert [r["texto"] for r in t1] == ["de E1", "de E2", "de poste en E2"]
    assert [r["ubicacion"] for r in t1] == ["Estación 1", "Estación 2", "Estación 2 › Poste S65"]
    assert out[0]["rows"] == [{"ubicacion": "General", "area": "SEGURIDAD", "texto": "general"}]
    assert out[2]["rows"][0]["texto"] == "de E3"


def test_omite_vacias_y_sin_items_da_lista_vacia():
    assert _actividades_resumen_por_tramo([], NODES) == []
    assert _actividades_resumen_por_tramo([_it("  ", NIVEL_GENERAL), _it("", NIVEL_SUBTRAMO, "s1")], NODES) == []


# ── Punta a punta (Mongo simulada) ─────────────────────────────────────────
mongomock_motor = pytest.importorskip("mongomock_motor")

ACT_GENERAL = "Reunion de coordinacion semanal"
ACT_REPORTE = "Colado de pila 1 en poste"
ACT_FUERA_DE_PERIODO = "Actividad de hace dos meses"


def _sembrar(db, con_tabla_resumen):
    now = datetime.now(timezone.utc)
    viejo = datetime(2020, 1, 1, tzinfo=timezone.utc)
    modulos = {"reportes_diarios": {"tabla_resumen": con_tabla_resumen}, "reportes_semanales": {}, "reportes_mensuales": {}}
    return [
        db.projects.insert_one({"id": "p1", "name": "Proyecto Demo", "color_institucional": "#003366",
                                "modulos": modulos}),
        db.location_nodes.insert_many([
            {**NODES["r1"], "project_id": "p1", "is_leaf": False},
            {**NODES["s2"], "project_id": "p1", "is_leaf": False},
            {**NODES["p1"], "project_id": "p1", "is_leaf": True},
        ]),
        db.areas.insert_one({"id": "a1", "project_id": "p1", "name": "OBRA CIVIL"}),
        db.reports.insert_many([
            {"id": "rep1", "project_id": "p1", "node_id": "p1", "area_id": "a1", "created_at": now,
             "severidad": "diario", "actividades": ACT_REPORTE, "images": [], "captured_by": "u1",
             "node_path_names": ["TRAMO 1", "Estación 2", "Poste S65"], "captured_by_name": "Ing"},
            {"id": "rep0", "project_id": "p1", "node_id": "p1", "area_id": "a1", "created_at": viejo,
             "severidad": "diario", "actividades": ACT_FUERA_DE_PERIODO, "images": [], "captured_by": "u1",
             "node_path_names": ["TRAMO 1", "Estación 2", "Poste S65"], "captured_by_name": "Ing"},
        ]),
        db.actividades_curadas.insert_one({
            "id": "c1", "project_id": "p1", "nivel": "GENERAL", "area_id": "a1", "node_id": None,
            "texto_original": ACT_GENERAL, "reporte_origen_id": None, "orden": 0, "oculta": False,
            "created_at": now, "node_path_names": [], "historial": [],
        }),
        # Tabla Resumen (avance acumulado) con un dato para que el módulo se emita.
        db.tabla_resumen_actividades.insert_one({"id": "ta1", "project_id": "p1", "nombre": "VUELO LIDAR", "orden": 0}),
        db.tabla_resumen_columnas.insert_one({"id": "tc1", "project_id": "p1", "tipo": "estacion", "label": "EST 1", "orden": 0}),
        db.tabla_resumen_celdas.insert_one({"id": "tx1", "project_id": "p1", "actividad_id": "ta1", "columna_id": "tc1", "valor": 100}),
    ]


def _correr(formato, con_tabla_resumen):
    from mongomock_motor import AsyncMongoMockClient

    db = AsyncMongoMockClient()["t"]
    old_db = server.db
    server.db = db
    try:
        async def go():
            for coro in _sembrar(db, con_tabla_resumen):
                await coro
            user = {"id": "u1", "role": server.ROLE_COORD, "name": "Coord", "email": "c@x.mx"}
            common = dict(pid="p1", period="today", period_type="diario", area_id=None, scope=None,
                          recuento_nivel=None, recuento_node_ids=None, recuento_sin_datos=None, user=user)
            if formato == "pdf":
                resp = await server.export_reports_pdf(**common, estructura_solo=False)
            else:
                resp = await server.export_reports_pptx(**common)
            chunks = [c async for c in resp.body_iterator]
            return b"".join(chunks)
        return asyncio.run(go())
    finally:
        server.db = old_db


def _paginas_pdf(data):
    from pypdf import PdfReader
    return [p.extract_text() for p in PdfReader(io.BytesIO(data)).pages]


def _slides_pptx(data):
    from pptx import Presentation
    prs = Presentation(io.BytesIO(data))
    return ["\n".join(sh.text_frame.text for sh in s.shapes if sh.has_text_frame) for s in prs.slides]


def _pagina_tabla(paginas):
    # La última aparición: la primera es la entrada del índice del informe.
    return max(i for i, t in enumerate(paginas) if "TABLA DE AVANCE ACUMULADO" in t)


def _paginas(formato, con_tabla_resumen):
    data = _correr(formato, con_tabla_resumen)
    return _paginas_pdf(data) if formato == "pdf" else _slides_pptx(data)


@pytest.mark.parametrize("formato", ["pdf", "pptx"])
def test_resumen_se_imprime_con_las_actividades_del_hub_del_periodo(formato):
    paginas = _paginas(formato, con_tabla_resumen=True)
    inicio = [i for i, t in enumerate(paginas) if "RESUMEN DE ACTIVIDADES POR TRAMO" in t]
    assert len(inicio) == 1, "el título del resumen va solo en su primera página/diapositiva"
    i_tabla = _pagina_tabla(paginas)
    # Resumen = desde su primera página hasta la anterior a la Tabla Resumen.
    resumen = "\n".join(paginas[inicio[0]:i_tabla])
    assert ACT_GENERAL in resumen and ACT_REPORTE in resumen
    assert "TRAMO 1" in resumen and "Estación 2" in resumen
    assert all(ACT_FUERA_DE_PERIODO not in t for t in paginas), "fuera del período del informe no se imprime"


@pytest.mark.parametrize("formato", ["pdf", "pptx"])
def test_resumen_va_justo_antes_de_la_tabla_resumen(formato):
    paginas = _paginas(formato, con_tabla_resumen=True)
    inicio = next(i for i, t in enumerate(paginas) if "RESUMEN DE ACTIVIDADES POR TRAMO" in t)
    i_tabla = _pagina_tabla(paginas)
    assert inicio < i_tabla
    # Entre ambos solo páginas del propio resumen (una por tramo/continuación).
    assert all("ACTIVIDAD" in t for t in paginas[inicio:i_tabla])


@pytest.mark.parametrize("formato", ["pdf", "pptx"])
def test_resumen_se_imprime_aunque_la_tabla_resumen_no_este_activa(formato):
    paginas = _paginas(formato, con_tabla_resumen=False)
    assert any("RESUMEN DE ACTIVIDADES POR TRAMO" in t for t in paginas)
    assert not any("TABLA DE AVANCE ACUMULADO" in t for t in paginas)
