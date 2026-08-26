"""Tests unitarios obligatorios del normalizador de decimales de importación
(Etapa 2 del diagnóstico). import_number_parser se fusionó dentro de
server.py (el despliegue de producción solo copia ese archivo)."""
import os
import sys
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_import_number_parser")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import (
    parse_numero_texto, detectar_convencion,
    NumeroInvalidoError, NumeroAmbiguoError, CeldaErrorExcelError,
    to_decimal,
)


# ============================================================================
# Casos explícitos del diagnóstico (2.d)
# ============================================================================
@pytest.mark.parametrize("texto,esperado", [
    ("634,00", "634.00"),
    ("824,00", "824.00"),
    ("1.234,50", "1234.50"),
    ("1,234.50", "1234.50"),
    ("1.234.567", "1234567"),
    ("$ 1 234,00", "1234.00"),
    ("(1.234,50)", "-1234.50"),
])
def test_casos_explicitos(texto, esperado):
    assert parse_numero_texto(texto) == Decimal(esperado)


def test_1234_con_convencion_coma_decimal_es_mil_doscientos_treinta_y_cuatro():
    assert parse_numero_texto("1.234", convencion="coma") == Decimal("1234")


def test_1234_con_convencion_punto_decimal_es_uno_punto_dos_tres_cuatro():
    assert parse_numero_texto("1.234", convencion="punto") == Decimal("1.234")


def test_1234_sin_convencion_determinable_lanza_error_de_ambiguedad():
    with pytest.raises(NumeroAmbiguoError) as exc_info:
        parse_numero_texto("1.234")
    err = exc_info.value
    assert err.lectura_miles == Decimal("1234")
    assert err.lectura_decimal == Decimal("1.234")


@pytest.mark.parametrize("valor", ["", None, "abc"])
def test_valores_invalidos_lanzan_error(valor):
    with pytest.raises(NumeroInvalidoError):
        parse_numero_texto(valor)


def test_celda_de_error_excel_lanza_error_especifico():
    with pytest.raises(CeldaErrorExcelError) as exc_info:
        parse_numero_texto("#REF!")
    assert exc_info.value.literal == "#REF!"


@pytest.mark.parametrize("literal", ["#VALUE!", "#N/A", "#DIV/0!", "#NAME?", "#NULL!", "#NUM!"])
def test_otras_celdas_de_error_excel_tambien_se_detectan(literal):
    with pytest.raises(CeldaErrorExcelError):
        parse_numero_texto(literal)


def test_valor_numerico_nativo_no_pasa_por_este_modulo():
    """openpyxl con data_only=True entrega float/int para celdas numericas
    reales -- ese camino NUNCA debe pasar por parse_numero_texto (ver 2.a);
    lo que se prueba aqui es que el camino correcto (to_decimal(str(numero)))
    da el resultado esperado sin normalizacion de texto."""
    valor_nativo = 634.0
    assert to_decimal(str(valor_nativo)) == Decimal("634.0")
    assert to_decimal(str(valor_nativo)) == Decimal("634.00")


# ============================================================================
# Casos adicionales de robustez del algoritmo (no listados explícitamente en
# el diagnóstico, pero cubren ramas del mismo algoritmo ya especificado)
# ============================================================================
def test_entero_sin_separadores():
    assert parse_numero_texto("1234") == Decimal("1234")


def test_un_solo_digito_decimal():
    assert parse_numero_texto("634,5") == Decimal("634.5")


def test_cuatro_o_mas_digitos_decimales_no_es_ambiguo():
    assert parse_numero_texto("634,1234") == Decimal("634.1234")


def test_espacio_no_separable_como_separador_de_miles():
    #   y   son los espacios "no separables" que Excel/Numbers usan
    # como separador de miles en algunos locales.
    assert parse_numero_texto("1 234,00") == Decimal("1234.00")
    assert parse_numero_texto("1 234,00") == Decimal("1234.00")


def test_negativo_con_guion_simple():
    assert parse_numero_texto("-1.234,50") == Decimal("-1234.50")


def test_moneda_usd_y_comillas():
    assert parse_numero_texto("USD 1,234.50") == Decimal("1234.50")
    assert parse_numero_texto("'1234,00'") == Decimal("1234.00")


# ============================================================================
# detectar_convencion
# ============================================================================
def test_detectar_convencion_coma_por_caso_inequivoco_regla_2():
    # "1.234,50" es inequivoco (regla 2): coma a la derecha -> convencion coma.
    assert detectar_convencion(["1.234,50", "1.234"]) == "coma"


def test_detectar_convencion_punto_por_caso_inequivoco_regla_2():
    assert detectar_convencion(["1,234.50", "1.234"]) == "punto"


def test_detectar_convencion_por_regla_3_separador_repetido():
    # "." repetido -> es de miles -> el archivo usa coma para decimales.
    assert detectar_convencion(["1.234.567"]) == "coma"
    # "," repetido -> es de miles -> el archivo usa punto para decimales.
    assert detectar_convencion(["1,234,567"]) == "punto"


def test_detectar_convencion_por_regla_4_inequivoca():
    # "634,00" (2 digitos tras la coma) es inequivocamente decimal -> coma.
    assert detectar_convencion(["634,00", "824,00"]) == "coma"


def test_detectar_convencion_ninguna_evidencia_devuelve_none():
    assert detectar_convencion(["1.234", "5.678"]) is None  # solo casos ambiguos
    assert detectar_convencion([]) is None
    assert detectar_convencion(["1234", "5678"]) is None  # enteros simples, sin separador
    assert detectar_convencion([1234, 56.7, None]) is None  # numeros nativos, no texto


def test_detectar_convencion_ignora_celdas_de_error_y_no_numericas():
    assert detectar_convencion(["#REF!", "clave", "descripcion", "634,00"]) == "coma"
