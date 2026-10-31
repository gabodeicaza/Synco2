"""Presentación semanal: plantilla "semanal", selector de reportes de la semana
y export PPTX con las láminas del informe de referencia.

Usa el Mongo local (DB de prueba) y llama directamente a las funciones de los
endpoints — sin HTTP ni auth real."""
import asyncio
import base64
import io
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_presentacion_semanal")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pptx import Presentation  # noqa: E402

import server  # noqa: E402

# PNG 1x1 válido
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def _run(coro):
    return asyncio.run(coro)


def _template_pptx(path: Path) -> None:
    prs = Presentation()
    prs.slide_width, prs.slide_height = 9144000 * 3, 6858000 * 3
    for _ in range(2):
        prs.slides.add_slide(prs.slide_layouts[6])
    prs.save(str(path))


async def _scenario(tmp_path: Path, con_plantilla: bool):
    pid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    user = {"id": uid, "name": "Coord", "role": server.ROLE_COORD, "project_ids": [pid]}
    proj = {"id": pid, "name": "Proyecto X", "objeto_contrato": "OBJETO DEL CONTRATO",
            "color_institucional": "#8A1538",
            "modulos": {"reportes_semanales": {"impacto_ambiental": True, "aspectos_sociales": True,
                                                "seguridad_higiene": True, "estudios_proyecto": True, "supervision_ambiental": True,
                                                "pendientes_generales": True}},
            "datos_contrato": {"obra": {"empresa": "ALFA", "contrato": "C-1", "monto": "$1.00"}}}
    if con_plantilla:
        tpl = tmp_path / "tpl.pptx"
        _template_pptx(tpl)
        proj["template_pptx"] = str(tpl)
    await server.db.projects.insert_one(proj)
    now = datetime.now(timezone.utc)
    rid_in, rid_out = str(uuid.uuid4()), str(uuid.uuid4())
    base = {"project_id": pid, "node_id": "n", "node_path_names": ["Tramo", "Estación 1"],
            "images": [PNG_B64] * 5, "photo_captions": ["uno", "dos"], "actividades": "Colado\nHabilitado",
            "severidad": ["informativo"], "captured_by_name": "Esp"}
    await server.db.reports.insert_many([
        {**base, "id": rid_in, "title": "Colado de zapatas", "created_at": now},
        {**base, "id": rid_out, "title": "Reporte viejo", "created_at": datetime(2020, 1, 1, tzinfo=timezone.utc)},
    ])
    await server.db.ambiental_auditoria.insert_one({
        "id": str(uuid.uuid4()), "project_id": pid, "tipo": "cumplimiento", "descripcion": "Riego de areas verdes",
        "fecha": now.date().isoformat(), "created_at": now, "captured_by_name": "Esp", "images": []})
    await server.db.levantamientos_sociales.insert_one({
        "id": str(uuid.uuid4()), "project_id": pid, "tipo": "dictamen_estructural", "ambito": "estacion",
        "total_requerido": 10, "realizados": 5})
    await server.db.seguridad_reportes.insert_one({
        "id": str(uuid.uuid4()), "project_id": pid, "fecha": now.date().isoformat(), "created_at": now,
        "trabajador": "Juan Perez", "contratista": "ALFA", "descripcion": "Caida leve", "severidad": "leve", "images": []})
    await server.db.ambiental.insert_many([
        {"id": str(uuid.uuid4()), "project_id": pid, "seccion": "autorizacion", "tipo": "SEDEMA", "folio": "DGEIRA/003972/2026", "orden": 0},
        {"id": str(uuid.uuid4()), "project_id": pid, "seccion": "arbolado", "nombre": "P003 (Perisur)", "orden": 0,
         "derribo_aut": 3, "derribo_ej": 2, "poda_aut": 1, "poda_ej": 1, "trasplante_aut": 6, "trasplante_ej": 5},
        {"id": str(uuid.uuid4()), "project_id": pid, "seccion": "informe", "nombre": "4to Informe Trimestral",
         "avance": 10, "fecha_cierre": "2026-12-02", "orden": 0},
        {"id": str(uuid.uuid4()), "project_id": pid, "seccion": "resarcimiento", "lugar": "Parque Cantera",
         "cantidad": 20, "foto": PNG_B64, "pie": "Plantaciones en Parque Cantera", "orden": 0},
        {"id": str(uuid.uuid4()), "project_id": pid, "seccion": "resarcimiento", "lugar": "Anillo Circunvalacion",
         "cantidad": 26, "foto": PNG_B64, "pie": "Plantaciones en Anillo", "orden": 1}])
    await server.db.seguridad_indicadores.insert_one({
        "id": str(uuid.uuid4()), "project_id": pid, "tipo": "campo", "fecha": now.date().isoformat(),
        "porcentaje": 69.13, "clave": "campo|x"})
    await server.db.electromecanica.insert_one({
        "id": str(uuid.uuid4()), "project_id": pid,
        "avance": {"estaciones": {"fabricacion": 26.79, "suministro": 1.26, "montaje": 0},
                   "pilonas": {"fabricacion": 7.05, "suministro": 1.41, "montaje": 0.24}},
        "avance_general": None, "pilonas_total": None, "pilonas_suministradas": None, "patio_nota": None,
        "documentos": [], "observaciones": [{"id": "o1", "titulo": "Suministro de componentes", "texto": "Llegada de contenedores", "fotos": []}]})
    await server.db.pendientes_generales.insert_one({
        "id": str(uuid.uuid4()), "project_id": pid, "contrato": "calidad", "titulo": "Faltantes de Obra",
        "descripcion": "Falta entrega del programa de montaje\nProcedimiento de relleno", "orden": 0, "resuelto": False})
    await server.set_estudios_matrices(pid, server.EstudioMatricesIn(matrices=[
        server.EstudioMatrizIn(
            titulo="Estatus de documentos en estaciones", forma="puntos", columnas=["Universidad", "Cantera"],
            filas=["# Mecanica de suelos", "EMS", "Plano de sondeos"],
            celdas={"1,0": "validado", "1,1": "observaciones", "2,0": "na"},
            notas=[server.EstudioMatrizNotaIn(titulo="Pendientes", texto="3 estudios de Xochitl")]),
        server.EstudioMatrizIn(
            titulo="Entregables TDR arquitectonico", columnas=[f"E{i}" for i in range(1, 9)],
            filas=["# Fase 1"] + [f"Entregable {i}" for i in range(1, 31)],
            celdas={f"{r},{c}": ("validado" if (r + c) % 3 == 0 else "revision" if (r + c) % 3 == 1 else "pendiente")
                    for r in range(1, 31) for c in range(8)},
            descripcion="Estado de revision de los entregables del proyecto ejecutivo.",
            notas=[server.EstudioMatrizNotaIn(titulo="Aspectos que retrasan", texto="Falta aprobacion del EMS")])]), user)
    await server.db.estudio_disciplina_avance.insert_many([
        {"id": str(uuid.uuid4()), "project_id": pid, "node_id": None, "disciplina": "topografia", "porcentaje": 98, "estatus": "en_proceso"},
        {"id": str(uuid.uuid4()), "project_id": pid, "node_id": "n", "disciplina": "urbano", "porcentaje": 100, "estatus": "terminado"}])
    await server.db.estudios_bitacora.insert_one({
        "id": str(uuid.uuid4()), "project_id": pid, "disciplina": "topografia",
        "texto": "Levantamiento de poligonal", "created_at": now})
    await server.db.pendientes_generales.insert_one({
        "id": str(uuid.uuid4()), "project_id": pid, "contrato": "obra", "titulo": "Control de Avance",
        "descripcion": "Programa pendiente de aval", "resuelto": False, "orden": 0, "created_at": now})
    await server.db.estimaciones.insert_many([
        {"id": str(uuid.uuid4()), "project_id": pid, "contrato": "obra", "numero": n, "estatus": "PAGADA",
         "periodo_inicio": "2026-01-01", "periodo_fin": "2026-01-31", "obra_ejecutada": "1000.00",
         "amortizacion": "100.00", "pct_amortizacion_anticipo": "10", "total_deducciones": "50.00",
         "iva": "160.00", "total_neto": "1010.00", "fecha_pago": "2026-02-02"} for n in (1, 2)])
    await server.db.location_nodes.insert_many([
        {"id": "est1", "project_id": pid, "parent_id": None, "name": "ESTACIÓN 1. UNIVERSIDAD", "order": 0,
         "tipo_nodo": "estacion", "cover_image": "data:image/png;base64," + PNG_B64},
        {"id": "est2", "project_id": pid, "parent_id": None, "name": "ESTACIÓN 2. CANTERA", "order": 1,
         "tipo_nodo": "estacion", "cover_image": None}])
    try:
        fecha = now.date().isoformat()
        created = await server.create_presentacion(
            pid, server.PresentacionIn(project_id=pid, fecha=fecha, plantilla="semanal"), user)
        tipos = [s["tipo"] for s in sorted(created["secciones"], key=lambda s: s["orden"])]
        assert tipos[0] == "portada" and tipos[-1] == "cierre" and "reportes_semana" in tipos
        assert tipos.count("croquis_estacion") == 1 and tipos.count("informacion_particular") == 2
        assert tipos.index("croquis_estacion") > tipos.index("divisor")
        assert (await server.agregar_secciones_estaciones(pid, created["id"], user))["agregadas"] == 0   # idempotente

        semana = await server.list_reportes_semana_presentacion(pid, created["id"], user)
        ids = [r["id"] for r in semana]
        assert rid_in in ids and rid_out not in ids
        assert semana[0]["titulo"] == "Colado de zapatas" and semana[0]["n_fotos"] == 5

        sec = next(s for s in created["secciones"] if s["tipo"] == "reportes_semana")
        await server.update_presentacion_seccion(
            pid, created["id"], sec["id"], server.PresentacionSeccionPatch(report_ids=[rid_in]), user)

        lam = await server.create_presentacion_seccion(
            pid, created["id"], server.PresentacionSeccionIn(tipo="lamina_imagenes", titulo="Grafica propia", orden=99), user)
        fotos = [server.InformacionParticularFotoIn(photo="data:image/png;base64," + PNG_B64, caption=f"Foto {i}", ajustar=(i == 0))
                 for i in range(5)]
        await server.update_informacion_particular(
            pid, created["id"], lam["id"],
            server.InformacionParticularBloquesPatch(bloques=[
                server.InformacionParticularBloqueIn(titulo="Avance de pilonas", actividades=["Linea uno"], fotos=fotos),
                server.InformacionParticularBloqueIn(
                    titulo="Actividades generales - supervision social", estilo="registro",
                    fotos=[server.InformacionParticularFotoIn(photo="data:image/png;base64," + PNG_B64, caption="Reunion virtual con C5")])]),
            user)

        resp = await server.export_presentacion_pptx(pid, created["id"], user)
        data = b"".join([chunk async for chunk in resp.body_iterator])
        return Presentation(io.BytesIO(data)), tipos
    finally:
        await server.db.projects.delete_one({"id": pid})
        await server.db.presentaciones.delete_many({"project_id": pid})
        await server.db.reports.delete_many({"project_id": pid})
        await server.db.location_nodes.delete_many({"project_id": pid})
        for col in ("ambiental_auditoria", "levantamientos_sociales", "seguridad_reportes",
                    "estudios_bitacora", "pendientes_generales", "estimaciones", "seguridad_indicadores", "ambiental", "estudio_disciplina_avance", "electromecanica", "estudios_matrices"):
            await server.db[col].delete_many({"project_id": pid})


async def _ambos(tmp_path):
    # Un solo bucle de eventos: el cliente Motor queda atado al primero.
    return [await _scenario(tmp_path, False), await _scenario(tmp_path, True)]


def test_export_semanal_incluye_reporte_elegido(tmp_path):
    for prs, _tipos in _run(_ambos(tmp_path)):
        _verifica(prs)


def _verifica(prs):
    textos = []
    for sl in prs.slides:
        partes = [sh.text_frame.text for sh in sl.shapes if sh.has_text_frame]
        for sh in sl.shapes:
            if sh.has_table:
                partes += [c.text for row in sh.table.rows for c in row.cells]
        textos.append(" ".join(partes))
    todo = " | ".join(textos)
    assert "INFORME DE ACTIVIDADES" in todo
    assert "Colado de zapatas" in todo           # reporte elegido
    assert "Reporte viejo" not in todo           # fuera de la semana / no elegido
    assert "(cont.)" in todo                     # 5 fotos → segunda lámina
    assert "AVANCE DE PILONAS" in todo and "Foto 4" in todo   # lámina libre
    assert "ESTACIÓN 1. UNIVERSIDAD" in todo and "ESTACIÓN 2. CANTERA" in todo   # láminas por estación
    assert "AUTORIZADOS" in todo and "DERRIBOS" in todo and "P003 (Perisur)" in todo   # matriz de arbolado
    assert "Porcentaje de avance" in todo and "Dictámenes estructurales en Estaciones: 50.00%" in todo   # lista social
    assert "REGISTRO FOTOGRÁFICO DE ACTIVIDADES GENERALES" in todo and "Reunion virtual con C5" in todo
    assert "ESTATUS DE DOCUMENTOS EN ESTACIONES" in todo and "Base de cálculo: 2 entregables × 2 columnas = 3 registros" in todo
    assert "Validado técnicamente: 1 (33.3%)" in todo and "PENDIENTES" in todo
    assert "Gracias" in todo
    assert "Componentes Electromecánicos" in todo and "26.79%" in todo   # resumen electromecánico
    assert "FALTANTES DE OBRA" in todo and "programa de montaje" in todo  # columnas de calidad
    assert "Riego de areas verdes" in todo       # Ambiental automático
    assert "AMBIENTAL" in todo and "SEGURIDAD" in todo and "SOCIAL" in todo
    assert "LEVANTAMIENTOS NOTARIALES - AVANCES" in todo        # Social automático
    assert "Levantamiento de poligonal" in todo  # Estudios y proyecto ejecutivo
    assert "Programa pendiente de aval" in todo  # Pendientes generales
    assert "Juan Perez" in todo                  # Seguridad automática
    assert "TOTAL" in todo and "2,000.00" in todo   # fila TOTAL de estimaciones
    assert "Estado Contractual y Financiero" in todo
    assert "98.00%" in todo and "100.00%" in todo   # seguimiento de estudios
    assert "Cruz de seguridad" in todo and "69.13%" in todo   # láminas de Seguridad
    assert "DATOS DE CONTRATO (OBRA)" in todo    # financiero con datos de contrato
    # portada, mapa, 3 divisores, contrato, estudios, 2 láminas de reporte, cierre
    assert len(prs.slides) >= 10
