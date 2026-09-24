"""Separador decimal por proyecto (A-07 / X-05): el modelo lo acepta solo como "." o ","
y los proyectos existentes sin el campo caen a ".". Pruebas puras: sin Mongo."""
import os
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_separador_decimal")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

BASE = dict(name="Prueba", constructora="Constructora", contract_number="C-1")


def test_proyecto_nuevo_usa_punto_por_defecto():
    assert server.ProjectIn(**BASE).separador_decimal == "."


def test_acepta_coma_y_punto():
    assert server.ProjectIn(**BASE, separador_decimal=",").separador_decimal == ","
    assert server.ProjectPatch(separador_decimal=".").separador_decimal == "."


@pytest.mark.parametrize("valor", [";", "", "coma", "1"])
def test_rechaza_cualquier_otro_separador(valor):
    with pytest.raises(ValidationError):
        server.ProjectIn(**BASE, separador_decimal=valor)
    with pytest.raises(ValidationError):
        server.ProjectPatch(separador_decimal=valor)


def test_update_sin_el_campo_no_lo_toca():
    assert server.ProjectPatch().separador_decimal is None


def test_salida_de_proyecto_tiene_punto_por_defecto():
    campos = server.ProjectOut.model_fields
    assert campos["separador_decimal"].default == "."
