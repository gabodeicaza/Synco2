"""A-04 y A-05. A-04: CV (variación de costo) es None mientras AC = 0, igual que el CPI.
A-05: la sección Financiero de la Presentación usa el mismo servicio y el mismo periodo que el
tablero EVM. Pruebas puras con un `db` falso: sin Mongo ni backend vivo."""
import asyncio
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_finanzas_periodo_presentacion")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

D = Decimal
PROYECTO = {"id": "p1", "name": "Demo", "modo_avance": "CANTIDAD"}


class Cur:
    def __init__(self, docs):
        self.docs = list(docs)

    async def to_list(self, length=None):
        return list(self.docs)

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()

    def sort(self, *a, **k):
        return self


def _col(docs=None, one=None):
    c = MagicMock()
    c.find = MagicMock(side_effect=lambda *a, **k: Cur(docs or []))
    c.find_one = AsyncMock(return_value=one)
    return c


def concepto(cid, importe, ini, fin, meta="10"):
    return {
        "id": cid, "project_id": "p1", "clave": cid, "descripcion": "x", "unidad": "M3",
        "cantidad": "0", "precio_unitario": "0", "meta_cantidad": meta,
        "importe_total_editable": importe, "fecha_inicio": ini, "fecha_fin": fin,
        "created_at": datetime(2026, 1, 1), "activo": True,
    }


def avance(cid, fecha, importe):
    return {
        "id": f"a-{cid}-{fecha}", "project_id": "p1", "concepto_id": cid, "fecha": fecha,
        "cantidad_ejecutada": "1", "tipo": "normal",
        "precio_unitario_congelado": importe, "importe_ganado_congelado": importe,
        "creado_en": datetime(2026, 9, 1, 12, 0),
    }


def gasto(fecha, monto):
    return {"id": f"g-{fecha}", "project_id": "p1", "fecha": fecha, "monto": monto}


def usar_db(conceptos, avances=(), gastos=()):
    db = MagicMock()
    db.projects = _col(one=dict(PROYECTO))
    db.conceptos = _col(docs=conceptos)
    db.registros_avance = _col(docs=list(avances))
    db.gastos_reales = _col(docs=list(gastos))
    db.programa_versiones = _col(docs=[])
    db.programa_distribucion = _col(docs=[])
    server.db = db
    return db


def datos_de_obra(con_gastos=True):
    conceptos = [
        concepto("c1", "1000", "2026-08-01", "2026-10-31"),
        concepto("c2", "500.50", "2026-09-01", "2026-09-30"),
    ]
    avances = [avance("c1", "2026-08-15", "100"), avance("c1", "2026-09-10", "200"), avance("c2", "2026-09-20", "50.25")]
    gastos = [gasto("2026-08-20", "80"), gasto("2026-09-12", "120.75")] if con_gastos else []
    return conceptos, avances, gastos


# ------------------------------------------------------------------ resolver_rango_periodo
class TestResolverRango:
    def test_mes_actual_va_del_dia_1_a_la_fecha(self):
        assert server.resolver_rango_periodo("mes_actual", date(2026, 9, 24)) == ("2026-09-01", "2026-09-24")

    def test_sin_periodo_es_mes_actual(self):
        assert server.resolver_rango_periodo(None, date(2026, 9, 24)) == ("2026-09-01", "2026-09-24")

    def test_ultimos_3_meses(self):
        assert server.resolver_rango_periodo("ultimos_3_meses", date(2026, 9, 24)) == ("2026-06-01", "2026-09-24")

    def test_ultimos_3_meses_cruza_el_anio(self):
        assert server.resolver_rango_periodo("ultimos_3_meses", date(2026, 2, 10)) == ("2025-11-01", "2026-02-10")
        assert server.resolver_rango_periodo("ultimos_3_meses", date(2026, 3, 31)) == ("2025-12-01", "2026-03-31")

    def test_proyecto_completo_arranca_en_el_primer_mes_con_datos(self):
        assert server.resolver_rango_periodo("proyecto_completo", date(2026, 9, 24), "2026-03") == ("2026-03-01", "2026-09-24")

    def test_proyecto_completo_sin_datos_arranca_el_1_de_enero(self):
        assert server.resolver_rango_periodo("proyecto_completo", date(2026, 9, 24), None) == ("2026-01-01", "2026-09-24")

    def test_si_el_primer_mes_es_posterior_a_la_fecha_no_invierte_el_rango(self):
        assert server.resolver_rango_periodo("proyecto_completo", date(2026, 2, 10), "2026-05") == ("2026-02-10", "2026-02-10")

    def test_periodo_desconocido_falla(self):
        with pytest.raises(ValueError):
            server.resolver_rango_periodo("semana", date(2026, 9, 24))


# ------------------------------------------------------------------ A-04
class TestVariacionCostoSinGasto:
    def test_con_ac_cero_el_cv_es_none_igual_que_el_cpi(self):
        conceptos, avances, _ = datos_de_obra(con_gastos=False)
        usar_db(conceptos, avances)
        r = asyncio.run(server.calcular_analisis_evm("p1", "2026-09-01", "2026-09-30"))
        assert r["ac"] == D("0")
        assert r["ev_total"] > 0  # antes el CV salía igual al EV completo
        assert r["variacion_costo"] is None
        assert r["cpi"] is None

    def test_con_gasto_el_cv_es_ev_menos_ac(self):
        conceptos, avances, gastos = datos_de_obra()
        usar_db(conceptos, avances, gastos)
        r = asyncio.run(server.calcular_analisis_evm("p1", "2026-09-01", "2026-09-30"))
        assert r["variacion_costo"] == r["ev_total"] - r["ac"]
        assert r["cpi"] is not None

    def test_las_cifras_redondeadas_conservan_none(self):
        conceptos, avances, _ = datos_de_obra(con_gastos=False)
        usar_db(conceptos, avances)
        r = asyncio.run(server.calcular_analisis_evm("p1", "2026-09-01", "2026-09-30"))
        c = server.cifras_analisis(r)
        assert c["variacion_costo"] is None
        assert c["cpi"] is None
        assert c["ac"] == D("0.00")

    def test_el_endpoint_serializa_none_no_el_ev(self, monkeypatch):
        conceptos, avances, _ = datos_de_obra(con_gastos=False)
        usar_db(conceptos, avances)
        monkeypatch.setattr(server, "ensure_project_access", AsyncMock(return_value=dict(PROYECTO)))
        out = asyncio.run(server.analisis_periodo("p1", start="2026-09-01", end="2026-09-30", user={"id": "u"}))
        assert out.variacion_costo is None
        assert out.cpi is None
        assert D(out.ev) > 0


# ------------------------------------------------------------------ A-05
def _tablero(monkeypatch, periodo, fecha):
    monkeypatch.setattr(server, "ensure_project_access", AsyncMock(return_value=dict(PROYECTO)))
    return asyncio.run(server.analisis_periodo("p1", periodo=periodo, fecha=fecha, user={"id": "u"}))


class TestPresentacionIgualQueTablero:
    @pytest.mark.parametrize("periodo", ["mes_actual", "ultimos_3_meses", "proyecto_completo"])
    @pytest.mark.parametrize("con_gastos", [True, False])
    def test_mismas_cifras_y_mismo_rango(self, monkeypatch, periodo, con_gastos):
        conceptos, avances, gastos = datos_de_obra(con_gastos)
        usar_db(conceptos, avances, gastos)
        pres = {"id": "pr1", "project_id": "p1", "fecha": "2026-09-24", "periodo_financiero": periodo}

        fin = asyncio.run(server.datos_financieros_presentacion("p1", pres, dict(PROYECTO)))
        tablero = _tablero(monkeypatch, periodo, "2026-09-24")

        assert (fin["start"], fin["end"]) == (tablero.start, tablero.end)
        c = fin["cifras"]
        for campo in ("bac", "pv", "ev", "ac", "variacion_cronograma", "variacion_costo", "ev_contractual", "ev_total",
                      "eac", "etc", "vac"):
            esperado = getattr(tablero, campo)
            obtenido = server.dec_to_str(c[campo]) if c[campo] is not None else None
            assert obtenido == esperado, campo
        for campo in ("spi", "cpi"):  # el tablero los serializa con dec_to_str
            esperado = getattr(tablero, campo)
            obtenido = server.dec_to_str(c[campo]) if c[campo] is not None else None
            assert obtenido == esperado, campo

    def test_ya_no_usa_una_ventana_de_7_dias(self, monkeypatch):
        conceptos, avances, gastos = datos_de_obra()
        usar_db(conceptos, avances, gastos)
        pres = {"id": "pr1", "project_id": "p1", "fecha": "2026-09-24"}
        fin = asyncio.run(server.datos_financieros_presentacion("p1", pres, dict(PROYECTO)))
        assert (fin["start"], fin["end"]) == ("2026-09-01", "2026-09-24")

    def test_sin_el_campo_o_con_uno_invalido_usa_mes_actual(self):
        conceptos, avances, gastos = datos_de_obra()
        usar_db(conceptos, avances, gastos)
        for pres in ({"fecha": "2026-09-24"}, {"fecha": "2026-09-24", "periodo_financiero": "otro"}):
            fin = asyncio.run(server.datos_financieros_presentacion("p1", pres, dict(PROYECTO)))
            assert fin["periodo"] == "mes_actual"

    def test_proyecto_completo_arranca_en_el_primer_mes_con_datos_del_proyecto(self):
        conceptos, avances, gastos = datos_de_obra()
        usar_db(conceptos, avances, gastos)
        pres = {"fecha": "2026-09-24", "periodo_financiero": "proyecto_completo"}
        fin = asyncio.run(server.datos_financieros_presentacion("p1", pres, dict(PROYECTO)))
        assert fin["start"] == "2026-08-01"

    def test_el_tablero_acepta_el_periodo_y_rechaza_uno_desconocido(self, monkeypatch):
        conceptos, avances, gastos = datos_de_obra()
        usar_db(conceptos, avances, gastos)
        monkeypatch.setattr(server, "ensure_project_access", AsyncMock(return_value=dict(PROYECTO)))
        with pytest.raises(server.HTTPException) as e:
            asyncio.run(server.analisis_periodo("p1", periodo="semana", user={"id": "u"}))
        assert e.value.status_code == 400
        with pytest.raises(server.HTTPException) as e:
            asyncio.run(server.analisis_periodo("p1", user={"id": "u"}))
        assert e.value.status_code == 400


class TestModeloDePresentacion:
    def test_periodo_por_defecto_y_valores_validos(self):
        assert server.PresentacionIn(project_id="p1", fecha="2026-09-24").periodo_financiero == "mes_actual"
        assert server.PresentacionIn(
            project_id="p1", fecha="2026-09-24", periodo_financiero="ultimos_3_meses"
        ).periodo_financiero == "ultimos_3_meses"
        assert server.PresentacionPatch().periodo_financiero is None

    def test_rechaza_un_periodo_desconocido(self):
        with pytest.raises(ValidationError):
            server.PresentacionIn(project_id="p1", fecha="2026-09-24", periodo_financiero="semana")
        with pytest.raises(ValidationError):
            server.PresentacionPatch(periodo_financiero="semana")
