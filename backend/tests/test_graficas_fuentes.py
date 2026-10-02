"""Fuentes de las gráficas dibujadas con Pillow (server.py): la fuente por
defecto de Pillow no trae vocales acentuadas, así que se usa una TrueType del
sistema y, si no hay ninguna, se quitan los acentos para que el texto se lea."""
import io
import os
import sys
from decimal import Decimal
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_fuentes")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402


def test_sin_acentos_conserva_la_enie_como_n_y_el_resto_igual():
    assert server._sin_acentos("Dictámenes estructurales · Físico–financiero") == "Dictamenes estructurales · Fisico–financiero"
    assert server._sin_acentos("ASPECTOS SOCIALES 100%") == "ASPECTOS SOCIALES 100%"


def test_chart_canvas_sin_fuentes_del_sistema_quita_acentos(monkeypatch):
    from PIL import Image
    monkeypatch.setattr(server, "_CHART_FONT_CANDIDATAS", ())
    d, fuentes = server._chart_canvas(Image.new("RGB", (10, 10)), 12, 20)
    assert len(fuentes) == 2
    # textlength de la versión sin acentos == la del texto original: nunca dibuja cuadros
    assert d.textlength("ó", font=fuentes[0]) == d.textlength("o", font=fuentes[0])


def test_graficas_se_generan_con_y_sin_fuentes_del_sistema(monkeypatch):
    from PIL import Image
    for candidatas in (server._CHART_FONT_CANDIDATAS, ()):
        monkeypatch.setattr(server, "_CHART_FONT_CANDIDATAS", candidatas)
        png = server._grafica_lineas_png(
            "Avance físico", ["01/26", "02/26"], [("Programado", "#2563EB", [Decimal(1), Decimal(5)])], lambda v: f"{v:.0f}%")
        assert Image.open(io.BytesIO(png)).size == (1800, 800)
        assert Image.open(io.BytesIO(server._grafica_donas_png("Dictámenes", [("a", 1, 2)]))).size == (1800, 800)
