"""Tests unitarios puros de la configuración de captura por Área (server.py).

El Coordinador define por Área si el reporte lleva Personal y/o Equipo y qué
campos libres extra captura (p. ej. Banderilleros). Cubre la normalización de
los campos, los defaults de áreas anteriores a la función y el cruce de los
valores del reporte contra la configuración del Área.

Mismo patrón que test_format_workforce_desc.py: importa server.py directo con
env vars dummy, sin HTTP ni Mongo.
"""
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_area_recursos_campos")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import (  # noqa: E402
    AreaCampoExtraIn,
    MAX_CAMPOS_EXTRA_AREA,
    _area_con_defaults,
    _campo_extra_texto,
    _campos_extra_para_reporte,
    _normalizar_campos_extra,
    _whatsapp_texto_reporte,
)


def campo(nombre, **kw):
    return AreaCampoExtraIn(nombre=nombre, **kw)


def test_id_se_deriva_del_nombre_sin_acentos():
    out = _normalizar_campos_extra([campo("Banderilleros")])
    assert out == [{"id": "banderilleros", "nombre": "Banderilleros", "tipo": "numero", "unidad": None}]
    assert _normalizar_campos_extra([campo("Número de Cuadrillas")])[0]["id"] == "numero_de_cuadrillas"


def test_conserva_id_existente_al_renombrar():
    out = _normalizar_campos_extra([campo("Bandereros", id="banderilleros", unidad="pers.")])
    assert out[0]["id"] == "banderilleros"
    assert out[0]["unidad"] == "pers."


def test_rechaza_nombre_vacio_repetido_y_exceso():
    with pytest.raises(HTTPException):
        _normalizar_campos_extra([campo("   ")])
    with pytest.raises(HTTPException):
        _normalizar_campos_extra([campo("Banderilleros"), campo("banderílleros")])
    with pytest.raises(HTTPException):
        _normalizar_campos_extra([campo(f"Campo {i}") for i in range(MAX_CAMPOS_EXTRA_AREA + 1)])


def test_area_anterior_a_la_funcion_captura_personal_y_equipo():
    a = _area_con_defaults({"id": "a1", "name": "Calidad"})
    assert a["captura_personal"] is True
    assert a["captura_equipo"] is True
    assert a["campos_extra"] == []
    assert _area_con_defaults({"captura_personal": False})["captura_personal"] is False


AREA_SEG = {"campos_extra": [
    {"id": "banderilleros", "nombre": "Banderilleros", "tipo": "numero", "unidad": None},
    {"id": "turno", "nombre": "Turno", "tipo": "texto", "unidad": None},
]}


def test_valores_se_cruzan_con_la_configuracion_del_area():
    out = _campos_extra_para_reporte(AREA_SEG, {"banderilleros": "4", "turno": " Noche ", "otro": 9})
    assert [(c["id"], c["valor"]) for c in out] == [("banderilleros", 4), ("turno", "Noche")]


def test_valores_vacios_o_sin_area_no_generan_campos():
    assert _campos_extra_para_reporte(AREA_SEG, {"banderilleros": "", "turno": None}) == []
    assert _campos_extra_para_reporte(None, {"banderilleros": 3}) == []


def test_numero_invalido_o_negativo_se_rechaza():
    for malo in ("abc", "-1"):
        with pytest.raises(HTTPException):
            _campos_extra_para_reporte(AREA_SEG, {"banderilleros": malo})


def test_numero_acepta_coma_decimal():
    out = _campos_extra_para_reporte(AREA_SEG, {"banderilleros": "2,5"})
    assert out[0]["valor"] == 2.5


def test_texto_del_campo_incluye_unidad():
    assert _campo_extra_texto({"nombre": "Banderilleros", "valor": 4}) == "Banderilleros: 4"
    assert _campo_extra_texto({"nombre": "Agua", "valor": 10, "unidad": "L"}) == "Agua: 10 L"


def test_whatsapp_omite_secciones_que_el_area_no_captura_y_agrega_campos():
    doc = {
        "captura_personal": False,
        "captura_equipo": False,
        "campos_extra": [{"nombre": "Banderilleros", "valor": 4}],
        "captured_by_name": "Ana",
    }
    texto = _whatsapp_texto_reporte(doc)
    assert "Personal:" not in texto
    assert "Equipo:" not in texto
    assert "Banderilleros: 4" in texto


def test_whatsapp_sin_configuracion_sigue_mostrando_personal_y_equipo():
    texto = _whatsapp_texto_reporte({"captured_by_name": "Ana", "personnel": ["3 Peón"]})
    assert "Personal:\n3 Peón" in texto
    assert "Equipo:\n-" in texto


def test_areas_anteriores_capturan_actividades_y_observaciones():
    a = _area_con_defaults({"name": "Vieja"})
    assert a["captura_actividades"] is True and a["captura_observaciones"] is True


def test_area_puede_apagar_actividades_y_observaciones():
    a = _area_con_defaults({"captura_actividades": False, "captura_observaciones": False})
    assert a["captura_actividades"] is False and a["captura_observaciones"] is False
