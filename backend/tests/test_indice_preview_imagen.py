"""Vista previa en imagen del índice: PDF (con fondo de plantilla) y maqueta del PowerPoint."""
import asyncio
import base64
import io
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

pytest.importorskip("pymupdf")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_indice_img")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

ESTRUCTURA = [{"key": f"s{i}", "title": f"Sección {i}", "n": 2, "inicio": 1 + 2 * i} for i in range(40)]
ESTRUCTURA[0]["caps"] = [20, 25]
USER = {"id": "u", "role": server.ROLE_COORD}


def _correr(formato, cfg, proyecto=None, estructura=ESTRUCTURA):
    db = MagicMock()
    db.projects.find_one = AsyncMock(return_value={"indice_estructura": {"diario": estructura}})
    server.db = db
    server.ensure_project_access = AsyncMock(return_value=proyecto or {"color_institucional": "#8A1538"})
    return asyncio.run(server.preview_indice_imagen("p1", "diario", cfg, formato, USER))


def _png(dataurl):
    return base64.b64decode(dataurl.split(",", 1)[1])


@pytest.mark.parametrize("formato", ["pdf", "pptx"])
def test_devuelve_png_de_las_hojas_del_indice(formato):
    r = _correr(formato, {})
    assert r["disponible"] and r["habilitado"] and r["formato"] == formato
    assert 1 <= len(r["paginas"]) <= 3 and r["total_paginas_indice"] >= 2  # 40 secciones no caben en una hoja
    assert _png(r["paginas"][0])[:8] == b"\x89PNG\r\n\x1a\n"
    assert r["ancho"] > r["alto"] > 0


def test_con_plantilla_pdf_la_hoja_lleva_el_fondo(tmp_path):
    from reportlab.pdfgen import canvas
    tpl = tmp_path / "tpl.pdf"
    c = canvas.Canvas(str(tpl), pagesize=(800, 450))
    c.setFillColorRGB(1, 0, 0)
    c.rect(0, 0, 800, 450, fill=1)
    c.showPage()
    c.save()
    server._get_project_template = lambda proj, kind: str(tpl) if kind == "pdf" else None
    r = _correr("pdf", {}, ESTRUCTURA[:3] and ESTRUCTURA[:3] and {"color_institucional": "#8A1538"}, ESTRUCTURA[:3])
    assert (r["ancho"], r["alto"]) == (800, 450)
    import pymupdf
    pix = pymupdf.Pixmap(io.BytesIO(_png(r["paginas"][0])))
    assert pix.pixel(5, 5)[0] > 200 and pix.pixel(5, 5)[1] < 60  # esquina roja = fondo de la plantilla


def test_sin_indice_no_hay_hojas():
    r = _correr("pdf", {"enabled": False})
    assert r["habilitado"] is False and r["paginas"] == []


def test_estructura_sin_paginas_no_esta_disponible():
    assert _correr("pdf", {}, estructura=[{"key": "a", "title": "A"}]) == {"disponible": False}
