"""Test unitario puro de `_actividades_por_area_index` y
`_actividades_resumen_para_bloque` — server.py. Estas dos funciones son el
"pegamento" entre el hub Actividades Generales (curado) y el resumen por
Área que ahora se imprime dentro de cada bloque de Área del PDF/PPTX
(`_actividades_curadas_resumen_por_area`, que sí toca Mongo y por eso no se
prueba aquí — ver test_actividades_generales.py para eso).

Mismo patrón que test_actividades_split_lineas.py: importa server.py
directo con env vars dummy, sin HTTP ni Mongo real.
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_actividades_resumen_area")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from server import (  # noqa: E402
    _actividades_por_area_index, _actividades_resumen_para_bloque,
    NIVEL_GENERAL, NIVEL_SUBTRAMO, NIVEL_NODO,
)


def _item(texto, nivel, node_id=None, area_id="area-1"):
    return {"texto": texto, "nivel": nivel, "node_id": node_id, "area_id": area_id}


def test_index_separa_los_3_niveles_en_sus_propios_diccionarios():
    items = [
        _item("General 1", NIVEL_GENERAL),
        _item("Subtramo 1", NIVEL_SUBTRAMO, node_id="subtramo-a"),
        _item("Nodo 1", NIVEL_NODO, node_id="poste-a1"),
    ]
    idx = _actividades_por_area_index(items)
    assert idx["general"] == {"area-1": ["General 1"]}
    assert idx["subtramo"] == {("subtramo-a", "area-1"): ["Subtramo 1"]}
    assert idx["nodo"] == {("poste-a1", "area-1"): ["Nodo 1"]}


def test_index_excluye_texto_vacio_o_solo_espacios():
    items = [_item("", NIVEL_GENERAL), _item("   ", NIVEL_NODO, node_id="poste-a1"), _item("Real", NIVEL_GENERAL)]
    idx = _actividades_por_area_index(items)
    assert idx["general"] == {"area-1": ["Real"]}
    assert idx["nodo"] == {}


def test_resumen_para_bloque_combina_general_subtramo_y_nodo_en_ese_orden():
    idx = _actividades_por_area_index([
        _item("G1", NIVEL_GENERAL),
        _item("S1", NIVEL_SUBTRAMO, node_id="subtramo-a"),
        _item("N1", NIVEL_NODO, node_id="poste-a1"),
    ])
    out = _actividades_resumen_para_bloque(idx, "poste-a1", "subtramo-a", ["area-1"])
    assert out == ["G1", "S1", "N1"]


def test_resumen_para_bloque_no_incluye_actividades_de_otro_nodo_o_subtramo():
    idx = _actividades_por_area_index([
        _item("S-otro", NIVEL_SUBTRAMO, node_id="subtramo-b"),
        _item("N-otro", NIVEL_NODO, node_id="poste-b1"),
        _item("N-mio", NIVEL_NODO, node_id="poste-a1"),
    ])
    out = _actividades_resumen_para_bloque(idx, "poste-a1", "subtramo-a", ["area-1"])
    assert out == ["N-mio"]


def test_resumen_para_bloque_sin_subtramo_id_omite_nivel_subtramo_sin_reventar():
    idx = _actividades_por_area_index([
        _item("G1", NIVEL_GENERAL),
        _item("N1", NIVEL_NODO, node_id="poste-a1"),
    ])
    out = _actividades_resumen_para_bloque(idx, "poste-a1", None, ["area-1"])
    assert out == ["G1", "N1"]


def test_resumen_para_bloque_une_varios_area_id_del_mismo_bucket_visual():
    """Un bucket visual de Área en el export puede colapsar varios area_id
    (ver `_normalize_area_name`, ej. "Sub supervisores" → "OBRA CIVIL") —
    el resumen debe traer las actividades de TODOS esos area_id."""
    idx = _actividades_por_area_index([
        _item("De area-1", NIVEL_NODO, node_id="poste-a1", area_id="area-1"),
        _item("De area-2", NIVEL_NODO, node_id="poste-a1", area_id="area-2"),
    ])
    out = _actividades_resumen_para_bloque(idx, "poste-a1", None, ["area-1", "area-2"])
    assert out == ["De area-1", "De area-2"]


def test_resumen_para_bloque_deduplica_preservando_primer_orden():
    idx = _actividades_por_area_index([
        _item("Repetida", NIVEL_GENERAL, area_id="area-1"),
        _item("Repetida", NIVEL_NODO, node_id="poste-a1", area_id="area-2"),
        _item("Única", NIVEL_NODO, node_id="poste-a1", area_id="area-2"),
    ])
    out = _actividades_resumen_para_bloque(idx, "poste-a1", None, ["area-1", "area-2"])
    assert out == ["Repetida", "Única"]


def test_resumen_para_bloque_sin_datos_devuelve_lista_vacia():
    idx = _actividades_por_area_index([])
    assert _actividades_resumen_para_bloque(idx, "poste-x", "subtramo-x", ["area-1"]) == []
