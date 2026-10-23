"""Importador masivo de Capacidades de Operadores: análisis, conciliación de nombres, confirmar y deshacer."""
import io
import os
import sys
from datetime import datetime
from pathlib import Path

import openpyxl
import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_cap")
os.environ.setdefault("JWT_SECRET", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import server  # noqa: E402

PID = "p1"
USER = {"id": "u1", "name": "Coord", "role": server.ROLE_COORD, "project_ids": []}


@pytest.fixture()
def c(tmp_path, monkeypatch):
    mdb = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", mdb)
    monkeypatch.setattr(server, "UPLOADS_DIR", tmp_path)
    server.app.dependency_overrides[server.current_user] = lambda: USER
    with TestClient(server.app) as cl:
        import asyncio
        loop = asyncio.new_event_loop()
        loop.run_until_complete(mdb.projects.insert_one({"id": PID, "modulos": {"reportes_diarios": {"capacidades_operadores": True}}}))
        loop.close()
        yield cl
    server.app.dependency_overrides.clear()


def u(path=""):
    return f"/api/projects/{PID}/capacidades/{path}"


def xlsx(hojas):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for nombre, filas in hojas.items():
        ws = wb.create_sheet(nombre)
        for f in filas:
            ws.append(f)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def subir(c, data):
    r = c.post(u("importar/analizar"), files={"file": ("cl4.xlsx", data, "application/octet-stream")})
    assert r.status_code == 200, r.text
    return r.json()


def preview(c, a, hoja, tipo, **kw):
    h = next(x for x in a["hojas"] if x["nombre"] == hoja)
    body = {"archivo_id": a["archivo_id"], "hoja": hoja, "tipo": tipo, "header_row": h["header_row"],
            "mapeo": h["sugerido"][tipo], **kw}
    r = c.post(u("importar/previsualizar"), json=body)
    assert r.status_code == 200, r.text
    return r.json()


PERSONAL = [
    ["LISTA DE PERSONAL"], ["AGOSTO"],
    ["NO,", "FRENTE", "NOMBRE DEL TRABAJADOR", "PUESTO", "ESTATUS"],
    [1, "UNIVERSIDAD", "Santos Ruiz Gregorio", None, "VIGENTE"],
    [2, "UNIVERSIDAD", "GONZALEZ URIBE MISSRAIN", "OPERADOR DE GRUA", "NO ENCONTRADO"],
    [3, "E2 CANTERA", "Mora Antonio Herlindo", "Carpintero", "VIGENTE"],
    [4, "E2 CANTERA", "Mora Antonio Herlindo", "Carpintero", "VIGENTE"],   # repetido: un solo nombre distinto
    [None, None, "TOTAL DE PERSONAL ENCONTRADO:", None, None],
]


def test_analizar_detecta_encabezado_y_sugiere_mapeo(c):
    a = subir(c, xlsx({"SUA ALFA": PERSONAL}))
    h = a["hojas"][0]
    assert h["header_row"] == 3 and h["filas"] == 5
    assert h["sugerido"]["personal"] == {"nombre": 2, "puesto": 3, "frente": 1, "estatus": 4}
    assert c.post(u("importar/analizar"), files={"file": ("x.pdf", b"zz")}).status_code == 400


def test_importar_personal_con_estatus_sua_y_deshacer(c):
    sua = c.post(u("certificaciones"), json={"nombre": "Alta IMSS/SUA"}).json()
    a = subir(c, xlsx({"SUA ALFA": PERSONAL}))
    p = preview(c, a, "SUA ALFA", "personal",
                opciones={"crear_catalogo_nuevo": True, "estatus_cert": {"cert_id": sua["id"], "valores_ok": ["VIGENTE"]}})
    assert p["resumen"]["nombres_distintos"] == 3 and p["resumen"]["por_estado"]["nuevo"] == 3
    assert p["resumen"]["filas_omitidas"] == 1  # la fila "TOTAL DE PERSONAL ENCONTRADO:" no es una persona
    # la vista previa no escribe nada
    assert c.get(u("operadores")).json()["total"] == 0

    r = c.post(u(f"importar/{p['import_id']}/confirmar?plantilla=SUA mensual"))
    assert r.status_code == 200, r.text
    assert r.json()["personas_creadas"] == 3 and r.json()["creados"] == 3 and r.json()["sin_cambios"] == 1
    ops = c.get(u("operadores")).json()
    assert ops["total"] == 3
    mora = next(o for o in ops["items"] if o["nombre"].startswith("Mora"))
    assert mora["tipo"] == "Carpintero"  # tipo creado a partir del puesto
    # SUA vigente -> constancia; sin la exigencia aún no hay regla, así que no hay brecha
    assert any(x["nombre"] == "Alta IMSS/SUA" and x["constancia_id"] for x in mora["certificaciones"])
    assert c.post(u(f"importar/{p['import_id']}/confirmar")).status_code == 409  # no se aplica dos veces
    assert c.get(u("importar-plantillas?tipo=personal")).json()[0]["mapeo"]["nombre"] == "NOMBRE DEL TRABAJADOR"

    d = c.post(u(f"importar/{p['import_id']}/deshacer")).json()
    assert d["estado"] == "deshecha"
    assert c.get(u("operadores")).json()["total"] == 0
    assert [t["nombre"] for t in c.get(u("tipos")).json()] == []  # los tipos creados por la importación se dan de baja
    assert len(c.get(u("certificaciones")).json()) == 1  # la certificación previa no se toca


def test_conciliacion_de_nombres_ya_grabados(c):
    c.post(u("operadores"), json={"nombre": "Cesar May Rosales", "puesto": "Operador"})
    c.post(u("operadores"), json={"nombre": "Gonzalez Uribe Missrain"})
    c.post(u("operadores"), json={"nombre": "Perez Lopez Juan"})
    c.post(u("operadores"), json={"nombre": "Perez Lopes Juana", "force": True})
    filas = [["NOMBRE", "PUESTO", "FRENTE"],
             [" May Rosales Cesar", "Operador excavadora", "E1"],       # orden invertido -> exacto
             ["GONZÁLEZ URIBE MISRRAIN", None, None],                    # error ortográfico -> alto o dudoso
             ["Perez Lopez Juana", None, None],                          # ambiguo -> dudoso
             ["Totalmente Nuevo Fulano", None, None]]
    a = subir(c, xlsx({"Hoja1": filas}))
    p = preview(c, a, "Hoja1", "personal", opciones={"umbral_auto": 0.99})
    g = {x["nombre_origen"]: x for x in c.get(u(f"importar/{p['import_id']}/grupos")).json()["items"]}
    assert g[" May Rosales Cesar".strip()]["estado"] == "exacto"
    assert g["Totalmente Nuevo Fulano"]["estado"] == "nuevo"
    assert g["Perez Lopez Juana"]["estado"] == "dudoso" and len(g["Perez Lopez Juana"]["candidatos"]) >= 1
    assert g["GONZÁLEZ URIBE MISRRAIN"]["estado"] in ("alto", "dudoso")

    # con dudosos pendientes no deja confirmar
    pend = [x for x in g.values() if x["decision"] is None]
    assert pend and c.post(u(f"importar/{p['import_id']}/confirmar")).status_code == 409
    cand = g["Perez Lopez Juana"]["candidatos"][0]["persona_id"]
    dec = [{"grupo": x["grupo"], "accion": "ligar", "persona_id": x["candidatos"][0]["persona_id"]} for x in pend]
    assert c.put(u(f"importar/{p['import_id']}/grupos"), json=dec).json()["dudosos_pendientes"] == 0
    r = c.post(u(f"importar/{p['import_id']}/confirmar")).json()
    assert r["personas_creadas"] == 1 and r["actualizados"] >= 1
    ops = c.get(u("operadores?limit=50")).json()
    assert ops["total"] == 5  # 4 existentes + 1 nuevo; nadie se duplicó
    may = next(o for o in ops["items"] if o["nombre"] == "Cesar May Rosales")
    assert may["frente"] == "E1" and may["puesto"] == "Operador excavadora"  # el archivo manda cuando trae valor; una celda vacía nunca borra
    # lo ligado a mano queda como alias para la próxima vez
    pj = c.get(u(f"personas/buscar?q=perez lopez juana")).json()
    assert any(x["persona_id"] == cand for x in pj)


def test_importar_constancias_dc3_y_omitir_sin_dc3(c):
    c.post(u("certificaciones"), json={"nombre": "Trabajos en alturas", "aliases": ["TRABAJO EN ALTURAS"], "vigencia_meses": 12})
    c.post(u("operadores"), json={"nombre": "Alvarado Ruiz Jonathan"})
    filas = [["NO", "NOMBRE DEL TRABAJADOR", "CURSO", "PUESTO", "DC3", "ESTATUS"],
             [1, "ALVARADO RUIZ JONATHAN", "TRABAJOS EN ALTURAS", "SOLDADOR", "CUMPLE", "ACTIVO"],
             [2, "Solis Olvera Pablo", "TRABAJO EN ALTURAS", "SOLDADOR", "SIN  DC3", "BAJA"],
             [3, "Reyes Soto Gerardo", "Curso inventado", "X", "CUMPLE", "ACTIVO"]]
    a = subir(c, xlsx({"DC3": filas}))
    h = a["hojas"][0]
    assert h["sugerido"]["certificaciones"]["certificacion"] == 2
    p = preview(c, a, "DC3", "certificaciones", opciones={"omitir_si": ["SIN DC3"]})
    assert p["resumen"]["errores"] == 1 and p["valores_nuevos"]["certificaciones"][0]["valor"] == "Curso inventado"
    assert p["resumen"]["nombres_distintos"] == 1  # Solis se omitió (sin DC3) y Reyes quedó con error
    r = c.post(u(f"importar/{p['import_id']}/confirmar")).json()
    assert r["creados"] == 1
    op = c.get(u("operadores?q=alvarado")).json()["items"][0]
    assert op["certificaciones"][0]["constancia_id"]
    # reimportar el mismo archivo no duplica constancias
    p2 = preview(c, a, "DC3", "certificaciones", opciones={"omitir_si": ["SIN DC3"]})
    assert c.post(u(f"importar/{p2['import_id']}/confirmar")).json()["sin_cambios"] == 1


def test_importar_equipos_con_operador_y_fechas(c):
    c.post(u("operadores"), json={"nombre": "Lozano Pineda Jose Alberto"})
    filas = [["#", "Maquinaria / Equipo", "Modelo / Identificación", "Estación o Intertramo", "Estado", "Operador", "FECHA DE INGRESO", "FECHA DE SALIDA"],
             [1, "Excavadora", "CAT EX-318", "Estación 1", "Activo", "Jose Alberto Lozano Pineda", datetime(2026, 5, 1), "CONTINUA"],
             [2, "Roscadora", "Rolet", "Estación 1", "Inactivo", "NO APLICA", "NO APLICA", "CONTINUA"]]
    a = subir(c, xlsx({"Maquinaria": filas}))
    p = preview(c, a, "Maquinaria", "equipos")
    assert p["resumen"]["por_estado"]["exacto"] == 1
    r = c.post(u(f"importar/{p['import_id']}/confirmar")).json()
    assert r["creados"] == 2
    eqs = {e["nombre"]: e for e in c.get(u("equipos")).json()}
    assert eqs["Excavadora"]["operador"]["nombre"] == "Lozano Pineda Jose Alberto"
    assert eqs["Excavadora"]["fecha_ingreso"] == "2026-05-01" and eqs["Excavadora"]["fecha_salida"] is None
    assert eqs["Roscadora"]["estado"] == "inactivo" and eqs["Roscadora"]["operador"] is None
    # reimportar: ahora actualiza/sin cambios, no duplica
    p2 = preview(c, a, "Maquinaria", "equipos")
    r2 = c.post(u(f"importar/{p2['import_id']}/confirmar")).json()
    assert r2["creados"] == 0 and len(c.get(u("equipos")).json()) == 2


def test_lista_grande_rapida(c):
    import time
    nombres = [f"Apellido{i % 900} Materno{i % 37} Nombre{i}" for i in range(800)]
    base = [["NOMBRE", "PUESTO"]] + [[n, "Peon"] for n in nombres]
    a = subir(c, xlsx({"G": base}))
    t = time.time()
    p = preview(c, a, "G", "personal", opciones={"crear_catalogo_nuevo": True})
    assert p["resumen"]["filas_validas"] == 800
    r = c.post(u(f"importar/{p['import_id']}/confirmar")).json()
    assert r["personas_creadas"] == 800
    # segunda pasada con los mismos nombres: todo debe conciliarse como existente
    p2 = preview(c, a, "G", "personal", opciones={"crear_catalogo_nuevo": True})
    assert p2["resumen"]["por_estado"]["exacto"] == 800 and p2["resumen"]["por_estado"]["nuevo"] == 0
    assert time.time() - t < 120
