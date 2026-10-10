"""C-01 migración: reubicar conceptos ya importados según el prefijo de su clave.
Plan puro + aplicar/revertir con una base en memoria: sin Mongo ni backend vivo."""
import asyncio
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_migracion_catalogo")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402

USER = {"id": "u1", "name": "Coord", "role": server.ROLE_COORD}


def P(i, clave, activo=True):
    return {"id": i, "project_id": "p1", "clave": clave, "nombre": f"Partida {clave}", "activo": activo, "partida_padre_id": None}


def C(i, clave, partida, activo=True):
    return {"id": i, "project_id": "p1", "clave": clave, "partida_id": partida, "activo": activo}


# ------------------------------------------------------------------ exclusión de Cablebús
class TestExclusion:
    @pytest.mark.parametrize("nombre", [
        "Cablebús Línea 4", "CABLEBUS LINEA 4", "cablebus", "Línea 4", "Linea 4 Norte", "Cablebus Línea 4 - Ampliación",
    ])
    def test_se_excluyen(self, nombre):
        assert server.es_proyecto_excluido(nombre) is True

    @pytest.mark.parametrize("nombre", ["Proyecto Demo (PRUEBA)", "Línea 40 Norte", "Línea 5", "Autopista 4 carriles", ""])
    def test_no_se_excluyen(self, nombre):
        assert server.es_proyecto_excluido(nombre) is False


# ------------------------------------------------------------------ plan puro
class TestPlan:
    def test_catalogo_plano_se_reorganiza_por_prefijo(self):
        partidas = [P("x", "CAT")]
        conceptos = [C("c1", "1.1.1", "x"), C("c2", "1.1.2", "x"), C("c3", "1.2.1", "x"), C("c4", "2.1.1", "x")]
        plan = server.planificar_reubicacion(partidas, conceptos)
        nodos = {n["clave"]: n["padre"] for n in plan["nodos_a_crear"]}
        assert set(nodos) == {"1", "1.1", "1.2", "2", "2.1"}
        # el primer nodo de cada rama cuelga de donde estaba el catálogo; los demás, del nodo anterior
        assert nodos["1"] == ("id", "x") and nodos["2"] == ("id", "x")
        assert nodos["1.1"] == ("nuevo", "1") and nodos["1.2"] == ("nuevo", "1") and nodos["2.1"] == ("nuevo", "2")
        destino = {m["concepto_id"]: m["hacia"] for m in plan["movimientos"]}
        assert destino == {"c1": ("nuevo", "1.1"), "c2": ("nuevo", "1.1"), "c3": ("nuevo", "1.2"), "c4": ("nuevo", "2.1")}

    def test_los_nodos_se_crean_de_raiz_a_hoja(self):
        plan = server.planificar_reubicacion([P("x", "CAT")], [C("c", "1.1.1.1", "x")])
        assert [n["clave"] for n in plan["nodos_a_crear"]] == ["1", "1.1", "1.1.1"]

    def test_reusa_las_partidas_que_ya_existen_por_clave(self):
        partidas = [P("x", "CAT"), P("p1", "1")]
        plan = server.planificar_reubicacion(partidas, [C("c", "1.1", "x")])
        assert plan["nodos_a_crear"] == []  # "1" ya existe
        assert plan["movimientos"][0]["hacia"] == ("id", "p1")

    def test_es_idempotente_un_concepto_ya_en_su_lugar_no_se_mueve(self):
        partidas = [P("x", "CAT"), P("p1", "1"), P("p11", "1.1")]
        plan = server.planificar_reubicacion(partidas, [C("c", "1.1.1", "p11")])
        assert plan == {"nodos_a_crear": [], "movimientos": []}

    def test_las_claves_sin_puntos_no_se_tocan(self):
        plan = server.planificar_reubicacion([P("x", "CAT")], [C("c", "C-001", "x"), C("d", "7", "x")])
        assert plan == {"nodos_a_crear": [], "movimientos": []}

    def test_conceptos_inactivos_se_ignoran(self):
        plan = server.planificar_reubicacion([P("x", "CAT")], [C("c", "1.1", "x", activo=False)])
        assert plan["movimientos"] == []

    def test_partidas_inactivas_no_cuentan_como_existentes(self):
        plan = server.planificar_reubicacion([P("x", "CAT"), P("viejo", "1", activo=False)], [C("c", "1.1", "x")])
        assert [n["clave"] for n in plan["nodos_a_crear"]] == ["1"]

    def test_el_orden_de_creacion_es_estable_y_natural(self):
        conceptos = [C("a", "10.1", "x"), C("b", "2.1", "x"), C("c", "1.1", "x")]
        plan = server.planificar_reubicacion([P("x", "CAT")], conceptos)
        assert [n["clave"] for n in plan["nodos_a_crear"]] == ["1", "2", "10"]  # 2 antes que 10 (orden numérico)


# ------------------------------------------------------------------ base en memoria
class Cur:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, campo, direccion=1):
        self.docs.sort(key=lambda d: d.get(campo) or 0, reverse=direccion < 0)
        return self

    async def to_list(self, length=None):
        return [dict(d) for d in self.docs]


def _coincide(d, filtro):
    for k, v in filtro.items():
        if isinstance(v, dict):
            if "$ne" in v and d.get(k) == v["$ne"]:
                return False
        elif d.get(k) != v:
            return False
    return True


class Col:
    def __init__(self, docs=None, falla_en_insert=None):
        self.docs = {d["id"]: dict(d) for d in (docs or [])}
        self.falla_en_insert = falla_en_insert
        self.inserts = 0

    def find(self, filtro=None, proyeccion=None):
        return Cur([d for d in self.docs.values() if _coincide(d, filtro or {})])

    async def find_one(self, filtro):
        return next((dict(d) for d in self.docs.values() if _coincide(d, filtro)), None)

    async def count_documents(self, filtro):
        return sum(1 for d in self.docs.values() if _coincide(d, filtro))

    async def insert_one(self, doc):
        self.inserts += 1
        if self.falla_en_insert and self.inserts == self.falla_en_insert:
            raise RuntimeError("fallo simulado")
        self.docs[doc["id"]] = dict(doc)

    async def update_one(self, filtro, upd):
        d = next((x for x in self.docs.values() if _coincide(x, filtro)), None)
        if d is None:
            return
        d.update(upd.get("$set", {}))
        for k, v in upd.get("$push", {}).items():
            d.setdefault(k, []).append(v)


def _db(partidas, conceptos, falla_en_insert=None):
    from unittest.mock import MagicMock
    db = MagicMock()
    db.partidas = Col(partidas, falla_en_insert)
    db.conceptos = Col(conceptos)
    db.migraciones_catalogo = Col()
    db.catalogo_bitacora = Col()
    server.db = db
    return db


def _aplicar():
    plan = asyncio.run(server._plan_reubicacion_de_proyecto("p1"))
    return plan, asyncio.run(server.aplicar_reubicacion("p1", plan, USER))


class TestAplicarYRevertir:
    def _catalogo_plano(self):
        return _db([P("x", "CAT")], [C("c1", "1.1.1", "x"), C("c2", "1.1.2", "x"), C("c3", "2.1.1", "x")])

    def test_aplicar_crea_los_nodos_con_la_clave_como_nombre_pendiente(self):
        db = self._catalogo_plano()
        _, mig = _aplicar()
        assert mig
        nuevas = [p for p in db.partidas.docs.values() if p.get("migracion_id") == mig]
        assert {p["clave"] for p in nuevas} == {"1", "1.1", "2", "2.1"}
        for p in nuevas:
            assert p["nombre"] == p["clave"] and p["nombre_pendiente"] is True and p["activo"] is True
        por_clave = {p["clave"]: p for p in nuevas}
        assert por_clave["1"]["partida_padre_id"] == "x"
        assert por_clave["1.1"]["partida_padre_id"] == por_clave["1"]["id"]
        assert db.conceptos.docs["c1"]["partida_id"] == por_clave["1.1"]["id"]
        assert db.conceptos.docs["c3"]["partida_id"] == por_clave["2.1"]["id"]
        assert db.migraciones_catalogo.docs[mig]["estado"] == "aplicada"

    def test_aplicar_dos_veces_no_cambia_nada(self):
        db = self._catalogo_plano()
        _aplicar()
        n_partidas = len(db.partidas.docs)
        plan2, mig2 = _aplicar()
        assert mig2 is None and plan2 == {"nodos_a_crear": [], "movimientos": []}
        assert len(db.partidas.docs) == n_partidas

    def test_revertir_devuelve_cada_concepto_y_da_de_baja_las_partidas_nuevas(self):
        db = self._catalogo_plano()
        _, mig = _aplicar()
        r = asyncio.run(server.revertir_migracion(mig, USER))
        assert r == {"conceptos_restaurados": 3, "partidas_dadas_de_baja": 4}
        assert {c["partida_id"] for c in db.conceptos.docs.values()} == {"x"}
        assert all(p["activo"] is False for p in db.partidas.docs.values() if p.get("migracion_id") == mig)
        assert db.partidas.docs["x"]["activo"] is True  # la original no se toca
        assert db.migraciones_catalogo.docs[mig]["estado"] == "revertida"
        # nunca se borra nada
        assert len(db.conceptos.docs) == 3 and len(db.partidas.docs) == 5

    def test_revertir_no_pisa_lo_que_el_usuario_movio_despues(self):
        db = self._catalogo_plano()
        _, mig = _aplicar()
        db.conceptos.docs["c1"]["partida_id"] = "otro-lugar"  # el usuario lo reubicó a mano
        r = asyncio.run(server.revertir_migracion(mig, USER))
        assert r["conceptos_restaurados"] == 2
        assert db.conceptos.docs["c1"]["partida_id"] == "otro-lugar"

    def test_revertir_es_idempotente(self):
        db = self._catalogo_plano()
        _, mig = _aplicar()
        asyncio.run(server.revertir_migracion(mig, USER))
        r2 = asyncio.run(server.revertir_migracion(mig, USER))
        assert r2["conceptos_restaurados"] == 0
        assert {c["partida_id"] for c in db.conceptos.docs.values()} == {"x"}

    def test_si_falla_a_la_mitad_se_revierte_solo(self):
        db = _db([P("x", "CAT")], [C("c1", "1.1.1", "x"), C("c2", "2.1.1", "x")], falla_en_insert=3)
        plan = asyncio.run(server._plan_reubicacion_de_proyecto("p1"))
        with pytest.raises(HTTPException) as e:
            asyncio.run(server.aplicar_reubicacion("p1", plan, USER))
        assert e.value.status_code == 500 and "revirtió" in e.value.detail
        assert {c["partida_id"] for c in db.conceptos.docs.values()} == {"x"}
        assert all(not p["activo"] for p in db.partidas.docs.values() if p.get("migracion_id"))


class TestEndpointsSeguridad:
    def test_un_proyecto_excluido_se_rechaza_con_403(self):
        from unittest.mock import AsyncMock, MagicMock
        db = MagicMock()
        db.projects = MagicMock()
        db.projects.find_one = AsyncMock(return_value={"id": "p1", "name": "Cablebús Línea 4"})
        server.db = db
        with pytest.raises(HTTPException) as e:
            asyncio.run(server._proyecto_migrable_o_error("p1", USER))
        assert e.value.status_code == 403

    def test_aplicar_sin_confirmar_se_rechaza(self):
        with pytest.raises(HTTPException) as e:
            asyncio.run(server.aplicar_migracion_catalogo("p1", server.MigracionConfirmIn(confirm=False), USER))
        assert e.value.status_code == 400

    def test_solo_el_coordinador_general_puede_migrar(self):
        rutas = [r for r in server.api.routes if "/admin/migraciones/catalogo-jerarquia" in getattr(r, "path", "")]
        assert len(rutas) == 4
        for r in rutas:
            roles = set()
            for dep in r.dependant.dependencies:
                for cell in (dep.call.__closure__ or []):
                    if isinstance(cell.cell_contents, tuple):
                        roles = set(cell.cell_contents)
            assert roles == {server.ROLE_COORD}, r.path

    def test_renombrar_una_partida_limpia_la_marca_de_nombre_pendiente(self):
        db = _db([{**P("n", "1"), "nombre_pendiente": True, "created_at": None}], [])
        db.partidas.docs["n"]["created_at"] = __import__("datetime").datetime(2026, 1, 1)
        # update_partida lee la partida y luego escribe; comprobamos el $set que produce el nombre
        from unittest.mock import AsyncMock
        db.partidas.update_one = AsyncMock()
        db.partidas.find = lambda *a, **k: Cur([db.partidas.docs["n"]])
        db.projects = __import__("unittest.mock").mock.MagicMock()
        db.projects.find_one = AsyncMock(return_value={"id": "p1", "modo_avance": "CANTIDAD"})
        db.conceptos.find = lambda *a, **k: Cur([])
        try:
            asyncio.run(server.update_partida("n", server.PartidaPatch(nombre="Preliminares"), USER))
        except Exception:
            pass
        assert db.partidas.update_one.await_args.args[1]["$set"] == {"nombre": "Preliminares", "nombre_pendiente": False}
