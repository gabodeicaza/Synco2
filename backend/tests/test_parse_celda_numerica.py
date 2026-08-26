"""Test puro (sin HTTP) de la bifurcación por tipo de celda (Etapa 2, 2.a)
dentro de server.py: un número NATIVO (int/float, lo que entrega openpyxl
con data_only=True) nunca debe pasar por el normalizador de texto; solo el
texto (CSV o celda de .xlsx guardada como texto) sí.
"""
import os
import sys
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_import_parse")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import _parse_celda_numerica, NumeroAmbiguoError, NumeroInvalidoError, CeldaErrorExcelError


def test_numero_nativo_float_no_pasa_por_el_normalizador_de_texto():
    # 634.0 nativo -> Decimal(str(634.0)) directo, sin importar convencion.
    assert _parse_celda_numerica(634.0, convencion=None) == Decimal("634.0")


def test_numero_nativo_int_no_pasa_por_el_normalizador_de_texto():
    assert _parse_celda_numerica(1234, convencion=None) == Decimal("1234")


def test_texto_si_pasa_por_el_normalizador():
    assert _parse_celda_numerica("634,00", convencion=None) == Decimal("634.00")


def test_texto_ambiguo_sin_convencion_lanza_error_de_ambiguedad():
    with pytest.raises(NumeroAmbiguoError):
        _parse_celda_numerica("1.234", convencion=None)


def test_texto_ambiguo_con_convencion_se_resuelve():
    assert _parse_celda_numerica("1.234", convencion="coma") == Decimal("1234")
    assert _parse_celda_numerica("1.234", convencion="punto") == Decimal("1.234")


def test_celda_de_error_excel_lanza_error_especifico():
    with pytest.raises(CeldaErrorExcelError):
        _parse_celda_numerica("#REF!", convencion=None)


def test_celda_vacia_lanza_error():
    with pytest.raises(ValueError):
        _parse_celda_numerica(None, convencion=None)


def test_bool_no_se_trata_como_numero_valido():
    # bool es subclase de int en Python -- este caso existe justo para que
    # una celda booleana de Excel no se cuele como 0/1.
    with pytest.raises(ValueError):
        _parse_celda_numerica(True, convencion=None)


def test_float_con_ruido_binario_se_limpia_a_lo_que_excel_realmente_muestra():
    # Reporte real: Excel mostraba "2.3" pero el float64 subyacente (típico
    # de una celda que viene de una fórmula) traía ruido de punto flotante
    # -- antes del fix, Decimal(str(2.1 + 0.2)) se colaba tal cual.
    ruidoso = 2.1 + 0.2
    assert str(ruidoso) != "2.3"  # confirma que el float de prueba SÍ tiene el ruido típico
    assert _parse_celda_numerica(ruidoso, convencion=None) == Decimal("2.3")


def test_float_limpio_no_se_ve_afectado_por_el_redondeo_de_ruido():
    assert _parse_celda_numerica(2.3, convencion=None) == Decimal("2.3")


def test_float_se_redondea_a_2_decimales():
    assert _parse_celda_numerica(1.23456, convencion=None) == Decimal("1.23")
