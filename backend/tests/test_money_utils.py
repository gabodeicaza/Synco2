"""Test unitario de los helpers de dinero/cantidades (money_utils se fusionó
dentro de server.py — el despliegue de producción solo copia ese archivo)."""
import os
import sys
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_money_utils")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import to_decimal, round_money, compute_importe, sum_decimales


def test_to_decimal_rechaza_float():
    with pytest.raises(TypeError):
        to_decimal(12.5)


def test_to_decimal_acepta_string():
    assert to_decimal("12.50") == Decimal("12.50")


def test_compute_importe_sin_redondear_intermedio():
    # 3 * 0.111 = 0.333 exacto, no debe perder precisión por redondeo intermedio.
    importe = compute_importe("3", "0.111")
    assert importe == Decimal("0.333")


def test_round_money_half_up():
    assert round_money("10.005") == Decimal("10.01")
    assert round_money("10.004") == Decimal("10.00")


def test_sum_decimales_exacta():
    assert sum_decimales(["0.1", "0.1", "0.1"]) == Decimal("0.3")
