"""Test E2E manual para el marcador tipo "dado" (rectángulo de cimentación)
en Plano de Avance — agregado junto con etiquetas visibles y el modo
"Mover" (arrastrar) en la app. Este archivo solo cubre lo que se puede
verificar por API (el drag en sí vive 100% en el cliente — PlanoMarkerOverlay
usa el mismo endpoint PATCH que ya existía para reposicionar).

Cubre:
  - POST .../markers con tipo="dado" (solo requiere x/y, igual que "punto").
  - PATCH .../markers/{id} reposiciona x/y de un "dado" (lo que usa el modo
    "Mover" del cliente tras un arrastre).
  - GET .../snapshot.png no truena con un plano que mezcla punto/dado/segmento
    (antes _bake_plano_snapshot no sabía dibujar "dado" — solo hornear PNG,
    no se valida el contenido pixel a pixel, solo que responde 200 con bytes).

USO:
  python -m pytest backend/tests/test_plano_avance_dado.py -s -v
  o
  python backend/tests/test_plano_avance_dado.py
"""
import io
import os
import sys
import uuid

import requests

BASE = os.environ.get("SYNCO_TEST_BASE_URL", "http://localhost:8001/api")
EMAIL = "gabriel@synco.mx"
PASSWORD = "SynCo2026!Coord"


def _log(msg: str):
    print(f"[test] {msg}")


def _tiny_png_bytes() -> bytes:
    from PIL import Image
    img = Image.new("RGB", (200, 150), color="#EEEEEE")
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


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
            "name": f"TEST_PlanoDado_{suffix}",
            "constructora": "TEST_Constructora",
            "contract_number": f"TEST-{suffix}",
            "description": "E2E: marcador tipo dado en Plano de Avance",
        },
        timeout=15,
    )
    r.raise_for_status()
    pid = r.json()["id"]
    _log(f"Proyecto creado: {pid}")

    try:
        # -------------------- Subir plano --------------------
        png_bytes = _tiny_png_bytes()
        r = requests.post(
            f"{BASE}/projects/{pid}/planos-avance",
            headers=headers,
            params={"nombre": "Cimentación"},
            files={"file": ("plano.png", png_bytes, "image/png")},
            timeout=30,
        )
        assert r.status_code == 200, f"Upload failed: {r.status_code} {r.text}"
        plano_id = r.json()["id"]
        _log(f"Plano creado: {plano_id}")

        # -------------------- Crear marcador tipo "dado" --------------------
        r = requests.post(
            f"{BASE}/projects/{pid}/planos-avance/{plano_id}/markers",
            headers=headers,
            json={"tipo": "dado", "label": "D-1", "x": 0.2, "y": 0.3},
            timeout=15,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        dado = r.json()
        assert dado["tipo"] == "dado"
        assert dado["label"] == "D-1"
        dado_id = dado["id"]
        _log(f"✅ Marcador 'dado' creado: {dado_id}")

        # -------------------- Crear un punto y una trabe "conectada" --------------------
        r = requests.post(
            f"{BASE}/projects/{pid}/planos-avance/{plano_id}/markers",
            headers=headers,
            json={"tipo": "punto", "label": "C-1", "x": 0.2, "y": 0.3},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        punto_id = r.json()["id"]

        r = requests.post(
            f"{BASE}/projects/{pid}/planos-avance/{plano_id}/markers",
            headers=headers,
            json={"tipo": "segmento", "label": "CT-40x160", "x": 0.2, "y": 0.3, "x2": 0.6, "y2": 0.3},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        trabe_id = r.json()["id"]
        _log("Punto + trabe creados (misma coordenada de origen que el dado)")

        # -------------------- Reposicionar el dado (simula el modo "Mover" del cliente) --------------------
        r = requests.patch(
            f"{BASE}/projects/{pid}/planos-avance/{plano_id}/markers/{dado_id}",
            headers=headers,
            json={"x": 0.35, "y": 0.45},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        moved = r.json()
        assert moved["x"] == 0.35 and moved["y"] == 0.45
        _log("✅ PATCH reposiciona x/y de un 'dado' (mismo endpoint que usa el modo Mover)")

        # El cliente (PlanoAvanceScreen.onDragEndMarker) haría además este PATCH
        # sobre la trabe conectada — lo ejercitamos aquí para confirmar que el
        # endpoint soporta mover solo el extremo x/y (no x2/y2) de un segmento.
        r = requests.patch(
            f"{BASE}/projects/{pid}/planos-avance/{plano_id}/markers/{trabe_id}",
            headers=headers,
            json={"x": 0.35, "y": 0.45},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        trabe_moved = r.json()
        assert trabe_moved["x"] == 0.35 and trabe_moved["y"] == 0.45
        assert trabe_moved["x2"] == 0.6 and trabe_moved["y2"] == 0.3, "El otro extremo de la trabe no debe moverse"
        _log("✅ PATCH mueve solo el extremo x/y de la trabe, x2/y2 queda intacto")

        # -------------------- Snapshot no truena con punto+dado+segmento --------------------
        r = requests.get(f"{BASE}/projects/{pid}/planos-avance/{plano_id}/snapshot.png", headers=headers, timeout=30)
        assert r.status_code == 200, f"Snapshot failed: {r.status_code} {r.text[:300]}"
        assert len(r.content) > 0 and r.headers.get("content-type", "").startswith("image/")
        _log("✅ snapshot.png responde 200 con un plano que mezcla punto/dado/segmento")

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
