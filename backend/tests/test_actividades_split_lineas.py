"""Test unitario puro de `_split_actividades_lineas` y de las dos funciones
que la envuelven según `FEATURE_SPLIT_ACTIVIDADES_POR_LINEA`
(`_lineas_de_bloque`, `_linea_actual_del_reporte`) — server.py. Activada
desde 2026-08-13 (ver comentario junto a la bandera en server.py: sin
confirmación directa de datos reales, decisión delegada por el usuario).

Mismo patrón que test_clave_utils.py: importa server.py directo con env
vars dummy, sin HTTP ni Mongo real — estas funciones no tocan la base de
datos (`_derive_actividades_from_reports`/`_resolve_actividad_doc`, que sí
la tocan, se cubren en los tests de integración de
test_actividades_generales.py contra un backend vivo).
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_actividades_split")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from server import (  # noqa: E402
    _split_actividades_lineas, _lineas_de_bloque, _linea_actual_del_reporte,
)


def test_bloque_de_una_sola_linea_da_un_item_identico_al_comportamiento_actual():
    assert _split_actividades_lineas("Excavación de zanja en Poste A1") == ["Excavación de zanja en Poste A1"]
    # Mismo criterio que el resto del código ya usa hoy para el bloque
    # completo: solo se recorta espacio en los extremos.
    assert _split_actividades_lineas("  Colado de losa  ") == ["Colado de losa"]


def test_tres_lineas_dan_tres_items_independientes():
    bloque = "Excavación de zanja\nColado de losa\nInstalación de poste"
    assert _split_actividades_lineas(bloque) == [
        "Excavación de zanja", "Colado de losa", "Instalación de poste",
    ]


def test_lineas_vacias_y_de_solo_espacios_se_ignoran_sin_correr_los_indices():
    bloque = "Primera actividad\n\n   \nSegunda actividad\n\t\nTercera actividad\n"
    resultado = _split_actividades_lineas(bloque)
    assert resultado == ["Primera actividad", "Segunda actividad", "Tercera actividad"]
    # El índice 1 (segundo elemento) es "Segunda actividad", NO una cadena
    # vacía ni un espacio en blanco — las líneas vacías nunca ocupan un índice.
    assert resultado[1] == "Segunda actividad"


def test_separadores_crlf_y_lf_mezclados_en_el_mismo_bloque():
    bloque = "Línea A\r\nLínea B\nLínea C\r\n\r\nLínea D"
    assert _split_actividades_lineas(bloque) == ["Línea A", "Línea B", "Línea C", "Línea D"]


def test_separador_cr_solo_tambien_se_reconoce():
    # Estilo Mac clásico (\r solo) — poco probable en captura móvil moderna,
    # pero cubierto por si algún dato legado o pegado desde otra fuente lo trae.
    assert _split_actividades_lineas("Línea A\rLínea B") == ["Línea A", "Línea B"]


def test_vinetas_escritas_a_mano_se_preservan_tal_cual():
    """Decisión de diseño (aprobada por el usuario 2026-08-12): NO se quitan
    ni normalizan viñetas que el usuario ya escribió — el parser preserva
    el texto exacto, la no-duplicación del bullet visual (si el texto ya
    empieza con '-', '•', '1.', etc.) queda anotada como requisito de la
    Etapa (c) de impresión, no de este parser."""
    bloque = "- Excavación de zanja\n• Colado de losa\n1. Instalación de poste"
    assert _split_actividades_lineas(bloque) == [
        "- Excavación de zanja", "• Colado de losa", "1. Instalación de poste",
    ]


def test_bloque_vacio_o_none_da_lista_vacia():
    assert _split_actividades_lineas("") == []
    assert _split_actividades_lineas(None) == []
    assert _split_actividades_lineas("   \n  \n\t") == []


# ============================================================================
# `_lineas_de_bloque` — único punto de la base de código que consulta la
# bandera. Con ella en True (estado actual) debe comportarse exactamente
# igual que `_split_actividades_lineas`; con ella en False, el bloque
# completo (recortado) como único elemento — el comportamiento previo a la
# bandera, para que apagarla sea instantáneo y sin sorpresas.
# ============================================================================
def test_lineas_de_bloque_con_bandera_activa_delega_en_split_lineas(monkeypatch):
    monkeypatch.setattr(server, "FEATURE_SPLIT_ACTIVIDADES_POR_LINEA", True)
    bloque = "Excavación de zanja\nColado de losa\n\nInstalación de poste"
    assert _lineas_de_bloque(bloque) == _split_actividades_lineas(bloque)
    assert _lineas_de_bloque(bloque) == ["Excavación de zanja", "Colado de losa", "Instalación de poste"]


def test_lineas_de_bloque_con_bandera_apagada_es_el_bloque_completo(monkeypatch):
    monkeypatch.setattr(server, "FEATURE_SPLIT_ACTIVIDADES_POR_LINEA", False)
    bloque = "Excavación de zanja\nColado de losa\nInstalación de poste"
    # Con la bandera apagada, el bloque multilínea NO se parte: un solo
    # item, igual que el comportamiento previo a toda esta feature.
    assert _lineas_de_bloque(bloque) == [bloque.strip()]
    assert _lineas_de_bloque("  Una sola línea  ") == ["Una sola línea"]
    assert _lineas_de_bloque("") == []
    assert _lineas_de_bloque(None) == []


# ============================================================================
# `_linea_actual_del_reporte` — usada por la detección de divergencia
# ("PUNTERO AL ORIGEN"): compara contra la línea vigente en una posición
# dada, y marca "estructura_cambio" en vez de intentar realinear si esa
# posición ya no existe.
# ============================================================================
def test_linea_actual_del_reporte_devuelve_la_linea_en_su_indice(monkeypatch):
    monkeypatch.setattr(server, "FEATURE_SPLIT_ACTIVIDADES_POR_LINEA", True)
    bloque = "Primera\nSegunda\nTercera"
    assert _linea_actual_del_reporte(bloque, 0) == ("Primera", False)
    assert _linea_actual_del_reporte(bloque, 1) == ("Segunda", False)
    assert _linea_actual_del_reporte(bloque, 2) == ("Tercera", False)


def test_linea_actual_del_reporte_marca_estructura_cambio_si_el_indice_ya_no_existe(monkeypatch):
    monkeypatch.setattr(server, "FEATURE_SPLIT_ACTIVIDADES_POR_LINEA", True)
    # El bloque se editó/recapturó y ahora tiene menos líneas: el índice 2
    # (que existía cuando se materializó la actividad) ya no existe.
    bloque_reducido = "Primera\nSegunda"
    texto, estructura_cambio = _linea_actual_del_reporte(bloque_reducido, 2)
    assert estructura_cambio is True
    assert texto is None


def test_linea_actual_del_reporte_indice_none_equivale_a_cero(monkeypatch):
    """Compatibilidad con filas materializadas ANTES de esta feature (sin
    campo `linea_idx`, modo bloque-completo): `None` se trata como 0, la
    única posición válida en ese modo."""
    monkeypatch.setattr(server, "FEATURE_SPLIT_ACTIVIDADES_POR_LINEA", False)
    assert _linea_actual_del_reporte("Un bloque de una sola línea", None) == ("Un bloque de una sola línea", False)
