"""Módulo Capacidades de Operadores: catálogos, operadores, constancias, semáforo, equipos.

Corre en memoria (mongomock-motor), sin servidor ni Mongo real.
"""
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_cap")
os.environ.setdefault("JWT_SECRET", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import server  # noqa: E402

PID, PID2 = "p1", "p2"
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
        loop.run_until_complete(mdb.projects.insert_many([{"id": PID, "modulos": MODULOS_ON}, {"id": PID2, "modulos": MODULOS_ON}, {"id": "p_off"}]))
        loop.close()
        yield cl
    server.app.dependency_overrides.clear()


def u(p, path=""):
    return f"/api/projects/{p}/capacidades/{path}"


def mk_cert(c, nombre="DC3 Alturas", **kw):
    r = c.post(u(PID, "certificaciones"), json={"nombre": nombre, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_normalizacion_y_similitud():
    assert server._cap_key("Cesar May Rosales") == server._cap_key(" MAY  rosales, César ")
    assert server._cap_similitud(server._cap_key("Gonzales Uribe Misrrain"), server._cap_key("Gonzalez Uribe Missrain")) > 0.85
    assert server._cap_suma_meses(date(2026, 1, 31), 1) == date(2026, 2, 28)


def test_modulo_apagado_bloquea_el_acceso(c):
    assert c.get(u("p_off", "certificaciones")).status_code == 403
    assert c.post(u("p_off", "certificaciones"), json={"nombre": "X"}).status_code == 403
    assert c.get(u(PID, "certificaciones")).status_code == 200


def test_catalogo_unico_y_baja_logica(c):
    a = mk_cert(c)
    assert c.post(u(PID, "certificaciones"), json={"nombre": "dc3 alturas"}).status_code == 409
    assert c.delete(u(PID, f"certificaciones/{a['id']}")).status_code == 200
    assert c.get(u(PID, "certificaciones")).json() == []
    assert len(c.get(u(PID, "certificaciones?incluir_inactivos=true")).json()) == 1


def test_semaforo_completo(c):
    cert = mk_cert(c, vigencia_meses=12)
    tipo = c.post(u(PID, "tipos"), json={"nombre": "Excavadora", "cert_ids": [cert["id"]]}).json()
    op = c.post(u(PID, "operadores"), json={"nombre": "May Rosales Cesar", "tipo_id": tipo["id"], "frente": "E1"}).json()
    assert op["semaforo"] == "rojo" and op["faltantes"] == ["DC3 Alturas"]

    hoy = date.today()
    k = c.post(u(PID, f"operadores/{op['id']}/constancias"), json={"cert_id": cert["id"], "emision": hoy.isoformat()}).json()
    assert k["vencimiento"] is not None  # calculado con la vigencia del catálogo
    assert c.get(u(PID, f"operadores/{op['id']}")).json()["semaforo"] == "verde"

    # por vencer -> amarillo ; vencida -> rojo
    por_vencer = (hoy + timedelta(days=10)).isoformat()
    c.put(u(PID, f"constancias/{k['id']}"), json={"cert_id": cert["id"], "vencimiento": por_vencer})
    assert c.get(u(PID, f"operadores/{op['id']}")).json()["semaforo"] == "amarillo"
    c.put(u(PID, f"constancias/{k['id']}"), json={"cert_id": cert["id"], "vencimiento": (hoy - timedelta(days=1)).isoformat()})
    o = c.get(u(PID, f"operadores/{op['id']}")).json()
    assert o["semaforo"] == "rojo" and o["vencidas"] == ["DC3 Alturas"]

    r = c.get(u(PID, "resumen")).json()
    assert r["por_semaforo"]["rojo"] == 1 and r["brechas"][0]["nombre"] == "May Rosales Cesar"


def test_equipo_exige_su_tipo_al_operador(c):
    cert = mk_cert(c, "Maquinaria pesada")
    tipo = c.post(u(PID, "tipos"), json={"nombre": "Grúa", "cert_ids": [cert["id"]]}).json()
    op = c.post(u(PID, "operadores"), json={"nombre": "Juan Perez"}).json()
    assert op["semaforo"] == "sin_reglas"
    eq = c.post(u(PID, "equipos"), json={"nombre": "Grúa Grove", "tipo_id": tipo["id"], "operador_id": op["id"]})
    assert eq.status_code == 200
    assert c.get(u(PID, f"operadores/{op['id']}")).json()["semaforo"] == "rojo"
    lista = c.get(u(PID, "equipos?q=grove")).json()
    assert lista[0]["operador"]["semaforo"] == "rojo"
    # baja del operador libera el equipo
    c.delete(u(PID, f"operadores/{op['id']}"))
    assert c.get(u(PID, "equipos")).json()[0]["operador"] is None


def test_duplicados_reutilizacion_entre_proyectos_y_alias(c):
    op = c.post(u(PID, "operadores"), json={"nombre": "Gonzales Uribe Misrrain"}).json()
    r = c.post(u(PID, "operadores"), json={"nombre": "Uribe Gonzalez Missrain"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "posibles_duplicados"
    # reutilizar la persona en otro proyecto
    cand = c.get(u(PID2, "personas/buscar?q=uribe")).json()
    assert cand[0]["persona_id"] == op["persona_id"] and cand[0]["operador_id"] is None
    o2 = c.post(u(PID2, "operadores"), json={"nombre": "x", "persona_id": op["persona_id"], "frente": "E9"})
    assert o2.status_code == 200 and o2.json()["nombre"] == "Gonzales Uribe Misrrain"
    assert c.post(u(PID2, "operadores"), json={"nombre": "x", "persona_id": op["persona_id"]}).status_code == 409
    # renombrar conserva el nombre previo como alias
    c.put(u(PID, f"operadores/{op['id']}"), json={"nombre": "Gonzalez Uribe Missrain"})
    assert "Gonzales Uribe Misrrain" in c.get(u(PID, f"operadores/{op['id']}")).json()["aliases"]
    # búsqueda por nombre en cualquier orden y sin acentos
    assert c.get(u(PID, "operadores?q=missrain gonzalez")).json()["total"] == 1


def test_copiar_catalogos_a_otro_proyecto(c):
    cert = mk_cert(c, "NOM-020")
    c.post(u(PID, "tipos"), json={"nombre": "Soldador", "cert_ids": [cert["id"]]})
    r = c.post(u(PID2, f"catalogos/copiar?origen_project_id={PID}")).json()
    assert r == {"certificaciones_nuevas": 1, "tipos_nuevos": 1}
    tipos = c.get(u(PID2, "tipos")).json()
    certs2 = c.get(u(PID2, "certificaciones")).json()
    assert tipos[0]["cert_ids"] == [certs2[0]["id"]] and certs2[0]["id"] != cert["id"]
    assert c.post(u(PID2, f"catalogos/copiar?origen_project_id={PID}")).json() == {"certificaciones_nuevas": 0, "tipos_nuevos": 0}


def test_archivo_constancia_subir_descargar_y_validar(c):
    cert = mk_cert(c)
    op = c.post(u(PID, "operadores"), json={"nombre": "Ana Lopez"}).json()
    k = c.post(u(PID, f"operadores/{op['id']}/constancias"), json={"cert_id": cert["id"]}).json()
    assert c.post(u(PID, f"constancias/{k['id']}/archivo"), files={"file": ("a.exe", b"zz")}).status_code == 400
    r = c.post(u(PID, f"constancias/{k['id']}/archivo"), files={"file": ("dc3.pdf", b"%PDF-1.4 hola", "application/pdf")})
    assert r.status_code == 200 and "path" not in r.json()
    d = c.get(u(PID, f"constancias/{k['id']}/archivo"))
    assert d.status_code == 200 and d.content == b"%PDF-1.4 hola"
    det = c.get(u(PID, f"operadores/{op['id']}")).json()
    assert det["certificaciones"][0]["tiene_archivo"] and "path" not in str(det["constancias"])


def test_solo_lectura_para_jefe(c):
    server.app.dependency_overrides[server.current_user] = lambda: {**USER, "role": server.ROLE_JEFE}
    assert c.post(u(PID, "certificaciones"), json={"nombre": "X"}).status_code == 403
    assert c.get(u(PID, "certificaciones")).status_code == 200


def test_migracion_enciende_solo_proyectos_con_datos(c):
    import asyncio
    db = server.db

    async def run():
        await db.projects.insert_many([
            {"id": "con_datos"}, {"id": "apagado", "modulos": {"reportes_diarios": {"capacidades_operadores": False}}},
            {"id": "sin_datos"},
        ])
        await db.cap_certs.insert_many([{"project_id": "con_datos"}, {"project_id": "apagado"}])
        n1 = await server._cap_migrar_modulo()
        n2 = await server._cap_migrar_modulo()
        return n1, n2, {p["id"]: p async for p in db.projects.find({})}

    n1, n2, ps = asyncio.new_event_loop().run_until_complete(run())
    assert (n1, n2) == (1, 0)
    assert ps["con_datos"]["modulos"]["reportes_diarios"]["capacidades_operadores"] is True
    assert ps["apagado"]["modulos"]["reportes_diarios"]["capacidades_operadores"] is False
    assert "modulos" not in ps["sin_datos"]
