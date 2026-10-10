"""A-03 / A-11: Lista por excepción (ajustes negativos, acuerdos vencidos, conceptos sin avance
en su ventana, precedencia con `atrasado`) y armado de la entrada del Resumen con IA.
Pruebas sin Mongo (db falso) ni red (no se llama a Gemini)."""
import asyncio
import os
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_excepciones_evm")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

HOY = date(2026, 9, 24)


# --- db falso mínimo ----------------------------------------------------------
def _coincide(doc: dict, filtro: dict) -> bool:
    for campo, cond in filtro.items():
        valor = doc.get(campo)
        if isinstance(cond, dict) and "$in" in cond:
            if valor not in cond["$in"]:
                return False
        elif valor != cond:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = [dict(d) for d in docs]

    def sort(self, *a, **k):
        return self

    async def to_list(self, length=None):
        return self.docs

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()


class _Coleccion:
    def __init__(self, docs=None):
        self.docs = docs or []

    def find(self, filtro=None, *a, **k):
        return _Cursor([d for d in self.docs if _coincide(d, filtro or {})])


class _Db:
    def __init__(self, **colecciones):
        for nombre in ("conceptos", "registros_avance", "gastos_reales", "minutas", "programa_versiones",
                       "programa_distribucion", "excedentes_concepto", "partidas"):
            setattr(self, nombre, _Coleccion(colecciones.get(nombre, [])))


def concepto(cid="c1", clave="1.1", inicio="2026-09-01", fin="2026-09-30", meta="100", importe="10000", **extra):
    doc = {
        "id": cid, "project_id": "p1", "clave": clave, "descripcion": f"Concepto {clave}", "unidad": "M3",
        "activo": True, "cantidad": meta, "precio_unitario": "0", "meta_cantidad": meta,
        "importe_total_editable": importe, "fecha_inicio": inicio, "fecha_fin": fin,
    }
    doc.update(extra)
    return doc


def avance(cid="c1", fecha="2026-09-10", cantidad="5", tipo="normal", **extra):
    doc = {
        "id": f"a-{cid}-{fecha}-{cantidad}-{tipo}", "concepto_id": cid, "project_id": "p1", "fecha": fecha,
        "cantidad_ejecutada": cantidad, "tipo": tipo, "creado_en": datetime(2026, 9, 10, tzinfo=timezone.utc),
        "importe_ganado_congelado": None,
    }
    doc.update(extra)
    return doc


def acuerdo(limite, estado=False, responsable="Ana", descripcion="Entregar planos"):
    return {"id": "ac", "descripcion": descripcion, "responsable_name": responsable, "fecha_limite": limite, "estado": estado}


# --- ajuste_negativo -----------------------------------------------------------
def test_ajuste_negativo_suma_lo_que_resta_con_su_importe_y_motivo():
    c = concepto()  # precio efectivo = 10000 / 100 = 100 por M3
    regs = [
        avance(cantidad="-3", tipo="ajuste", motivo="Se duplicó el registro", fecha="2026-09-10"),
        avance(cantidad="-2.5", tipo="ajuste", motivo="Error de captura", fecha="2026-09-12"),
    ]
    filas = server.excepciones_ajustes_negativos({"c1": c}, regs)
    assert len(filas) == 1
    f = filas[0]
    assert f.tipo == "ajuste_negativo" and f.severidad == "informativa"
    assert f.cantidad == "5.5" and f.importe == "550.00"
    assert "2 ajustes negativos" in f.detalle and "Error de captura" in f.detalle  # el motivo más reciente


def test_ajuste_negativo_ignora_positivos_cero_normales_y_conceptos_desconocidos():
    c = concepto()
    regs = [
        avance(cantidad="4", tipo="ajuste", motivo="Se faltó capturar"),
        avance(cantidad="0", tipo="ajuste", fecha="2026-09-11"),
        avance(cantidad="-1", tipo="normal", fecha="2026-09-12"),
        avance(cid="otro", cantidad="-9", tipo="ajuste", fecha="2026-09-13"),
    ]
    assert server.excepciones_ajustes_negativos({"c1": c}, regs) == []


def test_un_solo_ajuste_usa_singular():
    f = server.excepciones_ajustes_negativos({"c1": concepto()}, [avance(cantidad="-1", tipo="ajuste")])[0]
    assert "1 ajuste negativo:" in f.detalle


# --- acuerdo_vencido -----------------------------------------------------------
def test_acuerdo_vencido_cuenta_dias_de_atraso_y_ordena_del_mas_atrasado():
    minutas = [{"titulo": "Junta semanal", "acuerdos": [acuerdo("2026-09-23"), acuerdo("2026-09-10", responsable="Luis")]}]
    filas = server.excepciones_acuerdos_vencidos(minutas, HOY)
    assert [f.dias_atraso for f in filas] == [14, 1]
    assert filas[0].responsable == "Luis" and filas[0].tipo == "acuerdo_vencido"
    assert "hace 14 días" in filas[0].detalle and "Junta semanal" in filas[0].detalle
    assert "hace 1 día " in filas[1].detalle
    assert filas[0].importe is None and filas[0].cantidad is None and filas[0].severidad == "informativa"


def test_el_dia_limite_todavia_no_esta_vencido_ni_los_cumplidos_ni_los_futuros():
    minutas = [{"titulo": "M", "acuerdos": [
        acuerdo("2026-09-24"), acuerdo("2026-09-25"), acuerdo("2026-09-01", estado=True), acuerdo("no-es-fecha"), acuerdo(""),
    ]}]
    assert server.excepciones_acuerdos_vencidos(minutas, HOY) == []


def test_borde_de_fecha_en_la_zona_del_proyecto_no_en_utc():
    # 23 sep 21:30 en CDMX = 24 sep 03:30 UTC. Para el proyecto todavía es el 23: un acuerdo con
    # límite 23 sep NO está vencido (en UTC ya lo parecería).
    ahora = datetime(2026, 9, 24, 3, 30, tzinfo=timezone.utc)
    hoy_cdmx = server.hoy_proyecto(None, ahora)
    assert hoy_cdmx == date(2026, 9, 23)
    minutas = [{"titulo": "M", "acuerdos": [acuerdo("2026-09-23"), acuerdo("2026-09-22")]}]
    filas = server.excepciones_acuerdos_vencidos(minutas, hoy_cdmx)
    assert [f.dias_atraso for f in filas] == [1]
    assert len(server.excepciones_acuerdos_vencidos(minutas, ahora.date())) == 2  # el error que evita


# --- sin_avance_en_ventana -----------------------------------------------------
def _sin_avance(conceptos, avances_por_concepto=None, dists=None, hoy=HOY, excluir=None):
    return server.excepciones_sin_avance_en_ventana(conceptos, dists or {}, avances_por_concepto or {}, hoy, excluir or set())


def test_sin_avance_en_ventana_con_importe_planeado_a_la_fecha():
    filas = _sin_avance([concepto()])  # 1-30 sep, hoy 24 sep: 24 de 30 días → 10000 × 24/30
    assert len(filas) == 1
    f = filas[0]
    assert f.tipo == "sin_avance_en_ventana" and f.severidad == "informativa"
    assert f.importe == "8000.00"
    assert "ya empezó hace 23 días" in f.detalle


def test_con_avance_dentro_de_la_ventana_no_se_reporta():
    assert _sin_avance([concepto()], {"c1": [avance(fecha="2026-09-05", cantidad="0.0001")]}) == []


def test_avances_en_cero_o_fuera_de_la_ventana_no_cuentan():
    fuera = [avance(fecha="2026-08-31"), avance(fecha="2026-09-05", cantidad="0"), avance(fecha="2026-09-06", cantidad="-2", tipo="ajuste")]
    assert len(_sin_avance([concepto()], {"c1": fuera})) == 1


@pytest.mark.parametrize("hoy,esperado", [
    (date(2026, 8, 31), 0),   # todavía no empieza
    (date(2026, 9, 1), 1),    # el primer día de la ventana ya cuenta
    (date(2026, 9, 30), 1),   # el último día de la ventana todavía cuenta
    (date(2026, 10, 1), 0),   # ya terminó: eso es `atrasado`, no esta alerta
])
def test_bordes_de_la_ventana(hoy, esperado):
    assert len(_sin_avance([concepto()], hoy=hoy)) == esperado


def test_concepto_sin_programa_no_se_reporta():
    assert _sin_avance([concepto(inicio=None, fin=None)]) == []
    assert _sin_avance([concepto(inicio="2026-09-30", fin="2026-09-01")]) == []  # rango invertido


def test_usa_la_distribucion_mensual_vigente_como_ventana():
    c = concepto(inicio=None, fin=None, meta="100", importe="10000")
    dist = {"c1": {"meses": [
        {"fecha_inicio": "2026-09-01", "fecha_fin": "2026-09-30", "importe": "4000"},
        {"fecha_inicio": "2026-10-01", "fecha_fin": "2026-10-31", "importe": "6000"},
    ]}}
    filas = _sin_avance([c], dists=dist, hoy=date(2026, 10, 15))
    assert len(filas) == 1 and "2026-09-01 — 2026-10-31" in filas[0].detalle
    assert filas[0].importe is not None
    con_avance = _sin_avance([c], {"c1": [avance(fecha="2026-09-20")]}, dists=dist, hoy=date(2026, 10, 15))
    assert con_avance == []


def test_los_ids_excluidos_por_atrasado_no_se_repiten():
    assert _sin_avance([concepto()], excluir={"c1"}) == []


# --- orquestador (db falso): precedencia con `atrasado` y orden ----------------
def _correr(monkeypatch, **colecciones):
    monkeypatch.setattr(server, "db", _Db(**colecciones))
    monkeypatch.setattr(server, "hoy_proyecto", lambda proyecto=None, ahora=None: HOY)
    return asyncio.run(server.calcular_excepciones_evm("p1", {"id": "p1", "modo_avance": "CANTIDAD"}))


def test_atrasado_tiene_precedencia_sobre_sin_avance_aunque_el_programa_siga_abierto(monkeypatch):
    # fecha_fin del concepto ya pasó (atrasado) pero la distribución vigente llega hasta octubre:
    # solo debe salir UN renglón, el de atrasado.
    c = concepto(inicio="2026-08-01", fin="2026-08-31")
    dist = {"concepto_id": "c1", "programa_version_id": "v1", "meses": [
        {"fecha_inicio": "2026-08-01", "fecha_fin": "2026-10-31", "importe": "10000"},
    ]}
    filas = _correr(
        monkeypatch, conceptos=[c], programa_versiones=[{"id": "v1", "project_id": "p1", "vigente": True}],
        programa_distribucion=[dist],
    )
    assert [f.tipo for f in filas] == ["atrasado"]


def test_un_concepto_en_ventana_sin_avance_sale_como_sin_avance_y_no_como_atrasado(monkeypatch):
    filas = _correr(monkeypatch, conceptos=[concepto()])
    assert [f.tipo for f in filas] == ["sin_avance_en_ventana"]


def test_orden_de_severidad_de_todos_los_tipos(monkeypatch):
    atrasado = concepto("c1", "1.1", inicio="2026-08-01", fin="2026-08-31")
    sin_avance = concepto("c2", "1.2")
    excedido = concepto("c3", "1.3", meta="10", importe="1000", inicio="2026-01-01", fin="2026-12-31")
    fuera = concepto("c4", "1.4", inicio="2026-01-01", fin="2026-12-31", meta="10", importe="1000")
    filas = _correr(
        monkeypatch,
        conceptos=[fuera, excedido, sin_avance, atrasado],
        registros_avance=[
            avance("c3", "2026-09-05", "15"),  # 15 de 10 → excedente
            avance("c3", "2026-09-06", "-1", tipo="ajuste", motivo="Error"),  # ajuste negativo (sigue excedido: 14 de 10)
            avance("c4", "2026-09-05", "1", fuera_de_ventana=True),
            avance("c2", "2026-08-15", "3"),  # antes de su ventana (no cuenta) → sigue sin avance
        ],
        minutas=[{"project_id": "p1", "titulo": "Junta", "acuerdos": [acuerdo("2026-09-01")]}],
        gastos_reales=[{"project_id": "p1", "monto": "50000", "fecha": "2026-09-05"}],
    )
    tipos = [f.tipo for f in filas]
    orden = ["atrasado", "sin_avance_en_ventana", "acuerdo_vencido", "ajuste_negativo", "excedente_volumen", "sobrecosto", "fuera_de_ventana"]
    assert tipos == sorted(tipos, key=orden.index)
    assert set(tipos) == set(orden)


def test_sobre_meta_ya_no_es_un_tipo_valido():
    assert "sobre_meta" not in server.ExcepcionEvmOut.model_fields["tipo"].annotation.__args__


# --- A-11: entrada del Resumen con IA -------------------------------------------
def _entrada(**kw):
    base = dict(
        pid="p1", reportes=[], noticias=[], avances=[], gastos=[], excepciones=[],
        conceptos_por_id={"c1": concepto()}, bac=Decimal("0"), ac_total=Decimal("0"), hoy=HOY,
    )
    base.update(kw)
    return server.construir_entrada_resumen_ia(**base)


def test_sin_nada_no_hay_datos_y_el_texto_fijo_trae_las_5_viñetas():
    r = _entrada()
    assert r["hay_datos"] is False
    assert r["omitidos"] == {"avances": 0, "gastos": 0, "excepciones": 0}
    assert server.RESUMEN_IA_SIN_DATOS.count("• ") == 5
    assert "Excepciones y control de costos" in server.RESUMEN_IA_SIN_DATOS


def test_sin_reportes_pero_con_avances_hay_datos_y_se_citan_cifras_exactas():
    av = avance(cantidad="12.5", importe_ganado_congelado="1250")
    r = _entrada(avances=[av])
    assert r["hay_datos"] is True
    assert "1.1 Concepto 1.1 | normal | cantidad: 12.5 M3 | valor ganado: $1250.00" in r["user_text"]
    assert "Total: 0 entradas" in r["user_text"]  # cero reportes
    assert "Fecha de hoy en el proyecto: 2026-09-24" in r["user_text"]


def test_gastos_y_control_de_costos():
    g = {"concepto_texto": "Nómina semana 12", "monto": "1500.5", "concepto_clave": "1.1"}
    r = _entrada(gastos=[g], bac=Decimal("10000"), ac_total=Decimal("12500"))
    t = r["user_text"]
    assert "Nómina semana 12 (concepto 1.1) | $1500.50" in t
    assert "Presupuesto contratado: $10000.00" in t and "Costo real acumulado: $12500.00" in t
    assert "Costo real sobre presupuesto: 125.0%" in t


def test_topes_de_tamaño_y_conteo_de_omitidos():
    avances = [avance(fecha="2026-09-24", cantidad=str(i + 1)) for i in range(7)]
    gastos = [{"concepto_texto": f"G{i}", "monto": "10"} for i in range(4)]
    excs = [{"tipo": "acuerdo_vencido", "clave": "", "descripcion": f"A{i}", "detalle": "Vencido"} for i in range(6)]
    r = _entrada(avances=avances, gastos=gastos, excepciones=excs, max_avances=3, max_gastos=2, max_excepciones=4)
    assert r["omitidos"] == {"avances": 4, "gastos": 2, "excepciones": 2}
    t = r["user_text"]
    assert "(y 4 registros de avance más no listados)" in t
    assert "(y 2 gastos más no listados)" in t
    assert "(y 2 excepciones más no listadas)" in t
    assert t.count("- [acuerdo_vencido]") == 4
    assert "Registros de avance del día. Total: 7." in t  # el total sí es el real


def test_las_excepciones_llevan_cantidad_e_importe():
    e = {"tipo": "excedente_volumen", "clave": "1.3", "descripcion": "Concreto", "detalle": "Excede 5 M3", "cantidad": "5", "importe": "500.00"}
    t = _entrada(excepciones=[e])["user_text"]
    assert "- [excedente_volumen] 1.3 Concreto: Excede 5 M3 | cantidad: 5 | importe: $500.00" in t


def test_el_prompt_permite_citar_solo_las_cifras_del_bloque_de_datos():
    s = server.RESUMEN_IA_SYSTEM_MESSAGE
    assert "PUEDES CITAR EXACTAMENTE LAS CIFRAS DEL BLOQUE DE DATOS DE CONTROL" in s
    assert "Y SOLO ESAS" in s and "NO CALCULES" in s
    assert "Excepciones y control de costos" in s


def test_reportes_y_noticias_siguen_en_la_entrada():
    rep = {"created_at": datetime(2026, 9, 24, 15, tzinfo=timezone.utc), "node_path_names": ["Tramo 1"], "avance": "10 m", "actividades": "Colado"}
    ann = {"created_at": datetime(2026, 9, 24, 12, tzinfo=timezone.utc), "title": "Lluvia", "body": "Suspensión"}
    r = _entrada(reportes=[rep], noticias=[ann])
    assert "Tramo 1" in r["user_text"] and "Colado" in r["user_text"] and "Lluvia: Suspensión" in r["user_text"]
