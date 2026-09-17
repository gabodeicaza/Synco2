"""Test E2E manual para "Fuerza de Trabajo" como captura independiente
(resource_logs) — reemplaza al test viejo `test_daily_resource_log.py`
(diseño descartado: objetos estructurados, solo nodos raíz "Tramo",
restricción de scope de sub-coordinador que ya no existe).

Cubre:
  - PUT /api/projects/{pid}/resource-logs (upsert por nodo+día, nunca duplica)
  - Rechazo (400) al capturar sobre un nodo que NO es hoja
  - GET /api/projects/{pid}/resource-logs/{node_id} (null si no hay corte hoy)
  - PATCH /api/resource-logs/{id}/entry (editar/borrar una entrada)
  - Que el export PDF tome personal/maquinaria de resource_logs y NO de un
    reporte narrativo — el punto central del feature: la tabla FUERZA DE
    TRABAJO/MAQUINARIA Y EQUIPO debe verse llena aunque nadie suba un
    reporte de actividad ese día.

USO:
  python -m pytest backend/tests/test_resource_logs.py -s -v
  o
  python backend/tests/test_resource_logs.py
"""
import io
import os
import sys
import uuid

import requests
from pypdf import PdfReader

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
            "name": f"TEST_ResourceLogs_{suffix}",
            "constructora": "TEST_Constructora",
            "contract_number": f"TEST-{suffix}",
            "description": "E2E: Fuerza de Trabajo como captura independiente",
        },
        timeout=15,
    )
    r.raise_for_status()
    pid = r.json()["id"]
    _log(f"Proyecto creado: {pid}")

    try:
        def _create_node(name, parent_id=None, is_leaf=False, mt=None, order=0):
            payload = {
                "project_id": pid,
                "parent_id": parent_id,
                "name": name,
                "order": order,
                "is_leaf": is_leaf,
                "measurement_type": mt,
            }
            rr = requests.post(f"{BASE}/projects/{pid}/nodes", headers=headers, json=payload, timeout=15)
            assert rr.status_code == 200, f"Node '{name}' create failed: {rr.status_code} {rr.text}"
            return rr.json()["id"]

        tramo_id = _create_node("Tramo 1")
        subtramo_id = _create_node("Estación 1. Prueba", parent_id=tramo_id, order=0)
        c1_id = _create_node("C1", parent_id=subtramo_id, is_leaf=True, mt="cadenamiento", order=0)
        c2_id = _create_node("C2", parent_id=subtramo_id, is_leaf=True, mt="cadenamiento", order=1)
        _log(f"Árbol creado: Tramo={tramo_id} Subtramo={subtramo_id} C1={c1_id} C2={c2_id}")

        # -------------------- Rechazo en nodo no-hoja --------------------
        r = requests.put(
            f"{BASE}/projects/{pid}/resource-logs",
            headers=headers,
            json={"node_id": subtramo_id, "personnel": ["1 Topografo"], "equipment": []},
            timeout=15,
        )
        assert r.status_code == 400, f"Se esperaba 400 en nodo no-hoja, llegó {r.status_code}: {r.text}"
        _log("✅ 400 al capturar sobre un nodo no-hoja")

        # -------------------- Upsert (crea) --------------------
        r = requests.put(
            f"{BASE}/projects/{pid}/resource-logs",
            headers=headers,
            json={"node_id": c1_id, "personnel": ["2 Topografo", "1 Cadenero"], "equipment": ["1 Camion (Activo)"]},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        log1 = r.json()
        assert log1["node_id"] == c1_id
        assert log1["node_name"] == "C1"
        assert len(log1["personnel"]) == 2
        assert log1["equipment"] == ["1 Camion (Activo)"]
        assert "_id" not in log1
        assert log1["fecha_cdmx"]
        log1_id = log1["id"]
        _log(f"✅ resource_log creado: {log1_id}")

        # -------------------- Upsert (sobrescribe, no duplica) --------------------
        r = requests.put(
            f"{BASE}/projects/{pid}/resource-logs",
            headers=headers,
            json={"node_id": c1_id, "personnel": ["5 Ayudante general"], "equipment": []},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        log1_v2 = r.json()
        assert log1_v2["id"] == log1_id, "Debe sobrescribir el mismo doc (mismo nodo+día), no crear otro"
        assert log1_v2["personnel"] == ["5 Ayudante general"]
        assert log1_v2["equipment"] == []
        _log("✅ upsert sobrescribe (mismo id) en vez de duplicar")

        # -------------------- GET un solo nodo --------------------
        g = requests.get(f"{BASE}/projects/{pid}/resource-logs/{c1_id}", headers=headers, timeout=15)
        assert g.status_code == 200, g.text
        got = g.json()
        assert got is not None and got["id"] == log1_id
        assert got["personnel"] == ["5 Ayudante general"]

        g2 = requests.get(f"{BASE}/projects/{pid}/resource-logs/{c2_id}", headers=headers, timeout=15)
        assert g2.status_code == 200, g2.text
        assert g2.json() is None, "C2 no tiene corte capturado hoy — debe regresar null"
        _log("✅ GET por nodo: trae el corte existente, null si no hay")

        # -------------------- Editar/borrar una entrada --------------------
        p = requests.patch(
            f"{BASE}/resource-logs/{log1_id}/entry",
            headers=headers,
            json={"field": "personnel", "index": 0, "value": "7 Ayudante general"},
            timeout=15,
        )
        assert p.status_code == 200, p.text
        assert p.json()["personnel"] == ["7 Ayudante general"]

        p2 = requests.patch(
            f"{BASE}/resource-logs/{log1_id}/entry",
            headers=headers,
            json={"field": "personnel", "index": 0, "value": None},
            timeout=15,
        )
        assert p2.status_code == 200, p2.text
        assert p2.json()["personnel"] == [], "Borrar con value=None debe recortar el arreglo"
        _log("✅ PATCH entry: edita y borra una entrada individual")

        # Re-captura C1 para el resto del test (equipo activo/inactivo, para
        # que se distinga claramente de C2 en la tabla del PDF).
        r = requests.put(
            f"{BASE}/projects/{pid}/resource-logs",
            headers=headers,
            json={
                "node_id": c1_id,
                "personnel": ["3 Topografo"],
                "equipment": ["2 Retroexcavadora CAT 320.(Activo)"],
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text

        r = requests.put(
            f"{BASE}/projects/{pid}/resource-logs",
            headers=headers,
            json={"node_id": c2_id, "personnel": ["4 Cadenero"], "equipment": []},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        _log("Cortes finales de C1/C2 capturados — SIN ningún reporte narrativo en el proyecto")

        # -------------------- Exportar PDF SIN reportes narrativos --------------------
        # El punto central del feature: sin subir ni un solo reporte de
        # actividad, la tabla FUERZA DE TRABAJO/MAQUINARIA Y EQUIPO del
        # resumen debe venir llena con lo capturado en Fuerza de Trabajo.
        _log("Exportando PDF (period=today) SIN reportes narrativos…")
        r = requests.get(
            f"{BASE}/projects/{pid}/export/reports.pdf",
            headers=headers,
            params={"period": "today"},
            timeout=180,
        )
        assert r.status_code == 200, f"Export failed: {r.status_code} {r.text[:300]}"
        pdf_bytes = r.content
        assert len(pdf_bytes) > 0, "PDF vacío"
        pages = PdfReader(io.BytesIO(pdf_bytes)).pages
        page_texts = [(p.extract_text() or "").upper() for p in pages]
        full_text = "\n".join(page_texts)
        _log(f"PDF exportado: {len(pages)} páginas, {len(pdf_bytes)} bytes")

        assert "TOPOGRAFO" in full_text, "Falta el personal capturado en Fuerza de Trabajo (Topografo) en el PDF"
        assert "CADENERO" in full_text, "Falta el personal capturado en Fuerza de Trabajo (Cadenero) en el PDF"
        assert "RETROEXCAVADORA" in full_text, "Falta la maquinaria capturada en Fuerza de Trabajo en el PDF"
        assert "FUERZA DE TRABAJO" in full_text and "MAQUINARIA Y EQUIPO" in full_text, (
            "Deben aparecer las tablas Fuerza de Trabajo / Maquinaria y Equipo"
        )
        _log("✅ El resumen PDF muestra personal/maquinaria de Fuerza de Trabajo SIN reportes narrativos")

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
