"""GPS real del nodo (T-05b): campos gps_lat/gps_lon separados de las coordenadas UTM (target_*).
Validan rango, ambos-o-ninguno, y no tocan target_*. Pruebas puras: sin Mongo (db falso)."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_gps_nodo")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402


class _Coleccion:
    def __init__(self, docs):
        self.docs = docs
        self.actualizados = []

    async def find_one(self, filtro, *a, **k):
        for d in self.docs:
            if all(d.get(c) == v for c, v in filtro.items()):
                return dict(d)
        return None

    async def update_one(self, filtro, cambio):
        self.actualizados.append(cambio["$set"])
        for d in self.docs:
            if d["id"] == filtro["id"]:
                d.update(cambio["$set"])


class _Db:
    def __init__(self, nodo):
        self.location_nodes = _Coleccion([nodo])


def _nodo(**extra):
    base = {
        "id": "n1", "project_id": "p1", "parent_id": None, "name": "Frente 1", "depth": 0, "order": 0,
        "is_leaf": True, "measurement_type": "coord_latlon",
        "target_lat": 2_150_000.0, "target_lon": 480_000.0, "target_elev": 2240.0,
    }
    base.update(extra)
    return base


def _patch(monkeypatch, cuerpo, nodo=None):
    nodo = nodo or _nodo()
    db = _Db(nodo)
    monkeypatch.setattr(server, "db", db)
    user = {"id": "u1", "role": server.ROLE_COORD, "name": "Ana"}
    salida = asyncio.run(server.update_node("n1", server.NodePatch(**cuerpo), user))
    return salida, db


def test_validar_gps_acepta_ambos_o_ninguno():
    assert server.validar_gps_nodo(None, None) == (None, None)
    assert server.validar_gps_nodo(19.432608, -99.133209) == (19.432608, -99.133209)
    assert server.validar_gps_nodo(-90, 180) == (-90.0, 180.0)


@pytest.mark.parametrize("lat,lon", [(19.4, None), (None, -99.1)])
def test_validar_gps_exige_latitud_y_longitud_juntas(lat, lon):
    with pytest.raises(ValueError, match="juntas"):
        server.validar_gps_nodo(lat, lon)


@pytest.mark.parametrize("lat,lon,texto", [
    (90.0001, 0, "latitud"), (-91, 0, "latitud"), (0, 180.5, "longitud"), (0, -181, "longitud"),
    (float("nan"), 0, "válida"), (0, float("inf"), "válida"),
])
def test_validar_gps_rechaza_fuera_de_rango_o_no_finito(lat, lon, texto):
    with pytest.raises(ValueError, match=texto):
        server.validar_gps_nodo(lat, lon)


def test_modelos_traen_los_campos_opcionales():
    assert server.LocationNodeOut(
        id="n", project_id="p", name="x", depth=0, order=0, is_leaf=False,
    ).gps_lat is None  # nodo viejo, sin migración
    assert server.LocationNodeIn(project_id="p", name="x").gps_lon is None
    assert server.NodePatch().quitar_gps is None


def test_patch_guarda_gps_sin_tocar_las_coordenadas_utm(monkeypatch):
    salida, db = _patch(monkeypatch, {"gps_lat": 19.432608, "gps_lon": -99.133209})
    cambio = db.location_nodes.actualizados[0]
    assert cambio == {"gps_lat": 19.432608, "gps_lon": -99.133209}
    assert salida["target_lat"] == 2_150_000.0 and salida["target_lon"] == 480_000.0


def test_patch_con_solo_la_latitud_es_400(monkeypatch):
    with pytest.raises(HTTPException) as e:
        _patch(monkeypatch, {"gps_lat": 19.4})
    assert e.value.status_code == 400
    assert "juntas" in e.value.detail


def test_patch_fuera_de_rango_es_400(monkeypatch):
    with pytest.raises(HTTPException) as e:
        _patch(monkeypatch, {"gps_lat": 120, "gps_lon": 10})
    assert e.value.status_code == 400
    assert "latitud" in e.value.detail


def test_quitar_gps_borra_ambos_y_no_toca_utm(monkeypatch):
    salida, db = _patch(monkeypatch, {"quitar_gps": True}, nodo=_nodo(gps_lat=19.4, gps_lon=-99.1))
    assert db.location_nodes.actualizados[0] == {"gps_lat": None, "gps_lon": None}
    assert salida["gps_lat"] is None and salida["target_lat"] == 2_150_000.0


def test_gps_aplica_a_cualquier_nodo_no_solo_a_hojas_coord(monkeypatch):
    nodo = _nodo(is_leaf=False, measurement_type=None, target_lat=None, target_lon=None, target_elev=None)
    salida, _ = _patch(monkeypatch, {"gps_lat": 19.4, "gps_lon": -99.1}, nodo=nodo)
    assert salida["gps_lat"] == 19.4


def test_patch_sin_gps_no_toca_esos_campos(monkeypatch):
    _, db = _patch(monkeypatch, {"name": "Frente 2"}, nodo=_nodo(gps_lat=19.4, gps_lon=-99.1))
    assert "gps_lat" not in db.location_nodes.actualizados[0]
