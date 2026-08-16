"""Test unitario obligatorio del comparador de claves jerárquicas.

Puro en cuanto a lo que prueba (clave_sort_key/sort_by_clave son funciones
sin efectos secundarios) — pero desde que esa lógica se fusionó dentro de
server.py (el flujo de despliegue de producción solo copia ese archivo, ya
no hay clave_utils.py aparte), importar server.py exige las mismas env vars
dummy que el resto de los tests que lo tocan."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_clave_utils")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import clave_sort_key, sort_by_clave


def test_orden_numerico_jerarquico():
    claves = ["10.3", "3.3", "1.10", "1.2", "4.3", "1.9"]
    ordenadas = sorted(claves, key=clave_sort_key)
    assert ordenadas == ["1.2", "1.9", "1.10", "3.3", "4.3", "10.3"]


def test_orden_como_texto_seria_incorrecto():
    claves = ["10.3", "3.3", "1.10", "1.2", "4.3", "1.9"]
    assert sorted(claves) != sorted(claves, key=clave_sort_key)


def test_numero_variable_de_segmentos():
    claves = ["1", "1.2", "1.2.1", "1.10", "2"]
    ordenadas = sorted(claves, key=clave_sort_key)
    assert ordenadas == ["1", "1.2", "1.2.1", "1.10", "2"]


def test_clave_prefijo_ordena_primero():
    assert clave_sort_key("1.2") < clave_sort_key("1.2.1")


def test_segmento_no_numerico_ordena_despues():
    claves = ["3.3A", "3.3", "3.10"]
    ordenadas = sorted(claves, key=clave_sort_key)
    assert ordenadas == ["3.3", "3.10", "3.3A"]


def test_sort_by_clave_sobre_dicts():
    items = [{"clave": "10.3", "x": 1}, {"clave": "3.3", "x": 2}, {"clave": "1.2", "x": 3}]
    ordenados = sort_by_clave(items)
    assert [it["clave"] for it in ordenados] == ["1.2", "3.3", "10.3"]


def test_clave_alfanumerica_sin_puntos():
    """Caso obligatorio del plan de Ampliación del Catálogo (jerarquía de 4
    niveles): claves que mezclan letras y números sin punto entre ellas
    ("A101", no "A.101"). Texto plano ordenaría "A1010" antes que "A102";
    el comparador debe extraer la corrida numérica y compararla como
    entero."""
    claves = ["A101", "A1011", "A1011.1", "A102", "A1010"]
    ordenadas = sorted(claves, key=clave_sort_key)
    assert ordenadas == ["A101", "A102", "A1010", "A1011", "A1011.1"]


def test_clave_alfanumerica_orden_de_texto_seria_incorrecto():
    claves = ["A101", "A1011", "A1011.1", "A102", "A1010"]
    assert sorted(claves) != sorted(claves, key=clave_sort_key)
