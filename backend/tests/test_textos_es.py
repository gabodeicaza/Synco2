"""Textos en español del backend (Fase 5): fechas largas y cortas, capitalización de nombres de
área, género/plural/artículos de los nombres de nivel, mensajes con acentos y marca Dirac.
Pruebas puras: sin Mongo."""
import ast
import asyncio
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_textos_es")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
         "octubre", "noviembre", "diciembre"]
ABREV = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


# ------------------------------------------------------------------ fechas
@pytest.mark.parametrize("mes", range(1, 13))
def test_fecha_larga_es_en_minuscula_y_con_de(mes):
    dt = datetime(2026, mes, 16, 18, 0, tzinfo=timezone.utc)
    assert server._fmt_fecha_es(dt) == f"16 de {MESES[mes - 1]} de 2026"


@pytest.mark.parametrize("mes", range(1, 13))
def test_fecha_corta_iso_a_texto_largo(mes):
    assert server._fmt_dia_corto_es(f"2026-{mes:02d}-05") == f"5 de {MESES[mes - 1]} de 2026"


def test_fecha_larga_usa_el_dia_de_mexico_no_el_de_utc():
    # 24 sep 03:30 UTC = 23 sep 21:30 en CDMX
    assert server._fmt_fecha_es(datetime(2026, 9, 24, 3, 30, tzinfo=timezone.utc)) == "23 de septiembre de 2026"


def test_no_queda_el_formato_viejo_ni_la_constante_duplicada():
    assert not hasattr(server, "_MESES_ES")
    assert server._MESES_ES_COMPLETO == MESES
    assert server._MESES_ES_ABREV == ABREV
    assert "del 2026" not in server._fmt_fecha_es(datetime(2026, 6, 16, 12, tzinfo=timezone.utc))


def test_mes_capitalizado_para_encabezados_sueltos():
    assert [server.mes_capitalizado(m) for m in (1, 6, 9, 12)] == ["Enero", "Junio", "Septiembre", "Diciembre"]


def test_etiqueta_de_dia_usa_el_mes_abreviado():
    # lunes 3 de agosto de 2026
    assert server._fmt_day_label_es(datetime(2026, 8, 3, 10, 0)) == "Lunes 03 ago"
    assert server._fmt_day_label_es(datetime(2026, 1, 4, 10, 0)) == "Domingo 04 ene"


def test_etiqueta_de_semana_usa_meses_abreviados():
    assert server._fmt_week_label_es(date(2026, 8, 2), date(2026, 8, 8)) == "Semana del 02 al 08 ago"
    assert server._fmt_week_label_es(date(2026, 8, 30), date(2026, 9, 5)) == "Semana del 30 ago al 05 sep"


def test_rango_de_dias_va_en_mayusculas():
    assert server._fmt_rango_dias_es("2026-06-15", "2026-06-20") == "DEL 15 AL 20 DE JUNIO DE 2026"
    assert server._fmt_rango_dias_es("2026-06-28", "2026-07-03") == "DEL 28 DE JUNIO AL 3 DE JULIO DE 2026"


def test_formato_corto_de_un_solo_estilo():
    assert server.fmt_fecha_corta_es(date(2026, 9, 23)) == "23 sep 2026"
    assert server.fmt_fecha_corta_es(datetime(2026, 1, 5, 9, 0)) == "5 ene 2026"
    # 23 sep 2026 08:47 en CDMX = 14:47 UTC
    assert server.fmt_fecha_hora_corta_es(datetime(2026, 9, 23, 14, 47, tzinfo=timezone.utc)) == "23 sep 2026, 08:47"


# ------------------------------------------------------------------ capitalización de áreas
@pytest.mark.parametrize("entrada,esperado", [
    ("topografía y geotecnia", "Topografía y Geotecnia"),
    ("TOPOGRAFÍA Y GEOTECNIA", "Topografía y Geotecnia"),
    ("obra civil y estructuras", "Obra Civil y Estructuras"),
    ("HSE y calidad", "HSE y Calidad"),
    ("HSE Y CALIDAD", "HSE y Calidad"),
    ("calidad", "Calidad"),
    ("CALIDAD", "Calidad"),
    ("ingeniería de campo", "Ingeniería de Campo"),
    ("gestión social y comunicación", "Gestión Social y Comunicación"),
    ("albañilería", "Albañilería"),
    ("ÑANDÚ Y CIA", "Ñandú y Cia"),
    ("de la obra", "De la Obra"),
    ("zona A", "Zona A"),
    ("  medio   ambiente  ", "Medio Ambiente"),
    ("SST", "SST"),
    ("seguridad e higiene", "Seguridad e Higiene"),
])
def test_capitalizar_es(entrada, esperado):
    assert server.capitalizar_es(entrada) == esperado


def test_capitalizar_es_vacio():
    assert server.capitalizar_es("") == ""
    assert server.capitalizar_es(None) == ""


def test_normalizar_area_conserva_acentos_y_no_deja_y_en_mayuscula():
    assert server._normalize_area_name("topografía y geotecnia") == "Topografía y Geotecnia"
    assert server._normalize_area_name("Topografía-Y_Geotecnia") == "Topografía y Geotecnia"
    assert server._normalize_area_name("CALIDAD") == server._normalize_area_name("calidad") == "Calidad"
    assert server._normalize_area_name("") == "SIN ÁREA"
    assert server._normalize_area_name("Sub supervisores") == "OBRA CIVIL"


# ------------------------------------------------------------------ género, artículos, plurales
@pytest.mark.parametrize("nombre,genero", [
    ("Frente", "m"), ("Partida", "f"), ("Tramo", "m"), ("Estructura", "f"), ("Concepto", "m"),
    ("Actividad", "f"), ("Capítulo", "m"), ("Sistema", "m"), ("Nivel", "m"), ("Etapa", "f"),
    ("Fase", "f"), ("Estación", "f"), ("Obra civil", "f"), ("Sub-partida", "f"), ("Programa", "m"),
    ("Mano de obra", "f"), ("Día", "m"), ("Torre", "f"), ("Zona", "f"), ("Edificio", "m"),
])
def test_genero_de_nombres_de_nivel(nombre, genero):
    assert server.genero_nombre_es(nombre) == genero


def test_override_de_genero_por_dict_y_por_lista():
    assert server.genero_nombre_es("Tramo", override={"tramo": "f"}) == "f"
    assert server.genero_nombre_es("Tramo", override=["m", "f"], profundidad=1) == "f"
    assert server.genero_nombre_es("Partida", override={"otro": "m"}) == "f"      # sin coincidencia: heurística
    assert server.genero_nombre_es("Partida", override=["x"], profundidad=0) == "f"  # valor inválido: heurística


@pytest.mark.parametrize("singular,plural", [
    ("nivel", "niveles"), ("actividad", "actividades"), ("frente", "frentes"), ("capítulo", "capítulos"),
    ("estación", "estaciones"), ("sistema", "sistemas"), ("partida", "partidas"), ("concepto", "conceptos"),
    ("luz", "luces"), ("crisis", "crisis"), ("lunes", "lunes"), ("mes", "meses"), ("país", "países"),
    ("autobús", "autobuses"), ("inglés", "ingleses"), ("jardín", "jardines"), ("etapa", "etapas"),
    ("tramo", "tramos"), ("sub-partida", "sub-partidas"), ("etapa de obra", "etapas de obra"),
    ("obra civil", "obra civiles"), ("café", "cafés"), ("tabú", "tabúes"), ("estructura", "estructuras"),
])
def test_pluralizar_es(singular, plural):
    assert server.pluralizar_es(singular) == plural


def test_pluralizar_es_vacio():
    assert server.pluralizar_es("") == ""
    assert server.pluralizar_es(None) == ""


def test_articulos():
    assert server.articulo_es("Frente") == "el"
    assert server.articulo_es("Partida") == "la"
    assert server.articulo_es("Partida", definido=False) == "una"
    assert server.articulo_es("Frente", definido=False) == "un"
    assert server.articulo_es("Frente", plural=True) == "los"
    assert server.articulo_es("Partida", plural=True) == "las"
    assert server.articulo_es("Partida", definido=False, plural=True) == "unas"
    assert server.articulo_es("Área") == "el"          # a tónica
    assert server.articulo_es("Área", definido=False) == "un"


def test_nombres_nivel_por_defecto_son_los_historicos():
    n = server.nombres_nivel_proyecto(None)
    assert n["partida"]["nombre"] == "Partida" and n["partida"]["articulo"] == "la"
    assert n["partida"]["indefinido"] == "una" and n["partida"]["plural"] == "partidas"
    assert n["concepto"]["nombre"] == "Concepto" and n["concepto"]["articulo_plural"] == "los"


def test_nombres_nivel_configurados_y_profundidad():
    proyecto = {"nombres_niveles_partida": ["Frente", "Estructura", "Etapa"], "nombre_nivel_concepto": "Actividad"}
    assert server.nombres_nivel_proyecto(proyecto, 0)["partida"]["nombre"] == "Frente"
    assert server.nombres_nivel_proyecto(proyecto, 0)["partida"]["indefinido"] == "un"
    n1 = server.nombres_nivel_proyecto(proyecto, 1)["partida"]
    assert (n1["nombre"], n1["indefinido"], n1["plural"]) == ("Estructura", "una", "estructuras")
    assert server.nombres_nivel_proyecto(proyecto, 7)["partida"]["nombre"] == "Partida"   # fuera de rango
    c = server.nombres_nivel_proyecto(proyecto)["concepto"]
    assert (c["nombre"], c["articulo"], c["plural"], c["articulo_plural"]) == ("Actividad", "la", "actividades", "las")


def test_nombres_nivel_respeta_el_override_del_proyecto():
    proyecto = {"nombres_niveles_partida": ["Tramo"], "genero_niveles": {"tramo": "f"}}
    n = server.nombres_nivel_proyecto(proyecto)["partida"]
    assert (n["genero"], n["articulo"], n["indefinido"]) == ("f", "la", "una")


# ------------------------------------------------------------------ mensajes con el nombre del nivel
class _Col:
    def __init__(self, docs):
        self.docs = docs

    async def find_one(self, filtro, *a, **k):
        for d in self.docs:
            if all(d.get(c) == v for c, v in filtro.items()):
                return dict(d)
        return None


class _Db:
    def __init__(self, proyecto=None, partidas=None, conceptos=None):
        self.projects = _Col([proyecto] if proyecto else [])
        self.partidas = _Col(partidas or [])
        self.conceptos = _Col(conceptos or [])


def test_niveles_de_proyecto_lee_el_proyecto_y_cae_a_los_historicos(monkeypatch):
    monkeypatch.setattr(server, "db", _Db({"id": "p1", "nombre_nivel_concepto": "Actividad"}))
    assert asyncio.run(server._niveles_de_proyecto("p1"))["concepto"]["nombre"] == "Actividad"
    assert asyncio.run(server._niveles_de_proyecto("otro"))["concepto"]["nombre"] == "Concepto"
    assert asyncio.run(server._niveles_de_proyecto(None))["partida"]["nombre"] == "Partida"


def test_niveles_de_proyecto_no_falla_si_la_base_no_responde(monkeypatch):
    class Rota:
        class projects:
            @staticmethod
            async def find_one(*a, **k):
                raise RuntimeError("sin conexión")

    monkeypatch.setattr(server, "db", Rota())
    assert asyncio.run(server._niveles_de_proyecto("p1"))["partida"]["nombre"] == "Partida"


def test_profundidad_de_partida_cuenta_ancestros(monkeypatch):
    partidas = [
        {"id": "a", "project_id": "p1", "partida_padre_id": None},
        {"id": "b", "project_id": "p1", "partida_padre_id": "a"},
        {"id": "c", "project_id": "p1", "partida_padre_id": "b"},
        {"id": "x", "project_id": "p1", "partida_padre_id": "y"},   # ciclo
        {"id": "y", "project_id": "p1", "partida_padre_id": "x"},
    ]
    monkeypatch.setattr(server, "db", _Db(partidas=partidas))
    assert asyncio.run(server._profundidad_partida("p1", "a")) == 0
    assert asyncio.run(server._profundidad_partida("p1", "c")) == 2
    assert asyncio.run(server._profundidad_partida("p1", None)) == 0
    assert asyncio.run(server._profundidad_partida("p1", "x")) <= 2   # no se cicla


COORD = {"id": "u1", "name": "Ana", "role": server.ROLE_COORD, "project_ids": ["p1"]}


def _pu_no_extraordinario(monkeypatch, proyecto):
    monkeypatch.setattr(server, "db", _Db(proyecto, conceptos=[{"id": "c1", "project_id": "p1", "extraordinario": False}]))

    async def acceso(user, pid):
        return proyecto

    monkeypatch.setattr(server, "ensure_project_access", acceso)
    body = server.PuExtraordinarioPatch(pu_estatus="autorizado", referencia="Convenio 1")
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.set_pu_extraordinario("c1", body, COORD))
    return e.value


def test_mensaje_de_pu_extraordinario_usa_el_nombre_configurado(monkeypatch):
    e = _pu_no_extraordinario(monkeypatch, {"id": "p1", "nombre_nivel_concepto": "Actividad"})
    assert e.status_code == 400
    assert e.detail == "Solo las actividades extraordinarias tienen P.U. por autorizar"


def test_mensaje_de_pu_extraordinario_por_defecto_no_cambia(monkeypatch):
    e = _pu_no_extraordinario(monkeypatch, {"id": "p1"})
    assert e.detail == "Solo los conceptos extraordinarios tienen P.U. por autorizar"


# ------------------------------------------------------------------ mensajes y marca en el código
def _textos_de_excepciones():
    arbol = ast.parse(Path(server.__file__).read_text(encoding="utf-8"))
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.Call) and getattr(nodo.func, "id", None) == "HTTPException":
            for c in ast.walk(nodo):
                if isinstance(c, ast.Constant) and isinstance(c.value, str):
                    yield c.lineno, c.value


def test_los_mensajes_de_error_no_tienen_las_faltas_corregidas():
    prohibidos = ["estacion es requerida", "estacion no puede", "requiere titulo", "Cuerpo requerido",
                  "Cuerpo máximo", "Cuerpo no puede", "Titulo requerido", "Titulo obligatorio"]
    malos = [(ln, t) for ln, t in _textos_de_excepciones() if any(p in t for p in prohibidos)]
    assert malos == []


def test_los_mensajes_de_noticias_hablan_de_contenido():
    textos = {t for _, t in _textos_de_excepciones()}
    assert {"Contenido requerido", "Contenido máximo 4000 caracteres", "Contenido no puede estar vacío"} <= textos


def test_ningun_texto_visible_dice_synco():
    """Solo el secreto por defecto (BOOTSTRAP_SECRET) conserva la palabra; ningún mensaje ni
    documento exportado debe decir SynCo."""
    fuente = Path(server.__file__).read_text(encoding="utf-8")
    restos = [m for m in re.findall(r"(?i)[^\n]*synco[^\n]*", fuente) if "BOOTSTRAP_SECRET" not in m]
    assert restos == []
