"""Tests del modelo de línea base de arranque en caliente (adelanto de
Etapa 3, preparado antes de que el equipo confirme si mantienen al día la
matriz "Avance Diario FÍSICO" -- ver _reemplazar_linea_base en server.py).

Un RegistroAvance con origen=LINEA_BASE es el MISMO modelo que un avance
normal, solo marcado -- eso es lo que permite las dos rutas de poblarla (un
registro por concepto en la fecha de corte, o uno por día real de la matriz)
sin cambiar el esquema. Cubre:
  - _validar_permiso_edicion_avance: un registro migrado solo lo edita
    Sub-Coordinador, sin importar autor/ventana de 24h.
  - _reemplazar_linea_base: borra TODOS los registros LINEA_BASE de un
    proyecto (de cualquier batch), nunca toca los de origen=APP.
"""
import asyncio
import functools
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_linea_base_model")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import _validar_permiso_edicion_avance, _reemplazar_linea_base, ROLE_SUB
from fastapi import HTTPException


def run_async(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return asyncio.run(fn(*args, **kwargs))
    return wrapper


# ============================================================================
# _validar_permiso_edicion_avance — puro, sin DB
# ============================================================================
def test_registro_normal_no_bloquea_a_nadie_aqui():
    # Este helper solo bloquea LINEA_BASE -- la ventana normal de 24h/autor
    # se valida aparte en update_avance, no aquí.
    _validar_permiso_edicion_avance({"origen": "APP"}, {"id": "u1", "role": "ESPECIALISTA"})  # no debe lanzar


def test_registro_linea_base_bloqueado_para_no_subcoordinador():
    with pytest.raises(HTTPException) as exc_info:
        _validar_permiso_edicion_avance({"origen": "LINEA_BASE"}, {"id": "u1", "role": "ESPECIALISTA"})
    assert exc_info.value.status_code == 403


def test_registro_linea_base_bloqueado_incluso_para_el_autor_original():
    # A diferencia de la ventana normal, ser el autor no exime aquí.
    with pytest.raises(HTTPException):
        _validar_permiso_edicion_avance(
            {"origen": "LINEA_BASE", "capturado_por": "u1"}, {"id": "u1", "role": "ESPECIALISTA"},
        )


def test_registro_linea_base_permitido_para_subcoordinador():
    _validar_permiso_edicion_avance({"origen": "LINEA_BASE"}, {"id": "u2", "role": ROLE_SUB})  # no debe lanzar


def test_registro_sin_campo_origen_se_trata_como_normal():
    # Documentos guardados antes de que existiera el campo (setdefault
    # implícito de Pydantic a "APP" en RegistroAvanceOut) no deben quedar
    # bloqueados por accidente.
    _validar_permiso_edicion_avance({}, {"id": "u1", "role": "ESPECIALISTA"})  # no debe lanzar


# ============================================================================
# _reemplazar_linea_base — colección Mongo falsa
# ============================================================================
class _FakeAvancesCollection:
    def __init__(self, docs):
        self.docs = {d["id"]: dict(d) for d in docs}

    async def delete_many(self, query):
        pid = query.get("project_id")
        origen = query.get("origen")
        a_borrar = [k for k, v in self.docs.items() if v.get("project_id") == pid and v.get("origen") == origen]
        for k in a_borrar:
            del self.docs[k]

        class _Result:
            deleted_count = len(a_borrar)
        return _Result()


@run_async
async def test_reemplazar_linea_base_borra_todos_los_batches_del_proyecto():
    col = _FakeAvancesCollection([
        {"id": "a1", "project_id": "p1", "origen": "LINEA_BASE", "linea_base_batch_id": "batch-viejo-1"},
        {"id": "a2", "project_id": "p1", "origen": "LINEA_BASE", "linea_base_batch_id": "batch-viejo-1"},
        {"id": "a3", "project_id": "p1", "origen": "LINEA_BASE", "linea_base_batch_id": "batch-viejo-2"},
    ])
    borrados = await _reemplazar_linea_base(col, "p1")
    assert borrados == 3
    assert len(col.docs) == 0


@run_async
async def test_reemplazar_linea_base_nunca_toca_avances_de_la_app():
    col = _FakeAvancesCollection([
        {"id": "a1", "project_id": "p1", "origen": "LINEA_BASE", "linea_base_batch_id": "batch-1"},
        {"id": "a2", "project_id": "p1", "origen": "APP"},
        {"id": "a3", "project_id": "p1", "origen": "APP"},
    ])
    borrados = await _reemplazar_linea_base(col, "p1")
    assert borrados == 1
    assert set(col.docs.keys()) == {"a2", "a3"}
    assert all(d["origen"] == "APP" for d in col.docs.values())


@run_async
async def test_reemplazar_linea_base_no_toca_otros_proyectos():
    col = _FakeAvancesCollection([
        {"id": "a1", "project_id": "p1", "origen": "LINEA_BASE"},
        {"id": "a2", "project_id": "p2", "origen": "LINEA_BASE"},
    ])
    borrados = await _reemplazar_linea_base(col, "p1")
    assert borrados == 1
    assert "a2" in col.docs
