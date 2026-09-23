"""Pruebas de la parte pura del seed demo (T-03): datos genéricos, sin
vocabulario de un proyecto real, sin fechas futuras y con unidades válidas."""
import os
import sys
from datetime import date
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_seed_demo")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import seed_demo  # noqa: E402
import server  # noqa: E402

HOY = date(2026, 9, 23)


def _todos_los_textos(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _todos_los_textos(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _todos_los_textos(v)


def test_el_proyecto_demo_lleva_la_marca_prueba():
    assert "(PRUEBA)" in seed_demo.construir_plan(HOY)["proyecto"]["name"]


def test_sin_vocabulario_de_un_proyecto_real():
    plan = seed_demo.construir_plan(HOY)
    for texto in _todos_los_textos(plan):
        bajo = texto.lower()
        for palabra in seed_demo.PALABRAS_PROHIBIDAS:
            assert palabra not in bajo, f"'{palabra}' en '{texto}'"


def test_ningun_avance_con_fecha_futura_ni_cantidad_invalida():
    for a in seed_demo.construir_plan(HOY)["avances"]:
        assert date.fromisoformat(a["fecha"]) <= HOY
        assert float(a["cantidad"]) > 0


def test_el_avance_no_supera_lo_contratado():
    plan = seed_demo.construir_plan(HOY)
    contratado = {c["clave"]: float(c["cantidad"]) for c in plan["conceptos"]}
    ejecutado = {}
    for a in plan["avances"]:
        ejecutado[a["concepto"]] = ejecutado.get(a["concepto"], 0) + float(a["cantidad"])
    for clave, total in ejecutado.items():
        assert total <= contratado[clave]


def test_unidades_y_referencias_validas():
    plan = seed_demo.construir_plan(HOY)
    claves_partida = {p["clave"] for p in plan["partidas"]}
    for c in plan["conceptos"]:
        assert c["unidad"] in server.UNIDADES
        assert c["partida"] in claves_partida
    for p in plan["partidas"]:
        assert p["padre"] is None or p["padre"] in claves_partida
    assert any(n["is_leaf"] for n in plan["nodos"])
    assert plan["minuta"]["ubicacion"] in {n["name"] for n in plan["nodos"]}


def test_hoy_usa_la_zona_horaria_del_proyecto():
    assert seed_demo.TZ_PROYECTO.key == "America/Mexico_City"


def test_png_de_ejemplo_es_un_png_valido():
    datos = seed_demo.png_de_ejemplo(80, 40)
    assert datos.startswith(b"\x89PNG\r\n\x1a\n") and datos.endswith(b"IEND\xaeB`\x82")


def test_no_escribe_sin_confirmar(monkeypatch, capsys):
    monkeypatch.setenv("SEED_ADMIN_EMAIL", "a@b.mx")
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "x")
    assert seed_demo.main(["--base-url", "http://localhost:1/api"]) == 2
    assert "--confirmar" in capsys.readouterr().out
