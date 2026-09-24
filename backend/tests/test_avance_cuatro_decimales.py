"""La cantidad de avance conserva hasta 4 decimales de punta a punta (el cliente ya los admite):
el servidor no redondea ni rechaza esa precisión. Pruebas puras: sin Mongo."""
import os
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_avance_cuatro_decimales")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

HOY = date(2026, 9, 24)


def _validar(cantidad, tipo="normal", motivo=None):
    return server.validar_avance(
        tipo=tipo, cantidad=cantidad, fecha="2026-09-24", motivo=motivo, hoy=HOY, modo_avance="CANTIDAD",
    )


def test_acepta_cuatro_decimales_sin_redondear():
    q, _, _ = _validar("1.2345")
    assert q == Decimal("1.2345")
    q, _, _ = _validar("0.0001")
    assert q == Decimal("0.0001")


def test_ajuste_negativo_con_cuatro_decimales():
    q, _, motivo = _validar("-0.0002", tipo="ajuste", motivo="Se duplicó el registro")
    assert q == Decimal("-0.0002")
    assert motivo == "Se duplicó el registro"


def test_el_modelo_de_entrada_conserva_el_texto_exacto():
    registro = server.RegistroAvanceIn(concepto_id="c1", fecha="2026-09-24", cantidad_ejecutada="1234.5678")
    assert registro.cantidad_ejecutada == "1234.5678"


def test_la_suma_de_avances_es_exacta():
    assert server.dec_to_str(server.sum_decimales(["0.1", "0.2", "0.0001"])) == "0.3001"
