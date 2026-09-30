"""Tests puros (sin HTTP ni Mongo) de los módulos Fotos LiDAR y Tapial y de
los Datos de Contrato del proyecto (server.py)."""
import base64
import io
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_fotos_tapial")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from PIL import Image  # noqa: E402

import server  # noqa: E402
from server import (  # noqa: E402
    _bake_plano_snapshot, _fmt_iso_dmy, _fotos_lidar_etiqueta, _normalize_photo_b64,
    _plano_tapial_avance, _png_bytes_to_jpeg_dataurl, _sanitize_datos_contrato,
    _sanitize_modulos, _sanitize_plano_puntos,
)


def _png_b64(w=400, h=200, color=(200, 200, 200)) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


# ── Catálogo de módulos ────────────────────────────────────────────────────
def test_modulos_nuevos_estan_en_el_catalogo():
    m = _sanitize_modulos({"reportes_diarios": {"fotos_lidar": True, "tapial": True}})
    assert m["reportes_diarios"]["fotos_lidar"] is True
    assert m["reportes_diarios"]["tapial"] is True
    assert m["reportes_semanales"]["tapial"] is False


# ── Datos de contrato ──────────────────────────────────────────────────────
def test_datos_contrato_descarta_basura_y_recorta():
    assert _sanitize_datos_contrato("x") == {}
    out = _sanitize_datos_contrato({
        "obra": {"empresa": "  ALFA  ", "monto": "$1.00", "hack": "x", "iva": 5, "fin": ""},
        "supervision": {"contrato": "DGOT-1"},
        "otro": {"empresa": "no"},
    })
    assert out == {"obra": {"empresa": "ALFA", "monto": "$1.00"}, "supervision": {"contrato": "DGOT-1"}}
    largo = _sanitize_datos_contrato({"obra": {"objeto": "a" * 5000}})
    assert len(largo["obra"]["objeto"]) == 1000


# ── Fotos LiDAR ────────────────────────────────────────────────────────────
def test_normalize_photo_reduce_y_devuelve_data_url_jpeg():
    out = _normalize_photo_b64(_png_b64(4000, 3000))
    assert out.startswith("data:image/jpeg;base64,")
    img = Image.open(io.BytesIO(base64.b64decode(out.split(",", 1)[1])))
    assert max(img.size) <= 1800


def test_normalize_photo_rechaza_basura():
    with pytest.raises(HTTPException) as e:
        _normalize_photo_b64(base64.b64encode(b"no soy imagen").decode())
    assert e.value.status_code == 400
    with pytest.raises(HTTPException):
        _normalize_photo_b64("")


def test_fecha_y_etiqueta():
    assert _fmt_iso_dmy("2026-09-29") == "29/09/2026"
    assert _fmt_iso_dmy("basura") == "basura"
    assert _fotos_lidar_etiqueta("ORIGINAL", "2026-01-05") == "ORIGINAL · 05/01/2026"
    assert _fotos_lidar_etiqueta("ACTUAL", None) == "ACTUAL"


# ── Tapial ─────────────────────────────────────────────────────────────────
def test_puntos_validacion():
    assert _sanitize_plano_puntos([[0, 0], [1, 1]]) == [[0.0, 0.0], [1.0, 1.0]]
    for malo in (None, [[0, 0]], [[0, 0], [2, 0]], [[0, 0], ["a", 1]], [[0, 0], [1]], [[0, 0], [True, 1]]):
        with pytest.raises(HTTPException):
            _sanitize_plano_puntos(malo)
    with pytest.raises(HTTPException):
        _sanitize_plano_puntos([[0.1, 0.1]] * 201)


def _plano(markers, w=1000, h=500):
    return {"imagen": _png_b64(w, h), "markers": markers}


def test_avance_tapial_por_longitud_con_discontinuidad():
    # Dos tramos separados (hueco entre ellos): 500 px terminados y 500 px sin iniciar.
    plano = _plano([
        {"tipo": "tramo", "estatus": "terminado", "puntos": [[0.0, 0.5], [0.5, 0.5]]},
        {"tipo": "tramo", "estatus": "sin_iniciar", "puntos": [[0.6, 0.5], [1.0, 0.5]]},
        {"tipo": "tramo", "estatus": "en_proceso", "puntos": [[0.5, 0.2], [0.5, 0.4]]},
        {"tipo": "punto", "estatus": "terminado", "x": 0.1, "y": 0.1},
    ])
    av = _plano_tapial_avance(plano)
    assert av["tramos"] == 3
    # terminado 500px, sin iniciar 400px, en proceso 100px (200*0.5=100) → total 1000
    assert av["pct_terminado"] == 50.0
    assert av["pct_en_proceso"] == 10.0


def test_avance_tapial_sin_tramos():
    av = _plano_tapial_avance(_plano([{"tipo": "punto", "x": 0.1, "y": 0.1}]))
    assert av == {"tramos": 0, "pct_terminado": None, "pct_en_proceso": None}


def test_snapshot_dibuja_tramos_y_jpeg_export():
    plano = _plano([
        {"tipo": "tramo", "estatus": "terminado", "label": "T1", "puntos": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.6]]},
    ])
    png = _bake_plano_snapshot(plano)
    img = Image.open(io.BytesIO(png)).convert("RGB")
    # El trazo verde (#16A34A) debe existir en la imagen horneada.
    assert (0x16, 0xA3, 0x4A) in {px for px in img.getdata()}
    jpg = _png_bytes_to_jpeg_dataurl(png)
    assert jpg.startswith("data:image/jpeg;base64,")
