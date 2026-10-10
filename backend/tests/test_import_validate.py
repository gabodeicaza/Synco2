"""Tests puros (sin HTTP, sin Mongo real) de la Etapa 3: validación completa
del archivo, overlay de correcciones y estado efectivo por fila.
"""
import copy
import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_import_validate")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

from server import (
    _validar_archivo_completo, _calcular_vista_filas, _resumen_de_vista, ImportMappingIn, _fila_parece_encabezado,
)

HEADERS = ["Clave", "Descripcion", "Unidad", "Cantidad", "PU", "Importe"]
MAPPING = ImportMappingIn(clave="Clave", descripcion="Descripcion", unidad="Unidad", cantidad="Cantidad", precio_unitario="PU", importe="Importe")
MAPPING_SIN_IMPORTE = ImportMappingIn(clave="Clave", descripcion="Descripcion", unidad="Unidad", cantidad="Cantidad", precio_unitario="PU")


def _sheet(data_rows):
    return [HEADERS] + data_rows


def _validar(data_rows, convencion=None, existing_by_clave=None, mapping=MAPPING_SIN_IMPORTE):
    return _validar_archivo_completo(_sheet(data_rows), 0, mapping, convencion, existing_by_clave or {})


def _por_clave(filas, clave):
    return next(f for f in filas if f["clave"] == clave)


# ============================================================================
# Celda de error de Excel no bloquea el resto
# ============================================================================
def test_celda_de_error_excel_no_impide_validar_el_resto():
    filas = _validar([
        ["A1", "Concepto A", "PZA", "10", "50.00"],
        ["B1", "Concepto B", "PZA", "#REF!", "50.00"],
        ["C1", "Concepto C", "PZA", "20", "30.00"],
    ])
    vista = _calcular_vista_filas(filas, {})
    resumen = _resumen_de_vista(vista)

    assert _por_clave(vista, "A1")["estado"] == "ok"
    assert _por_clave(vista, "C1")["estado"] == "ok"
    fila_b = _por_clave(vista, "B1")
    assert fila_b["estado"] == "error"
    assert any(p["tipo"] == "excel_error" for p in fila_b["problemas_activos"])
    assert resumen == {"total": 3, "ok": 2, "advertencia": 0, "error": 1, "duplicado": 0, "descartado": 0}


# ============================================================================
# Número ambiguo expone las dos lecturas, no adivina
# ============================================================================
def test_numero_ambiguo_expone_las_dos_lecturas_posibles():
    filas = _validar([["A1", "Concepto A", "PZA", "1.234", "50.00"]])
    vista = _calcular_vista_filas(filas, {})
    fila = vista[0]
    assert fila["estado"] == "error"
    problema = next(p for p in fila["problemas_activos"] if p["tipo"] == "numero_ambiguo")
    assert problema["campo"] == "cantidad"
    assert problema["lectura_miles"] == "1234"
    assert problema["lectura_decimal"] == "1.234"


def test_convencion_resuelve_el_ambiguo_sin_marcarlo_como_error():
    filas_coma = _validar([["A1", "Concepto A", "PZA", "1.234", "50.00"]], convencion="coma")
    assert filas_coma[0]["cantidad"] == "1234"
    assert _calcular_vista_filas(filas_coma, {})[0]["estado"] == "ok"

    filas_punto = _validar([["A1", "Concepto A", "PZA", "1.234", "50.00"]], convencion="punto")
    assert filas_punto[0]["cantidad"] == "1.234"
    assert _calcular_vista_filas(filas_punto, {})[0]["estado"] == "ok"


def test_cambiar_convencion_revalida_todas_las_filas_ambiguas():
    """Simula "aplicar esta interpretación a todas las filas ambiguas": se
    re-llama _validar_archivo_completo con una convención distinta y TODAS
    las filas ambiguas cambian de interpretación, no una por una."""
    rows = [
        ["A1", "Concepto A", "PZA", "1.234", "50.00"],
        ["B1", "Concepto B", "PZA", "5.678", "10.00"],
    ]
    con_coma = _validar(rows, convencion="coma")
    con_punto = _validar(rows, convencion="punto")

    assert [f["cantidad"] for f in con_coma] == ["1234", "5678"]
    assert [f["cantidad"] for f in con_punto] == ["1.234", "5.678"]


# ============================================================================
# Unidad no reconocida es advertencia, no error
# ============================================================================
def test_unidad_no_reconocida_es_advertencia_no_error():
    filas = _validar([["A1", "Concepto A", "COSTAL", "10", "50.00"]])
    vista = _calcular_vista_filas(filas, {})
    fila = vista[0]
    assert fila["unidad"] == "UNIVERSAL"  # fallback ya aplicado
    assert fila["estado"] == "advertencia"
    assert any(p["tipo"] == "unidad_no_reconocida" for p in fila["problemas_activos"])


# ============================================================================
# Campo obligatorio vacío
# ============================================================================
def test_descripcion_vacia_es_error():
    filas = _validar([["A1", "", "PZA", "10", "50.00"]])
    vista = _calcular_vista_filas(filas, {})
    assert vista[0]["estado"] == "error"
    assert any(p["tipo"] == "campo_obligatorio_vacio" and p["campo"] == "descripcion" for p in vista[0]["problemas_activos"])


def test_cantidad_vacia_es_campo_obligatorio_vacio_no_numero_ilegible():
    filas = _validar([["A1", "Concepto A", "PZA", "", "50.00"]])
    vista = _calcular_vista_filas(filas, {})
    assert vista[0]["estado"] == "error"
    problema = next(p for p in vista[0]["problemas_activos"] if p["campo"] == "cantidad")
    assert problema["tipo"] == "campo_obligatorio_vacio"


def test_texto_ilegible_es_numero_ilegible():
    filas = _validar([["A1", "Concepto A", "PZA", "abc", "50.00"]])
    vista = _calcular_vista_filas(filas, {})
    assert vista[0]["estado"] == "error"
    problema = next(p for p in vista[0]["problemas_activos"] if p["campo"] == "cantidad")
    assert problema["tipo"] == "numero_ilegible"


# ============================================================================
# Clave ya existente en el proyecto -> duplicado
# ============================================================================
def test_clave_existente_en_proyecto_es_duplicado():
    existentes = {"A1": {"id": "concepto-existente-1"}}
    filas = _validar([["A1", "Concepto A", "PZA", "10", "50.00"]], existing_by_clave=existentes)
    vista = _calcular_vista_filas(filas, {})
    assert vista[0]["estado"] == "duplicado"
    assert vista[0]["concepto_existente_id"] == "concepto-existente-1"
    assert any(p["tipo"] == "clave_existente_proyecto" for p in vista[0]["problemas_activos"])


# ============================================================================
# Clave duplicada DENTRO del archivo -> se recalcula dinámicamente
# ============================================================================
def test_clave_duplicada_en_archivo_conserva_la_primera_valida_y_omite_la_otra():
    # C-08: la gemela válida (la primera) se conserva; la otra se omite solo porque esa gemela existe.
    filas = _validar([
        ["A1", "Concepto A v1", "PZA", "10", "50.00"],
        ["A1", "Concepto A v2", "PZA", "20", "60.00"],
    ])
    vista = _calcular_vista_filas(filas, {})
    assert vista[0]["estado"] == "ok"
    assert vista[1]["estado"] == "duplicado"
    dup = next(p for p in vista[1]["problemas_activos"] if p["tipo"] == "clave_duplicada_archivo")
    assert dup["fila_gemela"] == vista[0]["fila"]


def test_descartar_una_fila_duplicada_deja_ok_a_la_otra():
    filas = _validar([
        ["A1", "Concepto A v1", "PZA", "10", "50.00"],
        ["A1", "Concepto A v2", "PZA", "20", "60.00"],
    ])
    fila_a_descartar = filas[0]["fila"]
    correcciones = {str(fila_a_descartar): {"descartar": True}}
    vista = _calcular_vista_filas(filas, correcciones)

    descartada = next(f for f in vista if f["fila"] == fila_a_descartar)
    sobreviviente = next(f for f in vista if f["fila"] != fila_a_descartar)
    assert descartada["estado"] == "descartado"
    assert sobreviviente["estado"] == "ok"  # se recalculó dinámicamente al quedar como única activa


# ============================================================================
# Importe: siempre se recalcula, el del archivo es solo informativo
# ============================================================================
def test_importe_que_no_coincide_es_advertencia_informativa():
    # cantidad(10) * PU(50.00) = 500.00, pero el archivo dice 999.00
    filas = _validar([["A1", "Concepto A", "PZA", "10", "50.00", "999.00"]], mapping=MAPPING)
    vista = _calcular_vista_filas(filas, {})
    fila = vista[0]
    assert fila["importe_calculado"] == "500.00"
    assert fila["estado"] == "advertencia"
    assert any(p["tipo"] == "importe_no_coincide" for p in fila["problemas_activos"])


def test_importe_que_coincide_dentro_de_tolerancia_no_genera_problema():
    filas = _validar([["A1", "Concepto A", "PZA", "10", "50.005", "500.00"]], mapping=MAPPING)
    vista = _calcular_vista_filas(filas, {})
    assert not any(p["tipo"] == "importe_no_coincide" for p in vista[0]["problemas_activos"])


# ============================================================================
# Overlay de correcciones: resuelve el problema, revertir regresa al original
# ============================================================================
def test_correccion_resuelve_ambiguo_y_revertir_regresa_al_original():
    filas = _validar([["A1", "Concepto A", "PZA", "1.234", "50.00"]])  # ambiguo sin convención
    fila_num = filas[0]["fila"]

    vista_original = _calcular_vista_filas(filas, {})
    assert vista_original[0]["estado"] == "error"
    assert vista_original[0]["cantidad_efectiva"] is None

    correcciones = {str(fila_num): {"cantidad": "1234"}}
    vista_corregida = _calcular_vista_filas(filas, correcciones)
    assert vista_corregida[0]["estado"] == "ok"
    assert vista_corregida[0]["cantidad_efectiva"] == "1234"
    # El dato inmutable de validated_rows NUNCA cambió.
    assert filas[0]["cantidad"] is None

    # Revertir = borrar la entrada del overlay (lo que hace el DELETE /rows/{fila}).
    correcciones.pop(str(fila_num), None)
    vista_revertida = _calcular_vista_filas(filas, correcciones)
    assert vista_revertida[0]["estado"] == "error"
    assert vista_revertida[0]["cantidad_efectiva"] is None


# ============================================================================
# raw_rows / validated_rows nunca se modifican
# ============================================================================
def test_validar_archivo_completo_nunca_modifica_las_filas_crudas():
    rows = _sheet([
        ["A1", "Concepto A", "PZA", "10", "50.00"],
        ["B1", "Concepto B", "PZA", "#REF!", "50.00"],
    ])
    copia = copy.deepcopy(rows)
    _validar_archivo_completo(rows, 0, MAPPING_SIN_IMPORTE, None, {})
    assert rows == copia


def test_calcular_vista_filas_nunca_modifica_validated_rows():
    filas = _validar([["A1", "Concepto A", "PZA", "1.234", "50.00"]])
    copia = copy.deepcopy(filas)
    _calcular_vista_filas(filas, {str(filas[0]["fila"]): {"cantidad": "1234", "descartar": False}})
    assert filas == copia


# ============================================================================
# _fila_parece_encabezado — heurística para proponer la fila de encabezado
# cuando el archivo trae logo/título antes (caso reportado: catálogo real)
# ============================================================================
def test_fila_de_encabezado_real_se_reconoce():
    assert _fila_parece_encabezado(["Clave", "Descripcion", "Unidad", "Cantidad", "PU"]) is True


def test_fila_de_titulo_con_una_celda_larga_no_se_reconoce():
    assert _fila_parece_encabezado(["CATÁLOGO DE CONCEPTOS — PROYECTO PERISUR", None, None, None, None]) is False


def test_fila_vacia_no_se_reconoce():
    assert _fila_parece_encabezado([None, None, None, None]) is False
    assert _fila_parece_encabezado(["", "", ""]) is False


def test_fila_de_datos_no_se_confunde_con_encabezado():
    # "3.3.1" y "10"/"50.00" son numéricos (la clave jerárquica también
    # cuenta como tal: solo dígitos y puntos), así que de las 5 celdas solo
    # 2 son texto puro ("Muro de block", "M2") -> 40% < 60%, no pasa el umbral.
    assert _fila_parece_encabezado(["3.3.1", "Muro de block", "M2", "10", "50.00"]) is False


def test_fila_solo_numeros_no_se_reconoce():
    assert _fila_parece_encabezado(["1", "2", "3", "4", "5"]) is False


def test_import_headers_propone_la_primera_fila_que_parece_encabezado():
    # Simula el caso reportado: 2 filas de logo/título, encabezado en la fila 3.
    rows = [
        ["LOGO EMPRESA CONSTRUCTORA", None, None, None],
        ["Presupuesto Proyecto Perisur — Marzo 2026", None, None, None],
        ["Clave", "Descripcion", "Cantidad", "PU"],
        ["3.1", "Trazo y nivelación", "100", "25.00"],
    ]
    propuesta = next((i for i, r in enumerate(rows[:15]) if _fila_parece_encabezado(r)), 0)
    assert propuesta == 2
