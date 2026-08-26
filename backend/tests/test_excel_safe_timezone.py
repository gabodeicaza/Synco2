"""Test puro de `_excel_safe` — server.py.

Bug real reportado: "cuando hago un reporte siempre sale mal la hora".
`_excel_safe` le quitaba el tzinfo a un datetime tz-aware (UTC, como se
almacena `created_at` siempre) SIN convertirlo antes a CDMX -- el Excel
exportado (`/export/reports.xlsx`) mostraba la hora UTC cruda, y en
capturas de noche (CDMX está 6-7h detrás de UTC) literalmente el día
calendario equivocado.
"""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_excel_safe_tz")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import _excel_safe


def test_datetime_tz_aware_se_convierte_a_cdmx_no_a_utc_crudo():
    # 2026-08-15 02:30 UTC == 2026-08-14 20:30 CDMX (UTC-6, horario de verano CDMX).
    utc_dt = datetime(2026, 8, 15, 2, 30, tzinfo=timezone.utc)
    resultado = _excel_safe(utc_dt)
    assert resultado == datetime(2026, 8, 14, 20, 30)
    assert resultado.tzinfo is None  # openpyxl exige naive


def test_captura_nocturna_cambia_de_dia_calendario_al_convertir_a_cdmx():
    # Caso literal del bug: capturado a las 23:50 CDMX -> 05:50 UTC del día
    # siguiente. Antes del fix, _excel_safe mostraba "día siguiente 05:50".
    utc_dt = datetime(2026, 8, 15, 5, 50, tzinfo=timezone.utc)
    resultado = _excel_safe(utc_dt)
    assert resultado == datetime(2026, 8, 14, 23, 50)
    assert resultado.day == 14  # no 15 -- el día calendario CDMX real de la captura


def test_datetime_naive_se_deja_tal_cual_sin_reventar():
    naive_dt = datetime(2026, 8, 14, 20, 30)
    assert _excel_safe(naive_dt) == naive_dt


def test_none_se_convierte_a_cadena_vacia():
    assert _excel_safe(None) == ""


def test_lista_se_aplana_a_texto_separado_por_comas():
    assert _excel_safe(["3 Ayudante", "1 Maestro"]) == "3 Ayudante, 1 Maestro"


def test_valores_no_datetime_pasan_sin_tocar():
    assert _excel_safe(42) == 42
    assert _excel_safe("texto") == "texto"
