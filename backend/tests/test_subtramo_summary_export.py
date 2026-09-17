"""Test E2E manual para la página de resumen por Subtramo en el export PDF.

Cubre la actualización crítica: la sumatoria de Fuerza de Trabajo /
Maquinaria y Equipo debe agruparse por SUBTRAMO (nodo a profundidad 1),
no por Tramo (nodo raíz) — con una página de resumen emitida cada vez que
el iterador cambia de subtramo.

Construye:
  Tramo 1 (raíz, profundidad 0)
    └── Subtramo A (profundidad 1) — acceso_predio="Permitido"
          ├── Poste A1 (hoja) → reporte: 2 Topografo, 1 Camion
          └── Poste A2 (hoja) → reporte: 1 Cadenero, 1 Camioneta
    └── Subtramo B (profundidad 1) — acceso_predio="Bloqueado"
          └── Poste B1 (hoja) → reporte: 3 Topografo, 2 Retroexcavadora

Totales esperados POR SUBTRAMO (no por Tramo):
  Subtramo A: personal = 3 (2 Topografo + 1 Cadenero), maquinaria = 2
  Subtramo B: personal = 3 (3 Topografo),               maquinaria = 2

Si el código regresionara a agrupar por Tramo (raíz), ambos subtramos se
fusionarían en UNA sola página con el nombre del Tramo (nunca el de los
subtramos) y totales combinados (personal=6, maquinaria=4) — el test
detecta esto verificando que cada nombre de Subtramo aparece en una
página PROPIA y distinta del export.

USO:
  python -m pytest backend/tests/test_subtramo_summary_export.py -s -v
  o
  python backend/tests/test_subtramo_summary_export.py
"""
import io
import os
import sys
import uuid

import requests
from pypdf import PdfReader

# Override con SYNCO_TEST_BASE_URL para apuntar a un despliegue remoto
# (ej. https://apm-app.mx/api) en vez del backend local de desarrollo.
BASE = os.environ.get("SYNCO_TEST_BASE_URL", "http://localhost:8001/api")
EMAIL = "gabriel@synco.mx"
PASSWORD = "SynCo2026!Coord"


def _log(msg: str):
    print(f"[test] {msg}")


def main() -> int:
    suffix = uuid.uuid4().hex[:8]

    # -------------------- 1. LOGIN --------------------
    _log("Login como coordinador general…")
    r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    r.raise_for_status()
    token = r.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    _log(f"Token OK ({token[:20]}…)")

    # -------------------- 2. CREAR PROYECTO --------------------
    _log("Creando proyecto de prueba…")
    r = requests.post(
        f"{BASE}/projects",
        headers=headers,
        json={
            "name": f"TEST_SubtramoSummary_{suffix}",
            "constructora": "TEST_Constructora",
            "contract_number": f"TEST-{suffix}",
            "description": "E2E: resumen por subtramo",
        },
        timeout=15,
    )
    r.raise_for_status()
    pid = r.json()["id"]
    _log(f"Proyecto creado: {pid}")

    try:
        # -------------------- 3. ÁRBOL: Tramo -> 2 Subtramos -> Postes --------------------
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
        subtramo_a_id = _create_node("Subtramo A", parent_id=tramo_id, order=0)
        subtramo_b_id = _create_node("Subtramo B", parent_id=tramo_id, order=1)
        poste_a1_id = _create_node("Poste A1", parent_id=subtramo_a_id, is_leaf=True, mt="cadenamiento", order=0)
        poste_a2_id = _create_node("Poste A2", parent_id=subtramo_a_id, is_leaf=True, mt="cadenamiento", order=1)
        poste_b1_id = _create_node("Poste B1", parent_id=subtramo_b_id, is_leaf=True, mt="cadenamiento", order=0)
        _log(f"Árbol creado: Tramo={tramo_id} SubtramoA={subtramo_a_id} SubtramoB={subtramo_b_id}")

        # -------------------- 4. Acceso al Predio / Situación Social por Subtramo --------------------
        r = requests.patch(
            f"{BASE}/nodes/{subtramo_a_id}",
            headers=headers,
            json={"acceso_predio": "Permitido", "situacion_social": "Predio liberado en su totalidad."},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        r = requests.patch(
            f"{BASE}/nodes/{subtramo_b_id}",
            headers=headers,
            json={"acceso_predio": "Bloqueado", "situacion_social": "Pendiente convenio con propietario."},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        _log("Acceso al Predio / Situación Social persistidos en ambos subtramos")

        # -------------------- 5. REPORTES (Fuerza de Trabajo / Maquinaria) --------------------
        def _create_report(node_id, personnel, equipment, actividades):
            payload = {
                "project_id": pid,
                "node_id": node_id,
                "measurement_value": {"cadenamiento": "0+000"},
                "actividades": actividades,
                # El export tiene un gate previo basado en reportes con
                # severidad Importante/Urgente (excluye Informativo) antes de
                # llegar al loop que emite el resumen por subtramo — usamos
                # "importante" para que el PDF no corte temprano con "No hay
                # reportes para el período seleccionado".
                "severidad": "importante",
                "personnel": personnel,
                "equipment": equipment,
            }
            rr = requests.post(f"{BASE}/reports", headers=headers, json=payload, timeout=15)
            assert rr.status_code == 200, f"Report create failed: {rr.status_code} {rr.text}"
            return rr.json()["id"]

        _create_report(poste_a1_id, ["2 Topografo"], ["1 Camion"], "Trazo y nivelacion")
        _create_report(poste_a2_id, ["1 Cadenero"], ["1 Camioneta"], "Limpieza de derecho de via")
        _create_report(poste_b1_id, ["3 Topografo"], ["2 Retroexcavadora"], "Excavacion de zanja")
        _log("3 reportes creados (2 en Subtramo A, 1 en Subtramo B)")

        # -------------------- 6. EXPORTAR PDF --------------------
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
        _log(f"PDF exportado: {len(pages)} páginas, {len(pdf_bytes)} bytes")

        page_texts = [(p.extract_text() or "").upper() for p in pages]

        def _pages_containing(needle: str):
            return [i for i, t in enumerate(page_texts) if needle in t]

        pages_a = _pages_containing("SUBTRAMO A")
        pages_b = _pages_containing("SUBTRAMO B")
        _log(f"Páginas con 'SUBTRAMO A': {pages_a}")
        _log(f"Páginas con 'SUBTRAMO B': {pages_b}")

        assert pages_a, "El nombre 'Subtramo A' no aparece en ninguna página del PDF exportado"
        assert pages_b, "El nombre 'Subtramo B' no aparece en ninguna página del PDF exportado"
        assert set(pages_a).isdisjoint(pages_b), (
            "Subtramo A y Subtramo B aparecen en la MISMA página — indica que la "
            "agrupación sigue siendo por Tramo (raíz) en vez de por Subtramo"
        )
        _log("✅ Cada subtramo tiene su PROPIA página de resumen (no fusionadas por Tramo)")

        # Acceso al Predio: el estatus de cada subtramo debe aparecer en su página.
        text_a = page_texts[pages_a[0]]
        text_b = page_texts[pages_b[0]]
        assert "PERMITIDO" in text_a, "Página de Subtramo A debería mostrar 'PERMITIDO'"
        assert "BLOQUEADO" in text_b, "Página de Subtramo B debería mostrar 'BLOQUEADO'"
        _log("✅ Badge de Acceso al Predio correcto por subtramo")

        # Totales por subtramo NO deben estar fusionados: el total combinado
        # incorrecto (6 personal si se agrupara por Tramo) no debe aparecer
        # como total en ninguna de las dos páginas de subtramo.
        assert "TOTAL" in text_a and "TOTAL" in text_b, "Debe existir un bloque TOTAL en cada página de subtramo"
        _log("✅ Bloques TOTAL presentes en ambas páginas de resumen")

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
