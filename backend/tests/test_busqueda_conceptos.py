"""A-10: la búsqueda de conceptos es por texto literal (sin regex), sin q lista todo y `limit`
acota la lista por defecto de Registrar avance. Pruebas puras: sin Mongo."""
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_busqueda_conceptos")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

DOCS = [
    {"clave": "1.1.1", "descripcion": "Excavación en cepa"},
    {"clave": "1.1.2", "descripcion": "Relleno (compactado)"},
    {"clave": "1.2", "descripcion": "Acero de refuerzo"},
    {"clave": "C-001", "descripcion": "Concreto f'c=250 [premezclado]"},
]


def claves(lista):
    return [d["clave"] for d in lista]


def test_sin_texto_devuelve_todo_en_el_orden_recibido():
    assert claves(server.filtrar_conceptos_busqueda(DOCS, None)) == ["1.1.1", "1.1.2", "1.2", "C-001"]
    assert claves(server.filtrar_conceptos_busqueda(DOCS, "   ")) == ["1.1.1", "1.1.2", "1.2", "C-001"]


def test_limit_recorta_la_lista_por_defecto():
    assert claves(server.filtrar_conceptos_busqueda(DOCS, None, 2)) == ["1.1.1", "1.1.2"]
    assert claves(server.filtrar_conceptos_busqueda(DOCS, "1.", 1)) == ["1.1.1"]


@pytest.mark.parametrize("texto, esperado", [
    ("1.1.", ["1.1.1", "1.1.2"]),          # el punto final no es comodín
    ("1.1", ["1.1.1", "1.1.2"]),
    ("(compactado)", ["1.1.2"]),           # paréntesis literales
    ("[premezclado]", ["C-001"]),          # corchetes literales
    ("f'c=250", ["C-001"]),
    ("EXCAVACION", ["1.1.1"]),             # sin acentos ni mayúsculas
    ("*", []),                             # no es "todo"
    ("?", []),
    ("\\", []),
])
def test_caracteres_especiales_se_buscan_como_texto(texto, esperado):
    assert claves(server.filtrar_conceptos_busqueda(DOCS, texto)) == esperado


def test_sin_resultados_devuelve_lista_vacia():
    assert server.filtrar_conceptos_busqueda(DOCS, "zzz") == []
