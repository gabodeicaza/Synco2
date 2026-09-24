"""Tests de la Etapa 3 sobre el commit con compensación manual — usa
colecciones Mongo FALSAS (en memoria) para poder simular un fallo a mitad
del loop sin depender de un Mongo real corriendo en este entorno. Mismo
principio que los tests de offlineQueue.test.ts en el frontend: sustituir la
capa de I/O por un doble controlable en vez de dejar el comportamiento sin
probar.
"""
import asyncio
import functools
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest


def run_async(fn):
    """No hay pytest-asyncio instalado en este proyecto (y no quiero
    agregar una dependencia nueva sin proponerla primero) -- se corre la
    coroutine de prueba con asyncio.run() puro."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return asyncio.run(fn(*args, **kwargs))
    return wrapper

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_import_commit")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import _ejecutar_commit_con_compensacion, _validar_archivo_completo, _calcular_vista_filas, ImportMappingIn
from fastapi import HTTPException


class _FakeCollection:
    """Doble mínimo de una colección de motor/AsyncIOMotorCollection: solo
    implementa lo que _ejecutar_commit_con_compensacion realmente usa."""

    def __init__(self, docs=None):
        self.docs = {d["id"]: dict(d) for d in (docs or [])}
        self._fail_on = None  # (operacion, n) -> truena en la n-esima llamada a esa operacion
        self._counts = {"insert_one": 0, "update_one": 0, "delete_one": 0}

    def fail_on(self, op: str, n: int):
        self._fail_on = (op, n)

    def _maybe_fail(self, op):
        self._counts[op] = self._counts.get(op, 0) + 1
        if self._fail_on and self._fail_on[0] == op and self._counts[op] == self._fail_on[1]:
            raise RuntimeError(f"fallo simulado en {op} #{self._fail_on[1]}")

    async def find_one(self, query):
        doc = self.docs.get(query.get("id"))
        return dict(doc) if doc else None

    async def insert_one(self, doc):
        self._maybe_fail("insert_one")
        self.docs[doc["id"]] = dict(doc)

    async def update_one(self, query, update):
        self._maybe_fail("update_one")
        _id = query.get("id")
        if _id in self.docs:
            if "$set" in update:
                self.docs[_id].update(update["$set"])
            if "$push" in update:
                for k, v in update["$push"].items():
                    self.docs[_id].setdefault(k, []).append(v)

    async def delete_one(self, query):
        self._maybe_fail("delete_one")
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


# ============================================================================
# Caso feliz: se crean y actualizan correctamente
# ============================================================================
@run_async
async def test_creados_y_actualizados_se_registran_bien():
    existente = _concepto_existente("concepto-existente", "B1")
    conceptos_col = _FakeCollection([existente])
    sessions_col = _FakeCollection([{"id": "import-1"}])

    vista = _vista_de(
        [
            ["A1", "Concepto nuevo", "PZA", "10", "50.00"],
            ["B1", "Concepto actualizado", "M2", "20", "60.00"],
        ],
        existing_by_clave={"B1": {"id": "concepto-existente"}},
    )

    resultado = await _ejecutar_commit_con_compensacion(
        conceptos_col, sessions_col, _noop_bitacora,
        "proyecto-1", "import-1", "partida-1", vista, "actualizar", TEST_USER, "archivo.xlsx",
    )

    assert resultado["creados"] == 1
    assert resultado["actualizados"] == 1
    assert len(conceptos_col.docs) == 2
    actualizado = conceptos_col.docs["concepto-existente"]
    assert actualizado["cantidad"] == "20"
    assert actualizado["precio_unitario"] == "60.00"
    assert actualizado["import_batch_id"] == resultado["import_batch_id"]


# ============================================================================
# EL TEST QUE MÁS IMPORTA: falla a mitad del commit -> compensación revierte
# ============================================================================
@run_async
async def test_fallo_a_mitad_del_commit_revierte_creados_y_restaura_actualizados():
    existente = _concepto_existente("concepto-existente", "B1", descripcion="Descripción ORIGINAL", cantidad="5", precio_unitario="10.00", unidad="PZA")
    conceptos_col = _FakeCollection([existente])
    sessions_col = _FakeCollection([{"id": "import-1"}])

    # 3 filas: crear, actualizar, crear. Forzamos que el SEGUNDO insert_one
    # (el de la fila C, después de que A ya se creó y B ya se actualizó)
    # truene -- exactamente "a mitad del commit".
    conceptos_col.fail_on("insert_one", 2)

    vista = _vista_de(
        [
            ["A1", "Concepto nuevo A", "PZA", "10", "50.00"],
            ["B1", "Concepto actualizado", "M2", "20", "60.00"],
            ["C1", "Concepto nuevo C", "PZA", "30", "70.00"],
        ],
        existing_by_clave={"B1": {"id": "concepto-existente"}},
    )

    with pytest.raises(HTTPException) as exc_info:
        await _ejecutar_commit_con_compensacion(
            conceptos_col, sessions_col, _noop_bitacora,
            "proyecto-1", "import-1", "partida-1", vista, "actualizar", TEST_USER, "archivo.xlsx",
        )
    assert exc_info.value.status_code == 500

    # La fila A (creada antes del fallo) debe haber sido borrada por la compensación.
    ids_restantes = set(conceptos_col.docs.keys())
    assert "concepto-existente" in ids_restantes
    assert len([i for i in ids_restantes if i != "concepto-existente"]) == 0, \
        f"quedó un concepto creado sin compensar: {ids_restantes}"

    # La fila B (actualizada antes del fallo) debe haber vuelto a su valor ANTERIOR.
    restaurado = conceptos_col.docs["concepto-existente"]
    assert restaurado["descripcion"] == "Descripción ORIGINAL"
    assert restaurado["cantidad"] == "5"
    assert restaurado["precio_unitario"] == "10.00"
    assert restaurado["unidad"] == "PZA"

    # La fila C nunca llegó a crearse (el insert_one fue el que tronó).
    assert "concepto-existente" == list(conceptos_col.docs.keys())[0]

    # El registro de compensación quedó persistido en la sesión ANTES de
    # cada write real -- son 3 entradas, no 2: A (creada, éxito), B
    # (actualizada, éxito) y TAMBIÉN C, porque su entrada de compensación se
    # escribió justo antes de que su insert_one fallara. Compensar la
    # entrada de C es un delete_one sobre un id que nunca llegó a existir
    # -- un no-op inocuo, que es exactamente la garantía que se aprobó
    # ("registrar antes de escribir": si truena entre ambos pasos, lo peor
    # que pasa es revertir algo que nunca se modificó).
    log = sessions_col.docs["import-1"].get("compensacion_log", [])
    assert len(log) == 3
    assert [entry["tipo"] for entry in log] == ["creado", "actualizado", "creado"]


# ============================================================================
# Reimportar el mismo archivo dos veces no duplica
# ============================================================================
@run_async
async def test_reimportar_mismo_archivo_dos_veces_no_duplica():
    conceptos_col = _FakeCollection()
    sessions_col = _FakeCollection([{"id": "import-1"}, {"id": "import-2"}])

    data_rows = [["A1", "Concepto A", "PZA", "10", "50.00"]]

    # Primera importación: no hay nada existente todavía.
    vista_1 = _vista_de(data_rows, existing_by_clave={})
    resultado_1 = await _ejecutar_commit_con_compensacion(
        conceptos_col, sessions_col, _noop_bitacora,
        "proyecto-1", "import-1", "partida-1", vista_1, "actualizar", TEST_USER, "archivo.xlsx",
    )
    assert resultado_1["creados"] == 1
    assert len(conceptos_col.docs) == 1
    primer_id = list(conceptos_col.docs.keys())[0]

    # Segunda importación del MISMO archivo: ahora "A1" ya existe -> debe
    # detectarse como duplicado y actualizar en vez de crear otro.
    existing_by_clave = {"A1": {"id": primer_id}}
    vista_2 = _vista_de(data_rows, existing_by_clave=existing_by_clave)
    assert vista_2[0]["estado"] == "duplicado"

    resultado_2 = await _ejecutar_commit_con_compensacion(
        conceptos_col, sessions_col, _noop_bitacora,
        "proyecto-1", "import-2", "partida-1", vista_2, "actualizar", TEST_USER, "archivo.xlsx",
    )
    assert resultado_2["creados"] == 0
    assert resultado_2["actualizados"] == 1
    assert len(conceptos_col.docs) == 1  # sigue habiendo un solo concepto, no dos


@run_async
async def test_reimportar_con_duplicados_accion_omitir_no_toca_lo_existente():
    existente = _concepto_existente("concepto-existente", "A1", descripcion="NO TOCAR", cantidad="999", precio_unitario="999.00")
    conceptos_col = _FakeCollection([existente])
    sessions_col = _FakeCollection([{"id": "import-1"}])

    vista = _vista_de([["A1", "Concepto nuevo", "PZA", "10", "50.00"]], existing_by_clave={"A1": {"id": "concepto-existente"}})
    resultado = await _ejecutar_commit_con_compensacion(
        conceptos_col, sessions_col, _noop_bitacora,
        "proyecto-1", "import-1", "partida-1", vista, "omitir", TEST_USER, "archivo.xlsx",
    )
    assert resultado["creados"] == 0
    assert resultado["actualizados"] == 0
    assert resultado["omitidos"] == 1
    assert conceptos_col.docs["concepto-existente"]["descripcion"] == "NO TOCAR"  # nunca se tocó


# ============================================================================
# Duplicado DENTRO del archivo (C-08): se importa la primera fila válida y la
# otra se omite, ni con "actualizar" se importan las dos
# ============================================================================
@run_async
async def test_duplicado_dentro_del_archivo_importa_la_gemela_valida_y_omite_la_otra():
    conceptos_col = _FakeCollection()
    sessions_col = _FakeCollection([{"id": "import-1"}])

    vista = _vista_de([
        ["A1", "Concepto A v1", "PZA", "10", "50.00"],
        ["A1", "Concepto A v2", "PZA", "20", "60.00"],
    ])
    resultado = await _ejecutar_commit_con_compensacion(
        conceptos_col, sessions_col, _noop_bitacora,
        "proyecto-1", "import-1", "partida-1", vista, "actualizar", TEST_USER, "archivo.xlsx",
    )
    assert resultado["creados"] == 1
    assert resultado["omitidos"] == 1
    assert [d["descripcion"] for d in conceptos_col.docs.values()] == ["Concepto A v1"]


# ============================================================================
# Filas con error o descartadas nunca se importan
# ============================================================================
@run_async
async def test_filas_con_error_o_descartadas_no_se_importan():
    conceptos_col = _FakeCollection()
    sessions_col = _FakeCollection([{"id": "import-1"}])

    filas = _validar_archivo_completo(
        [HEADERS] + [
            ["A1", "Concepto A", "PZA", "10", "50.00"],
            ["B1", "Concepto B", "PZA", "#REF!", "50.00"],
        ],
        0, MAPPING, None, {},
    )
    fila_b = next(f for f in filas if f["clave"] == "B1")
    vista = _calcular_vista_filas(filas, {str(fila_b["fila"]): {"descartar": True}})
    # B1 en este caso ya iba a fallar por #REF!, forzamos el descarte
    # explícito para probar también esa ruta (independiente del error).

    resultado = await _ejecutar_commit_con_compensacion(
        conceptos_col, sessions_col, _noop_bitacora,
        "proyecto-1", "import-1", "partida-1", vista, "actualizar", TEST_USER, "archivo.xlsx",
    )
    assert resultado["creados"] == 1  # solo A1
    assert len(conceptos_col.docs) == 1
    assert list(conceptos_col.docs.values())[0]["clave"] == "A1"
