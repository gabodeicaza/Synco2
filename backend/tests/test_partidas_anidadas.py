"""Tests de las Partidas anidadas (subpartidas dentro de subpartidas, N
niveles) — el campo `partida_padre_id` existía en el modelo pero antes
siempre se guardaba en None ("reservado para subpartidas futuras"). Cubre
las funciones puras de árbol que decide qué conceptos entran al total de
cada partida (`_partida_out`) y qué mueve NO se permite (ciclos).
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_partidas_anidadas")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import _partida_children_by_parent, _partida_subtree_ids


def _p(id_, padre=None):
    return {"id": id_, "partida_padre_id": padre}


# Árbol de prueba (3 niveles):
#   raiz-1 (root)
#     └─ nivel2-a
#          └─ nivel3-a1
#          └─ nivel3-a2
#     └─ nivel2-b
#   raiz-2 (root, sin hijos)
ARBOL = [
    _p("raiz-1"),
    _p("nivel2-a", "raiz-1"),
    _p("nivel3-a1", "nivel2-a"),
    _p("nivel3-a2", "nivel2-a"),
    _p("nivel2-b", "raiz-1"),
    _p("raiz-2"),
]


def test_children_by_parent_agrupa_por_padre_incluyendo_raiz_none():
    children = _partida_children_by_parent(ARBOL)
    assert set(children[None]) == {"raiz-1", "raiz-2"}
    assert set(children["raiz-1"]) == {"nivel2-a", "nivel2-b"}
    assert set(children["nivel2-a"]) == {"nivel3-a1", "nivel3-a2"}
    assert "nivel2-b" not in children  # sin hijos propios: no aparece como key


def test_subtree_de_la_raiz_incluye_los_3_niveles_completos():
    children = _partida_children_by_parent(ARBOL)
    subtree = set(_partida_subtree_ids("raiz-1", children))
    assert subtree == {"raiz-1", "nivel2-a", "nivel3-a1", "nivel3-a2", "nivel2-b"}


def test_subtree_de_un_nodo_intermedio_no_incluye_a_sus_hermanos():
    children = _partida_children_by_parent(ARBOL)
    subtree = set(_partida_subtree_ids("nivel2-a", children))
    assert subtree == {"nivel2-a", "nivel3-a1", "nivel3-a2"}
    assert "nivel2-b" not in subtree
    assert "raiz-1" not in subtree  # el padre nunca es parte del subtree del hijo


def test_subtree_de_una_hoja_es_solo_ella_misma():
    children = _partida_children_by_parent(ARBOL)
    assert _partida_subtree_ids("nivel3-a1", children) == ["nivel3-a1"]


def test_subtree_de_raiz_sin_hijos_es_solo_ella_misma():
    children = _partida_children_by_parent(ARBOL)
    assert _partida_subtree_ids("raiz-2", children) == ["raiz-2"]


# ============================================================================
# Detección de ciclos: mover una partida dentro de su propia subpartida debe
# rechazarse — misma lógica que usa update_partida (in-line, no una función
# aparte) al chequear `nuevo_padre in _partida_subtree_ids(partida_id, ...)`.
# ============================================================================
def test_mover_nivel2_a_dentro_de_su_propia_hija_nivel3_es_un_ciclo_detectable():
    children = _partida_children_by_parent(ARBOL)
    # "¿Puedo mover nivel2-a para que su padre sea nivel3-a1?" -> NO, porque
    # nivel3-a1 está dentro del subtree de nivel2-a.
    intentado_nuevo_padre = "nivel3-a1"
    subtree_de_nivel2_a = _partida_subtree_ids("nivel2-a", children)
    assert intentado_nuevo_padre in subtree_de_nivel2_a  # -> el endpoint debe rechazar este movimiento


def test_mover_nivel2_b_bajo_nivel2_a_es_valido_no_es_un_ciclo():
    children = _partida_children_by_parent(ARBOL)
    intentado_nuevo_padre = "nivel2-a"
    subtree_de_nivel2_b = _partida_subtree_ids("nivel2-b", children)
    assert intentado_nuevo_padre not in subtree_de_nivel2_b  # -> el endpoint debe permitirlo
