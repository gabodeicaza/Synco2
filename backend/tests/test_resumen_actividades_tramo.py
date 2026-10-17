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
TITULO_REPORTE = "Armado de cabezal poste S65"
_PNG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def _sembrar(db, con_tabla_resumen):
    now = datetime.now(timezone.utc)
    viejo = datetime(2020, 1, 1, tzinfo=timezone.utc)
    modulos = {"reportes_diarios": {"tabla_resumen": con_tabla_resumen}, "reportes_semanales": {}, "reportes_mensuales": {}}
    return [
        db.projects.insert_one({"id": "p1", "name": "Proyecto Demo", "color_institucional": "#003366",
                                "modulos": modulos, "general_data_images": [_PNG, _PNG],
                                "general_data_names": ["Presupuesto 2026", ""]}),
        db.location_nodes.insert_many([
            {**NODES["r1"], "project_id": "p1", "is_leaf": False},
            {**NODES["s2"], "project_id": "p1", "is_leaf": False},
            {**NODES["p1"], "project_id": "p1", "is_leaf": True},
        ]),
        db.areas.insert_one({"id": "a1", "project_id": "p1", "name": "OBRA CIVIL"}),
        db.reports.insert_many([
            {"id": "rep1", "project_id": "p1", "node_id": "p1", "area_id": "a1", "created_at": now,
             "severidad": "diario", "actividades": ACT_REPORTE, "images": [], "captured_by": "u1",
             "title": TITULO_REPORTE,
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


@pytest.mark.parametrize("formato", ["pdf"])  # el PPTX tiene su propio formato (ver abajo)
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


@pytest.mark.parametrize("formato", ["pdf"])  # el PPTX tiene su propio formato (ver abajo)
def test_resumen_va_justo_antes_de_la_tabla_resumen(formato):
    paginas = _paginas(formato, con_tabla_resumen=True)
    inicio = next(i for i, t in enumerate(paginas) if "RESUMEN DE ACTIVIDADES POR TRAMO" in t)
    i_tabla = _pagina_tabla(paginas)
    assert inicio < i_tabla
    # Entre ambos solo páginas del propio resumen (una por tramo/continuación).
    assert all("ACTIVIDAD" in t for t in paginas[inicio:i_tabla])


@pytest.mark.parametrize("formato", ["pdf"])  # el PPTX tiene su propio formato (ver abajo)
def test_resumen_se_imprime_aunque_la_tabla_resumen_no_este_activa(formato):
    paginas = _paginas(formato, con_tabla_resumen=False)
    assert any("RESUMEN DE ACTIVIDADES POR TRAMO" in t for t in paginas)
    assert not any("TABLA DE AVANCE ACUMULADO" in t for t in paginas)


def _indice_impreso(paginas):
    """Texto del índice impreso (página/diapositiva 2, tras la portada)."""
    return paginas[1]


@pytest.mark.parametrize("formato", ["pdf"])  # el PPTX tiene su propio formato (ver abajo)
def test_indice_refleja_todo_titulos_de_ingenieros_datos_generales_y_resumen(formato):
    paginas = _paginas(formato, con_tabla_resumen=True)
    indice = _indice_impreso(paginas)
    assert TITULO_REPORTE in indice, "cada reporte aparece con el título que escogieron los ingenieros"
    assert "Presupuesto 2026" in indice and "Datos generales 2" in indice
    assert "Resumen de actividades · TRAMO 1" in indice and "Resumen de actividades · General" in indice
    assert "Poste S65 · Obra Civil" in indice, "el área de cada nodo es una entrada propia"


@pytest.mark.parametrize("formato", ["pdf", "pptx"])
def test_indice_apunta_a_la_pagina_del_reporte(formato):
    paginas = _paginas(formato, con_tabla_resumen=True)
    lineas = [ln.strip() for ln in _indice_impreso(paginas).splitlines() if ln.strip()]
    ent = {t: int(n) for t, n in zip(lineas, lineas[1:]) if n.isdigit()}
    area = ent["TRAMO 1 › Estación 2 › Poste S65 · Obra Civil"]
    reporte = ent[TITULO_REPORTE]
    resumen_subtramo = ent["Resumen · Estación 2"]
    # Orden real del documento: portadilla del área → su resumen de actividades
    # → página del reporte → resumen del subtramo (que sigue inmediatamente).
    assert area < reporte == resumen_subtramo - 1
    # Y la diapositiva/página del subtramo es de verdad la del resumen.
    assert "ESTACIÓN 2" in paginas[resumen_subtramo - 1].upper()


# ── PPTX: resumen de actividades POR FRENTE al inicio (formato de referencia) ──
def test_pptx_resumen_por_frente_va_al_inicio_con_el_formato_de_referencia():
    slides = _paginas("pptx", con_tabla_resumen=True)
    i_res = next(i for i, t in enumerate(slides) if "ACTIVIDADES GENERALES" in t and "OBRA CIVIL" in t and i > 1)
    i_reporte = next(i for i, t in enumerate(slides) if i > i_res and "TRAMO 1 › Estación 2 › Poste S65" in t)
    i_tabla = max(i for i, t in enumerate(slides) if "TABLA DE AVANCE ACUMULADO" in t)
    assert i_res < i_reporte < i_tabla, "el resumen va antes del cuerpo por nodo y de la Tabla Resumen"
    texto = slides[i_res]
    # un encabezado por frente (Estación) y bajo él las actividades, las de poste con su nombre por delante
    assert "Estación 2" in texto and "Poste S65 " + ACT_REPORTE in texto
    # las generales del hub salen bajo "General"; lo de fuera de período no sale
    assert "General" in texto and ACT_GENERAL in texto
    assert all(ACT_FUERA_DE_PERIODO not in t for t in slides)
    # ya no se imprime la tabla "por tramo" al final del PPTX
    assert not any("RESUMEN DE ACTIVIDADES POR TRAMO" in t for t in slides)


def test_pptx_indice_apunta_al_resumen_por_area():
    slides = _paginas("pptx", con_tabla_resumen=True)
    indice = _indice_impreso(slides)
    assert "Resumen de actividades · OBRA CIVIL" in indice
    assert "Resumen de actividades · TRAMO 1" not in indice
    lineas = [ln.strip() for ln in indice.splitlines() if ln.strip()]
    ent = {t: int(n) for t, n in zip(lineas, lineas[1:]) if n.isdigit()}
    pagina = ent["Resumen de actividades · OBRA CIVIL"]
    assert "ACTIVIDADES GENERALES" in slides[pagina - 1]


def _pptx_con_orden(orden):
    """PPTX diario con `indice_config.diario.order` = `orden`; devuelve el texto por diapositiva."""
    from mongomock_motor import AsyncMongoMockClient

    db = AsyncMongoMockClient()["t"]
    old_db = server.db
    server.db = db
    try:
        async def go():
            for coro in _sembrar(db, True):
                await coro
            await db.projects.update_one({"id": "p1"}, {"$set": {"indice_config": {"diario": {"order": orden}}}})
            user = {"id": "u1", "role": server.ROLE_COORD, "name": "Coord", "email": "c@x.mx"}
            resp = await server.export_reports_pptx(
                pid="p1", period="today", period_type="diario", area_id=None, scope=None,
                recuento_nivel=None, recuento_node_ids=None, recuento_sin_datos=None, user=user)
            return b"".join([c async for c in resp.body_iterator])
        return _slides_pptx(asyncio.run(go()))
    finally:
        server.db = old_db


def test_pptx_indice_va_justo_despues_de_la_portada_y_lista_el_resumen_de_avance():
    """Regresión: la marca de 'Resumen de avance' apuntaba a la diapositiva siguiente, su sección
    quedaba vacía y se contaba como portada: el índice salía DESPUÉS de ella y no se podía reordenar."""
    slides = _paginas("pptx", con_tabla_resumen=True)
    assert "ÍNDICE" in slides[1], "el índice debe ser la diapositiva 2 (justo tras la portada)"
    assert "Resumen de avance" in slides[1]


def test_pptx_mover_una_seccion_arriba_del_resumen_de_avance_funciona():
    natural = _pptx_con_orden([])
    i_nat_res = next(i for i, t in enumerate(natural) if "ACTIVIDAD" in t and "AVANCE" in t and "TABLA" not in t)
    movido = _pptx_con_orden(["gd:0", "gd:1", "resumen_avance"])
    i_res = next(i for i, t in enumerate(movido) if "ACTIVIDAD" in t and "AVANCE" in t and "TABLA" not in t)
    assert i_res > i_nat_res, "con gd:0 y gd:1 antes, el resumen de avance debe quedar más abajo"


# ── Puro: agrupación por frente ────────────────────────────────────────────
from server import _actividades_resumen_por_frente  # noqa: E402

NODOS_FRENTE = {
    "r1": {"id": "r1", "name": "TRAMO I", "parent_id": None, "depth": 0, "order": 0},
    "r2": {"id": "r2", "name": "TRAMO II", "parent_id": None, "depth": 0, "order": 1},
    "e1": {"id": "e1", "name": "Estación 1 UNIVERSIDAD", "parent_id": "r1", "depth": 1, "order": 0},
    "i12": {"id": "i12", "name": "Inter-tramo E1-E2", "parent_id": "r1", "depth": 1, "order": 1, "tipo_nodo": "intertramo"},
    "e2": {"id": "e2", "name": "Estación 2 CANTERA", "parent_id": "r1", "depth": 1, "order": 2},
    "e9": {"id": "e9", "name": "Estación 9 OTRO TRAMO", "parent_id": "r2", "depth": 1, "order": 0},
    "s3": {"id": "s3", "name": "Poste S3", "parent_id": "i12", "depth": 2, "order": 0},
    "s4": {"id": "s4", "name": "Poste S4", "parent_id": "i12", "depth": 2, "order": 1},
}


def _item(texto, nivel, node_id=None, area="OBRA CIVIL"):
    return {"texto": texto, "nivel": nivel, "node_id": node_id, "area_name": area}


def test_por_frente_todos_los_frentes_en_orden_del_arbol_con_sin_actividad():
    items = [
        _item("Armado de columna", NIVEL_SUBTRAMO, "e1"),
        _item("reconstrucción de muro", NIVEL_NODO, "s3"),
        _item("Poste S4 montaje de poste", NIVEL_NODO, "s4"),   # ya trae su nombre: no se repite
        _item("Perforación de pila", NIVEL_SUBTRAMO, "e2"),
    ]
    (grupo,) = _actividades_resumen_por_frente(items, NODOS_FRENTE)
    assert grupo["area"] == "OBRA CIVIL"
    assert [b["titulo"] for b in grupo["bloques"]] == [
        "Estación 1 UNIVERSIDAD", "Inter-tramo E1-E2", "Estación 2 CANTERA", "Estación 9 OTRO TRAMO"]  # TRAMO I, luego TRAMO II
    por = {b["titulo"]: b["lineas"] for b in grupo["bloques"]}
    assert por["Estación 1 UNIVERSIDAD"] == ["Armado de columna"]
    assert por["Inter-tramo E1-E2"] == ["Poste S3 reconstrucción de muro", "Poste S4 montaje de poste"]
    assert por["Estación 9 OTRO TRAMO"] == ["Sin actividades"]


def test_por_frente_una_entrada_por_area_con_actividad_y_general_primero():
    items = [
        _item("de seguridad", NIVEL_SUBTRAMO, "e1", area="SEGURIDAD"),
        _item("reunión general", NIVEL_GENERAL, area="OBRA CIVIL"),
        _item("   ", NIVEL_SUBTRAMO, "e2", area="AMBIENTAL"),  # texto vacío: el área no cuenta
    ]
    out = _actividades_resumen_por_frente(items, NODOS_FRENTE)
    assert [g["area"] for g in out] == ["OBRA CIVIL", "SEGURIDAD"]
    assert out[0]["bloques"][0] == {"titulo": "General", "lineas": ["reunión general"]}
    assert [b["lineas"] for b in out[1]["bloques"]][0] == ["de seguridad"]
    assert _actividades_resumen_por_frente([], NODOS_FRENTE) == []


def test_pptx_vuelo_lidar_de_estacion_lleva_el_icono_de_estacion():
    """La diapositiva de Vuelo LiDAR de una estación trae el pictograma de
    estación (PNG del PDF de iconos) junto al nombre."""
    from mongomock_motor import AsyncMongoMockClient
    from pptx import Presentation

    db = AsyncMongoMockClient()["t"]
    old_db = server.db
    server.db = db
    try:
        async def go():
            for coro in _sembrar(db, False):
                await coro
            await db.projects.update_one({"id": "p1"}, {"$set": {"modulos.reportes_diarios.fotos_lidar": True}})
            await db.fotos_lidar.insert_one({
                "id": "f1", "project_id": "p1", "node_id": "s2", "titulo": "Estación Dos", "orden": 0,
                "foto_original": _PNG, "foto_actual": _PNG,
                "foto_original_fecha": "2026-09-30", "foto_actual_fecha": "2026-10-09",
                "created_at": datetime.now(timezone.utc),
            })
            user = {"id": "u1", "role": server.ROLE_COORD, "name": "Coord", "email": "c@x.mx"}
            resp = await server.export_reports_pptx(
                pid="p1", period="today", period_type="diario", area_id=None, scope=None,
                recuento_nivel=None, recuento_node_ids=None, recuento_sin_datos=None, user=user)
            return b"".join([c async for c in resp.body_iterator])
        data = asyncio.run(go())
    finally:
        server.db = old_db
    prs = Presentation(io.BytesIO(data))
    lidar = [s for s in prs.slides if any(sh.has_text_frame and sh.text_frame.text == "Estación Dos" for sh in s.shapes)]
    assert len(lidar) == 1, "debe haber una diapositiva de Vuelo LiDAR para la estación"
    fotos = [sh for sh in lidar[0].shapes if sh.shape_type == 13 and sh.name.startswith("Picture")]
    # icono de estación + las dos fotos
    assert len(fotos) >= 3
    iconos = [sh for sh in fotos if sh.width / sh.height > 1.8]  # el pictograma es ancho (~2:1)
    assert len(iconos) == 1 and iconos[0].width >= 2.5 * 360000, "el icono de estación debe verse grande (≥ 2.5 cm)"
