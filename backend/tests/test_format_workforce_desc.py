"""Test unitario puro de `_format_workforce_desc` — server.py.

Fija el comportamiento reportado como bug: entradas de `equipment`
capturadas como "Tipo :: Marca :: Modelo :: Serie" se imprimían con el
separador " :: " literal en las tablas MAQUINARIA Y EQUIPO/PERSONAL del
PDF/PPTX (ej. "martillo neumático :: :: :: ::") porque `_measure`/
`_measure_rows` (motor PDF) usaban `r.get("desc")` crudo en vez de pasarlo
por `_format_workforce_desc` — ya lo hacían correctamente `_draw_mini_table`
y `_draw_big_table` (motor PPTX). Ver el fix en `draw_subtramo_summary_page`
y `_emit_recuento_general` (server.py).

Mismo patrón que los demás test_actividades_*.py: importa server.py directo
con env vars dummy, sin HTTP ni Mongo.
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_format_workforce_desc")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import _format_workforce_desc  # noqa: E402


def test_sin_separador_personal_se_devuelve_tal_cual_sin_segunda_linea():
    # Personal se captura sin " :: " — ej. tras `_parse_qty_desc("3 Ayudante (S2)")`.
    assert _format_workforce_desc("Ayudante (S2)") == ("Ayudante (S2)", None)
    assert _format_workforce_desc("ING. Civil") == ("ING. Civil", None)


def test_con_separador_equipo_completo_separa_serie_y_no_deja_el_separador():
    main, serie = _format_workforce_desc("Excavadora :: CAT :: 320GX :: EX-318")
    assert main == "Excavadora CAT 320GX"
    assert serie == "EX-318"
    assert "::" not in main
    assert "::" not in (serie or "")


def test_reporte_de_bug_martillo_neumatico_no_imprime_el_separador():
    """Caso literal del reporte: segmentos Marca/Modelo/Serie vacíos —
    antes del fix se imprimía 'martillo neumático :: :: :: ::'."""
    main, serie = _format_workforce_desc("martillo neumático ::  ::  :: ")
    assert main == "martillo neumático"
    assert serie is None
    assert "::" not in main


def test_segmentos_vacios_intermedios_se_descartan_y_el_ultimo_no_vacio_es_la_serie():
    # Tipo="Excavadora", Marca="" (vacío, se descarta), Modelo="320GX",
    # Serie="" (vacío) — quedan 2 partes no vacías tras filtrar; la función
    # trata SIEMPRE el último segmento no vacío restante como "serie"
    # (documentado en `_format_workforce_desc`), aunque semánticamente aquí
    # venía del campo Modelo, no Serie.
    main, serie = _format_workforce_desc("Excavadora ::  :: 320GX :: ")
    assert main == "Excavadora"
    assert serie == "320GX"
    assert "::" not in main


def test_solo_dos_de_cuatro_segmentos_con_contenido():
    main, serie = _format_workforce_desc("Grúa ::  ::  :: GR-09")
    assert main == "Grúa"
    assert serie == "GR-09"


def test_separador_suelto_sin_ningun_contenido_no_deja_dos_puntos_sueltos():
    main, serie = _format_workforce_desc("Martillo :: :: :: ::")
    assert "::" not in main
    assert serie is None


def test_vacio_o_none_no_revienta():
    assert _format_workforce_desc("") == ("", None)
    assert _format_workforce_desc(None) == ("", None)


def test_un_solo_segmento_tras_split_no_se_trata_como_serie():
    # " :: " está presente pero produce un solo segmento con contenido tras
    # descartar vacíos — no debe haber "serie" (necesita al menos 2 partes).
    main, serie = _format_workforce_desc("Compresor ::  ::  ::  ")
    assert main == "Compresor"
    assert serie is None
