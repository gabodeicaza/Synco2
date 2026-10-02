"""Contrato (obra / supervisión) en la capa financiera (server.py): las partidas
raíz llevan el contrato, el avance y los gráficos se calculan por contrato y el
dashboard EVM filtra por contrato (por defecto obra, sin cambiar lo anterior)."""
import asyncio
import os
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_contrato_fin")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import server  # noqa: E402
from test_capa_financiera import (  # noqa: E402
    FIN, HOY, INI, TODOS, USER, _concepto, _datos, _db, _sembrar, _texto,
)
from server import _avance_obra_bloques, _avance_obra_graficas, _avance_obra_resumen  # noqa: E402


def _datos_supervision():
    partidas = [
        {"id": "ps", "clave": "S1", "nombre": "REVISIÓN DEL PROCESO", "orden": 1, "activo": True, "contrato": "supervision"},
        {"id": "ps1", "clave": "S1.1", "nombre": "Sub", "orden": 1, "activo": True, "partida_padre_id": "ps"},
    ]
    ini = HOY - timedelta(days=99)
    conceptos = [_concepto("s1", "ps1", 500, ini, HOY + timedelta(days=100))]
    registros = [{"concepto_id": "s1", "fecha": (HOY - timedelta(days=1)).isoformat(), "importe_ganado_congelado": "50"}]
    return conceptos, partidas, registros


def test_contrato_se_hereda_de_la_raiz_y_sin_marca_es_obra():
    partidas = [
        {"id": "r1", "orden": 1},
        {"id": "r1a", "partida_padre_id": "r1"},
        {"id": "r2", "contrato": "supervision"},
        {"id": "r2a", "partida_padre_id": "r2"},
        {"id": "r2b", "partida_padre_id": "r2a"},
        {"id": "r3", "contrato": "obra"},
    ]
    assert server._mapa_contrato_partidas(partidas) == {
        "r1": "obra", "r1a": "obra", "r2": "supervision", "r2a": "supervision", "r2b": "supervision", "r3": "obra"}


def test_split_separa_catalogos_y_registros_huerfanos_van_a_obra():
    c_o, p_o, r_o, _ = _datos()
    c_s, p_s, r_s = _datos_supervision()
    huerfano = {"concepto_id": "borrado", "fecha": INI.isoformat(), "importe_ganado_congelado": "7"}
    sp = server._split_por_contrato(c_o + c_s, p_o + p_s, r_o + r_s + [huerfano])
    assert {c["id"] for c in sp["obra"][0]} == {"c1", "c2"} and {c["id"] for c in sp["supervision"][0]} == {"s1"}
    assert {pa["id"] for pa in sp["supervision"][1]} == {"ps", "ps1"}
    assert [r["concepto_id"] for r in sp["supervision"][2]] == ["s1"]
    assert huerfano in sp["obra"][2] and len(sp["obra"][2]) == len(r_o) + 1


def test_avance_de_supervision_usa_sus_partidas_y_etiquetas():
    c_s, p_s, r_s = _datos_supervision()
    res = _avance_obra_resumen(c_s, p_s, r_s, [], INI, FIN)
    assert [f["partida"] for f in res["filas"]] == ["REVISIÓN DEL PROCESO"]
    assert round(res["real_pct"], 2) == Decimal("10.00") and round(res["filas"][0]["semanal"], 2) == Decimal("10.00")
    _, tabla = _avance_obra_bloques(res, INI, FIN, "supervision")
    assert tabla["heading"] == "TABLA DE AVANCE POR PARTIDAS (SUPERVISIÓN)"
    assert [g[0] for g in _avance_obra_graficas(res, FIN, "supervision")] == [
        "GRÁFICA DE AVANCE (SUPERVISIÓN)", "FÍSICO – FINANCIERO (SUPERVISIÓN)"]


def _con_db(coro_fn):
    db = _db()
    old = server.db
    server.db = db
    try:
        return asyncio.run(coro_fn(db))
    finally:
        server.db = old


def test_partidas_contrato_solo_en_raiz_y_se_refleja_en_la_salida():
    async def go(db):
        await db.projects.insert_one({"id": "p1", "name": "P"})
        raiz = await server.create_partida(
            server.PartidaIn(project_id="p1", clave="S", nombre="SUPERVISIÓN", contrato="supervision"), USER)
        assert raiz.contrato == "supervision"
        sin_marca = await server.create_partida(server.PartidaIn(project_id="p1", clave="O", nombre="OBRA"), USER)
        assert sin_marca.contrato == "obra"
        hija = await server.create_partida(
            server.PartidaIn(project_id="p1", clave="S.1", nombre="hija", partida_padre_id=raiz.id), USER)
        assert hija.contrato == "supervision"  # hereda
        with pytest.raises(HTTPException) as e:
            await server.create_partida(
                server.PartidaIn(project_id="p1", clave="X", nombre="x", partida_padre_id=raiz.id, contrato="obra"), USER)
        assert e.value.status_code == 400
        with pytest.raises(HTTPException) as e2:
            await server.update_partida(hija.id, server.PartidaPatch(contrato="obra"), USER)
        assert e2.value.status_code == 400
        cambiada = await server.update_partida(sin_marca.id, server.PartidaPatch(contrato="supervision"), USER)
        assert cambiada.contrato == "supervision"
        listadas = await server.list_partidas("p1", False, USER)
        assert {p.clave: p.contrato for p in listadas} == {"S": "supervision", "O": "supervision", "S.1": "supervision"}
    _con_db(go)


async def _sembrar_con_supervision(db):
    await _sembrar(db, TODOS)
    c_s, p_s, r_s = _datos_supervision()
    await db.conceptos.insert_many(c_s)
    await db.partidas.insert_many([{**p, "project_id": "p1"} for p in p_s])
    await db.registros_avance.insert_many([{**r, "project_id": "p1"} for r in r_s])


def test_dashboard_evm_filtra_por_contrato_y_por_defecto_es_obra():
    async def go(db):
        await _sembrar_con_supervision(db)
        ini, fin = INI.isoformat(), FIN.isoformat()
        obra = await server.analisis_periodo("p1", ini, fin, "obra", USER)
        sup = await server.analisis_periodo("p1", ini, fin, "supervision", USER)
        por_defecto = await server.analisis_periodo("p1", ini, fin, user=USER)
        assert obra.ev == por_defecto.ev == "100.00" and sup.ev == "50.00"
        assert sup.ac == "0.00"  # los gastos reales no distinguen contrato: son de la obra
        pt_o = await server.analisis_periodo_presupuesto_total("p1", "obra", USER)
        pt_s = await server.analisis_periodo_presupuesto_total("p1", "supervision", USER)
        assert pt_o["presupuesto_total"] == "4000.00" and pt_s["presupuesto_total"] == "500.00"
        curva = await server.analisis_periodo_curva_s("p1", "supervision", USER)
        assert curva.ganado_acumulado[-1] == "50.00" and curva.real_acumulado[-1] == "0.00"
        with pytest.raises(HTTPException):
            await server.analisis_periodo_presupuesto_total("p1", "otro", USER)
    _con_db(go)


@pytest.mark.parametrize("formato", ["pdf", "pptx", "docx"])
def test_el_informe_imprime_obra_y_supervision(formato):
    async def go(db):
        await _sembrar_con_supervision(db)
        common = dict(pid="p1", period="week", period_type="semanal", area_id=None, scope=None, user=USER)
        if formato == "pdf":
            resp = await server.export_reports_pdf(
                **common, recuento_nivel=None, recuento_node_ids=None, recuento_sin_datos=None, estructura_solo=False)
        elif formato == "pptx":
            resp = await server.export_reports_pptx(
                **common, recuento_nivel=None, recuento_node_ids=None, recuento_sin_datos=None)
        else:
            resp = await server.export_reports_docx(**common)
        return b"".join([c async for c in resp.body_iterator])
    texto = _texto(formato, _con_db(go))
    for esperado in ("TABLA DE AVANCE POR PARTIDAS (OBRA)", "TABLA DE AVANCE POR PARTIDAS (SUPERVISIÓN)",
                     "REVISIÓN DEL PROCESO", "ESTUDIOS", "AVANCE DE OBRA Y SUPERVISIÓN"):
        assert esperado in texto, f"falta {esperado!r} en el {formato}"
    # El avance real de la obra no se contamina con el de supervisión (15.00% vs 10.00%).
    assert "15.00%" in texto and "10.00%" in texto
