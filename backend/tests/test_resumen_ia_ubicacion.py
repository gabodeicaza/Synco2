"""Tests puros de los helpers del resumen con IA por ubicación del hub
Actividades Generales (`_armar_entrada_resumen_ia_ubicacion` y
`_parsear_resumen_ia_ubicacion`). Sin red ni Mongo: la llamada a Gemini no se
prueba aquí."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_resumen_ia_ubicacion")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from server import (  # noqa: E402
    _armar_entrada_resumen_ia_ubicacion, _parsear_resumen_ia_ubicacion,
    NIVEL_GENERAL, NIVEL_NODO,
)


def _it(texto, node_id="n1", nombre="Poste 1", nivel=NIVEL_NODO, oculta=False):
    return {"texto": texto, "node_id": node_id, "node_name": nombre, "nivel": nivel, "oculta": oculta}


def test_agrupa_por_nodo_y_excluye_generales_y_ocultas():
    items = [
        _it("Colado de zapata", "n1", "Poste 1"),
        _it("Armado de acero", "n1", "Poste 1"),
        _it("Excavación", "n2", "Poste 2"),
        _it("Nota general", None, None, NIVEL_GENERAL),
        _it("Oculta", "n3", "Poste 3", oculta=True),
    ]
    texto, etiquetas = _armar_entrada_resumen_ia_ubicacion(items)
    assert list(etiquetas) == ["n1", "n2"]
    assert etiquetas["n1"] == "Poste 1"
    assert "Colado de zapata" in texto and "Armado de acero" in texto
    assert "Nota general" not in texto and "Oculta" not in texto


def test_deduplica_y_trunca():
    items = [_it("Igual"), _it("Igual"), _it("x" * 1000)]
    texto, _ = _armar_entrada_resumen_ia_ubicacion(items)
    assert texto.count("- Igual") == 1
    assert "x" * 301 not in texto


def test_sin_actividades_devuelve_vacio():
    assert _armar_entrada_resumen_ia_ubicacion([]) == ("", {})
    assert _armar_entrada_resumen_ia_ubicacion([_it("a", oculta=True)]) == ("", {})


def test_parseo_tolera_cercas_y_filtra_ids():
    raw = '```json\n{"n1": "  Se coló\\n la zapata. ", "zzz": "ajeno", "n2": "", "n3": 5}\n```'
    assert _parsear_resumen_ia_ubicacion(raw, ["n1", "n2", "n3"]) == {"n1": "Se coló la zapata."}


def test_parseo_invalido_lanza():
    with pytest.raises(ValueError):
        _parsear_resumen_ia_ubicacion("sin json", ["n1"])
