"""Test puro de `_feed_created_filter` (server.py): el chequeo de reportes
nuevos (`since`) del Inicio no debe traer reportes de fuera del día/rango
filtrado — regresión: `since` reemplazaba al día seleccionado."""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_feed_created_filter")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import _feed_created_filter  # noqa: E402


def _d(dia, h=0):
    return datetime(2026, 10, dia, h, tzinfo=timezone.utc)


def test_since_con_dia_conserva_los_limites_del_dia():
    f = _feed_created_filter((_d(5), _d(6)), None, _d(5, 10))
    assert f == {"$gte": _d(5), "$lt": _d(6), "$gt": _d(5, 10)}


def test_since_con_rango_conserva_el_inicio_del_rango():
    assert _feed_created_filter(None, _d(1), _d(2)) == {"$gte": _d(1), "$gt": _d(2)}


def test_dia_tiene_prioridad_sobre_rango_y_sin_since_no_agrega_gt():
    assert _feed_created_filter((_d(5), _d(6)), _d(1), None) == {"$gte": _d(5), "$lt": _d(6)}


def test_sin_nada_no_filtra():
    assert _feed_created_filter(None, None, None) == {}
