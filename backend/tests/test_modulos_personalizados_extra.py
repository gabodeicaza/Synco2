"""Creador de módulos — funciones avanzadas: ubicación, estatus/cierre, folio,
historial y eliminados, sincronización offline idempotente, Excel/CSV (exportar,
plantilla, importar), gráficas y plantillas propias."""
import asyncio
import io
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_modulos_personalizados_extra")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import server  # noqa: E402

mongomock_motor = pytest.importorskip("mongomock_motor")

COORD = {"id": "u1", "role": server.ROLE_COORD, "name": "Coord", "email": "c@x.mx"}
ESPEC = {"id": "u2", "role": server.ROLE_ESPECIALISTA, "name": "Calidad", "email": "q@x.mx", "project_ids": ["p1"]}
OTRO = {"id": "u3", "role": server.ROLE_ESPECIALISTA, "name": "Otro", "email": "o@x.mx", "project_ids": ["p1"]}


def _con_db(fn):
    def wrapper():
        from mongomock_motor import AsyncMongoMockClient
        db = AsyncMongoMockClient()["t"]
        old = server.db
        server.db = db
        try:
            async def go():
                await db.projects.insert_one({"id": "p1", "name": "Demo", "modulos": {}})
                await db.location_nodes.insert_many([
                    {"id": "n1", "project_id": "p1", "name": "Estación 1", "depth": 1, "order": 0, "parent_id": None, "is_leaf": True},
                    {"id": "n2", "project_id": "p1", "name": "Estación 2", "depth": 1, "order": 1, "parent_id": None, "is_leaf": True},
                ])
                await fn(db)
            asyncio.run(go())
        finally:
            server.db = old
    wrapper.__name__ = fn.__name__
    return wrapper


def _campos():
    return [
        {"id": "desc", "etiqueta": "Descripción", "tipo": "texto", "requerido": True},
        {"id": "ubi", "etiqueta": "Estación", "tipo": "ubicacion"},
        {"id": "cant", "etiqueta": "Cantidad", "tipo": "numero", "unidad": "m3", "agregacion": "suma"},
        {"id": "est", "etiqueta": "Estatus", "tipo": "seleccion", "opciones": ["Abierto", "En proceso", "Cerrado"],
         "estatus": True, "cierre": ["Cerrado"], "valor_defecto": "Abierto"},
        {"id": "ok", "etiqueta": "Cumple", "tipo": "interruptor"},
        {"id": "foto", "etiqueta": "Foto", "tipo": "foto"},
    ]


async def _modulo(**extra):
    body = {"nombre": "Seguimiento", "campos": _campos(), "salida": {"reportes_semanales": {"modo": "tabla"}}, **extra}
    return await server.create_custom_module("p1", body, COORD)


HOY = lambda: datetime.now(server.MX_TZ).date().isoformat()  # noqa: E731


# ── Sanitización nueva ─────────────────────────────────────────────────────
def test_estatus_solo_en_listas_y_cierre_valido():
    c = server._cm_sanitize_campos([
        {"id": "e", "etiqueta": "E", "tipo": "seleccion", "opciones": ["A", "B"], "estatus": True, "cierre": ["B", "Z"]},
        {"id": "t", "etiqueta": "T", "tipo": "texto", "estatus": True},
    ])
    assert c[0]["estatus"] is True and c[0]["cierre"] == ["B"] and not c[1].get("estatus")


def test_graficas_se_sanean():
    campos = server._cm_sanitize_campos(_campos())
    g = server._cm_sanitize_graficas([
        {"tipo": "pastel", "categoria": "est", "informes": ["reportes_semanales", "x"]},
        {"tipo": "raro", "categoria": "__fecha", "valor": "cant", "agregacion": "suma"},
        {"categoria": "no_existe"}, {"categoria": "cant"},  # inválidas: no categorizable
    ], campos)
    assert len(g) == 2 and g[0]["informes"] == ["reportes_semanales"] and g[0]["agregacion"] == "conteo"
    assert g[1]["tipo"] == "barras" and g[1]["valor"] == "cant" and g[1]["agregacion"] == "suma"


# ── Ubicación, estatus, folio, historial ─────────────────────────────────────
@_con_db
async def test_ubicacion_estatus_folio_e_historial(db):
    m = await _modulo(opciones={"folio_activo": True, "folio_prefijo": "SEG-", "folio_digitos": 3, "folio_inicio": 10})
    r1 = await server.create_custom_module_record("p1", m["id"], {"fecha": HOY(), "valores": {"desc": "A", "ubi": "n1", "est": "Abierto"}}, ESPEC)
    r2 = await server.create_custom_module_record("p1", m["id"], {"fecha": HOY(), "valores": {"desc": "B", "ubi": "estación 2"}}, ESPEC)
    assert (r1["folio"], r2["folio"]) == ("SEG-010", "SEG-011")  # consecutivo atómico desde el inicio
    assert r1["valores"]["ubi"] == {"id": "n1", "nombre": "Estación 1"} and r2["valores"]["ubi"]["id"] == "n2"
    with pytest.raises(HTTPException):
        await server.create_custom_module_record("p1", m["id"], {"valores": {"desc": "C", "ubi": "no-existe"}}, ESPEC)
    assert r1["cierres"] == {}
    # Cerrar guarda la fecha; reabrir la quita; editar sin cambios no ensucia el historial
    cerrado = await server.update_custom_module_record("p1", m["id"], r1["id"], {"valores": {"est": "Cerrado"}}, ESPEC)
    assert "est" in cerrado["cierres"] and cerrado["n_ediciones"] == 1
    igual = await server.update_custom_module_record("p1", m["id"], r1["id"], {"valores": {"est": "Cerrado"}}, ESPEC)
    assert igual["n_ediciones"] == 1
    reabierto = await server.update_custom_module_record("p1", m["id"], r1["id"], {"valores": {"est": "En proceso", "cant": 5}}, ESPEC)
    assert reabierto["cierres"] == {} and reabierto["n_ediciones"] == 2
    full = await server.get_custom_module_record("p1", m["id"], r1["id"], ESPEC)
    assert [h["accion"] for h in full["historial"]] == ["creado", "editado", "editado"]
    cambios = full["historial"][1]["cambios"]
    assert {"campo": "Estatus", "antes": "Abierto", "despues": "Cerrado"} in cambios
    assert any(c["campo"] == "Cantidad" and c["despues"] == "5 m3" for c in full["historial"][2]["cambios"])
    assert "historial" not in (await server.list_custom_module_records("p1", m["id"], user=ESPEC))[0]


@_con_db
async def test_eliminados_quedan_en_bitacora_y_se_limpian_con_el_modulo(db):
    m = await _modulo()
    r = await server.create_custom_module_record("p1", m["id"], {"fecha": HOY(), "valores": {"desc": "Borrame", "cant": 2}}, ESPEC)
    with pytest.raises(HTTPException) as e:
        await server.delete_custom_module_record("p1", m["id"], r["id"], OTRO)
    assert e.value.status_code == 403
    await server.delete_custom_module_record("p1", m["id"], r["id"], ESPEC)
    log = await server.list_custom_module_deleted("p1", m["id"], COORD)
    assert len(log) == 1 and log[0]["valores"]["desc"] == "Borrame" and log[0]["deleted_by_name"] == "Calidad"
    await server.delete_custom_module("p1", m["id"], confirmar=True, user=COORD)
    assert await db.custom_module_borrados.count_documents({}) == 0


# ── Offline: sincronización idempotente ─────────────────────────────────────
@_con_db
async def test_sync_offline_es_idempotente_y_respeta_la_hora_de_captura(db):
    m = await _modulo(opciones={"folio_activo": True})
    hace_horas = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
    body = {"client_id": "cli_1", "project_id": "p1", "module_id": m["id"], "op": "create", "fecha": HOY(),
            "captured_at": hace_horas, "valores": {"desc": "Sin señal"}}
    a = await server.sync_custom_record(dict(body), ESPEC)
    b = await server.sync_custom_record(dict(body), ESPEC)  # reintento tras perder la respuesta
    assert a["id"] == b["id"] and await db.custom_module_records.count_documents({}) == 1
    assert a["folio"] == "0001" and abs((datetime.fromisoformat(str(a["created_at"])).replace(tzinfo=timezone.utc) if isinstance(a["created_at"], str) else server._cm_aware(a["created_at"])) - datetime.fromisoformat(hace_horas)) < timedelta(seconds=2)
    # captured_at inverosímil (futuro lejano) se ignora
    c = await server.sync_custom_record({**body, "client_id": "cli_2", "captured_at": "2999-01-01T00:00:00Z"}, ESPEC)
    assert server._cm_aware(c["created_at"]) < datetime.now(timezone.utc) + timedelta(minutes=1)
    # edición offline de un registro existente
    up = await server.sync_custom_record({"project_id": "p1", "module_id": m["id"], "op": "update", "record_id": a["id"],
                                          "valores": {"cant": 9}}, ESPEC)
    assert up["valores"]["cant"] == 9
    with pytest.raises(HTTPException) as e:
        await server.sync_custom_record({"project_id": "p1", "module_id": m["id"], "op": "update", "record_id": a["id"], "valores": {}}, OTRO)
    assert e.value.status_code == 403


# ── Estatus en informes ───────────────────────────────────────────────────────
def _reg(valores, fecha="2026-06-24", cierre=None):
    return {"id": "x", "fecha": fecha, "valores": valores, "created_at": datetime(2026, 6, 24), "cierres": cierre or {}}


def test_ocultar_cerrados_solo_deja_los_cerrados_del_periodo():
    campos = server._cm_sanitize_campos(_campos())
    op = server._cm_sanitize_opciones({"ocultar_cerrados": True}, campos)
    m = {"id": "m", "nombre": "S", "campos": campos, "opciones": op,
         "salida": server._cm_sanitize_salida({"reportes_semanales": {"modo": "tabla"}}), "graficas": []}
    ini = datetime(2026, 6, 22, tzinfo=server.MX_TZ)
    fin = datetime(2026, 6, 28, 23, 59, tzinfo=server.MX_TZ)
    regs = [
        _reg({"desc": "abierto", "est": "Abierto"}),
        _reg({"desc": "cerrado esta semana", "est": "Cerrado"}, cierre={"est": datetime(2026, 6, 25, 12, tzinfo=timezone.utc)}),
        _reg({"desc": "cerrado hace mucho", "est": "Cerrado"}, cierre={"est": datetime(2026, 5, 1, tzinfo=timezone.utc)}),
    ]
    sec = server._cm_construye_seccion(m, regs, "reportes_semanales", ventana=(ini, fin))
    descs = [r[1 if False else 0] for r in sec["blocks"][0]["rows"] if r[0] != "TOTALES"]
    texto = str(sec["blocks"][0]["rows"])
    assert "abierto" in texto and "cerrado esta semana" in texto and "cerrado hace mucho" not in texto and descs


def test_resumen_incluye_distribucion_de_estatus():
    campos = server._cm_sanitize_campos(_campos())
    m = {"id": "m", "nombre": "S", "campos": campos, "opciones": server._cm_sanitize_opciones({}, campos),
         "salida": server._cm_sanitize_salida({"reportes_semanales": {"modo": "resumen"}}), "graficas": []}
    regs = [_reg({"est": "Abierto"}), _reg({"est": "Abierto"}), _reg({"est": "Cerrado"})]
    bloques = server._cm_construye_seccion(m, regs, "reportes_semanales")["blocks"]
    tabla = next(b for b in bloques if b.get("heading") == "ESTATUS · ESTATUS")
    assert tabla["rows"] == [["Abierto", "2"], ["En proceso", "0"], ["Cerrado", "1"]]


@_con_db
async def test_periodo_trae_tambien_cerrados_en_la_ventana_aunque_se_capturaron_antes(db):
    m = await _modulo(opciones={"ocultar_cerrados": True})
    modulo = await server._cm_get_modulo("p1", m["id"])
    antiguo = await server.create_custom_module_record("p1", m["id"], {"fecha": "2020-01-01", "valores": {"desc": "viejo"}}, ESPEC)
    await server.update_custom_module_record("p1", m["id"], antiguo["id"], {"valores": {"est": "Cerrado"}}, ESPEC)
    regs = await server._cm_registros_periodo("p1", modulo, "reportes_semanales", (datetime.now(server.MX_TZ).date() - timedelta(days=6)).isoformat(), HOY())
    assert [r["valores"]["desc"] for r in regs] == ["viejo"]


# ── Gráficas ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("tipo", ["barras", "barras_h", "pastel", "linea"])
def test_graficas_generan_png(tipo):
    png = server._cm_grafica_png(tipo, "Título", ["Abierto", "En proceso", "Cerrado"], [5, 3.5, 12], moneda=tipo == "barras")
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_datos_de_grafica_agrupan_y_agregan():
    campos = server._cm_sanitize_campos(_campos())
    m = {"campos": campos}
    regs = [_reg({"est": "Abierto", "cant": 2}, "2026-06-24"), _reg({"est": "Abierto", "cant": 3}, "2026-06-25"),
            _reg({"est": "Cerrado", "cant": 10}, "2026-06-25")]
    et, va = server._cm_datos_grafica(m, regs, {"tipo": "barras", "categoria": "est", "valor": None, "agregacion": "conteo"})
    assert (et, va) == (["Abierto", "Cerrado"], [2.0, 1.0])
    et, va = server._cm_datos_grafica(m, regs, {"tipo": "barras", "categoria": "est", "valor": "cant", "agregacion": "suma"})
    assert (et, va) == (["Cerrado", "Abierto"], [10.0, 5.0])  # ordenado de mayor a menor
    et, va = server._cm_datos_grafica(m, regs, {"tipo": "linea", "categoria": "__fecha", "valor": "cant", "agregacion": "promedio"})
    assert et == ["24/06/2026", "25/06/2026"] and va == [2.0, 6.5]  # cronológico


def test_pastel_agrupa_el_resto_en_otros():
    campos = server._cm_sanitize_campos([{"id": "t", "etiqueta": "T", "tipo": "texto"}])
    regs = [_reg({"t": f"v{i}"}) for i in range(12)]
    et, va = server._cm_datos_grafica({"campos": campos}, regs, {"tipo": "pastel", "categoria": "t", "agregacion": "conteo"})
    assert len(et) == 8 and et[-1] == "Otros" and sum(va) == 12


@_con_db
async def test_la_grafica_sale_en_los_tres_informes(db):
    m = await _modulo(graficas=[{"tipo": "pastel", "titulo": "Por estatus", "categoria": "est", "informes": ["reportes_semanales"]}])
    for est in ("Abierto", "Abierto", "Cerrado"):
        await server.create_custom_module_record("p1", m["id"], {"fecha": HOY(), "valores": {"desc": "x", "est": est}}, ESPEC)
    out = await server.preview_custom_module("p1", {"module_id": m["id"], "categoria": "reportes_semanales"}, COORD)
    img = [b for b in out["seccion"]["blocks"] if b["type"] == "imagen"]
    assert len(img) == 1 and img[0]["imagen"].startswith("data:image/jpeg;base64,") and img[0]["heading"] == "Por estatus"
    diario = await server.preview_custom_module("p1", {"module_id": m["id"], "categoria": "reportes_diarios", "definicion": {
        "salida": {"reportes_diarios": {"modo": "tabla"}}}}, COORD)
    assert not [b for b in diario["seccion"]["blocks"] if b["type"] == "imagen"]  # solo en los informes elegidos


@pytest.mark.parametrize("formato", ["pdf", "pptx", "docx"])
def test_export_con_grafica_y_folio_en_los_tres_formatos(formato):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    old = server.db
    server.db = db
    try:
        async def go():
            await db.projects.insert_one({"id": "p1", "name": "Demo", "color_institucional": "#003366", "modulos": {}})
            await db.location_nodes.insert_one({"id": "n1", "project_id": "p1", "name": "Estación 1", "depth": 1, "order": 0, "parent_id": None, "is_leaf": True})
            m = await _modulo(opciones={"folio_activo": True, "folio_prefijo": "SEG-"},
                              graficas=[{"tipo": "barras_h", "titulo": "Avance por estación", "categoria": "ubi", "informes": ["reportes_semanales"]}])
            for d in ("Hincado", "Colado"):
                await server.create_custom_module_record("p1", m["id"], {"fecha": HOY(), "valores": {"desc": d, "ubi": "n1", "cant": 4}}, ESPEC)
            common = dict(pid="p1", period="week", period_type="semanal", area_id=None, scope=None, user=COORD)
            if formato == "pdf":
                resp = await server.export_reports_pdf(**common, recuento_nivel=None, recuento_node_ids=None, recuento_sin_datos=None, estructura_solo=False)
            elif formato == "pptx":
                resp = await server.export_reports_pptx(**common, recuento_nivel=None, recuento_node_ids=None, recuento_sin_datos=None)
            else:
                resp = await server.export_reports_docx(**common)
            return b"".join([c async for c in resp.body_iterator])
        data = asyncio.run(go())
    finally:
        server.db = old
    if formato == "docx":
        from docx import Document
        d = Document(io.BytesIO(data))
        texto = " ".join([p.text for p in d.paragraphs] + [c.text for t in d.tables for r in t.rows for c in r.cells])
        assert "SEG-0001" in texto and "Estación 1" in texto and "Avance por estación" in texto
        assert len(d.inline_shapes) >= 1  # la gráfica entra como imagen
    elif formato == "pptx":
        from pptx import Presentation
        prs = Presentation(io.BytesIO(data))
        assert sum(1 for sl in prs.slides for sh in sl.shapes if sh.shape_type == 13) >= 1
    else:
        from pypdf import PdfReader
        texto = " ".join(p.extract_text() for p in PdfReader(io.BytesIO(data)).pages)
        assert "SEG-0001" in texto and "Avance por estación" in texto


# ── Excel / CSV ────────────────────────────────────────────────────────────────
async def _bytes(resp):
    return b"".join([c async for c in resp.body_iterator])


@_con_db
async def test_exportar_excel_y_csv(db):
    import openpyxl
    m = await _modulo(opciones={"folio_activo": True, "folio_prefijo": "S-"})
    for d, c in (("Uno", 2.5), ("Dos", 4)):
        await server.create_custom_module_record("p1", m["id"], {"fecha": HOY(), "valores": {"desc": d, "ubi": "n1", "cant": c, "ok": True}}, ESPEC)
    resp = await server.export_custom_module_records("p1", m["id"], formato="xlsx", user=COORD)
    assert "Seguimiento.xlsx" in resp.headers["content-disposition"]
    ws = openpyxl.load_workbook(io.BytesIO(await _bytes(resp))).active
    cab = [c.value for c in ws[1]]
    assert cab[:3] == ["Folio", "Fecha", "Descripción"] and "Cierre · Estatus" in cab and cab[-2:] == ["Registró", "Capturado el"]
    assert ws["A2"].value == "S-0001" and ws["C2"].value == "Uno" and ws["E2"].value == 2.5  # número real, no texto
    assert ws["D2"].value == "Estación 1"
    ultima = [c.value for c in ws[ws.max_row]]
    assert ultima[0] == "TOTALES" and 6.5 in ultima
    csv_resp = await server.export_custom_module_records("p1", m["id"], formato="csv", user=COORD)
    texto = (await _bytes(csv_resp)).decode("utf-8-sig")
    assert texto.splitlines()[0].startswith("Folio,Fecha,Descripción") and "Uno" in texto
    with pytest.raises(HTTPException):
        await server.export_custom_module_records("p1", m["id"], formato="pdf", user=COORD)


@_con_db
async def test_plantilla_de_importacion(db):
    import openpyxl
    m = await _modulo()
    wb = openpyxl.load_workbook(io.BytesIO(await _bytes(await server.custom_module_import_template("p1", m["id"], COORD))))
    assert wb.sheetnames == ["Datos", "Instrucciones"]
    cab = [c.value for c in wb["Datos"][1]]
    assert cab == ["Fecha", "Descripción *", "Estación", "Cantidad", "Estatus", "Cumple"]  # sin foto ni calculados
    assert any("Abierto" in str(c.value) for c in wb["Instrucciones"]["D"])


@_con_db
async def test_importar_valida_por_fila_y_asigna_folios(db):
    m = await _modulo(opciones={"folio_activo": True})
    filas = [
        {"fila": 2, "fecha": "24/06/2026", "valores": {"desc": "Ok 1", "ubi": "Estación 1", "cant": "1,250.5", "est": "cerrado", "ok": "Sí"}},
        {"fila": 3, "valores": {"desc": "Mala lista", "est": "Archivado"}},
        {"fila": 4, "valores": {"cant": 3}},  # falta descripción (obligatoria)
        {"fila": 5, "fecha": 45832, "valores": {"desc": "Serie Excel", "ok": "no"}},  # 45832 = 2025-06-24
        {"fila": 6, "valores": {"desc": "Lugar raro", "ubi": "Nunca existió"}},
    ]
    sim = await server.import_custom_module_records("p1", m["id"], {"filas": filas, "simular": True}, COORD)
    assert (sim["total"], sim["validas"], sim["n_errores"], sim["importados"]) == (5, 2, 3, 0)
    assert {e["fila"] for e in sim["errores"]} == {3, 4, 6}
    assert await db.custom_module_records.count_documents({}) == 0  # simular no escribe
    # Con errores y sin permiso explícito no se importa nada (todo o nada)
    todo = await server.import_custom_module_records("p1", m["id"], {"filas": filas}, COORD)
    assert todo["importados"] == 0 and await db.custom_module_records.count_documents({}) == 0
    res = await server.import_custom_module_records("p1", m["id"], {"filas": filas, "importar_validas": True}, COORD)
    assert res["importados"] == 2
    regs = await server.list_custom_module_records("p1", m["id"], user=COORD)
    por_desc = {r["valores"]["desc"]: r for r in regs}
    assert por_desc["Ok 1"]["valores"]["cant"] == 1250.5 and por_desc["Ok 1"]["valores"]["est"] == "Cerrado"
    assert por_desc["Ok 1"]["valores"]["ubi"]["nombre"] == "Estación 1" and "est" in por_desc["Ok 1"]["cierres"]
    assert por_desc["Serie Excel"]["fecha"] == "2025-06-24" and por_desc["Serie Excel"]["valores"]["ok"] is False
    assert sorted(r["folio"] for r in regs) == ["0001", "0002"]


# ── Plantillas propias ──────────────────────────────────────────────────────────
@_con_db
async def test_plantillas_propias(db):
    m = await _modulo(graficas=[{"tipo": "pastel", "categoria": "est", "informes": ["reportes_semanales"]}], opciones={"folio_activo": True, "folio_prefijo": "Z-"})
    t = await server.create_custom_module_template({"project_id": "p1", "module_id": m["id"], "nombre": "Mi plantilla"}, COORD)
    assert t["nombre"] == "Mi plantilla" and "project_id" not in t["definicion"] and "area_id" not in t["definicion"]
    assert [x["id"] for x in await server.list_custom_module_templates(COORD)] == [t["id"]]
    otro_coord = {**COORD, "id": "u9"}
    assert await server.list_custom_module_templates(otro_coord) == []  # son del Coordinador que las guardó
    with pytest.raises(HTTPException):
        await server.delete_custom_module_template(t["id"], otro_coord)
    # La definición guardada es aplicable tal cual a un módulo nuevo (otro proyecto)
    nuevo = await server.create_custom_module("p1", {**t["definicion"], "nombre": "Desde plantilla"}, COORD)
    assert nuevo["opciones"]["folio_prefijo"] == "Z-" and len(nuevo["graficas"]) == 1 and nuevo["folio_contador"] == 0
    await server.delete_custom_module_template(t["id"], COORD)
    assert await server.list_custom_module_templates(COORD) == []
