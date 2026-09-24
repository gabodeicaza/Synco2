"""A-01 (validar avances) y A-02 (volumen excedente, EV contractual vs total, EAC/ETC/VAC,
conceptos extraordinarios). Núcleo puro + handlers con un `db` falso: sin Mongo ni backend vivo."""
import asyncio
import os
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_a01_a02")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402

D = Decimal
HOY = date(2026, 9, 23)


def av(i, fecha, q, precio="10", cid="c1", creado=None, tipo="normal", con_importe=True):
    d = {
        "id": i, "concepto_id": cid, "fecha": fecha, "cantidad_ejecutada": str(q), "tipo": tipo,
        "creado_en": creado or datetime(2026, 9, 1, 12, 0),
    }
    if con_importe:
        d["precio_unitario_congelado"] = str(precio)
        d["importe_ganado_congelado"] = str(D(str(q)) * D(str(precio)))
    return d


def valida(**kw):
    base = dict(tipo="normal", cantidad="5", fecha="2026-09-22", motivo=None, hoy=HOY, modo_avance="CANTIDAD")
    base.update(kw)
    return server.validar_avance(**base)


# ------------------------------------------------------------------ A-01
class TestValidarAvance:
    def test_acepta_una_captura_normal(self):
        q, f, m = valida()
        assert (q, f, m) == (D("5"), "2026-09-22", None)

    @pytest.mark.parametrize("cantidad", ["0", "0.00", "-1", "-0.5"])
    def test_rechaza_cero_y_negativos(self, cantidad):
        with pytest.raises(ValueError, match="mayor que cero"):
            valida(cantidad=cantidad)

    @pytest.mark.parametrize("cantidad", ["abc", "", "1,5x", "NaN", "Infinity", None])
    def test_rechaza_texto_y_no_finitos(self, cantidad):
        with pytest.raises(ValueError, match="número"):
            valida(cantidad=cantidad)

    def test_rechaza_fecha_futura_pero_acepta_hoy(self):
        with pytest.raises(ValueError, match="futura"):
            valida(fecha="2026-09-24")
        assert valida(fecha="2026-09-23")[1] == "2026-09-23"

    def test_rechaza_fecha_mal_formada(self):
        with pytest.raises(ValueError, match="AAAA-MM-DD"):
            valida(fecha="23/09/2026")

    def test_el_hoy_es_el_del_proyecto_no_el_utc(self):
        # 21:30 en CDMX del 23 = 03:30 UTC del 24: capturar "el 23" no es futuro.
        ahora = datetime(2026, 9, 24, 3, 30, tzinfo=timezone.utc)
        hoy = server.hoy_proyecto(None, ahora)
        assert valida(fecha="2026-09-23", hoy=hoy)[1] == "2026-09-23"
        with pytest.raises(ValueError, match="futura"):
            valida(fecha="2026-09-24", hoy=hoy)

    def test_ajuste_pide_motivo(self):
        with pytest.raises(ValueError, match="motivo"):
            valida(tipo="ajuste", cantidad="-3")
        with pytest.raises(ValueError, match="motivo"):
            valida(tipo="ajuste", cantidad="-3", motivo="  ab ")
        q, _, m = valida(tipo="ajuste", cantidad="-3", motivo="  Se duplicó el registro ")
        assert q == D("-3") and m == "Se duplicó el registro"

    def test_ajuste_admite_negativos_pero_no_cero(self):
        with pytest.raises(ValueError, match="cero"):
            valida(tipo="ajuste", cantidad="0", motivo="corrección")

    def test_ajuste_no_aplica_en_modo_porcentaje(self):
        with pytest.raises(ValueError, match="porcentaje"):
            valida(tipo="ajuste", cantidad="-3", motivo="corrección", modo_avance="PORCENTAJE")

    def test_en_porcentaje_ya_no_hay_tope_de_100(self):
        assert valida(cantidad="120", modo_avance="PORCENTAJE")[0] == D("120")
        with pytest.raises(ValueError):
            valida(cantidad="0", modo_avance="PORCENTAJE")


# ------------------------------------------------------------------ A-02: reparto de volumen
class TestReparto:
    def test_todo_dentro_de_lo_contratado(self):
        r = server.repartir_avances([av("a", "2026-09-01", 40), av("b", "2026-09-02", 50)], D("100"))
        assert r["a"] == (D("40"), D("0")) and r["b"] == (D("50"), D("0"))

    def test_el_avance_que_cruza_el_tope_se_parte(self):
        r = server.repartir_avances([av("a", "2026-09-01", 90), av("b", "2026-09-02", 30), av("c", "2026-09-03", 5)], D("100"))
        assert r["a"] == (D("90"), D("0"))
        assert r["b"] == (D("10"), D("20"))  # 10 caben, 20 exceden
        assert r["c"] == (D("0"), D("5"))    # ya todo excedente
        assert sum(x[0] for x in r.values()) == D("100") and sum(x[1] for x in r.values()) == D("25")

    def test_orden_por_fecha_y_luego_por_captura_no_por_llegada(self):
        # Llega primero el del 3 (offline) y después el del 1: el excedente lo genera el que ocurrió después.
        r = server.repartir_avances([av("tarde", "2026-09-03", 60), av("pronto", "2026-09-01", 60)], D("100"))
        assert r["pronto"] == (D("60"), D("0")) and r["tarde"] == (D("40"), D("20"))

    def test_un_ajuste_negativo_baja_el_excedente_primero(self):
        lista = [av("a", "2026-09-01", 110), av("aj", "2026-09-02", -15, tipo="ajuste")]
        r = server.repartir_avances(lista, D("100"))
        assert r["a"] == (D("100"), D("10"))
        assert r["aj"] == (D("-5"), D("-10"))  # quita los 10 de excedente y 5 de lo contratado

    def test_concepto_extraordinario_con_contratado_cero_es_todo_excedente(self):
        r = server.repartir_avances([av("a", "2026-09-01", 7)], D("0"))
        assert r["a"] == (D("0"), D("7"))

    def test_excedente_de_concepto(self):
        assert server.excedente_de_concepto(D("125"), D("100")) == D("25")
        assert server.excedente_de_concepto(D("80"), D("100")) == D("0")
        assert server.excedente_de_concepto(D("5"), D("0")) == D("5")

    def test_cantidad_contratada_legado_y_evm(self):
        assert server.cantidad_contratada({"cantidad": "250"}) == D("250")
        assert server.cantidad_contratada({"cantidad": "250", "meta_cantidad": "300", "importe_total_editable": "9000"}) == D("300")


# ------------------------------------------------------------------ A-02: EV contractual vs total
class TestEV:
    CONC = {"c1": {"id": "c1", "cantidad": "100", "precio_unitario": "10"}}

    def test_ev_contractual_topado_y_total_completo(self):
        avances = [av("a", "2026-09-01", 90), av("b", "2026-09-02", 30)]
        ctr, tot = server.calcular_ev(avances, self.CONC, "CANTIDAD")
        assert tot == D("1200")   # 120 × 10
        assert ctr == D("1000")   # 100 × 10 (lo demás es excedente)

    def test_sin_excedente_las_dos_cifras_son_iguales(self):
        ctr, tot = server.calcular_ev([av("a", "2026-09-01", 40)], self.CONC, "CANTIDAD")
        assert ctr == tot == D("400")

    def test_la_ventana_filtra_pero_el_reparto_usa_todo_el_historial(self):
        avances = [av("a", "2026-08-01", 95), av("b", "2026-09-10", 20)]
        ctr, tot = server.calcular_ev(avances, self.CONC, "CANTIDAD", "2026-09-01", "2026-09-30")
        assert tot == D("200")  # solo el de septiembre
        assert ctr == D("50")   # de esos 20, solo 5 caben en lo contratado

    def test_ajuste_negativo_resta_del_ev(self):
        avances = [av("a", "2026-09-01", 100), av("aj", "2026-09-02", -10, tipo="ajuste")]
        ctr, tot = server.calcular_ev(avances, self.CONC, "CANTIDAD")
        assert tot == D("900") and ctr == D("900")

    def test_modo_porcentaje_no_separa(self):
        avances = [av("a", "2026-09-01", 120, precio="1")]
        ctr, tot = server.calcular_ev(avances, self.CONC, "PORCENTAJE")
        assert ctr == tot == D("120")

    def test_avances_sin_precio_congelado_no_aportan_ev(self):
        ctr, tot = server.calcular_ev([av("a", "2026-09-01", 10, con_importe=False)], self.CONC, "CANTIDAD")
        assert ctr == tot == D("0")

    def test_concepto_desconocido_cuenta_completo_como_antes(self):
        ctr, tot = server.calcular_ev([av("a", "2026-09-01", 10, cid="borrado")], self.CONC, "CANTIDAD")
        assert ctr == tot == D("100")

    def test_nada_de_float(self):
        ctr, tot = server.calcular_ev([av("a", "2026-09-01", "0.1", precio="1"), av("b", "2026-09-02", "0.2", precio="1")], {"c1": {"id": "c1", "cantidad": "1000", "precio_unitario": "1"}}, "CANTIDAD")
        assert tot == D("0.3")


# ------------------------------------------------------------------ A-02: EAC / ETC / VAC
class TestPronostico:
    def test_con_sobrecosto(self):
        p = server.calcular_pronostico(D("1000"), D("400"), D("500"))  # CPI 0.8
        assert p["eac"] == D("1250") and p["etc"] == D("750") and p["vac"] == D("-250")

    def test_bajo_presupuesto(self):
        p = server.calcular_pronostico(D("1000"), D("500"), D("400"))  # CPI 1.25
        assert p["eac"] == D("800") and p["vac"] == D("200")

    def test_sin_gasto_real_no_hay_pronostico(self):
        assert server.calcular_pronostico(D("1000"), D("400"), D("0")) is None

    def test_sin_valor_ganado_no_hay_pronostico(self):
        assert server.calcular_pronostico(D("1000"), D("0"), D("300")) is None

    def test_ac_mayor_que_bac_se_permite_y_se_calcula(self):
        p = server.calcular_pronostico(D("1000"), D("1000"), D("1500"))
        assert p is not None and p["vac"] < 0


# ------------------------------------------------------------------ handlers con db falso
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
    c.insert_one = AsyncMock()
    c.update_one = AsyncMock()
    return c


PROJ = {"id": "p1", "name": "Demo", "modo_avance": "CANTIDAD"}
CONCEPTO = {
    "id": "c1", "project_id": "p1", "partida_id": "pa", "clave": "1.1", "descripcion": "x", "unidad": "M3",
    "cantidad": "100", "precio_unitario": "10", "meta": "0", "periodicidad_meta": "SEMANAL",
    "created_at": datetime(2026, 1, 1), "activo": True,
}
USER = {"id": "u1", "name": "Ana", "role": server.ROLE_SUB, "project_ids": ["p1"]}


def _armar(avances_previos=None, proyecto=None):
    db = MagicMock()
    db.projects = _col(one=dict(proyecto or PROJ))
    db.conceptos = _col(one=dict(CONCEPTO))
    db.registros_avance = _col(docs=avances_previos or [])
    db.location_nodes = _col()
    db.catalogo_bitacora = _col()
    db.excedentes_concepto = _col()
    server.db = db
    return db


def _crear(**kw):
    body = dict(concepto_id="c1", fecha=server.hoy_proyecto(None).isoformat(), cantidad_ejecutada="5")
    body.update(kw)
    return asyncio.run(server.create_avance(server.RegistroAvanceIn(**body), USER))


class TestHandlerCrearAvance:
    @pytest.mark.parametrize("cantidad", ["0", "-2"])
    def test_rechaza_cero_y_negativo(self, cantidad):
        db = _armar()
        with pytest.raises(HTTPException) as e:
            _crear(cantidad_ejecutada=cantidad)
        assert e.value.status_code == 400
        db.registros_avance.insert_one.assert_not_called()

    def test_rechaza_fecha_futura(self):
        db = _armar()
        with pytest.raises(HTTPException) as e:
            _crear(fecha="2999-01-01")
        assert e.value.status_code == 400 and "futura" in e.value.detail
        db.registros_avance.insert_one.assert_not_called()

    def test_permite_registrar_mas_de_lo_contratado(self):
        # Ya lleva 95 de 100; captura 30: pasa (125%) y se guarda tal cual.
        db = _armar([av("a", "2026-09-01", 95)])
        _crear(cantidad_ejecutada="30")
        doc = db.registros_avance.insert_one.await_args.args[0]
        assert doc["cantidad_ejecutada"] == "30" and doc["tipo"] == "normal"
        assert doc["importe_ganado_congelado"] == "300"

    def test_ajuste_sin_motivo_se_rechaza(self):
        _armar([av("a", "2026-09-01", 10)])
        with pytest.raises(HTTPException) as e:
            _crear(tipo="ajuste", cantidad_ejecutada="-3")
        assert e.value.status_code == 400 and "motivo" in e.value.detail

    def test_ajuste_con_motivo_se_guarda_y_queda_en_bitacora(self):
        db = _armar([av("a", "2026-09-01", 10)])
        _crear(tipo="ajuste", cantidad_ejecutada="-3", motivo="Se capturó dos veces")
        doc = db.registros_avance.insert_one.await_args.args[0]
        assert doc["tipo"] == "ajuste" and doc["motivo"] == "Se capturó dos veces"
        assert doc["importe_ganado_congelado"] == "-30"
        bit = db.catalogo_bitacora.insert_one.await_args.args[0]
        assert bit["tipo"] == "ajuste_avance" and "Se capturó dos veces" in bit["valor_nuevo"]

    def test_ajuste_que_deja_el_acumulado_negativo_se_rechaza(self):
        _armar([av("a", "2026-09-01", 2)])
        with pytest.raises(HTTPException) as e:
            _crear(tipo="ajuste", cantidad_ejecutada="-5", motivo="corrección")
        assert e.value.status_code == 400 and "negativo" in e.value.detail


# ------------------------------------------------------------------ servicio único de análisis
class TestServicioAnalisis:
    def _db(self, avances, gastos, conceptos=None):
        db = MagicMock()
        db.projects = _col(one=dict(PROJ))
        db.conceptos = _col(docs=conceptos or [dict(CONCEPTO)])
        db.registros_avance = _col(docs=avances)
        db.gastos_reales = _col(docs=gastos)
        db.programa_versiones = _col()
        db.programa_distribucion = _col()
        server.db = db

    def test_ev_dos_cifras_bac_y_pronostico(self):
        self._db(
            [av("a", "2026-09-01", 90), av("b", "2026-09-02", 30)],
            [{"fecha": "2026-09-05", "monto": "1500"}],
        )
        r = asyncio.run(server.calcular_analisis_evm("p1", "2026-09-01", "2026-09-30"))
        assert r["ev_total"] == D("1200") and r["ev_contractual"] == D("1000")
        assert r["bac"] == D("1000") and r["ac"] == D("1500")
        # AC > BAC se permite: EAC = BAC / CPI con CPI = 1200/1500 = 0.8
        assert r["pronostico"]["eac"] == D("1250") and r["pronostico"]["vac"] == D("-250")
        assert r["cpi"] == D("0.8000")

    def test_sin_gastos_no_hay_cpi_ni_pronostico(self):
        self._db([av("a", "2026-09-01", 10)], [])
        r = asyncio.run(server.calcular_analisis_evm("p1", "2026-09-01", "2026-09-30"))
        assert r["cpi"] is None and r["pronostico"] is None

    def test_el_acumulado_incluye_meses_anteriores_a_la_ventana(self):
        self._db([av("a", "2026-08-01", 40), av("b", "2026-09-10", 10)], [{"fecha": "2026-08-15", "monto": "100"}])
        r = asyncio.run(server.calcular_analisis_evm("p1", "2026-09-01", "2026-09-30"))
        assert r["ev_total"] == D("100") and r["ev_acumulado"] == D("500")
        assert r["ac"] == D("0") and r["ac_acumulado"] == D("100")

    def test_rango_invertido(self):
        self._db([], [])
        with pytest.raises(ValueError):
            asyncio.run(server.calcular_analisis_evm("p1", "2026-09-30", "2026-09-01"))


# ------------------------------------------------------------------ excedentes y extraordinarios
class TestExcedentes:
    def _db(self, avances, estatus_docs=None):
        db = MagicMock()
        db.conceptos = _col(docs=[dict(CONCEPTO)])
        db.registros_avance = _col(docs=avances)
        db.excedentes_concepto = _col(docs=estatus_docs or [])
        db.catalogo_bitacora = _col()
        server.db = db
        return db

    def test_lista_el_excedente_con_cantidad_importe_y_estatus_pendiente(self):
        self._db([av("a", "2026-09-01", 90), av("b", "2026-09-02", 30)])
        out = asyncio.run(server._excedentes_del_proyecto("p1", dict(PROJ)))
        assert len(out) == 1
        e = out[0]
        assert e.cantidad_excedente == "20" and e.importe_excedente == "200.00" and e.estatus == "pendiente_autorizacion"

    def test_sin_excedente_no_aparece(self):
        self._db([av("a", "2026-09-01", 90)])
        assert asyncio.run(server._excedentes_del_proyecto("p1", dict(PROJ))) == []

    def test_respeta_el_estatus_guardado(self):
        self._db([av("a", "2026-09-01", 120)], [{"concepto_id": "c1", "estatus": "autorizado", "referencia": "OC-7"}])
        e = asyncio.run(server._excedentes_del_proyecto("p1", dict(PROJ)))[0]
        assert e.estatus == "autorizado" and e.referencia == "OC-7"

    def test_solo_el_coordinador_general_puede_autorizar(self):
        # La dependencia de la ruta exige ROLE_COORD.
        ruta = next(r for r in server.api.routes if getattr(r, "path", "") == "/api/projects/{pid}/excedentes/{concepto_id}" and "PATCH" in r.methods)
        deps = [d.call for d in ruta.dependant.dependencies]
        assert any(getattr(c, "__closure__", None) for c in deps)
        casos = {}
        for c in deps:
            if c.__closure__:
                for cell in c.__closure__:
                    if isinstance(cell.cell_contents, tuple):
                        casos = cell.cell_contents
        assert casos == (server.ROLE_COORD,)

    def test_autorizar_exige_referencia(self):
        db = self._db([av("a", "2026-09-01", 120)])
        db.projects = _col(one=dict(PROJ))
        coord = {"id": "u9", "name": "Coord", "role": server.ROLE_COORD, "project_ids": []}
        with pytest.raises(HTTPException) as e:
            asyncio.run(server.set_excedente_estatus("p1", "c1", server.ExcedentePatch(estatus="autorizado"), coord))
        assert e.value.status_code == 400 and "convenio" in e.value.detail

    def test_autorizar_guarda_y_deja_bitacora(self):
        db = self._db([av("a", "2026-09-01", 120)])
        db.projects = _col(one=dict(PROJ))
        coord = {"id": "u9", "name": "Coord", "role": server.ROLE_COORD, "project_ids": []}
        asyncio.run(server.set_excedente_estatus("p1", "c1", server.ExcedentePatch(estatus="autorizado", referencia="CM-03"), coord))
        filtro, upd = db.excedentes_concepto.update_one.await_args.args[:2]
        assert filtro == {"project_id": "p1", "concepto_id": "c1"} and upd["$set"]["estatus"] == "autorizado"
        assert db.catalogo_bitacora.insert_one.await_args.args[0]["tipo"] == "excedente_estatus"

    def test_concepto_sin_excedente_da_404(self):
        db = self._db([av("a", "2026-09-01", 10)])
        db.projects = _col(one=dict(PROJ))
        coord = {"id": "u9", "name": "Coord", "role": server.ROLE_COORD, "project_ids": []}
        with pytest.raises(HTTPException) as e:
            asyncio.run(server.set_excedente_estatus("p1", "c1", server.ExcedentePatch(estatus="rechazado"), coord))
        assert e.value.status_code == 404


class TestExtraordinarios:
    def test_un_extraordinario_nace_con_pu_pendiente(self):
        db = MagicMock()
        db.partidas = _col(one={"id": "pa", "project_id": "p1"})
        db.projects = _col(one=dict(PROJ))
        db.conceptos = _col()
        db.registros_avance = _col()
        db.excedentes_concepto = _col()
        db.catalogo_bitacora = _col()
        server.db = db
        body = server.ConceptoIn(
            partida_id="pa", clave="EXT-1", descripcion="Trabajo no catalogado", unidad="M3",
            cantidad="0", precio_unitario="0", meta="0", extraordinario=True,
        )
        out = asyncio.run(server.create_concepto(body, USER))
        doc = db.conceptos.insert_one.await_args.args[0]
        assert doc["extraordinario"] is True and doc["pu_estatus"] == "pendiente_autorizacion"
        assert out.extraordinario is True and out.pu_estatus == "pendiente_autorizacion"
        assert db.catalogo_bitacora.insert_one.await_args.args[0]["tipo"] == "concepto_extraordinario"

    def test_un_concepto_normal_no_tiene_estatus_de_pu(self):
        db = MagicMock()
        db.partidas = _col(one={"id": "pa", "project_id": "p1"})
        db.projects = _col(one=dict(PROJ))
        db.conceptos = _col()
        db.registros_avance = _col()
        db.excedentes_concepto = _col()
        server.db = db
        body = server.ConceptoIn(partida_id="pa", clave="1.9", descripcion="x", unidad="M3", cantidad="10", precio_unitario="5", meta="0")
        asyncio.run(server.create_concepto(body, USER))
        doc = db.conceptos.insert_one.await_args.args[0]
        assert doc["extraordinario"] is False and doc["pu_estatus"] is None


# ------------------------------------------------------------------ 422 serializable
class TestRespuesta422:
    def test_un_error_de_validador_propio_ya_no_termina_en_500(self):
        """Antes `exc.errors()` llevaba la excepción original en `ctx` y no se podía serializar:
        el cliente recibía 500 en vez de 422 con el mensaje."""
        import json
        from fastapi.exceptions import RequestValidationError
        from pydantic import ValidationError

        with pytest.raises(ValidationError) as e:
            server.RegistroAvanceIn(concepto_id="c", fecha="2026-01-01", cantidad_ejecutada="abc")
        with pytest.raises(TypeError):
            json.dumps(e.value.errors())  # el comportamiento anterior
        seguro = server._errores_422_serializables(RequestValidationError(e.value.errors()))
        texto = json.dumps(seguro)
        assert "cantidad_ejecutada" in texto and "input" not in seguro[0]
