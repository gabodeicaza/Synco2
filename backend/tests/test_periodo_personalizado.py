"""Exportaciones (PDF/Word/PPTX/conteo) con rango personalizado: `period="custom_YYYYMMDD_YYYYMMDD"`.
Pruebas puras de `_period_range` y de la categoría de módulos."""
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_periodo_personalizado")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402


def test_rango_cubre_los_dos_dias_completos_en_cdmx():
    ini, fin, etiqueta = server._period_range("custom_20200301_20200303", None)
    # CDMX = UTC-6 (sin horario de verano en 2020-03) → 00:00 local = 06:00 UTC.
    assert ini == datetime(2020, 3, 1, 6, 0, tzinfo=timezone.utc)
    assert fin == datetime(2020, 3, 4, 5, 59, 59, 999999, tzinfo=timezone.utc)
    assert etiqueta == "01/03/2020 al 03/03/2020"


def test_un_solo_dia():
    ini, fin, etiqueta = server._period_range("custom_20200301_20200301", None)
    assert (fin - ini).days == 0 and etiqueta == "01/03/2020"


def test_el_fin_no_pasa_de_ahora():
    _ini, fin, _ = server._period_range("custom_20200101_20991231", None)
    assert fin <= datetime.now(timezone.utc)


def test_rango_invertido_o_basura_da_400():
    with pytest.raises(HTTPException) as e:
        server._period_range("custom_20200305_20200301", None)
    assert e.value.status_code == 400
    with pytest.raises(HTTPException):
        server._period_range("custom_20209999_20200301", None)


def test_periodos_normales_no_cambian():
    assert server._parse_periodo_personalizado("week") is None
    assert server._period_range("yesterday", None)[2] == "Ayer"


def test_categoria_de_modulos_segun_duracion():
    f = server._modulos_categoria_para_export
    assert f(None, "custom_20200301_20200301") == "reportes_diarios"
    assert f(None, "custom_20200301_20200307") == "reportes_semanales"
    assert f(None, "custom_20200301_20200308") == "reportes_mensuales"
