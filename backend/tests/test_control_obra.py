"""Test E2E manual para el módulo "Control de Obra" — reusa el árbol de
nodos existente (Intertramo/Estación) en vez de duplicar datos, según lo
que pidió el usuario. Cubre:

  - 403 en los 3 sub-endpoints (poste-estatus, cimentacion, perforadoras)
    con el módulo "control_obra" apagado.
  - Tras encenderlo: PATCH /nodes/{nid}/poste-estatus acepta el 4to estado
    "cambio_trayectoria" (antes solo existían 3) y NO permite tocar otros
    campos del nodo (name/tipo_nodo) aunque se manden en el body.
  - POST/PATCH/DELETE de un elemento de Cimentación, con 400 si el node_id
    no es una Estación habilitada.
  - POST/PATCH/DELETE de una Perforadora (texto libre, sin validación de nodo).

USO:
  python -m pytest backend/tests/test_control_obra.py -s -v
  o
  python backend/tests/test_control_obra.py
"""
import os
import sys
import uuid

import requests

BASE = os.environ.get("SYNCO_TEST_BASE_URL", "http://localhost:8001/api")
EMAIL = "gabriel@synco.mx"
PASSWORD = "SynCo2026!Coord"


def _log(msg: str):
    print(f"[test] {msg}")


def main() -> int:
    suffix = uuid.uuid4().hex[:8]

    _log("Login como coordinador general…")
    r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    r.raise_for_status()
    token = r.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    _log(f"Token OK ({token[:20]}…)")

    _log("Creando proyecto de prueba…")
    r = requests.post(
        f"{BASE}/projects",
        headers=headers,
        json={
            "name": f"TEST_ControlObra_{suffix}",
            "constructora": "TEST_Constructora",
            "contract_number": f"TEST-{suffix}",
            "description": "E2E: módulo Control de Obra (postes/cimentación/perforadoras)",
        },
        timeout=15,
    )
    r.raise_for_status()
    pid = r.json()["id"]
    _log(f"Proyecto creado: {pid}")

    try:
        def _create_node(name, parent_id=None, is_leaf=False, mt=None, order=0):
            payload = {
                "project_id": pid, "parent_id": parent_id, "name": name,
                "order": order, "is_leaf": is_leaf, "measurement_type": mt,
            }
            rr = requests.post(f"{BASE}/projects/{pid}/nodes", headers=headers, json=payload, timeout=15)
            assert rr.status_code == 200, f"Node '{name}' create failed: {rr.status_code} {rr.text}"
            return rr.json()["id"]

        tramo_id = _create_node("Tramo 1")
        intertramo_id = _create_node("Intertramo E1-E2", parent_id=tramo_id, order=0)
        poste1_id = _create_node("C1", parent_id=intertramo_id, is_leaf=True, mt="cadenamiento", order=0)
        poste2_id = _create_node("C2", parent_id=intertramo_id, is_leaf=True, mt="cadenamiento", order=1)
        estacion_id = _create_node("Estación 1", parent_id=tramo_id, order=1)
        _log(f"Árbol: Tramo={tramo_id} Intertramo={intertramo_id} C1={poste1_id} C2={poste2_id} Estacion={estacion_id}")

        r = requests.patch(f"{BASE}/nodes/{intertramo_id}", headers=headers, json={"tipo_nodo": "intertramo"}, timeout=15)
        assert r.status_code == 200, r.text
        _log("Intertramo marcado como tipo_nodo='intertramo'")

        # -------------------- 403 con el módulo apagado --------------------
        r = requests.patch(
            f"{BASE}/nodes/{poste1_id}/poste-estatus", headers=headers,
            json={"estatus_pilas": "en_proceso"}, timeout=15,
        )
        assert r.status_code == 403, f"Se esperaba 403 (módulo apagado), llegó {r.status_code}: {r.text}"
        r = requests.post(
            f"{BASE}/projects/{pid}/control-obra/cimentacion", headers=headers,
            json={"node_id": estacion_id, "elemento": "Zapata"}, timeout=15,
        )
        assert r.status_code == 403, f"Se esperaba 403, llegó {r.status_code}: {r.text}"
        r = requests.post(
            f"{BASE}/projects/{pid}/control-obra/perforadoras", headers=headers,
            json={"nombre": "Perforadora 1"}, timeout=15,
        )
        assert r.status_code == 403, f"Se esperaba 403, llegó {r.status_code}: {r.text}"
        _log("✅ 403 en los 3 sub-endpoints con el módulo apagado")

        # -------------------- Enciende el módulo --------------------
        r = requests.put(
            f"{BASE}/projects/{pid}/modulos", headers=headers,
            json={"reportes_diarios": {"control_obra": True}}, timeout=15,
        )
        assert r.status_code == 200, r.text
        _log("Módulo 'control_obra' encendido")

        # -------------------- Poste-estatus: 4to estado + campos acotados --------------------
        r = requests.patch(
            f"{BASE}/nodes/{poste1_id}/poste-estatus", headers=headers,
            json={"estatus_pilas": "cambio_trayectoria", "estatus_cabezal": "concluido"}, timeout=15,
        )
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["estatus_pilas"] == "cambio_trayectoria"
        assert updated["estatus_cabezal"] == "concluido"
        assert updated["name"] == "C1", "El nombre del nodo no debe cambiar"
        _log("✅ poste-estatus acepta 'cambio_trayectoria' (4to estado)")

        # Confirma que este endpoint NO acepta tocar otros campos del nodo
        # (el body de PosteEstatusPatch solo declara los 4 campos de estatus
        # — un campo extra como 'name' simplemente lo ignora FastAPI/pydantic,
        # no debe romper ni aplicarse).
        r = requests.patch(
            f"{BASE}/nodes/{poste1_id}/poste-estatus", headers=headers,
            json={"estatus_fuste": "sin_iniciar", "name": "NOMBRE_HACKEADO"}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "C1", "poste-estatus no debe poder renombrar el nodo"
        _log("✅ poste-estatus ignora campos fuera de los 4 de estatus")

        # -------------------- Cimentación: crear/editar/borrar + 400 en nodo inválido --------------------
        r = requests.post(
            f"{BASE}/projects/{pid}/control-obra/cimentacion", headers=headers,
            json={"node_id": poste1_id, "elemento": "Zapata"}, timeout=15,
        )
        assert r.status_code == 400, f"Se esperaba 400 (poste no es Estación), llegó {r.status_code}: {r.text}"
        _log("✅ 400 al crear elemento de cimentación sobre un nodo que no es Estación")

        r = requests.post(
            f"{BASE}/projects/{pid}/control-obra/cimentacion", headers=headers,
            json={"node_id": estacion_id, "elemento": "Zapata", "total": 10, "acumulado_total": 4, "en_proceso": 2},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        elem = r.json()
        elem_id = elem["id"]
        assert elem["node_id"] == estacion_id
        assert elem["total"] == 10 and elem["acumulado_total"] == 4
        _log(f"✅ Elemento de cimentación creado: {elem_id}")

        g = requests.get(f"{BASE}/projects/{pid}/control-obra/cimentacion", headers=headers, timeout=15)
        assert g.status_code == 200, g.text
        assert any(e["id"] == elem_id for e in g.json()["elementos"])
        _log("✅ GET lista el elemento recién creado")

        r = requests.patch(
            f"{BASE}/projects/{pid}/control-obra/cimentacion/{elem_id}", headers=headers,
            json={"acumulado_total": 7}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["acumulado_total"] == 7 and r.json()["total"] == 10, "total no debe cambiar si no se manda"
        _log("✅ PATCH actualiza solo el campo enviado")

        r = requests.delete(f"{BASE}/projects/{pid}/control-obra/cimentacion/{elem_id}", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE}/projects/{pid}/control-obra/cimentacion", headers=headers, timeout=15)
        assert not any(e["id"] == elem_id for e in g.json()["elementos"]), "El elemento debió eliminarse"
        _log("✅ DELETE elimina el elemento")

        # -------------------- Perforadoras: crear/editar/borrar --------------------
        r = requests.post(
            f"{BASE}/projects/{pid}/control-obra/perforadoras", headers=headers,
            json={"nombre": "Piloteadora XCMG-105", "serie": "PP-105", "ubicacion": "Cerca del poste C1", "estatus": "Activa"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        perf = r.json()
        perf_id = perf["id"]
        assert perf["nombre"] == "Piloteadora XCMG-105"
        _log(f"✅ Perforadora creada: {perf_id}")

        r = requests.patch(
            f"{BASE}/projects/{pid}/control-obra/perforadoras/{perf_id}", headers=headers,
            json={"estatus": "Mantenimiento"}, timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["estatus"] == "Mantenimiento" and r.json()["nombre"] == "Piloteadora XCMG-105"
        _log("✅ PATCH actualiza solo el estatus")

        r = requests.delete(f"{BASE}/projects/{pid}/control-obra/perforadoras/{perf_id}", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE}/projects/{pid}/control-obra/perforadoras", headers=headers, timeout=15)
        assert not any(p["id"] == perf_id for p in g.json()["perforadoras"]), "La perforadora debió eliminarse"
        _log("✅ DELETE elimina la perforadora")

        _log("=" * 55)
        _log("✅ TODOS LOS PASOS PASARON")
        _log("=" * 55)
        return 0
    finally:
        try:
            requests.delete(f"{BASE}/projects/{pid}", headers=headers, timeout=15)
            _log("Cleanup: proyecto de prueba eliminado")
        except Exception:
            pass


def test_main():
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
