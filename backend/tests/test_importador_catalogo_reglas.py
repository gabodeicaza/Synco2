"""Reglas nuevas del importador de catálogo (Fase 2): C-04 unidades personalizadas,
C-07 advertencias de unidad vacía y P.U. en 0, C-08 duplicados con gemela válida,
C-09 clave sin el prefijo de su padre y C-13 convención decimal desde columnas
numéricas. Pruebas puras: sin HTTP ni Mongo."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_importador_reglas")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import (  # noqa: E402
    ImportMappingIn, _calcular_vista_filas, _map_unidad_con_flag, _validar_archivo_completo,
    candidatos_numericos_de_hoja, detectar_convencion, detectar_convencion_archivo, detectar_convencion_hoja,
)

HEADERS = ["Clave", "Descripcion", "Unidad", "Cantidad", "PU"]
MAPPING = ImportMappingIn(clave="Clave", descripcion="Descripcion", unidad="Unidad", cantidad="Cantidad", precio_unitario="PU")
MAPPING_SIN_UNIDAD = ImportMappingIn(clave="Clave", descripcion="Descripcion", cantidad="Cantidad", precio_unitario="PU")


def _validar(data_rows, mapping=MAPPING, personalizadas=None, convencion=None):
    return _validar_archivo_completo(
        [HEADERS] + data_rows, 0, mapping, convencion, {}, unidades_personalizadas=personalizadas or [],
    )


def _tipos(fila):
    return {p["tipo"] for p in fila["problemas_activos"]}


# ============================================================================
# C-04: unidades personalizadas del proyecto
# ============================================================================
def test_unidad_personalizada_se_reconoce_sin_acentos_ni_mayusculas():
    assert _map_unidad_con_flag("saco", ["SACO"]) == ("SACO", True)
    assert _map_unidad_con_flag("Tramo", ["TRAMO"]) == ("TRAMO", True)
    assert _map_unidad_con_flag("COSTAL", []) == ("UNIVERSAL", False)


def test_importador_acepta_unidad_personalizada_del_proyecto_sin_advertencia():
    filas = _validar([["A1", "Concepto A", "saco", "10", "50.00"]], personalizadas=["SACO"])
    vista = _calcular_vista_filas(filas, {})
    assert vista[0]["unidad"] == "SACO"
    assert vista[0]["estado"] == "ok"


def test_unidad_personalizada_de_otro_proyecto_sigue_siendo_advertencia():
    filas = _validar([["A1", "Concepto A", "saco", "10", "50.00"]], personalizadas=[])
    vista = _calcular_vista_filas(filas, {})
    assert vista[0]["estado"] == "advertencia"
    assert "unidad_no_reconocida" in _tipos(vista[0])


# ============================================================================
# C-07: unidad vacía y P.U. en 0 avisan, no bloquean
# ============================================================================
def test_unidad_vacia_es_advertencia():
    vista = _calcular_vista_filas(_validar([["A1", "Concepto A", "", "10", "50.00"]]), {})
    assert vista[0]["estado"] == "advertencia"
    assert "unidad_vacia" in _tipos(vista[0])
    assert vista[0]["unidad_efectiva"] == "UNIVERSAL"


def test_columna_de_unidad_sin_mapear_no_genera_aviso_por_cada_fila():
    vista = _calcular_vista_filas(_validar([["A1", "Concepto A", None, "10", "50.00"]], mapping=MAPPING_SIN_UNIDAD), {})
    assert vista[0]["estado"] == "ok"


def test_corregir_la_unidad_resuelve_la_advertencia():
    filas = _validar([["A1", "Concepto A", "", "10", "50.00"]])
    vista = _calcular_vista_filas(filas, {str(filas[0]["fila"]): {"unidad": "M2"}})
    assert vista[0]["estado"] == "ok"
    assert vista[0]["unidad_efectiva"] == "M2"


def test_precio_unitario_cero_es_advertencia_no_error():
    vista = _calcular_vista_filas(_validar([["A1", "Concepto A", "PZA", "10", "0"]]), {})
    assert vista[0]["estado"] == "advertencia"
    assert "precio_unitario_cero" in _tipos(vista[0])


def test_precio_unitario_distinto_de_cero_no_avisa():
    vista = _calcular_vista_filas(_validar([["A1", "Concepto A", "PZA", "10", "0.01"]]), {})
    assert vista[0]["estado"] == "ok"


def test_corregir_el_precio_resuelve_la_advertencia_de_cero():
    filas = _validar([["A1", "Concepto A", "PZA", "10", "0"]])
    vista = _calcular_vista_filas(filas, {str(filas[0]["fila"]): {"precio_unitario": "25.00"}})
    assert vista[0]["estado"] == "ok"


# ============================================================================
# C-08: una fila duplicada se omite SOLO si su gemela es válida
# ============================================================================
def test_gemela_valida_se_conserva_y_la_repetida_se_omite():
    vista = _calcular_vista_filas(_validar([
        ["A1", "Primera", "PZA", "10", "50.00"],
        ["A1", "Segunda", "PZA", "20", "60.00"],
    ]), {})
    assert [f["estado"] for f in vista] == ["ok", "duplicado"]
    assert "clave_duplicada_archivo" in _tipos(vista[1])


def test_si_la_primera_es_invalida_la_valida_es_la_gemela_y_la_invalida_no_se_pierde_en_silencio():
    vista = _calcular_vista_filas(_validar([
        ["A1", "Primera", "PZA", "abc", "50.00"],
        ["A1", "Segunda", "PZA", "20", "60.00"],
    ]), {})
    assert vista[1]["estado"] == "ok"
    assert vista[0]["estado"] == "error"  # sigue visible con su error, no se oculta como duplicado


def test_sin_gemela_valida_todas_quedan_en_error_para_revision():
    vista = _calcular_vista_filas(_validar([
        ["A1", "Primera", "PZA", "abc", "50.00"],
        ["A1", "Segunda", "PZA", "", "60.00"],
    ]), {})
    assert [f["estado"] for f in vista] == ["error", "error"]
    assert all("clave_duplicada_sin_gemela_valida" in _tipos(f) for f in vista)


def test_corregir_una_repetida_invalida_hace_que_la_otra_pase_a_omitirse():
    filas = _validar([
        ["A1", "Primera", "PZA", "abc", "50.00"],
        ["A1", "Segunda", "PZA", "", "60.00"],
    ])
    correcciones = {str(filas[0]["fila"]): {"cantidad": "10"}, str(filas[1]["fila"]): {"cantidad": "20"}}
    vista = _calcular_vista_filas(filas, correcciones)
    assert [f["estado"] for f in vista] == ["ok", "duplicado"]


def test_tres_repetidas_conservan_solo_la_primera_valida():
    vista = _calcular_vista_filas(_validar([
        ["A1", "Uno", "PZA", "1", "1"],
        ["A1", "Dos", "PZA", "2", "2"],
        ["A1", "Tres", "PZA", "3", "3"],
    ]), {})
    assert [f["estado"] for f in vista] == ["ok", "duplicado", "duplicado"]


# ============================================================================
# C-09: la clave debe llevar el prefijo de su partida padre
# ============================================================================
CONTEXTO_DESTINO = {"tiene_destino": True, "destino_clave": "3.3", "claves_partida_existentes": ["3", "3.3"]}


def test_clave_sin_prefijo_del_padre_avisa():
    vista = _calcular_vista_filas(_validar([["7.1", "Concepto", "PZA", "10", "5"]]), {}, contexto=CONTEXTO_DESTINO)
    assert vista[0]["estado"] == "advertencia"
    assert "clave_sin_prefijo_padre" in _tipos(vista[0])
    assert "3.3" in next(p["motivo"] for p in vista[0]["problemas_activos"] if p["tipo"] == "clave_sin_prefijo_padre")


def test_clave_con_prefijo_del_padre_no_avisa():
    vista = _calcular_vista_filas(_validar([["3.3.1", "Concepto", "PZA", "10", "5"]]), {}, contexto=CONTEXTO_DESTINO)
    assert vista[0]["estado"] == "ok"


def test_clave_plana_sin_jerarquia_no_avisa():
    vista = _calcular_vista_filas(_validar([["A1", "Concepto", "PZA", "10", "5"]]), {}, contexto=CONTEXTO_DESTINO)
    assert vista[0]["estado"] == "ok"


def test_sin_partida_destino_no_se_evalua_el_prefijo():
    contexto = {"tiene_destino": False, "claves_partida_existentes": ["3"]}
    vista = _calcular_vista_filas(_validar([["3.1", "Concepto", "PZA", "10", "5"]]), {}, contexto=contexto)
    assert vista[0]["estado"] == "ok"


# ============================================================================
# C-13: la convención decimal sale de celdas de columnas numéricas
# ============================================================================
def _hoja(filas):
    return [HEADERS] + filas


def test_las_claves_con_puntos_ya_no_votan_por_coma_decimal():
    hoja = _hoja([
        ["1.1.1", "Concepto A", "PZA", 10, 5],
        ["1.1.2", "Concepto B", "PZA", 20, 6],
        ["1.1.3", "Concepto C", "PZA", 30, 7],
        ["1.1.4", "Concepto D", "PZA", "1,500.25", 8],
    ])
    todas_las_celdas = [c for fila in hoja for c in fila]
    assert detectar_convencion(todas_las_celdas) == "coma"  # el error de antes: las claves ganaban
    assert detectar_convencion_hoja(hoja, 0, MAPPING) == "punto"


def test_una_hoja_con_solo_numeros_nativos_no_da_convencion():
    hoja = _hoja([["1.1.1", "Concepto A", "PZA", 1500.25, 10.5], ["1.1.2", "Concepto B", "PZA", 2000, 20.0]])
    assert detectar_convencion_hoja(hoja, 0, MAPPING) is None


def test_solo_cuentan_las_columnas_cantidad_pu_e_importe():
    hoja = _hoja([["1.1.1", "Ver 1.234.567", "PZA", "10", "5"]])
    assert candidatos_numericos_de_hoja(hoja, 0, MAPPING) == ["10", "5"]


def test_coma_decimal_en_las_columnas_numericas_se_detecta():
    hoja = _hoja([["1.1", "Concepto", "PZA", "1.500,25", "10,50"]])
    assert detectar_convencion_hoja(hoja, 0, MAPPING) == "coma"


def test_mapeo_como_diccionario_y_columna_inexistente():
    hoja = _hoja([["A", "B", "PZA", "1,500.25", "1"]])
    assert detectar_convencion_hoja(hoja, 0, {"cantidad": "Cantidad", "precio_unitario": "No existe"}) == "punto"
    assert detectar_convencion_hoja([], 0, MAPPING) is None
    assert detectar_convencion_hoja(hoja, 9, MAPPING) is None


def test_convencion_al_subir_el_archivo_usa_el_mapeo_propuesto():
    sheets = {"Hoja1": [
        ["Clave", "Descripción", "Unidad", "Cantidad", "Precio unitario"],
        ["1.1.1", "Concepto A", "PZA", "1,500.25", "10.50"],
        ["1.1.2", "Concepto B", "PZA", "3,000.75", "20.00"],
    ]}
    assert detectar_convencion_archivo(sheets) == "punto"
    assert detectar_convencion_archivo({"Vacia": []}) is None
