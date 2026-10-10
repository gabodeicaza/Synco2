"""Fotos LiDAR: los registros ligados a una estación se separan del módulo
final para imprimirse junto a su estación; los demás se quedan al final."""
import server as s

NODES = {
    "raiz": {"id": "raiz", "depth": 0, "parent_id": None},
    "e1": {"id": "e1", "depth": 1, "parent_id": "raiz"},
    "e2": {"id": "e2", "depth": 1, "parent_id": "raiz"},
    "e1-poste": {"id": "e1-poste", "depth": 2, "parent_id": "e1"},
}


def _mod(items):
    return {"fotos_lidar": {"titulo": "FOTOS LIDAR", "blocks": [{"type": "fotos_comparativa", "items": items}]}}


def test_separa_por_subtramo_y_deja_los_sin_estacion():
    data = _mod([{"titulo": "A", "node_id": "e1"}, {"titulo": "B", "node_id": "e1-poste"},
                 {"titulo": "C", "node_id": "e2"}, {"titulo": "D", "node_id": None}])
    por_sub = s._lidar_separar_por_estacion(data, NODES)
    assert [i["titulo"] for i in por_sub["e1"]] == ["A", "B"]
    assert [i["titulo"] for i in por_sub["e2"]] == ["C"]
    assert [i["titulo"] for i in data["fotos_lidar"]["blocks"][0]["items"]] == ["D"]


def test_si_todo_tiene_estacion_el_modulo_final_desaparece():
    data = _mod([{"titulo": "A", "node_id": "e1"}])
    s._lidar_separar_por_estacion(data, NODES)
    assert data["fotos_lidar"] is None


def test_restantes_vuelven_al_modulo_final():
    data = _mod([{"titulo": "A", "node_id": "e1"}, {"titulo": "D", "node_id": None}])
    por_sub = s._lidar_separar_por_estacion(data, NODES)
    s._lidar_devolver_restantes(data, por_sub)
    assert sorted(i["titulo"] for i in data["fotos_lidar"]["blocks"][0]["items"]) == ["A", "D"]
    assert por_sub == {}


def test_restantes_recrea_el_modulo_si_se_habia_vaciado():
    data = _mod([{"titulo": "A", "node_id": "e1"}])
    por_sub = s._lidar_separar_por_estacion(data, NODES)
    s._lidar_devolver_restantes(data, por_sub)
    assert data["fotos_lidar"]["blocks"][0]["items"][0]["titulo"] == "A"


def test_sin_modulo_no_hace_nada():
    assert s._lidar_separar_por_estacion({"fotos_lidar": None}, NODES) == {}
    assert s._lidar_separar_por_estacion({}, NODES) == {}
