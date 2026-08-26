"""Test unitario puro del nivel de agregación configurable de Recuento
General — server.py. Cubre `_recuento_general_by_nodo` (refactorizada para
recibir `nivel` en vez de asumir siempre nodo hoja), sus dos helpers
(`_recuento_general_grouping_nodes`, `_leaves_under_node`,
`_node_path_names_sync`) y `_resolve_recuento_config`.

Mismo patrón que los demás test_*.py de este módulo: importa server.py
directo con env vars dummy, sin HTTP ni Mongo real — estas funciones solo
operan sobre `nodes_by_id`/`reports_by_node`/`proj` ya cargados en memoria.

Árbol sintético usado en todo el archivo:

    T1 (tramo, depth0)
      S1 (subtramo, depth1, no-hoja)
        P1 (poste, depth2, hoja)
        P2 (poste, depth2, hoja)
      S2 (subtramo, depth1, HOJA en su propia rama — sin postes hijos)
    T2 (tramo, depth0)
      S3 (subtramo, depth1, no-hoja)
        P3 (poste, depth2, hoja)
"""
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_recuento_nivel")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import (  # noqa: E402
    _recuento_general_by_nodo, _recuento_general_grouping_nodes, _leaves_under_node,
    _node_path_names_sync, _resolve_recuento_config, _flatten_tree_in_order,
    NIVEL_RECUENTO_TRAMO, NIVEL_RECUENTO_SUBTRAMO, NIVEL_RECUENTO_HOJA, NIVEL_RECUENTO_PERSONALIZADO,
)


def _node(id_, parent_id, depth, is_leaf, name, order=0):
    return {"id": id_, "parent_id": parent_id, "depth": depth, "is_leaf": is_leaf, "name": name, "order": order}


def _tree():
    nodes = [
        _node("t1", None, 0, False, "TRAMO 1", 0),
        _node("s1", "t1", 1, False, "Subtramo S1", 0),
        _node("p1", "s1", 2, True, "Poste P1", 0),
        _node("p2", "s1", 2, True, "Poste P2", 1),
        _node("s2", "t1", 1, True, "Estación S2", 1),  # subtramo que es hoja en su propia rama
        _node("t2", None, 0, False, "TRAMO 2", 1),
        _node("s3", "t2", 1, False, "Subtramo S3", 0),
        _node("p3", "s3", 2, True, "Poste P3", 0),
    ]
    nodes_by_id = {n["id"]: n for n in nodes}
    root_ids = ["t1", "t2"]
    return nodes_by_id, root_ids


def _rep(personnel=None, equipment=None):
    return {"personnel": personnel or [], "equipment": equipment or [], "created_at": datetime.now(timezone.utc)}


def _reports_by_node():
    return {
        "p1": [_rep(personnel=["3 ING. Civil"], equipment=["1 Excavadora :: CAT :: 320GX :: EX-1"])],
        "p2": [_rep(personnel=["2 ING. Civil"])],
        "s2": [_rep(personnel=["1 Ayudante"])],
        "p3": [_rep(equipment=["1 Martillo neumático"])],
    }


# ============================================================================
# `_node_path_names_sync`
# ============================================================================
def test_node_path_names_sync_sube_hasta_la_raiz():
    nodes_by_id, _ = _tree()
    assert _node_path_names_sync("p1", nodes_by_id) == ["TRAMO 1", "Subtramo S1", "Poste P1"]
    assert _node_path_names_sync("s1", nodes_by_id) == ["TRAMO 1", "Subtramo S1"]
    assert _node_path_names_sync("t1", nodes_by_id) == ["TRAMO 1"]


# ============================================================================
# `_leaves_under_node`
# ============================================================================
def test_leaves_under_node_para_subtramo_no_hoja_devuelve_sus_postes():
    nodes_by_id, root_ids = _tree()
    all_leaves = _flatten_tree_in_order(nodes_by_id, root_ids)
    assert _leaves_under_node("s1", nodes_by_id, all_leaves) == ["p1", "p2"]


def test_leaves_under_node_para_nodo_que_ya_es_hoja_devuelve_solo_si_mismo():
    nodes_by_id, root_ids = _tree()
    all_leaves = _flatten_tree_in_order(nodes_by_id, root_ids)
    assert _leaves_under_node("s2", nodes_by_id, all_leaves) == ["s2"]


def test_leaves_under_node_para_tramo_devuelve_todas_sus_hojas_en_orden():
    nodes_by_id, root_ids = _tree()
    all_leaves = _flatten_tree_in_order(nodes_by_id, root_ids)
    assert _leaves_under_node("t1", nodes_by_id, all_leaves) == ["p1", "p2", "s2"]


# ============================================================================
# `_recuento_general_grouping_nodes`
# ============================================================================
def test_grouping_nodes_tramo_devuelve_solo_depth_0_en_orden():
    nodes_by_id, root_ids = _tree()
    out = _recuento_general_grouping_nodes(NIVEL_RECUENTO_TRAMO, None, nodes_by_id, root_ids)
    assert [n["id"] for n in out] == ["t1", "t2"]


def test_grouping_nodes_subtramo_devuelve_solo_depth_1_en_orden():
    nodes_by_id, root_ids = _tree()
    out = _recuento_general_grouping_nodes(NIVEL_RECUENTO_SUBTRAMO, None, nodes_by_id, root_ids)
    assert [n["id"] for n in out] == ["s1", "s2", "s3"]


def test_grouping_nodes_hoja_devuelve_nodos_hoja_en_orden():
    nodes_by_id, root_ids = _tree()
    out = _recuento_general_grouping_nodes(NIVEL_RECUENTO_HOJA, None, nodes_by_id, root_ids)
    assert [n["id"] for n in out] == ["p1", "p2", "s2", "p3"]


def test_grouping_nodes_personalizado_respeta_exactamente_los_marcados_mezclando_profundidades():
    nodes_by_id, root_ids = _tree()
    out = _recuento_general_grouping_nodes(NIVEL_RECUENTO_PERSONALIZADO, ["s1", "p3"], nodes_by_id, root_ids)
    assert [n["id"] for n in out] == ["s1", "p3"]


def test_grouping_nodes_personalizado_ignora_ids_que_no_existen():
    nodes_by_id, root_ids = _tree()
    out = _recuento_general_grouping_nodes(NIVEL_RECUENTO_PERSONALIZADO, ["s1", "no-existe"], nodes_by_id, root_ids)
    assert [n["id"] for n in out] == ["s1"]


# ============================================================================
# `_recuento_general_by_nodo` — comportamiento end-to-end por nivel
# ============================================================================
def test_nivel_hoja_es_identico_al_comportamiento_historico_sin_columna_poste():
    nodes_by_id, root_ids = _tree()
    out = _recuento_general_by_nodo(_reports_by_node(), nodes_by_id, root_ids, nivel=NIVEL_RECUENTO_HOJA)
    assert [e["node_id"] for e in out] == ["p1", "p2", "s2", "p3"]
    for e in out:
        assert e["tiene_columna_poste"] is False
        for row in e["personal"] + e["maquinaria"]:
            assert "poste" not in row
    p1 = next(e for e in out if e["node_id"] == "p1")
    assert p1["personal"] == [{"desc": "ING. Civil", "qty": 3}]
    # equipment con "::" ya viene limpio de _format_workforce_desc en el renderer,
    # pero el "desc" crudo con "::" se conserva hasta ahí a propósito (ver 1.a).
    assert p1["maquinaria"][0]["qty"] == 1


def test_nivel_subtramo_agrupa_por_estacion_y_no_suma_entre_postes_distintos():
    nodes_by_id, root_ids = _tree()
    out = _recuento_general_by_nodo(_reports_by_node(), nodes_by_id, root_ids, nivel=NIVEL_RECUENTO_SUBTRAMO)
    assert [e["node_id"] for e in out] == ["s1", "s2", "s3"]

    s1 = next(e for e in out if e["node_id"] == "s1")
    assert s1["tiene_columna_poste"] is True
    # P1 aportó 3 y P2 aportó 2 del MISMO puesto "ING. Civil" — deben quedar
    # como DOS filas separadas (con su columna "poste"), NUNCA sumadas en una
    # sola fila de 5 — ese es justo el pedido: "una columna que especifique
    # qué parte del tramo (poste)".
    civil_rows = sorted(s1["personal"], key=lambda r: r["poste"])
    assert civil_rows == [
        {"desc": "ING. Civil", "qty": 3, "poste": "Poste P1"},
        {"desc": "ING. Civil", "qty": 2, "poste": "Poste P2"},
    ]

    # S2 es una Estación que es HOJA en su propia rama (sin postes hijos) —
    # no hay nada que desambiguar, así que NO lleva columna "poste".
    s2 = next(e for e in out if e["node_id"] == "s2")
    assert s2["tiene_columna_poste"] is False
    assert s2["personal"] == [{"desc": "Ayudante", "qty": 1}]


def test_nivel_tramo_agrupa_todo_bajo_la_raiz_con_columna_poste_aunque_un_solo_leaf_reporte():
    nodes_by_id, root_ids = _tree()
    out = _recuento_general_by_nodo(_reports_by_node(), nodes_by_id, root_ids, nivel=NIVEL_RECUENTO_TRAMO)
    assert [e["node_id"] for e in out] == ["t1", "t2"]

    t2 = next(e for e in out if e["node_id"] == "t2")
    # T2 solo tiene UN poste con datos (P3) pero como el nodo de agrupación
    # (T2) no es hoja, la columna se muestra igual — consistencia de esquema
    # de tabla en todo el documento, no depende de cuántos postes reportaron.
    assert t2["tiene_columna_poste"] is True
    assert t2["maquinaria"] == [{"desc": "Martillo neumático", "qty": 1, "poste": "Poste P3"}]


def test_nivel_personalizado_mezcla_nodo_no_hoja_y_nodo_hoja_en_el_mismo_export():
    nodes_by_id, root_ids = _tree()
    out = _recuento_general_by_nodo(
        _reports_by_node(), nodes_by_id, root_ids, nivel=NIVEL_RECUENTO_PERSONALIZADO, node_ids=["s1", "p3"],
    )
    assert [e["node_id"] for e in out] == ["s1", "p3"]
    s1 = next(e for e in out if e["node_id"] == "s1")
    p3 = next(e for e in out if e["node_id"] == "p3")
    assert s1["tiene_columna_poste"] is True
    assert p3["tiene_columna_poste"] is False
    assert p3["maquinaria"] == [{"desc": "Martillo neumático", "qty": 1}]


def test_nodo_sin_datos_se_omite_por_defecto():
    nodes_by_id, root_ids = _tree()
    reports = _reports_by_node()
    del reports["p3"]  # T2/S3/P3 se queda sin ningún reporte
    out = _recuento_general_by_nodo(reports, nodes_by_id, root_ids, nivel=NIVEL_RECUENTO_TRAMO)
    assert [e["node_id"] for e in out] == ["t1"]  # t2 omitido, no aparece como tabla vacía


def test_nodo_sin_datos_con_incluir_sin_datos_genera_entrada_con_flag_para_la_leyenda():
    nodes_by_id, root_ids = _tree()
    reports = _reports_by_node()
    del reports["p3"]
    out = _recuento_general_by_nodo(
        reports, nodes_by_id, root_ids, nivel=NIVEL_RECUENTO_TRAMO, incluir_sin_datos=True,
    )
    assert [e["node_id"] for e in out] == ["t1", "t2"]
    t2 = next(e for e in out if e["node_id"] == "t2")
    assert t2["sin_datos"] is True
    assert t2["personal"] == [] and t2["maquinaria"] == []


def test_orden_de_filas_dentro_de_un_nodo_agrupador_sigue_el_orden_de_postes_no_alfabetico():
    """Con columna poste, el orden debe ser por poste (orden institucional
    Tramo→Subtramo→Poste), no alfabético por descripción — para que se lea
    como un desglose por ubicación, no una lista mezclada."""
    nodes_by_id, root_ids = _tree()
    reports = {
        "p1": [_rep(personnel=["1 Zapador"])],
        "p2": [_rep(personnel=["1 Ayudante"])],
    }
    out = _recuento_general_by_nodo(reports, nodes_by_id, root_ids, nivel=NIVEL_RECUENTO_SUBTRAMO)
    s1 = next(e for e in out if e["node_id"] == "s1")
    # "Zapador" (P1) antes que "Ayudante" (P2) pese al orden alfabético
    # inverso — porque P1 va antes que P2 en el árbol.
    assert [r["poste"] for r in s1["personal"]] == ["Poste P1", "Poste P2"]


# ============================================================================
# `_resolve_recuento_config`
# ============================================================================
def test_resolve_config_usa_parametros_explicitos_por_encima_de_todo():
    proj = {"recuento_config": {"nivel": "tramo", "node_ids": ["x"], "sin_datos_modo": "leyenda"}}
    nivel, node_ids, incluir = _resolve_recuento_config(proj, "hoja", "a,b", "omitir")
    assert nivel == "hoja"
    assert node_ids == ["a", "b"]
    assert incluir is False


def test_resolve_config_usa_preferencia_guardada_si_no_hay_parametros():
    proj = {"recuento_config": {"nivel": "tramo", "node_ids": ["a"], "sin_datos_modo": "leyenda"}}
    nivel, node_ids, incluir = _resolve_recuento_config(proj, None, None, None)
    assert nivel == "tramo"
    assert node_ids == ["a"]
    assert incluir is True


def test_resolve_config_cae_a_defaults_institucionales_sin_parametros_ni_preferencia():
    nivel, node_ids, incluir = _resolve_recuento_config({}, None, None, None)
    assert nivel == NIVEL_RECUENTO_SUBTRAMO
    assert node_ids == []
    assert incluir is False


def test_resolve_config_nivel_invalido_cae_a_subtramo():
    nivel, _, _ = _resolve_recuento_config({}, "no-es-un-nivel-valido", None, None)
    assert nivel == NIVEL_RECUENTO_SUBTRAMO
