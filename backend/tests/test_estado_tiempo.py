"""Test E2E manual para el módulo "Estado del Tiempo" (captura manual de
clima) — cubre que la captura vía PUT /weather-logs tenga PRIORIDAD sobre
la consulta automática a Open-Meteo en la página de resumen por Subtramo
del export PDF.

Cubre:
  - PUT /api/projects/{pid}/weather-logs rechaza (403) si el módulo
    "estado_tiempo" no está encendido para el proyecto.
  - Tras encenderlo: rechazo (400) al capturar sobre un nodo tipo
    "intertramo" y sobre un nodo NO habilitado en Acceso al Predio.
  - Upsert sobre un Subtramo tipo "Estación" (depth==1, habilitado por
    default) — valores claramente identificables (no vendrían de una
    consulta real a Open-Meteo) deben aparecer tal cual en el texto de la
    página de resumen del PDF exportado.

USO:
  python -m pytest backend/tests/test_estado_tiempo.py -s -v
  o
  python backend/tests/test_estado_tiempo.py
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
            "name": f"TEST_EstadoTiempo_{suffix}",
            "constructora": "TEST_Constructora",
            "contract_number": f"TEST-{suffix}",
            "description": "E2E: módulo Estado del Tiempo (captura manual de clima)",
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
        subtramo_est_id = _create_node("Estación 1. Prueba Clima", parent_id=tramo_id, order=0)
        subtramo_inter_id = _create_node("Intertramo E1-E2", parent_id=tramo_id, order=1)
        poste_id = _create_node("C1", parent_id=subtramo_est_id, is_leaf=True, mt="cadenamiento", order=0)
        _log(
            f"Árbol creado: Tramo={tramo_id} Estación={subtramo_est_id} "
            f"Intertramo={subtramo_inter_id} Poste={poste_id}"
        )

        # Marca el segundo Subtramo como tipo "Intertramo" — no debe poder
        # capturar clima manual (draw_intertramo_summary_page no tiene
        # sección de clima).
        r = requests.patch(
            f"{BASE}/nodes/{subtramo_inter_id}", headers=headers, json={"tipo_nodo": "intertramo"}, timeout=15,
        )
        assert r.status_code == 200, r.text

        # -------------------- 403 con el módulo apagado --------------------
        weather_payload = {
            "node_id": subtramo_est_id,
            "temperature_c": 99.0,
            "wind_kmh": 77.7,
            "precipitation_mm": 8.8,
            "us_aqi": 55.5,
        }
        r = requests.put(f"{BASE}/projects/{pid}/weather-logs", headers=headers, json=weather_payload, timeout=15)
        assert r.status_code == 403, f"Se esperaba 403 con el módulo apagado, llegó {r.status_code}: {r.text}"
        _log("✅ 403 al capturar con el módulo 'estado_tiempo' apagado")

        # -------------------- Enciende el módulo --------------------
        r = requests.put(
            f"{BASE}/projects/{pid}/modulos",
            headers=headers,
            json={"reportes_diarios": {"estado_tiempo": True}},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        _log("Módulo 'estado_tiempo' encendido para el proyecto")

        # -------------------- 400 sobre nodo Intertramo --------------------
        r = requests.put(
            f"{BASE}/projects/{pid}/weather-logs",
            headers=headers,
            json={**weather_payload, "node_id": subtramo_inter_id},
            timeout=15,
        )
        assert r.status_code == 400, f"Se esperaba 400 sobre Intertramo, llegó {r.status_code}: {r.text}"
        _log("✅ 400 al capturar sobre un nodo tipo Intertramo")

        # -------------------- 400 sobre nodo no habilitado (el Poste hoja) --------------------
        r = requests.put(
            f"{BASE}/projects/{pid}/weather-logs",
            headers=headers,
            json={**weather_payload, "node_id": poste_id},
            timeout=15,
        )
        assert r.status_code == 400, f"Se esperaba 400 sobre nodo no habilitado, llegó {r.status_code}: {r.text}"
        _log("✅ 400 al capturar sobre un nodo no habilitado en Acceso al Predio")

        # -------------------- Upsert válido sobre la Estación --------------------
        r = requests.put(f"{BASE}/projects/{pid}/weather-logs", headers=headers, json=weather_payload, timeout=15)
        assert r.status_code == 200, r.text
        log = r.json()
        assert log["node_id"] == subtramo_est_id
        assert log["temperature_c"] == 99.0
        assert log["wind_kmh"] == 77.7
        assert log["precipitation_mm"] == 8.8
        assert log["us_aqi"] == 55.5
        assert "_id" not in log
        assert log["fecha_cdmx"]
        assert len(log["hora_cdmx"]) == 2
        _log(f"✅ resource_log de clima creado: {log['id']}")

        # GET de un solo día — confirma que trae lo recién capturado.
        g = requests.get(f"{BASE}/projects/{pid}/weather-logs", headers=headers, timeout=15)
        assert g.status_code == 200, g.text
        logs = g.json()["logs"]
        assert any(l["node_id"] == subtramo_est_id and l["temperature_c"] == 99.0 for l in logs)
        _log("✅ GET /weather-logs trae la captura de hoy")

        # -------------------- Contenido persistente para que la página emita --------------------
        # Acceso al Predio simple, para garantizar que se emita la página de
        # resumen del Subtramo (el gate de emisión no depende del clima).
        r = requests.patch(
            f"{BASE}/nodes/{subtramo_est_id}",
            headers=headers,
            json={"acceso_predio": "Permitido", "situacion_social": "Predio liberado."},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        # -------------------- Exportar PDF --------------------
        _log("Exportando PDF (period=today)…")
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

        # Los valores capturados a mano deben aparecer en la página de
        # resumen — son imposibles de confundir con una respuesta real de
        # Open-Meteo. La temperatura se revisa de forma laxa ("99" cerca de
        # "C") porque el símbolo de grado puede extraerse distinto según el
        # motor de PDF -> texto; viento/precipitación/calidad del aire no
        # llevan símbolos especiales, se comparan tal cual el formato del
        # renderer (f"{wind:.1f} km/hr.", f"{precip:.1f} mm", f"{aqi:.1f} ICA").
        assert "99" in full_text, "Falta la temperatura capturada a mano (99) en el PDF"
        assert "77.7 KM/HR." in full_text, "Falta el viento capturado a mano (77.7 km/hr.) en el PDF"
        assert "8.8 MM" in full_text, "Falta la precipitación capturada a mano (8.8 mm) en el PDF"
        assert "55.5 ICA" in full_text, "Falta la calidad del aire capturada a mano (55.5 ICA) en el PDF"
        assert "ESTADO DEL TIEMPO" in full_text
        _log("✅ El resumen PDF muestra el clima capturado a mano (no el automático)")

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
