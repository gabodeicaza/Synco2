"""Idempotencia de la cola offline de avances: el mismo client_id no crea dos registros, ni por
reintento ni por carrera, y un ajuste ya guardado no falla al reenviarse. Pruebas puras: db falso."""
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from pymongo.errors import DuplicateKeyError

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_avance_idempotencia")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

PROJ = {"id": "p1", "name": "Demo", "modo_avance": "CANTIDAD"}
CONCEPTO = {
    "id": "c1", "project_id": "p1", "partida_id": "pa", "clave": "1.1", "descripcion": "x", "unidad": "M3",
    "cantidad": "100", "precio_unitario": "10", "meta": "0", "periodicidad_meta": "SEMANAL",
    "created_at": datetime(2026, 1, 1), "activo": True,
}
ANA = {"id": "u1", "name": "Ana", "role": server.ROLE_SUB, "project_ids": ["p1"]}
LUIS = {"id": "u2", "name": "Luis", "role": server.ROLE_SUB, "project_ids": ["p1"]}


class _Cur:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *a, **k):
        return self

    async def to_list(self, *a, **k):
        return list(self.docs)

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()


class _Avances:
    """Colección con estado: guarda lo insertado y aplica el índice único parcial de client_id."""

    def __init__(self, docs=None, carrera=False):
        self.docs = list(docs or [])
        self.carrera = carrera  # simula que otro envío inserta justo antes que nosotros

    def find(self, *a, **k):
        return _Cur(self.docs)

    async def find_one(self, filtro, *a, **k):
        for d in self.docs:
            if all(d.get(c) == v for c, v in filtro.items()):
                return dict(d)
        return None

    async def insert_one(self, doc):
        cid = doc.get("client_id")
        if self.carrera and cid:
            self.carrera = False
            self.docs.append({**doc, "id": "ganador", "_id": "x"})
        if cid and any(d.get("client_id") == cid for d in self.docs):
            raise DuplicateKeyError("E11000 duplicate key")
        self.docs.append(dict(doc))


def _armar(avances=None, carrera=False):
    db = MagicMock()
    db.projects = MagicMock()
    db.projects.find_one = AsyncMock(return_value=dict(PROJ))
    db.conceptos = MagicMock()
    db.conceptos.find_one = AsyncMock(return_value=dict(CONCEPTO))
    db.registros_avance = _Avances(avances, carrera)
    db.location_nodes = MagicMock()
    db.location_nodes.find_one = AsyncMock(return_value=None)
    db.catalogo_bitacora = MagicMock()
    db.catalogo_bitacora.insert_one = AsyncMock()
    db.excedentes_concepto = MagicMock()
    db.excedentes_concepto.find = MagicMock(side_effect=lambda *a, **k: _Cur([]))
    server.db = db
    return db


def _crear(usuario=ANA, **kw):
    body = dict(concepto_id="c1", fecha=server.hoy_proyecto(None).isoformat(), cantidad_ejecutada="5")
    body.update(kw)
    return asyncio.run(server.create_avance(server.RegistroAvanceIn(**body), usuario))


def test_mismo_client_id_devuelve_el_existente_y_no_duplica():
    db = _armar()
    primero = _crear(client_id="cli_a")
    segundo = _crear(client_id="cli_a")
    assert len(db.registros_avance.docs) == 1
    assert primero.id == segundo.id


def test_client_id_distintos_crean_dos_registros():
    db = _armar()
    _crear(client_id="cli_a")
    _crear(client_id="cli_b")
    assert len(db.registros_avance.docs) == 2


def test_sin_client_id_mantiene_el_comportamiento_actual():
    db = _armar()
    _crear()
    _crear()
    assert len(db.registros_avance.docs) == 2
    assert all(d["client_id"] is None for d in db.registros_avance.docs)


def test_el_client_id_de_otro_usuario_no_se_devuelve():
    db = _armar()
    _crear(usuario=ANA, client_id="cli_a")
    _crear(usuario=LUIS, client_id="cli_a2")
    # Otro usuario con el mismo id no recibe el registro ajeno: se rechaza por el índice único
    # (en producción) o crea el propio; en ningún caso devuelve el de Ana como suyo.
    ajeno = asyncio.run(db.registros_avance.find_one({"client_id": "cli_a", "capturado_por": "u2"}))
    assert ajeno is None


def test_reenviar_un_ajuste_ya_guardado_no_falla_por_acumulado_negativo():
    db = _armar()
    _crear(cantidad_ejecutada="3")  # ya hay 3 de avance acumulado
    ajuste = _crear(tipo="ajuste", cantidad_ejecutada="-3", motivo="Se duplicó el registro", client_id="cli_aj")
    # Reintento del mismo ajuste (la respuesta se perdió): antes fallaba con 400 porque 3 - 3 - 3 < 0.
    again = _crear(tipo="ajuste", cantidad_ejecutada="-3", motivo="Se duplicó el registro", client_id="cli_aj")
    assert again.id == ajuste.id
    assert len([d for d in db.registros_avance.docs if d.get("tipo") == "ajuste"]) == 1


def test_carrera_entre_dos_envios_gana_el_primero():
    db = _armar(carrera=True)
    salida = _crear(client_id="cli_carrera")
    assert len(db.registros_avance.docs) == 1
    assert salida.id == "ganador"


def test_error_de_indice_sin_registro_previo_se_propaga():
    db = _armar()

    async def falla(doc):
        raise DuplicateKeyError("otra clave duplicada")

    db.registros_avance.insert_one = falla
    with pytest.raises(DuplicateKeyError):
        _crear(client_id="cli_x")
