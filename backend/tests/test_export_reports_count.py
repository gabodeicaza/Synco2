"""R-03: el conteo previo a exportar usa EXACTAMENTE los mismos criterios que las
exportaciones (`_export_reports_query`) y con el periodo vacío da 0. Pruebas puras (db falso).
También cubre la captura rápida de Fuerza de Trabajo (`solo_fuerza_trabajo`)."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_export_reports_count")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402


def _coincide(doc, filtro):
    for campo, cond in filtro.items():
        valor = doc.get(campo)
        if isinstance(cond, dict):
            if "$in" in cond:
                # Como Mongo: si el campo es una lista, basta con que un elemento coincida.
                elementos = valor if isinstance(valor, list) else [valor]
                if not any(e in cond["$in"] for e in elementos):
                    return False
            if "$gte" in cond and not (valor is not None and valor >= cond["$gte"]):
                return False
            if "$lte" in cond and not (valor is not None and valor <= cond["$lte"]):
                return False
            if "$lt" in cond and not (valor is not None and valor < cond["$lt"]):
                return False
        elif valor != cond:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *a, **k):
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    async def to_list(self, length=None):
        return list(self.docs)


class _Coleccion:
    def __init__(self, docs=None, registro=None, nombre=""):
        self.docs = docs or []
        self.registro = registro if registro is not None else []
        self.nombre = nombre

    async def find_one(self, filtro, *a, **k):
        return next((dict(d) for d in self.docs if _coincide(d, filtro)), None)

    def find(self, filtro=None, *a, **k):
        self.registro.append(("find", self.nombre, filtro))
        return _Cursor([dict(d) for d in self.docs if _coincide(d, filtro or {})])

    async def count_documents(self, filtro):
        self.registro.append(("count", self.nombre, filtro))
        return sum(1 for d in self.docs if _coincide(d, filtro))


class _Db:
    def __init__(self, reportes, proyecto):
        self.registro = []
        self.projects = _Coleccion([proyecto], self.registro, "projects")
        self.reports = _Coleccion(reportes, self.registro, "reports")
        self.location_nodes = _Coleccion([], self.registro, "location_nodes")
        self.areas = _Coleccion([], self.registro, "areas")
        self.announcements = _Coleccion([], self.registro, "announcements")


AHORA = datetime.now(timezone.utc)
PROYECTO = {"id": "p1", "name": "Obra", "zona_horaria": "America/Mexico_City"}


def _reporte(i, severidad, area="a1", captura="u9", hace=timedelta(seconds=5)):
    return {
        "id": f"r{i}", "project_id": "p1", "node_id": "n1", "severidad": severidad,
        "area_id": area, "captured_by": captura, "created_at": AHORA - hace,
    }


def _preparar(monkeypatch, reportes):
    db = _Db(reportes, PROYECTO)
    monkeypatch.setattr(server, "db", db)

    async def acceso(user, pid):
        return PROYECTO

    monkeypatch.setattr(server, "ensure_project_access", acceso)
    return db


COORD = {"id": "u1", "role": server.ROLE_COORD, "name": "Ana"}


def _contar(**filtros):
    return asyncio.run(server.export_reports_count(pid="p1", user=filtros.pop("user", COORD), **{
        "period": "month", "period_type": None, "area_id": None, "scope": None, **filtros,
    }))


def test_periodo_vacio_da_cero(monkeypatch):
    _preparar(monkeypatch, [_reporte(1, ["urgente"], hace=timedelta(days=400))])
    r = _contar()
    assert r["reportes"] == 0
    assert r["reportes_fuerza_trabajo"] == 0


def test_solo_cuenta_la_severidad_que_exporta_el_documento(monkeypatch):
    _preparar(monkeypatch, [
        _reporte(1, ["informativo"]), _reporte(2, ["importante"]), _reporte(3, ["urgente"]),
    ])
    r = _contar()
    # Los documentos incluyen Importante + Urgente; el informativo solo cuenta en Fuerza de Trabajo.
    assert r["reportes"] == 2
    assert r["reportes_fuerza_trabajo"] == 3


def test_period_type_semanal_solo_importantes(monkeypatch):
    _preparar(monkeypatch, [_reporte(1, ["importante"]), _reporte(2, ["urgente"]), _reporte(3, ["informativo"])])
    assert _contar(period_type="semanal")["reportes"] == 1
    assert _contar(period_type="mensual")["reportes"] == 1


def test_filtra_por_area(monkeypatch):
    _preparar(monkeypatch, [_reporte(1, ["urgente"], area="a1"), _reporte(2, ["urgente"], area="a2")])
    assert _contar(area_id="a2")["reportes"] == 1
    assert _contar()["reportes"] == 2


def test_especialista_con_scope_mine_solo_cuenta_los_suyos(monkeypatch):
    _preparar(monkeypatch, [
        _reporte(1, ["urgente"], captura="u2"), _reporte(2, ["urgente"], captura="u9"),
    ])
    esp = {"id": "u2", "role": server.ROLE_ESPECIALISTA, "name": "Luis", "area_id": "a1"}
    assert _contar(user=esp, scope="mine")["reportes"] == 1


def test_el_conteo_y_la_exportacion_usan_la_misma_consulta(monkeypatch):
    db = _preparar(monkeypatch, [_reporte(1, ["urgente"]), _reporte(2, ["importante"])])
    _contar(area_id="a1")
    asyncio.run(server._gather_export_data("p1", "month", COORD, area_id="a1"))
    conteos = [f for (op, nombre, f) in db.registro if op == "count" and nombre == "reports"]
    busquedas = [f for (op, nombre, f) in db.registro if op == "find" and nombre == "reports"]
    consulta_narrativa, consulta_ft = conteos[0], conteos[1]

    def sin_fin(consulta):
        # `$lte` del periodo "mes" es el instante de la consulta: cambia por microsegundos.
        copia = dict(consulta)
        copia["created_at"] = {k: v for k, v in consulta["created_at"].items() if k != "$lte"}
        return copia

    assert sin_fin(consulta_narrativa) in [sin_fin(b) for b in busquedas]
    assert sin_fin(consulta_ft) in [sin_fin(b) for b in busquedas]
    assert "severidad" in consulta_narrativa and "severidad" not in consulta_ft


# --- Captura rápida de Fuerza de Trabajo -------------------------------------
class _Nodos:
    async def find_one(self, filtro, *a, **k):
        return {"id": "n1", "project_id": "p1", "is_leaf": True, "measurement_type": "cadenamiento"}


def _crear_reporte(monkeypatch, **campos):
    insertados = []

    class _Reportes:
        async def find_one(self, *a, **k):
            return None

        async def insert_one(self, doc):
            insertados.append(doc)

    class _Db2:
        location_nodes = _Nodos()
        reports = _Reportes()
        areas = _Coleccion([])
        projects = _Coleccion([PROYECTO])

    async def acceso(user, pid):
        return PROYECTO

    async def nombres(nid):
        return ["Tramo", "Hoja"]

    async def notificar(**k):
        return None

    monkeypatch.setattr(server, "db", _Db2())
    monkeypatch.setattr(server, "ensure_project_access", acceso)
    monkeypatch.setattr(server, "node_path_names", nombres)
    monkeypatch.setattr(server, "_notify_supervisors_new_report", notificar)
    cuerpo = server.ReportIn(project_id="p1", node_id="n1", measurement_value={}, **campos)
    user = {"id": "u2", "role": server.ROLE_ESPECIALISTA, "name": "Luis", "area_id": "a1"}
    doc = asyncio.run(server.create_report(cuerpo, user))
    return doc, insertados


def test_reporte_solo_fuerza_de_trabajo_no_exige_medicion(monkeypatch):
    doc, insertados = _crear_reporte(
        monkeypatch, solo_fuerza_trabajo=True, personnel=["4 Albañiles"], equipment=["1 Retroexcavadora"],
        title="Fuerza de trabajo",
    )
    assert doc["personnel"] == ["4 Albañiles"]
    assert doc["equipment"] == ["1 Retroexcavadora"]
    assert doc["measurement_value"] == {}
    assert doc["solo_fuerza_trabajo"] is True
    assert insertados[0]["captured_by"] == "u2"


def test_reporte_solo_fuerza_de_trabajo_exige_al_menos_una_categoria(monkeypatch):
    with pytest.raises(HTTPException) as e:
        _crear_reporte(monkeypatch, solo_fuerza_trabajo=True, personnel=["  "], equipment=[])
    assert e.value.status_code == 400
    assert "personal o de equipo" in e.value.detail


def test_un_reporte_normal_sigue_exigiendo_la_medicion(monkeypatch):
    with pytest.raises(HTTPException) as e:
        _crear_reporte(monkeypatch, personnel=["4 Albañiles"])
    assert e.value.status_code == 400
    assert "cadenamiento" in e.value.detail
