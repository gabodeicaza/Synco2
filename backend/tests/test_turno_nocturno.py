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


def test_separar_sin_turno_deja_todo_en_el_dia():
    por_nodo = {"a": [{"id": "x", "created_at": utc(2026, 9, 29, 4, 0)}]}
    d, n = server.separar_reportes_por_turno(por_nodo, {})
    assert d is por_nodo and n == {}
