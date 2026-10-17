"""Actividades con semáforo propio: helpers puros (se extraen de server.py sin importarlo,
porque importar el módulo completo requiere Mongo y toda la app)."""
import ast
from pathlib import Path
from typing import Any, List

_SRC = (Path(__file__).resolve().parent.parent / "server.py").read_text(encoding="utf-8")
_NOMBRES = {"_normalize_gravedad", "_normalize_actividades_items", "_gravedad_maxima"}
_tree = ast.parse(_SRC)
_ns: dict = {"Any": Any, "List": List, "_VALID_GRAVEDADES": ("verde", "amarillo", "rojo")}
exec("\n".join(ast.get_source_segment(_SRC, n) for n in _tree.body if getattr(n, "name", None) in _NOMBRES), _ns)

normalizar = _ns["_normalize_actividades_items"]
maxima = _ns["_gravedad_maxima"]


def test_descarta_vacias_y_normaliza_gravedad():
    items = normalizar([
        {"texto": " a ", "gravedad": "rojo"},
        {"texto": "   ", "gravedad": "rojo"},
        {"texto": "b"},
        {"texto": "c", "gravedad": "morado"},
        "no es dict",
    ])
    assert items == [
        {"texto": "a", "gravedad": "rojo"},
        {"texto": "b", "gravedad": "verde"},
        {"texto": "c", "gravedad": "verde"},
    ]


def test_gravedad_del_reporte_es_la_mas_grave():
    assert maxima([{"gravedad": "verde"}, {"gravedad": "amarillo"}]) == "amarillo"
    assert maxima([{"gravedad": "verde"}, {"gravedad": "rojo"}, {"gravedad": "amarillo"}]) == "rojo"
    assert maxima([{"gravedad": "verde"}]) == "verde"


def test_sin_actividades_usa_el_valor_por_defecto():
    assert maxima([], "amarillo") == "amarillo"
    assert maxima([]) == "verde"
