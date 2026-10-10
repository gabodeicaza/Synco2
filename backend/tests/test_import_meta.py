"""Tests de la meta de un concepto recién importado por Excel — antes se
creaba con meta "0" fija y había que editarla una por una a mano después.
Se probó primero con una columna "Meta" mapeable en el archivo, pero por
feedback ("la meta debe de ser la cantidad") se simplificó: no hay columna
Meta en el importador, la meta de un concepto NUEVO es siempre su propia
cantidad contratada, y un concepto EXISTENTE nunca la ve tocada al
reimportar. Mismo patrón de colecciones Mongo FALSAS que
test_import_commit_compensacion.py, para no depender de un Mongo real.
"""
import asyncio
import functools
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_import_meta")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import _ejecutar_commit_con_compensacion, _validar_archivo_completo, _calcular_vista_filas, ImportMappingIn


def run_async(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return asyncio.run(fn(*args, **kwargs))
    return wrapper


class _FakeCollection:
    def __init__(self, docs=None):
        self.docs = {d["id"]: dict(d) for d in (docs or [])}

    async def find_one(self, query):
        doc = self.docs.get(query.get("id"))
        return dict(doc) if doc else None

    async def insert_one(self, doc):
        self.docs[doc["id"]] = dict(doc)

    async def update_one(self, query, update):
        _id = query.get("id")
        if _id in self.docs:
            if "$set" in update:
                self.docs[_id].update(update["$set"])
            if "$push" in update:
                for k, v in update["$push"].items():
                    self.docs[_id].setdefault(k, []).append(v)

    async def delete_one(self, query):
        self.docs.pop(query.get("id"), None)


async def _noop_bitacora(*args, **kwargs):
    pass


TEST_USER = {"id": "user-1", "name": "Test User"}
HEADERS = ["Clave", "Descripcion", "Unidad", "Cantidad", "PU"]
MAPPING = ImportMappingIn(clave="Clave", descripcion="Descripcion", unidad="Unidad", cantidad="Cantidad", precio_unitario="PU")


def _vista_de(data_rows, existing_by_clave=None):
    rows = [HEADERS] + data_rows
    filas = _validar_archivo_completo(rows, 0, MAPPING, None, existing_by_clave or {})
    return _calcular_vista_filas(filas, {})


def _concepto_existente(cid, clave, **overrides):
    base = {
        "id": cid, "partida_id": "partida-1", "project_id": "proyecto-1",
        "clave": clave, "descripcion": "Descripción original", "unidad": "PZA",
        "cantidad": "5", "precio_unitario": "10.00", "meta": "0",
        "periodicidad_meta": "SEMANAL", "activo": True,
        "created_at": datetime.now(timezone.utc), "created_by": "otro-user",
    }
    base.update(overrides)
    return base


@run_async
async def test_concepto_nuevo_nace_sin_meta_y_con_la_cadencia_del_proyecto():
    # C-06: el importador no trae fechas, así que no hay programa del que calcular un
    # ritmo: la meta queda vacía (ya NO es "toda la cantidad por semana").
    conceptos_col = _FakeCollection()
    sessions_col = _FakeCollection([{"id": "import-1"}])

    vista = _vista_de([["A1", "Concepto nuevo", "PZA", "10", "50.00"]])

    resultado = await _ejecutar_commit_con_compensacion(
        conceptos_col, sessions_col, _noop_bitacora,
        "proyecto-1", "import-1", "partida-1", vista, "actualizar", TEST_USER, "archivo.xlsx",
        cadencia="DIARIA",
    )
    assert resultado["creados"] == 1
    creado = list(conceptos_col.docs.values())[0]
    assert creado["cantidad"] == "10"
    assert creado["meta"] == ""
    assert creado["periodicidad_meta"] == "DIARIA"


@run_async
async def test_sin_cadencia_explicita_se_usa_la_mensual_por_defecto_del_proyecto():
    conceptos_col = _FakeCollection()
    sessions_col = _FakeCollection([{"id": "import-1"}])
    vista = _vista_de([["A1", "Concepto nuevo", "PZA", "10", "50.00"]])
    await _ejecutar_commit_con_compensacion(
        conceptos_col, sessions_col, _noop_bitacora,
        "proyecto-1", "import-1", "partida-1", vista, "actualizar", TEST_USER, "archivo.xlsx",
    )
    assert list(conceptos_col.docs.values())[0]["periodicidad_meta"] == "MENSUAL"


@run_async
async def test_concepto_existente_reimportado_nunca_ve_su_meta_tocada():
    existente = _concepto_existente("concepto-existente", "B1", meta="999")
    conceptos_col = _FakeCollection([existente])
    sessions_col = _FakeCollection([{"id": "import-1"}])

    vista = _vista_de(
        [["B1", "Concepto actualizado", "M2", "20", "60.00"]],
        existing_by_clave={"B1": {"id": "concepto-existente"}},
    )
    resultado = await _ejecutar_commit_con_compensacion(
        conceptos_col, sessions_col, _noop_bitacora,
        "proyecto-1", "import-1", "partida-1", vista, "actualizar", TEST_USER, "archivo.xlsx",
    )
    assert resultado["actualizados"] == 1
    actualizado = conceptos_col.docs["concepto-existente"]
    assert actualizado["cantidad"] == "20"  # esto sí se actualizó
    assert actualizado["meta"] == "999"  # la meta, no
