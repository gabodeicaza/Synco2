"""C-05: alta manual de un concepto — clave única en el proyecto, campos obligatorios y
concepto extraordinario con P.U. pendiente de autorización (A-02). Sin HTTP ni Mongo real."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_crear_concepto")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

USER = {"id": "u1", "role": "coordinador_general"}


class _Coleccion:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, filtro):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filtro.items()):
                return d
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)


class _Db:
    def __init__(self, conceptos):
        self.partidas = _Coleccion([{"id": "pa1", "project_id": "p1"}])
        self.projects = _Coleccion([{"id": "p1", "unidades_personalizadas": ["SACO"]}])
        self.conceptos = _Coleccion(conceptos)


@pytest.fixture
def db(monkeypatch):
    falso = _Db([{"id": "c1", "project_id": "p1", "activo": True, "clave": "1.1"}])
    bitacora = []

    async def _out(doc):
        return doc

    async def _log(*args, **kwargs):
        bitacora.append(args)

    monkeypatch.setattr(server, "db", falso)
    monkeypatch.setattr(server, "_concepto_out", _out)
    monkeypatch.setattr(server, "_log_bitacora", _log)
    falso.bitacora = bitacora
    return falso


def _alta(**cambios):
    datos = dict(
        partida_id="pa1", clave="1.2", descripcion="Muro", unidad="M2", cantidad="10", precio_unitario="5", meta="10",
    )
    datos.update(cambios)
    return server.ConceptoIn(**datos)


def _correr(cuerpo):
    return asyncio.run(server.create_concepto(cuerpo, USER))


def test_clave_repetida_en_el_proyecto_responde_409(db):
    with pytest.raises(HTTPException) as e:
        _correr(_alta(clave="1.1"))
    assert e.value.status_code == 409
    assert "1.1" in e.value.detail


def test_clave_con_espacios_se_compara_recortada(db):
    with pytest.raises(HTTPException) as e:
        _correr(_alta(clave="  1.1  "))
    assert e.value.status_code == 409


def test_clave_o_descripcion_vacias_responden_400(db):
    for cambios in ({"clave": "   "}, {"descripcion": "  "}):
        with pytest.raises(HTTPException) as e:
            _correr(_alta(**cambios))
        assert e.value.status_code == 400


def test_alta_normal_no_es_extraordinaria(db):
    doc = _correr(_alta())
    assert doc["clave"] == "1.2"
    assert doc["extraordinario"] is False
    assert doc["pu_estatus"] is None
    assert len(db.conceptos.docs) == 2


def test_extraordinario_nace_con_pu_pendiente_de_autorizacion_y_queda_en_bitacora(db):
    doc = _correr(_alta(extraordinario=True))
    assert doc["extraordinario"] is True
    assert doc["pu_estatus"] == "pendiente_autorizacion"
    assert len(db.bitacora) == 1


def test_unidad_personalizada_del_proyecto_es_valida_y_otra_no(db):
    assert _correr(_alta(unidad="SACO"))["unidad"] == "SACO"
    with pytest.raises(HTTPException) as e:
        _correr(_alta(clave="1.9", unidad="COSTAL"))
    assert e.value.status_code == 400
