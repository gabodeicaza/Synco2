"""C-06: la meta por defecto de un concepto es cantidad ÷ duración programada, expresada en la
cadencia del proyecto; sin programa queda VACÍA (ya no es "toda la cantidad por semana").
Pruebas sin Mongo (colecciones falsas)."""
import asyncio
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_meta_por_defecto")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from server import cadencia_de_proyecto, meta_por_defecto  # noqa: E402


# --- fórmula ------------------------------------------------------------------

def test_diaria_reparte_la_cantidad_entre_los_dias_inclusive():
    # 10 días (1 al 10 de octubre, inclusive): 1000 / 10 = 100 por día.
    assert meta_por_defecto("1000", "2026-10-01", "2026-10-10", "DIARIA") == "100"


def test_semanal_es_cantidad_entre_semanas():
    # 14 días = 2 semanas: 1000 / 2 = 500 por semana.
    assert meta_por_defecto("1000", "2026-10-01", "2026-10-14", "SEMANAL") == "500"
    # 10 días = 1.4286 semanas: 1000 * 7 / 10 = 700.
    assert meta_por_defecto("1000", "2026-10-01", "2026-10-10", "SEMANAL") == "700"


def test_mensual_usa_meses_de_30_punto_4_dias():
    # 304 días = 10 meses: 1000 / 10 = 100 por mes.
    assert meta_por_defecto("1000", "2026-01-01", "2026-10-31", "MENSUAL") == "100"


def test_redondea_half_up_a_cuatro_decimales_solo_al_final():
    # 100 / 3 días = 33.3333...
    assert meta_por_defecto("100", "2026-10-01", "2026-10-03", "DIARIA") == "33.3333"
    # 200 / 3 = 66.6666... -> 66.6667 (HALF_UP)
    assert meta_por_defecto("200", "2026-10-01", "2026-10-03", "DIARIA") == "66.6667"


def test_un_solo_dia_deja_la_cantidad_completa_en_cadencia_diaria():
    assert meta_por_defecto("250.5", "2026-10-01", "2026-10-01", "DIARIA") == "250.5"


def test_nunca_devuelve_cero_si_hay_cantidad():
    # 0.0001 de cantidad en 3650 días es menos de una diezmilésima por día.
    assert meta_por_defecto("0.0001", "2026-01-01", "2036-01-01", "DIARIA") == "0.0001"


def test_resultado_es_un_decimal_exacto_en_texto():
    valor = meta_por_defecto("1234.5678", "2026-10-01", "2026-10-07", "SEMANAL")
    assert valor == "1234.5678"
    assert Decimal(valor) == Decimal("1234.5678")


@pytest.mark.parametrize("cantidad,inicio,fin", [
    ("1000", None, None),                      # sin programa
    ("1000", "2026-10-01", None),
    ("1000", None, "2026-10-10"),
    ("1000", "", ""),
    ("1000", "2026-10-10", "2026-10-01"),      # fechas invertidas
    ("1000", "no-es-fecha", "2026-10-10"),     # ilegibles
    ("1000", "2026-02-31", "2026-03-10"),
    (None, "2026-10-01", "2026-10-10"),        # sin cantidad
    ("", "2026-10-01", "2026-10-10"),
    ("abc", "2026-10-01", "2026-10-10"),
    ("0", "2026-10-01", "2026-10-10"),         # cantidad no positiva
    ("-5", "2026-10-01", "2026-10-10"),
])
def test_sin_programa_o_datos_invalidos_la_meta_queda_vacia(cantidad, inicio, fin):
    assert meta_por_defecto(cantidad, inicio, fin, "SEMANAL") is None


def test_cadencia_desconocida_se_trata_como_mensual():
    assert meta_por_defecto("1000", "2026-01-01", "2026-10-31", "OTRA") == meta_por_defecto(
        "1000", "2026-01-01", "2026-10-31", "MENSUAL",
    )


def test_cadencia_de_proyecto():
    assert cadencia_de_proyecto({"cadencia_reporte": "DIARIA"}) == "DIARIA"
    assert cadencia_de_proyecto({"cadencia_reporte": "semanal"}) == "SEMANAL"
    assert cadencia_de_proyecto({"cadencia_reporte": "quincenal"}) == "MENSUAL"
    assert cadencia_de_proyecto({}) == "MENSUAL"
    assert cadencia_de_proyecto(None) == "MENSUAL"


# --- modelos ------------------------------------------------------------------

BASE = dict(partida_id="p1", clave="1.1", descripcion="Concepto", cantidad="100", precio_unitario="10")


def test_la_periodicidad_diaria_es_valida_y_meta_puede_ir_vacia():
    c = server.ConceptoIn(**BASE, periodicidad_meta="DIARIA")
    assert c.periodicidad_meta == "DIARIA"
    assert c.meta == ""
    assert server.ConceptoIn(**BASE).periodicidad_meta is None  # sin valor: la cadencia del proyecto


def test_periodicidad_invalida_se_rechaza():
    with pytest.raises(ValidationError):
        server.ConceptoIn(**BASE, periodicidad_meta="QUINCENAL")


def test_meta_no_numerica_se_rechaza_y_la_vacia_o_en_blanco_se_normaliza():
    with pytest.raises(ValidationError):
        server.ConceptoIn(**BASE, meta="abc")
    assert server.ConceptoIn(**BASE, meta="   ").meta == ""
    assert server.ConceptoPatch(meta="").meta == ""  # vaciar la meta desde el PATCH
    assert server.ConceptoPatch().meta is None


# --- alta manual (create_concepto) ---------------------------------------------

class _Coleccion:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    async def find_one(self, filtro, *_a, **_k):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filtro.items()):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    def find(self, filtro=None, *_a, **_k):
        docs = [d for d in self.docs if all(d.get(k) == v for k, v in (filtro or {}).items() if not isinstance(v, dict))]

        class _Cursor:
            def sort(self, *_x, **_y):
                return self

            async def to_list(self, length=None):
                return [dict(d) for d in docs]

        return _Cursor()


class _Db:
    def __init__(self, cadencia):
        self.partidas = _Coleccion([{"id": "p1", "project_id": "proy-1", "clave": "1", "nombre": "Partida"}])
        self.projects = _Coleccion([{"id": "proy-1", "cadencia_reporte": cadencia}])
        self.conceptos = _Coleccion()
        self.registros_avance = _Coleccion()


def _crear(monkeypatch, cadencia, **campos):
    db = _Db(cadencia)
    monkeypatch.setattr(server, "db", db)
    body = server.ConceptoIn(**{**BASE, **campos})
    salida = asyncio.run(server.create_concepto(body, user={"id": "u1", "role": server.ROLE_COORD}))
    return salida, db.conceptos.docs[0]


def test_alta_con_fechas_calcula_la_meta_en_la_cadencia_del_proyecto(monkeypatch):
    salida, doc = _crear(monkeypatch, "SEMANAL", cantidad="1000", fecha_inicio="2026-10-01", fecha_fin="2026-10-14")
    assert doc["meta"] == "500" and doc["periodicidad_meta"] == "SEMANAL"
    assert salida.meta == "500"


def test_alta_sin_fechas_deja_la_meta_vacia(monkeypatch):
    salida, doc = _crear(monkeypatch, "MENSUAL", cantidad="1000")
    assert doc["meta"] == "" and doc["periodicidad_meta"] == "MENSUAL"
    assert salida.meta == ""


def test_alta_respeta_la_meta_capturada_y_la_periodicidad_elegida(monkeypatch):
    _, doc = _crear(
        monkeypatch, "MENSUAL", cantidad="1000", meta="42", periodicidad_meta="DIARIA",
        fecha_inicio="2026-10-01", fecha_fin="2026-10-14",
    )
    assert doc["meta"] == "42" and doc["periodicidad_meta"] == "DIARIA"


def test_alta_diaria_usa_la_cadencia_diaria_del_proyecto(monkeypatch):
    _, doc = _crear(monkeypatch, "DIARIA", cantidad="1000", fecha_inicio="2026-10-01", fecha_fin="2026-10-10")
    assert doc["meta"] == "100" and doc["periodicidad_meta"] == "DIARIA"


# --- importador Maestro (con fechas) -------------------------------------------

class _ColeccionMaestro:
    def __init__(self):
        self.insertados = []

    def find(self, *_a, **_k):
        class _Vacio:
            def __aiter__(self):
                return self

            async def __anext__(self):
                raise StopAsyncIteration
        return _Vacio()

    async def bulk_write(self, ops, ordered=True):
        for op in ops:
            self.insertados.append(dict(op._doc))

    async def delete_one(self, *_a, **_k):
        return None

    async def update_one(self, *_a, **_k):
        return None


def _fila_maestro(clave, cantidad, inicio, fin):
    return {
        "estado": "ok", "tipo_fila": "concepto", "clave": clave, "descripcion": f"Concepto {clave}",
        "meta_cantidad_efectiva": cantidad, "importe_total_editable_efectivo": "5000",
        "fecha_inicio_efectiva": inicio, "fecha_fin_efectiva": fin,
        "problemas_activos": [], "concepto_existente_id": None,
    }


def _commit_maestro(vista, cadencia):
    conceptos = _ColeccionMaestro()
    sesiones = _ColeccionMaestro()

    async def bitacora(*_a, **_k):
        return None

    asyncio.run(server._ejecutar_commit_evm_con_compensacion(
        conceptos, sesiones, bitacora, "proy-1", "imp-1", "partida-1", vista, "actualizar",
        {"id": "u1", "name": "Ana"}, "archivo.xlsx", cadencia=cadencia,
    ))
    return conceptos.insertados


def test_maestro_calcula_la_meta_con_las_fechas_de_la_fila():
    insertados = _commit_maestro([_fila_maestro("1.1", "1000", "2026-10-01", "2026-10-14")], "SEMANAL")
    assert insertados[0]["meta"] == "500"
    assert insertados[0]["periodicidad_meta"] == "SEMANAL"
    assert insertados[0]["meta_cantidad"] == "1000"


def test_maestro_sin_fechas_validas_deja_la_meta_vacia():
    insertados = _commit_maestro(
        [_fila_maestro("1.1", "1000", None, None), _fila_maestro("1.2", "1000", "2026-10-14", "2026-10-01")],
        "DIARIA",
    )
    assert [c["meta"] for c in insertados] == ["", ""]
    assert {c["periodicidad_meta"] for c in insertados} == {"DIARIA"}
    assert all(c["meta"] != c["cantidad"] for c in insertados)
