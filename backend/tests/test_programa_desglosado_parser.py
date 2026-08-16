"""Tests del núcleo de parseo del "Programa desglosado" (Etapa 2 de la
Ampliación del Catálogo de Conceptos): agrupar_bloques_programa,
parse_rango_fechas_mes, extraer_distribucion_mensual_bloque,
validar_cuadre_distribucion.

Cubre las reglas explícitas del plan:
  - Cada concepto ocupa hasta 4 filas consecutivas (datos+fracción,
    porcentaje, IMPORTES, dibujo de barra). Se usa la fila de IMPORTES; la
    fila "Barra=..." se ignora sin generar error, en cualquier posición.
  - Un renglón de nivel superior sin distribución propia (fila_importes
    ausente) es válido: su curva se calcula sumando la de sus hijos.
  - La fila de rango de fechas bajo el encabezado ("DEL 8/12/25 AL
    31/12/25") fecha cada columna Mes N; no se asume que Mes 1 es enero.
  - La suma de la distribución mensual debe cuadrar con el importe del
    concepto (tolerancia 1 centavo); si no cuadra, se reporta con ambos
    valores en vez de importar en silencio.
"""
import os
import sys
from decimal import Decimal
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_programa_desglosado")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import (
    agrupar_bloques_programa,
    parse_rango_fechas_mes,
    extraer_distribucion_mensual_bloque,
    validar_cuadre_distribucion,
    to_decimal,
)

# Columnas de ejemplo: 0=Código, 1=Descripción, 2=Unidad, 3=Cantidad, 4=PU,
# 5=Importe, 6=Inicio, 7=Fin, 8=Mes1, 9=Mes2, 10=Mes3.
IDX_CODIGO = 0


# ============================================================================
# parse_rango_fechas_mes
# ============================================================================
def test_rango_fechas_mes_dos_digitos():
    assert parse_rango_fechas_mes("DEL 8/12/25 AL 31/12/25") == ("2025-12-08", "2025-12-31")


def test_rango_fechas_mes_no_asume_mes_1_enero():
    # El archivo real puede arrancar en diciembre — no debe asumirse enero.
    assert parse_rango_fechas_mes("DEL 1/12/25 AL 31/12/25") == ("2025-12-01", "2025-12-31")


def test_rango_fechas_mes_cuatro_digitos():
    assert parse_rango_fechas_mes("DEL 1/1/2026 AL 31/1/2026") == ("2026-01-01", "2026-01-31")


def test_rango_fechas_mes_texto_no_matchea_devuelve_none():
    assert parse_rango_fechas_mes("Mes 1") is None
    assert parse_rango_fechas_mes("") is None
    assert parse_rango_fechas_mes(None) is None


def test_rango_fechas_mes_fecha_invalida_devuelve_none():
    assert parse_rango_fechas_mes("DEL 31/2/25 AL 32/12/25") is None


# ============================================================================
# agrupar_bloques_programa
# ============================================================================
def test_bloque_de_4_filas_ignora_la_fila_barra():
    # fila 1 (fila_datos) trae los datos DEL CONCEPTO Y la distribución en
    # fracción en las mismas columnas de mes — no es una fila aparte.
    rows = [
        ["A101", "Trabe", "PZA", "10", "100", "1000", None, None, "0.3", "0.4", "0.3"],
        [None, None, None, None, None, None, None, None, "30", "40", "30"],
        [None, None, None, None, None, None, None, None, 300, 400, 300],
        [None, None, None, None, None, None, None, None, "Barra=22.58-100,0-…"],
    ]
    bloques = agrupar_bloques_programa(rows, IDX_CODIGO)
    assert len(bloques) == 1
    b = bloques[0]
    assert b["fila_datos"][0] == "A101"
    assert b["fila_porcentaje"] is not None
    assert b["fila_importes"][8:11] == [300, 400, 300]


def test_bloque_sin_fila_barra_tambien_funciona():
    rows = [
        ["A102", "Losa", "M2", "5", "200", "1000", None, None, "0.5", "0.5"],
        [None, None, None, None, None, None, None, None, "50", "50"],
        [None, None, None, None, None, None, None, None, "500", "500"],
        ["A103", "Muro", "M2", "1", "1", "1", None, None, "1"],
    ]
    bloques = agrupar_bloques_programa(rows, IDX_CODIGO)
    assert len(bloques) == 2
    assert bloques[0]["fila_datos"][0] == "A102"
    assert bloques[0]["fila_importes"] is not None
    assert bloques[1]["fila_datos"][0] == "A103"


def test_renglon_de_nivel_superior_sin_distribucion_propia_es_valido():
    # Un renglón "padre" que en el archivo aparece solo (su importe es la
    # suma de sus hijos, pero el archivo no le da fila de distribución
    # propia aquí) — fila_importes debe quedar None, no reventar.
    rows = [
        ["A1", "Partida raíz", "", "", "", "50000"],
        ["A101", "Trabe", "PZA", "10", "100", "1000"],
    ]
    bloques = agrupar_bloques_programa(rows, IDX_CODIGO)
    assert len(bloques) == 2
    assert bloques[0]["fila_datos"][0] == "A1"
    assert bloques[0]["fila_importes"] is None
    assert bloques[0]["fila_porcentaje"] is None


def test_barra_justo_despues_de_fila_datos_no_se_confunde_con_nuevo_concepto():
    # Caso real: la fila de barra puede venir ANTES de porcentaje/importes.
    # Su primera celda ("Barra=1-100,0-…") no está vacía, así que si se
    # revisara "¿parece un código nuevo?" antes que "¿es fila de barra?" se
    # confundiría con el siguiente concepto — por eso el chequeo de barra va
    # primero.
    rows = [
        ["A104", "Zapata", "PZA", "1", "10", "10", None, None, "0.1"],
        ["Barra=1-100,0-…"],
        [None, None, None, None, None, None, None, None, "1"],
        [None, None, None, None, None, None, None, None, "10"],
    ]
    bloques = agrupar_bloques_programa(rows, IDX_CODIGO)
    assert len(bloques) == 1
    b = bloques[0]
    assert b["fila_porcentaje"][8] == "1"
    assert b["fila_importes"][8] == "10"


def test_filas_vacias_antes_del_primer_concepto_se_ignoran():
    rows = [
        [None, None, None],
        ["", "", ""],
        ["A101", "Trabe", "PZA"],
    ]
    bloques = agrupar_bloques_programa(rows, IDX_CODIGO)
    assert len(bloques) == 1
    assert bloques[0]["fila_datos"][0] == "A101"


# ============================================================================
# extraer_distribucion_mensual_bloque
# ============================================================================
def test_extrae_de_la_fila_de_importes_no_de_fraccion_ni_porcentaje():
    # Verificado contra el archivo real: fracción/porcentaje están
    # desfasados por factores de 10 y 100 — solo importes suma exacto.
    fila_fraccion = [None] * 8 + ["0.3", "0.4", "0.3"]
    fila_porcentaje = [None] * 8 + ["30", "40", "30"]
    fila_importes = [None] * 8 + ["300", "400", "300"]
    columnas_mes = [8, 9, 10]

    valores, errores = extraer_distribucion_mensual_bloque(fila_importes, columnas_mes, "punto")
    assert errores == []
    assert valores == [to_decimal("300"), to_decimal("400"), to_decimal("300")]
    assert sum(valores) == to_decimal("1000")

    # Si por error se usara la fila de fracción o porcentaje, la suma NO
    # cuadraría con el importe del concepto (1000) — precisamente lo que la
    # validación obligatoria de cuadre debe atrapar.
    valores_fraccion, _ = extraer_distribucion_mensual_bloque(fila_fraccion, columnas_mes, "punto")
    assert sum(valores_fraccion) != to_decimal("1000")
    valores_pct, _ = extraer_distribucion_mensual_bloque(fila_porcentaje, columnas_mes, "punto")
    assert sum(valores_pct) != to_decimal("1000")


def test_fila_importes_none_da_ceros_sin_reventar():
    valores, errores = extraer_distribucion_mensual_bloque(None, [8, 9, 10], "punto")
    assert valores == [to_decimal("0"), to_decimal("0"), to_decimal("0")]
    assert errores == []


def test_celda_vacia_es_cero_celda_corrupta_es_error_no_silencioso():
    fila_importes = [None] * 8 + ["300", "", "texto-no-numerico"]
    valores, errores = extraer_distribucion_mensual_bloque(fila_importes, [8, 9, 10], "punto")
    assert valores[0] == to_decimal("300")
    assert valores[1] == to_decimal("0")  # vacío = sin actividad ese mes
    assert valores[2] == to_decimal("0")  # se sigue devolviendo 0 para no romper la suma...
    assert len(errores) == 1  # ...pero se reporta como error, no se silencia


# ============================================================================
# validar_cuadre_distribucion
# ============================================================================
def test_cuadre_exacto_no_reporta_error():
    assert validar_cuadre_distribucion(to_decimal("1000"), [to_decimal("300"), to_decimal("400"), to_decimal("300")]) is None


def test_cuadre_dentro_de_tolerancia_de_un_centavo_no_reporta_error():
    assert validar_cuadre_distribucion(to_decimal("1000.00"), [to_decimal("999.995")]) is None


def test_cuadre_fuera_de_tolerancia_reporta_ambos_valores():
    problema = validar_cuadre_distribucion(to_decimal("1000"), [to_decimal("300"), to_decimal("400")])
    assert problema is not None
    assert problema["tipo"] == "distribucion_no_cuadra"
    assert problema["importe_concepto"] == "1000.00"
    assert problema["suma_distribucion"] == "700.00"
    assert problema["diferencia"] == "300.00"
