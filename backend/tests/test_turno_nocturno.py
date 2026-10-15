"""Turno nocturno del proyecto: ventana horaria única (puede cruzar la medianoche),
clasificación por hora LOCAL del proyecto y separación de reportes. Pruebas puras."""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_turno_nocturno")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

PROY = {"turno_nocturno_inicio": "20:00", "turno_nocturno_fin": "06:00"}  # CDMX = UTC-6


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


def test_hora_normaliza_y_valida():
    assert server.normalizar_hora_hhmm("8:05") == "08:05"
    assert server.normalizar_hora_hhmm("  ") is None
    assert server.normalizar_hora_hhmm(None) is None
    for malo in ("24:00", "12:60", "abc", "1200"):
        with pytest.raises(ValueError):
            server.normalizar_hora_hhmm(malo)


def test_sin_configurar_nunca_es_nocturno():
    assert not server.es_turno_nocturno(utc(2026, 9, 29, 5, 0), {})
    assert not server.es_turno_nocturno(utc(2026, 9, 29, 5, 0), {"turno_nocturno_inicio": "20:00"})
    assert not server.es_turno_nocturno(utc(2026, 9, 29, 5, 0), {"turno_nocturno_inicio": "20:00", "turno_nocturno_fin": "20:00"})


def test_ventana_que_cruza_medianoche_usa_hora_local_no_utc():
    # 20:00 CDMX = 02:00 UTC del día siguiente: dentro. 06:00 CDMX = 12:00 UTC: ya es día.
    assert server.es_turno_nocturno(utc(2026, 9, 29, 2, 0), PROY)
    assert server.es_turno_nocturno(utc(2026, 9, 29, 11, 59), PROY)   # 05:59 local
    assert not server.es_turno_nocturno(utc(2026, 9, 29, 12, 0), PROY)  # 06:00 local
    assert not server.es_turno_nocturno(utc(2026, 9, 29, 1, 59), PROY)  # 19:59 local
    assert not server.es_turno_nocturno(utc(2026, 9, 29, 18, 0), PROY)  # 12:00 local


def test_ventana_dentro_del_mismo_dia():
    p = {"turno_nocturno_inicio": "01:00", "turno_nocturno_fin": "05:00"}
    assert server.es_turno_nocturno(utc(2026, 9, 29, 8, 0), p)       # 02:00 local
    assert not server.es_turno_nocturno(utc(2026, 9, 29, 12, 0), p)  # 06:00 local


def test_separar_reportes_por_turno():
    dia = {"id": "d", "created_at": utc(2026, 9, 29, 18, 0)}
    noche = {"id": "n", "created_at": utc(2026, 9, 29, 4, 0)}  # 22:00 local
    por_nodo = {"a": [dia, noche], "b": [noche]}
    d, n = server.separar_reportes_por_turno(por_nodo, PROY)
    assert d == {"a": [dia]}
    assert n == {"a": [noche], "b": [noche]}


def _en_rango(instante, rango):
    return rango[0] <= instante <= rango[1]


def test_informe_diario_en_curso_cubre_la_noche_previa_y_deja_la_de_hoy_para_manana():
    # Hoy 16 oct 19:00 CDMX (= 17 oct 01:00 UTC). Diario nominal: 16 00:00 CDMX -> ahora.
    ahora = utc(2026, 10, 17, 1, 0)
    nominal = (utc(2026, 10, 16, 6, 0), ahora)
    rango = server.rango_reportes_con_turno(*nominal, PROY, ahora)
    assert _en_rango(utc(2026, 10, 16, 5, 0), rango)    # 15 oct 23:00 CDMX -> sale en el del 16
    assert _en_rango(utc(2026, 10, 16, 8, 0), rango)    # 16 oct 02:00 -> sale en el del 16
    assert _en_rango(utc(2026, 10, 16, 20, 0), rango)   # 16 oct 14:00 (turno de dia)
    assert not _en_rango(utc(2026, 10, 16, 1, 59), rango)  # 15 oct 19:59: lo cubrio el informe del 15


def test_informe_en_curso_no_incluye_la_noche_que_apenas_empezo():
    # Hoy 15 oct 23:00 CDMX (= 16 oct 05:00 UTC): esa captura es del informe del 16.
    ahora = utc(2026, 10, 16, 5, 0)
    rango = server.rango_reportes_con_turno(utc(2026, 10, 15, 6, 0), ahora, PROY, ahora)
    assert not _en_rango(utc(2026, 10, 16, 4, 59), rango)  # 22:59 CDMX del 15
    assert _en_rango(utc(2026, 10, 16, 1, 59), rango)      # 19:59 CDMX del 15


def test_informe_a_las_2am_incluye_lo_capturado_de_madrugada():
    ahora = utc(2026, 10, 16, 8, 0)  # 16 oct 02:00 CDMX
    rango = server.rango_reportes_con_turno(utc(2026, 10, 16, 6, 0), ahora, PROY, ahora)
    assert _en_rango(utc(2026, 10, 16, 7, 0), rango)       # 01:00 del 16
    assert _en_rango(utc(2026, 10, 16, 3, 0), rango)       # 21:00 del 15


def test_rango_cerrado_se_recorre_completo():
    ahora = utc(2026, 10, 20, 12, 0)
    ini, fin = server.rango_reportes_con_turno(utc(2026, 10, 15, 6, 0), utc(2026, 10, 16, 6, 0), PROY, ahora)
    assert ini == utc(2026, 10, 15, 2, 0) and fin == utc(2026, 10, 16, 2, 0)  # 14 20:00 -> 15 20:00 CDMX


def test_rango_sin_cambio_si_no_hay_turno_o_no_cruza_medianoche():
    ahora = utc(2026, 10, 17, 1, 0)
    nominal = (utc(2026, 10, 16, 6, 0), ahora)
    assert server.rango_reportes_con_turno(*nominal, {}, ahora) == nominal
    mismo_dia = {"turno_nocturno_inicio": "01:00", "turno_nocturno_fin": "05:00"}
    assert server.rango_reportes_con_turno(*nominal, mismo_dia, ahora) == nominal


def test_separar_sin_turno_deja_todo_en_el_dia():
    por_nodo = {"a": [{"id": "x", "created_at": utc(2026, 9, 29, 4, 0)}]}
    d, n = server.separar_reportes_por_turno(por_nodo, {})
    assert d is por_nodo and n == {}
