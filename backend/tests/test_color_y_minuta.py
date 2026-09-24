"""P-02 (color #RRGGBB estricto, sin sustituir en silencio) y K-03 (fecha límite >= fecha de la
reunión). Núcleo puro + handlers con `db` falso: sin Mongo ni backend vivo."""
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_color_minuta")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402


# ------------------------------------------------------------------ P-02
class TestColor:
    @pytest.mark.parametrize("valor,esperado", [("#1E40AF", "#1E40AF"), ("#1e40af", "#1E40AF"), ("  #abcdef ", "#ABCDEF")])
    def test_acepta_rrggbb_y_normaliza_a_mayusculas(self, valor, esperado):
        assert server.validar_color_hex(valor, "Color") == esperado

    @pytest.mark.parametrize("valor", ["1E40AF", "#1E4", "#GGGGGG", "azul", "#1E40AF0", "rgb(1,2,3)", "##112233", "#12 456"])
    def test_rechaza_lo_que_no_sea_rrggbb_sin_sustituir(self, valor):
        with pytest.raises(HTTPException) as e:
            server.validar_color_hex(valor, "Color institucional")
        assert e.value.status_code == 400
        assert "#RRGGBB" in e.value.detail and "Color institucional" in e.value.detail and valor in e.value.detail

    def test_vacio_o_none_significa_no_configurado(self):
        assert server.validar_color_hex(None, "Color") is None
        assert server.validar_color_hex("   ", "Color") is None

    def test_no_texto_se_rechaza(self):
        with pytest.raises(HTTPException):
            server.validar_color_hex(123, "Color")  # type: ignore[arg-type]

    def test_la_lectura_para_exportar_sigue_tolerante(self):
        # Datos viejos guardados como #RGB siguen exportándose; solo la ESCRITURA es estricta.
        assert server._sanitize_color_hex("#abc") == "#AABBCC"


def _proyecto_body(**extra):
    return server.ProjectIn(name="P", constructora="C", contract_number="1", **extra)


COORD = {"id": "u1", "name": "Coord", "role": server.ROLE_COORD}


class TestColorEnHandlers:
    def _db(self):
        db = MagicMock()
        db.projects = MagicMock()
        db.projects.insert_one = AsyncMock()
        db.projects.find_one = AsyncMock(return_value={"id": "p1", "name": "P"})
        db.projects.update_one = AsyncMock()
        db.areas = MagicMock()
        db.areas.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
        db.areas.insert_one = AsyncMock()
        server.db = db
        return db

    def test_crear_proyecto_con_color_invalido_da_400_y_no_guarda(self):
        db = self._db()
        with pytest.raises(HTTPException) as e:
            asyncio.run(server.create_project(_proyecto_body(color_institucional="azulito"), COORD))
        assert e.value.status_code == 400 and "Color institucional" in e.value.detail
        db.projects.insert_one.assert_not_called()

    def test_crear_proyecto_sin_color_usa_el_defecto(self):
        db = self._db()
        asyncio.run(server.create_project(_proyecto_body(), COORD))
        doc = db.projects.insert_one.await_args.args[0]
        assert doc["color_institucional"] == "#003366"

    def test_crear_proyecto_con_color_valido_lo_guarda_normalizado(self):
        db = self._db()
        asyncio.run(server.create_project(_proyecto_body(color_institucional="#1e40af"), COORD))
        assert db.projects.insert_one.await_args.args[0]["color_institucional"] == "#1E40AF"

    def test_actualizar_con_color_invalido_da_400_y_no_escribe(self):
        db = self._db()
        with pytest.raises(HTTPException) as e:
            asyncio.run(server.update_project("p1", server.ProjectPatch(color_tema="#12"), COORD))
        assert e.value.status_code == 400 and "portada" in e.value.detail
        db.projects.update_one.assert_not_called()

    def test_area_con_color_invalido_da_400(self):
        db = self._db()
        with pytest.raises(HTTPException) as e:
            asyncio.run(server.create_area("p1", server.AreaIn(project_id="p1", name="Calidad", color="rojo"), COORD))
        assert e.value.status_code == 400
        db.areas.insert_one.assert_not_called()


# ------------------------------------------------------------------ K-03
USER = {"id": "u1", "name": "Ana", "role": server.ROLE_SUB, "project_ids": ["p1"]}


def _db_minuta():
    db = MagicMock()
    db.projects = MagicMock()
    db.projects.find_one = AsyncMock(return_value={"id": "p1", "name": "P"})
    db.areas = MagicMock()
    db.areas.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
    db.location_nodes = MagicMock()
    db.location_nodes.find_one = AsyncMock(return_value={"id": "n1", "name": "Frente 1", "parent_id": None, "project_id": "p1"})
    db.users = MagicMock()
    db.users.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[{"id": "u1", "name": "Ana", "role": "sub_coordinador"}])))
    db.minutas = MagicMock()
    db.minutas.count_documents = AsyncMock(return_value=0)
    db.minutas.insert_one = AsyncMock()
    server.db = db
    return db


def _minuta(fecha_reunion, fecha_limite):
    body = server.MinutaIn(
        titulo="Reunión", ubicacion_id="n1", fecha_reunion=fecha_reunion,
        acuerdos=[server.AcuerdoIn(descripcion="Entregar el acero", responsable_id="u1", fecha_limite=fecha_limite)],
    )
    return asyncio.run(server.create_minuta("p1", body, USER))


class TestFechaLimiteDeAcuerdo:
    def test_una_fecha_limite_anterior_a_la_reunion_se_rechaza(self):
        db = _db_minuta()
        with pytest.raises(HTTPException) as e:
            _minuta("2026-09-23", "2026-09-22")
        assert e.value.status_code == 400
        assert "no puede ser anterior" in e.value.detail and "2026-09-22" in e.value.detail
        db.minutas.insert_one.assert_not_called()

    def test_el_mismo_dia_de_la_reunion_es_valido(self):
        db = _db_minuta()
        _minuta("2026-09-23", "2026-09-23")
        db.minutas.insert_one.assert_awaited()

    def test_posterior_es_valido(self):
        db = _db_minuta()
        _minuta("2026-09-23", "2026-10-15")
        assert db.minutas.insert_one.await_args.args[0]["acuerdos"][0]["fecha_limite"] == "2026-10-15"

    def test_sin_fecha_de_reunion_se_usa_hoy_del_proyecto(self):
        db = _db_minuta()
        hoy = server.hoy_proyecto(None).isoformat()
        _minuta(None, hoy)
        assert db.minutas.insert_one.await_args.args[0]["fecha_reunion"] == hoy

    def test_fecha_de_reunion_mal_formada_se_rechaza(self):
        _db_minuta()
        with pytest.raises(HTTPException) as e:
            _minuta("23/09/2026", "2026-10-01")
        assert e.value.status_code == 400 and "AAAA-MM-DD" in e.value.detail
