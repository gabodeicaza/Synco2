"""A-06 Programa de obra: de un archivo con inicio/fin por concepto (o una curva planeada
mensual) al PV y al SPI. Pruebas puras con un `db` falso: sin Mongo ni backend vivo."""
import asyncio
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_programa_pv_spi")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

D = Decimal


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


def concepto(cid="c1", importe="1000", ini="2026-09-01", fin="2026-09-30", meta="10", **extra):
    d = {
        "id": cid, "project_id": "p1", "clave": cid, "descripcion": "x", "unidad": "M3",
        "cantidad": "0", "precio_unitario": "0", "meta_cantidad": meta,
        "importe_total_editable": importe, "fecha_inicio": ini, "fecha_fin": fin,
        "created_at": datetime(2026, 1, 1), "activo": True,
    }
    d.update(extra)
    return d


def avance(cid, fecha, importe):
    return {
        "id": f"a-{cid}-{fecha}", "concepto_id": cid, "fecha": fecha, "cantidad_ejecutada": "1", "tipo": "normal",
        "precio_unitario_congelado": importe, "importe_ganado_congelado": importe,
        "creado_en": datetime(2026, 9, 1, 12, 0),
    }


def usar_db(conceptos, avances=(), versiones=(), distribuciones=()):
    db = MagicMock()
    db.projects = _col(one={"id": "p1", "name": "Demo", "modo_avance": "CANTIDAD"})
    db.conceptos = _col(docs=conceptos)
    db.partidas = _col()
    db.registros_avance = _col(docs=list(avances))
    db.gastos_reales = _col(docs=[])
    db.programa_versiones = _col(docs=list(versiones))
    db.programa_distribucion = _col(docs=list(distribuciones))
    server.db = db
    return db


def analisis(start="2026-09-01", end="2026-09-30"):
    return asyncio.run(server.calcular_analisis_evm("p1", start, end))


def dist(cid, meses, version="v1"):
    return {"id": f"d-{cid}", "concepto_id": cid, "programa_version_id": version, "meses": meses}


# ------------------------------------------------------------------ programa lineal (inicio/fin)
class TestPvLineal:
    def test_ventana_completa_da_el_importe_y_media_ventana_la_mitad(self):
        c = concepto(importe="1000", ini="2026-09-01", fin="2026-09-30")
        assert server._prorrateo_concepto_en_ventana(c, date(2026, 9, 1), date(2026, 9, 30)) == D("1000")
        assert server._prorrateo_concepto_en_ventana(c, date(2026, 9, 1), date(2026, 9, 15)) == D("500")

    def test_fuera_de_la_ventana_no_aporta(self):
        c = concepto(ini="2026-09-01", fin="2026-09-30")
        assert server._prorrateo_concepto_en_ventana(c, date(2026, 10, 1), date(2026, 10, 31)) == D("0")
        assert server._prorrateo_concepto_en_ventana(c, date(2026, 8, 1), date(2026, 8, 31)) == D("0")

    def test_decimal_exacto_sin_float(self):
        c = concepto(importe="100", ini="2026-09-01", fin="2026-09-03")
        dias = [server._prorrateo_concepto_en_ventana(c, date(2026, 9, n), date(2026, 9, n)) for n in (1, 2, 3)]
        assert all(isinstance(x, Decimal) for x in dias)
        assert abs(sum(dias) - D("100")) < D("1e-20")

    def test_curva_mensual_suma_exactamente_el_importe(self):
        c = concepto(importe="1000.01", ini="2026-08-17", fin="2026-11-05")
        curva = server._curva_mensual_concepto(c)
        assert [p["mes"] for p in curva] == ["2026-08", "2026-09", "2026-10", "2026-11"]
        assert sum(D(p["valor"]) for p in curva) == D("1000.01")

    @pytest.mark.parametrize("campo", ["fecha_inicio", "fecha_fin"])
    def test_sin_fechas_no_rompe_y_no_aporta(self, campo):
        c = concepto(**{campo: None})
        assert server._prorrateo_concepto_en_ventana(c, date(2026, 9, 1), date(2026, 9, 30)) == D("0")
        assert server._curva_mensual_concepto(c) == []
        assert server._concepto_tiene_programa(c, None) is False

    def test_fechas_invertidas_no_aportan_ni_dan_curva(self):
        c = concepto(ini="2026-09-20", fin="2026-09-10")
        assert server._prorrateo_concepto_en_ventana(c, date(2026, 9, 1), date(2026, 9, 30)) == D("0")
        assert server._curva_mensual_concepto(c) == []
        assert server._concepto_tiene_programa(c, None) is False

    def test_fecha_ilegible_no_rompe(self):
        c = concepto(ini="20/09/2026")
        assert server._prorrateo_concepto_en_ventana(c, date(2026, 9, 1), date(2026, 9, 30)) == D("0")
        assert server._curva_mensual_concepto(c) == []


class TestSpiDeExtremoAExtremo:
    def test_spi_es_ev_contractual_entre_pv_a_cuatro_decimales(self):
        # PV de septiembre completo = 1000; EV contractual = 750 -> SPI 0.7500
        usar_db([concepto(importe="1000")], [avance("c1", "2026-09-10", "750")])
        r = analisis()
        assert r["pv"] == D("1000") and r["ev_contractual"] == D("750")
        assert r["spi"] == D("0.7500")
        assert r["variacion_cronograma"] == D("-250")

    def test_spi_a_media_ventana(self):
        usar_db([concepto(importe="1000")], [avance("c1", "2026-09-10", "500")])
        r = analisis("2026-09-01", "2026-09-15")
        assert r["pv"] == D("500") and r["spi"] == D("1.0000")

    def test_sin_pv_no_hay_spi(self):
        usar_db([concepto(importe="1000")], [avance("c1", "2026-09-10", "100")])
        r = analisis("2026-10-01", "2026-10-31")
        assert r["pv"] == D("0") and r["spi"] is None

    def test_un_concepto_sin_fechas_no_rompe_el_calculo_y_se_cuenta_sin_programa(self):
        usar_db([concepto("c1", "1000"), concepto("c2", "500", ini=None, fin=None)])
        r = analisis()
        assert r["pv"] == D("1000")
        assert r["conceptos_sin_programa"] == 1

    def test_conceptos_sin_avance_ni_fechas_dan_pv_cero_y_sin_spi(self):
        usar_db([concepto("c1", "1000", ini=None, fin=None)])
        r = analisis()
        assert r["pv"] == D("0") and r["spi"] is None and r["conceptos_sin_programa"] == 1


# ------------------------------------------------------------------ curva planeada mensual
MESES_1000 = [
    {"fecha_inicio": "2026-08-01", "fecha_fin": "2026-08-31", "importe": "100"},
    {"fecha_inicio": "2026-09-01", "fecha_fin": "2026-09-30", "importe": "700"},
    {"fecha_inicio": "2026-10-01", "fecha_fin": "2026-10-31", "importe": "200"},
]


class TestCurvaPlaneada:
    def test_pv_usa_la_curva_y_no_la_recta(self):
        d = dist("c1", MESES_1000)
        c = concepto(importe="1000", ini="2026-08-01", fin="2026-10-31")
        pv_curva = server._pv_de_concepto(c, d, date(2026, 9, 1), date(2026, 9, 30))
        pv_recta = server._pv_de_concepto(c, None, date(2026, 9, 1), date(2026, 9, 30))
        assert pv_curva == D("700")
        assert pv_recta != pv_curva

    def test_media_columna_prorratea_por_dias(self):
        d = dist("c1", MESES_1000)
        assert server._prorrateo_distribucion_en_ventana(d, date(2026, 9, 1), date(2026, 9, 15)) == D("350")

    def test_columna_que_cruza_meses_se_reparte_por_dias_y_suma_exacto(self):
        d = dist("c1", [{"fecha_inicio": "2026-09-16", "fecha_fin": "2026-10-15", "importe": "301.01"}])
        curva = server._curva_mensual_distribucion(d)
        assert [p["mes"] for p in curva] == ["2026-09", "2026-10"]
        assert sum(D(p["valor"]) for p in curva) == D("301.01")

    def test_meses_sin_rango_valido_se_ignoran_sin_romper(self):
        d = dist("c1", [
            {"fecha_inicio": None, "fecha_fin": None, "importe": "50"},
            {"fecha_inicio": "2026-09-30", "fecha_fin": "2026-09-01", "importe": "50"},
            {"fecha_inicio": "2026-09-01", "fecha_fin": "2026-09-30", "importe": "10"},
        ])
        assert server._prorrateo_distribucion_en_ventana(d, date(2026, 9, 1), date(2026, 9, 30)) == D("10")

    def test_la_version_vigente_alimenta_el_pv_y_el_spi(self):
        # El concepto no tiene fechas propias: solo existe su curva del programa.
        usar_db(
            [concepto("c1", "1000", ini=None, fin=None)],
            [avance("c1", "2026-09-10", "350")],
            versiones=[{"id": "v1", "project_id": "p1", "vigente": True}],
            distribuciones=[dist("c1", MESES_1000)],
        )
        r = analisis()
        assert r["pv"] == D("700") and r["spi"] == D("0.5000")
        assert r["conceptos_sin_programa"] == 0

    def test_sin_version_vigente_se_ignora_la_distribucion(self):
        usar_db(
            [concepto("c1", "1000", ini="2026-09-01", fin="2026-09-30")],
            versiones=[],
            distribuciones=[dist("c1", MESES_1000)],
        )
        assert analisis()["pv"] == D("1000")  # recta lineal, no la curva

    def test_la_curva_s_usa_la_curva_planeada(self):
        usar_db(
            [concepto("c1", "1000", ini="2026-08-01", fin="2026-10-31")],
            versiones=[{"id": "v1", "project_id": "p1", "vigente": True}],
            distribuciones=[dist("c1", MESES_1000)],
        )
        r = asyncio.run(server.analisis_periodo_curva_s("p1", user={"id": "u1", "role": server.ROLE_COORD, "project_ids": ["p1"]}))
        assert r.meses == ["2026-08", "2026-09", "2026-10"]
        assert r.planeado_acumulado == ["100.00", "800.00", "1000.00"]


# ------------------------------------------------------------------ validación de los importadores
HEADERS = ["Codigo", "Descripcion", "Importe", "Inicio", "Fin", "Mes 1", "Mes 2"]
MAPPING = server.ProgramaImportMappingIn(codigo="Codigo", importe="Importe", inicio="Inicio", fin="Fin", meses=["Mes 1", "Mes 2"])


def filas_programa(rangos, importes, inicio=None, fin=None, importe="100"):
    rows = [
        HEADERS,
        [None, None, None, None, None] + rangos,
        ["A1", "Concepto", importe, inicio, fin, "0.5", "0.5"],
        [None] * 5 + ["50", "50"],
        [None] * 5 + importes,
    ]
    return server._validar_archivo_programa_completo(rows, 0, MAPPING, "punto", {"A1": {"id": "c1"}})


def tipos(fila):
    return {p["tipo"] for p in fila["problemas"]}


class TestValidacionPrograma:
    RANGOS_OK = ["DEL 1/9/26 AL 30/9/26", "DEL 1/10/26 AL 31/10/26"]

    def test_archivo_correcto_no_trae_problemas(self):
        f = filas_programa(self.RANGOS_OK, ["50", "50"], datetime(2026, 9, 1), datetime(2026, 10, 31))[0]
        assert f["problemas"] == []

    def test_mes_con_importe_y_sin_rango_legible_es_error(self):
        f = filas_programa(["DEL 1/9/26 AL 30/9/26", "octubre"], ["50", "50"])[0]
        assert "rango_mes_ilegible" in tipos(f)
        vista = server._calcular_vista_programa([f], {})[0]
        assert vista["estado"] == "error"

    def test_mes_en_cero_sin_rango_no_estorba(self):
        f = filas_programa(["DEL 1/9/26 AL 30/9/26", None], ["100", None])[0]
        assert "rango_mes_ilegible" not in tipos(f)

    def test_rango_de_mes_invertido_es_error(self):
        f = filas_programa(["DEL 1/9/26 AL 30/9/26", "DEL 31/10/26 AL 1/10/26"], ["50", "50"])[0]
        assert "rango_mes_ilegible" in tipos(f)

    def test_inicio_posterior_al_fin_es_error(self):
        f = filas_programa(self.RANGOS_OK, ["50", "50"], datetime(2026, 10, 31), datetime(2026, 9, 1))[0]
        assert "rango_fecha_invalido" in tipos(f)
        assert server._calcular_vista_programa([f], {})[0]["estado"] == "error"
        motivo = next(p["motivo"] for p in f["problemas"] if p["tipo"] == "rango_fecha_invalido")
        assert "fecha_fin" not in motivo and "fecha de fin" in motivo

    def test_distribucion_que_no_cuadra_trae_motivo_legible(self):
        f = filas_programa(self.RANGOS_OK, ["50", "40"])[0]
        p = next(p for p in f["problemas"] if p["tipo"] == "distribucion_no_cuadra")
        assert p["motivo"].startswith("La suma de los meses (90.00)")
        assert "100.00" in p["motivo"]


class TestImportadorMaestro:
    MAP = server.ImportMappingEvmIn(clave="Clave", descripcion="Descripcion", meta="Meta", importe="Importe", inicio="Inicio", fin="Fin")
    HEAD = ["Clave", "Descripcion", "Meta", "Importe", "Inicio", "Fin"]

    def filas(self, *datos):
        return server._validar_archivo_completo_evm([self.HEAD, *datos], 0, self.MAP, "punto", {})

    def test_inicio_y_fin_de_excel_llegan_como_iso_y_alimentan_el_pv(self):
        f = self.filas(["1.1", "Muro", "10", "1000", datetime(2026, 9, 1), datetime(2026, 9, 30)])[0]
        assert f["problemas"] == []
        c = concepto(importe=f["importe_total_editable"], meta=f["meta_cantidad"], ini=f["fecha_inicio"], fin=f["fecha_fin"])
        assert server._prorrateo_concepto_en_ventana(c, date(2026, 9, 1), date(2026, 9, 15)) == D("500")

    def test_fechas_invertidas_dan_error_con_mensaje_legible(self):
        f = self.filas(["1.1", "Muro", "10", "1000", datetime(2026, 9, 30), datetime(2026, 9, 1)])[0]
        p = next(p for p in f["problemas"] if p["tipo"] == "rango_fecha_invalido")
        assert p["motivo"] == "La fecha de fin (2026-09-01) es anterior a la fecha de inicio (2026-09-30)."

    def test_fecha_en_texto_no_se_adivina(self):
        f = self.filas(["1.1", "Muro", "10", "1000", "01/09/2026", datetime(2026, 9, 30)])[0]
        assert "fecha_ilegible" in {p["tipo"] for p in f["problemas"]}
