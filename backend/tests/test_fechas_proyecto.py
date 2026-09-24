"""Fechas del proyecto (X-04 / A-08 / K-05): "hoy" en la zona del proyecto (nunca
UTC), semana lunes-domingo y eventos de todo el día. Pruebas puras: sin Mongo."""
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_fechas_proyecto")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

CDMX = ZoneInfo("America/Mexico_City")


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


def test_hoy_no_es_el_dia_utc():
    # 23 sep 2026, 21:30 en CDMX = 24 sep 03:30 UTC. "Hoy" para el proyecto sigue siendo 23.
    ahora = utc(2026, 9, 24, 3, 30)
    assert server.hoy_proyecto(None, ahora) == date(2026, 9, 23)
    assert ahora.date() == date(2026, 9, 24)  # lo que daría UTC (el bug)


def test_hoy_respeta_la_zona_del_proyecto():
    ahora = utc(2026, 9, 24, 3, 30)
    assert server.hoy_proyecto({"zona_horaria": "America/Tijuana"}, ahora) == date(2026, 9, 23)
    assert server.hoy_proyecto({"zona_horaria": "Europe/Madrid"}, ahora) == date(2026, 9, 24)


def test_zona_invalida_cae_a_cdmx_y_se_valida_al_guardar():
    assert server.zona_proyecto({"zona_horaria": "No/Existe"}) == server.MX_TZ
    with pytest.raises(ValueError):
        server.validar_zona_horaria("No/Existe")
    assert server.validar_zona_horaria("America/Cancun") == "America/Cancun"
    assert server.validar_zona_horaria("  ") is None


def test_offset_de_cdmx_es_menos_360_y_el_de_tijuana_cambia_con_el_horario_de_verano():
    assert server.offset_min_proyecto(None, utc(2026, 9, 23, 12)) == -360
    assert server.offset_min_proyecto({"zona_horaria": "America/Tijuana"}, utc(2026, 9, 23, 12)) == -420
    assert server.offset_min_proyecto({"zona_horaria": "America/Tijuana"}, utc(2026, 12, 23, 12)) == -480


def test_inicio_de_dia_es_medianoche_local_en_utc():
    assert server.inicio_dia_utc(date(2026, 9, 23)) == utc(2026, 9, 23, 6)
    assert server.inicio_dia_utc(date(2026, 9, 23), {"zona_horaria": "America/Tijuana"}) == utc(2026, 9, 23, 7)


def test_semana_va_de_lunes_a_domingo():
    miercoles = date(2026, 9, 23)
    assert server.semana_de(miercoles) == (date(2026, 9, 21), date(2026, 9, 27))
    assert server.semana_de(date(2026, 9, 27)) == (date(2026, 9, 21), date(2026, 9, 27))  # domingo
    assert server.semana_de(date(2026, 9, 21)) == (date(2026, 9, 21), date(2026, 9, 27))  # lunes
    assert server.inicio_semana(miercoles).weekday() == 0


def test_semana_respeta_el_dia_de_inicio_del_proyecto():
    # El plan de referencia corta sábado a sábado.
    assert server.semana_de(date(2026, 9, 23), "SABADO") == (date(2026, 9, 19), date(2026, 9, 25))
    assert server.inicio_semana(date(2026, 9, 26), "SABADO") == date(2026, 9, 26)


def test_inicio_de_semana_local_es_lunes_00_00():
    now_local = datetime(2026, 9, 23, 17, 45, tzinfo=CDMX)
    ini = server._inicio_semana_local(now_local)
    assert (ini.year, ini.month, ini.day, ini.hour, ini.weekday()) == (2026, 9, 21, 0, 0)


def test_evento_de_solo_fecha_no_sale_a_las_18_del_dia_anterior():
    """Bug: `fromisoformat('2026-09-23').replace(tzinfo=utc)` = 00:00 UTC = 18:00 del 22 en CDMX."""
    dt = server._evento_dia_completo("2026-09-23", None)
    local = dt.astimezone(CDMX)
    assert (local.year, local.month, local.day, local.hour, local.minute) == (2026, 9, 23, 0, 0)
    # el comportamiento viejo, para dejar constancia del bug que se corrigió:
    viejo = datetime.fromisoformat("2026-09-23").replace(tzinfo=timezone.utc).astimezone(CDMX)
    assert (viejo.day, viejo.hour) == (22, 18)


def test_evento_de_solo_fecha_acepta_fecha_con_hora():
    assert server._evento_dia_completo("2026-09-23T00:00:00", None) == utc(2026, 9, 23, 6)


def test_evento_out_marca_all_day_por_defecto():
    assert server._event_out({"_id": 1, "title": "x"})["all_day"] is False
    assert server._event_out({"all_day": True})["all_day"] is True


def test_parse_iso_sin_zona_usa_la_del_proyecto():
    dt = server._parse_iso("2026-09-23T09:00:00", CDMX)
    assert dt.astimezone(timezone.utc) == utc(2026, 9, 23, 15)
    # con zona explícita no se toca
    assert server._parse_iso("2026-09-23T15:00:00Z", CDMX) == utc(2026, 9, 23, 15)


def test_project_public_expone_hoy_y_offset():
    p = server._project_public({"id": "p", "name": "x"})
    assert p["zona_horaria"] == "America/Mexico_City"
    assert p["tz_offset_min"] == -360
    assert len(p["hoy"]) == 10 and p["hoy"][4] == "-"


def test_zona_horaria_invalida_se_rechaza_con_400_y_no_se_sustituye():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        server._zona_o_400("Mordor/Barad-dur")
    assert e.value.status_code == 400 and "Mordor/Barad-dur" in e.value.detail
    assert server._zona_o_400(None) == "America/Mexico_City"
    assert server._zona_o_400("America/Tijuana") == "America/Tijuana"
