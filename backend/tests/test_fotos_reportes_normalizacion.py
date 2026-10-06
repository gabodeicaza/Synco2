"""Normalización de fotos de reportes: cualquier formato/tamaño sale como JPEG abrible."""
import base64
import io
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_fotos_reportes")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from PIL import Image  # noqa: E402

from server import _normalize_images_b64, _normalize_report_photo_b64  # noqa: E402


def _data_url(img: Image.Image, fmt: str, mime: str) -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _open(data_url: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))


def test_jpeg_grande_se_reduce():
    out = _normalize_report_photo_b64(_data_url(Image.new("RGB", (6000, 4000), "red"), "JPEG", "image/jpeg"))
    img = _open(out)
    assert out.startswith("data:image/jpeg;base64,") and img.format == "JPEG"
    assert max(img.size) <= 2000


def test_png_y_webp_salen_jpeg():
    for fmt, mime in (("PNG", "image/png"), ("WEBP", "image/webp")):
        out = _normalize_report_photo_b64(_data_url(Image.new("RGBA", (800, 600), (0, 255, 0, 128)), fmt, mime))
        assert _open(out).format == "JPEG"


def test_foto_chica_no_se_amplia():
    out = _normalize_report_photo_b64(_data_url(Image.new("RGB", (300, 200), "blue"), "JPEG", "image/jpeg"))
    assert _open(out).size == (300, 200)


def test_invalida_se_devuelve_tal_cual():
    malo = "data:image/jpeg;base64," + base64.b64encode(b"no soy una imagen").decode()
    assert _normalize_report_photo_b64(malo) == malo
    assert _normalize_report_photo_b64("no-es-data-url") == "no-es-data-url"
    assert _normalize_images_b64(None) == []


def test_heic_se_convierte_a_jpeg():
    pillow_heif = pytest.importorskip("pillow_heif")
    pillow_heif.register_heif_opener()
    heic = _data_url(Image.new("RGB", (1200, 900), "orange"), "HEIF", "image/heic")
    out = _normalize_report_photo_b64(heic)
    assert out.startswith("data:image/jpeg;base64,") and _open(out).format == "JPEG"
