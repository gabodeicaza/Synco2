"""Test E2E manual para la página de resumen por Subtramo tipo INTERTRAMO
en el export PDF — hermano de test_subtramo_summary_export.py (que cubre el
formato Estación, sin tocarlo).

Cubre la nueva rama `draw_intertramo_summary_page` (server.py): un Subtramo
con `tipo_nodo == "intertramo"` debe imprimir un layout distinto al de
Estación — SIN el badge "ACCESO AL PREDIO", con "SITUACIÓN SOCIAL-
LIBERACIÓN FÍSICA DE PREDIOS" (plural) y una tabla "ACTIVIDAD EN POSTES"
con un renglón por hijo directo (Poste), mostrando su Ubicación y el
estatus de sus 4 columnas (Pilas/Cabezal/Fuste/Poste).

Construye:
  Tramo 1 (raíz, profundidad 0)
    └── Intertramo E1-E2 (profundidad 1, tipo_nodo="intertramo")
          situacion_social="Sin problemática social."
          ├── Poste C1 (hoja, ubicacion="Yobain")
          │     estatus_pilas="en_proceso", estatus_cabezal="concluido"
          │     → reporte: 2 Topografo, 1 Camion
          └── Poste C2 (hoja, ubicacion="Peto")
                estatus_fuste="sin_iniciar", estatus_poste="concluido"
                → reporte: 1 Cadenero, 1 Camioneta

USO:
  python -m pytest backend/tests/test_intertramo_summary_export.py -s -v
  o
  python backend/tests/test_intertramo_summary_export.py
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
            "name": f"TEST_IntertramoSummary_{suffix}",
            "constructora": "TEST_Constructora",
            "contract_number": f"TEST-{suffix}",
            "description": "E2E: resumen por subtramo tipo Intertramo",
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
        intertramo_id = _create_node("Intertramo E1-E2", parent_id=tramo_id, order=0)
        poste_c1_id = _create_node("C1", parent_id=intertramo_id, is_leaf=True, mt="cadenamiento", order=0)
        poste_c2_id = _create_node("C2", parent_id=intertramo_id, is_leaf=True, mt="cadenamiento", order=1)
        _log(f"Árbol creado: Tramo={tramo_id} Intertramo={intertramo_id} C1={poste_c1_id} C2={poste_c2_id}")

        # -------------------- Tipo de nodo + Situación Social (plural) --------------------
        r = requests.patch(
            f"{BASE}/nodes/{intertramo_id}",
            headers=headers,
            json={"tipo_nodo": "intertramo", "situacion_social": "Sin problemática social."},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("tipo_nodo") == "intertramo", "tipo_nodo no se persistió"

        # -------------------- Ubicación + estatus por Poste --------------------
        r = requests.patch(
            f"{BASE}/nodes/{poste_c1_id}",
            headers=headers,
            json={"ubicacion": "Yobain", "estatus_pilas": "en_proceso", "estatus_cabezal": "concluido"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        r = requests.patch(
            f"{BASE}/nodes/{poste_c2_id}",
            headers=headers,
            json={"ubicacion": "Peto", "estatus_fuste": "sin_iniciar", "estatus_poste": "concluido"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        _log("tipo_nodo / situación social / ubicación / estatus persistidos")

        # -------------------- Reportes (Fuerza de Trabajo / Maquinaria) --------------------
        def _create_report(node_id, personnel, equipment, actividades):
            payload = {
                "project_id": pid,
                "node_id": node_id,
                "measurement_value": {"cadenamiento": "0+000"},
                "actividades": actividades,
                "severidad": "importante",
                "personnel": personnel,
                "equipment": equipment,
            }
            rr = requests.post(f"{BASE}/reports", headers=headers, json=payload, timeout=15)
            assert rr.status_code == 200, f"Report create failed: {rr.status_code} {rr.text}"
            return rr.json()["id"]

        _create_report(poste_c1_id, ["2 Topografo"], ["1 Camion"], "Armado de acero estructural")
        _create_report(poste_c2_id, ["1 Cadenero"], ["1 Camioneta"], "Descabece de pilas")
        _log("2 reportes creados (uno por Poste)")

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
        _log(f"PDF exportado: {len(pages)} páginas, {len(pdf_bytes)} bytes")

        page_texts = [(p.extract_text() or "").upper() for p in pages]

        def _pages_containing(needle: str):
            return [i for i, t in enumerate(page_texts) if needle in t]

        def _pages_containing_all(*needles: str):
            return [i for i, t in enumerate(page_texts) if all(n in t for n in needles)]

        # FIX: desde que se corrigió el bug de "cover_meta" que borraba en
        # silencio el nodo entero sin `cover_image` (ver server.py), cada
        # Poste también imprime su propia portadilla — que también contiene
        # el nombre del Intertramo como parte de la ruta institucional
        # ("Tramo 1 › Intertramo E1-E2 › C1"). Hay que pedir además
        # "ACTIVIDAD EN POSTES" (exclusivo de la página de RESUMEN del
        # Intertramo) para no agarrar la portadilla por error.
        pages_intertramo = _pages_containing_all("INTERTRAMO E1-E2", "ACTIVIDAD EN POSTES")
        assert pages_intertramo, "La página de resumen del Intertramo (título + 'ACTIVIDAD EN POSTES') no aparece en el PDF"
        page_idx = pages_intertramo[0]
        text = page_texts[page_idx]
        _log(f"Página de resumen del Intertramo: índice {page_idx}")

        assert "ACTIVIDAD EN POSTES" in text, "Falta la sección 'ACTIVIDAD EN POSTES'"
        assert "SITUACIÓN SOCIAL-LIBERACIÓN FÍSICA DE PREDIOS" in text or "SITUACION SOCIAL-LIBERACION FISICA DE PREDIOS" in text, (
            "Falta el título plural 'Situación Social-Liberación Física de Predios'"
        )
        assert "ACCESO AL PREDIO" not in text, (
            "La página de un Intertramo NO debe mostrar el badge 'ACCESO AL PREDIO' (solo aplica a Estación)"
        )
        assert "ESTADO DEL TIEMPO" not in text, (
            "La página de un Intertramo NO debe mostrar 'ESTADO DEL TIEMPO' (formato de referencia del cliente)"
        )
        _log("✅ Secciones correctas: Actividad en Postes presente, Acceso al Predio/Estado del Tiempo ausentes")

        assert "YOBAIN" in text, "Falta la ubicación 'Yobain' del Poste C1 en la tabla"
        assert "PETO" in text, "Falta la ubicación 'Peto' del Poste C2 en la tabla"
        assert "EN PROCESO" in text, "Falta el estatus 'En proceso' (Pilas de C1)"
        assert "CONCLUIDO" in text, "Falta el estatus 'Concluido' (Cabezal de C1 / Poste de C2)"
        assert "SIN INICIAR" in text, "Falta el estatus 'Sin iniciar' (Fuste de C2, o celdas por defecto)"
        _log("✅ Tabla Actividad en Postes con ubicación y estatus por Poste")

        assert "FUERZA DE TRABAJO" in text and "MAQUINARIA Y EQUIPO" in text, (
            "Deben seguir apareciendo las tablas Fuerza de Trabajo / Maquinaria y Equipo"
        )
        assert "TOTAL" in text, "Debe existir un bloque TOTAL en la página"
        _log("✅ Tablas de recursos presentes con TOTAL")

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
