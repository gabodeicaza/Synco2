"""Tipo de obra (K-13 / T-10): el tipo decide los módulos y plantillas por defecto de un
proyecto NUEVO; los proyectos anteriores (sin el campo) se leen como "legado" y conservan
su comportamiento; las etapas de poste dejan de ser el valor por defecto y pasan a una
plantilla opcional. Núcleo puro + handlers con `db` falso: sin Mongo ni backend vivo."""
import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_tipo_obra")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

COORD = {"id": "u1", "name": "Coord", "role": server.ROLE_COORD}
ESPECIALISTA = {"id": "u2", "name": "Esp", "role": server.ROLE_ESPECIALISTA}
BASE = dict(name="Prueba", constructora="Constructora", contract_number="C-1")
CATEGORIAS = list(server.MODULOS_CATALOG)


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *a, **k):
        return self

    async def to_list(self, length=None):
        return [dict(d) for d in self.docs]


def _db_proyectos(existente=None):
    db = MagicMock()
    db.projects = MagicMock()
    db.projects.insert_one = AsyncMock()
    db.projects.update_one = AsyncMock()
    db.projects.find_one = AsyncMock(return_value=existente)
    server.db = db
    return db


def _crear(**extra):
    db = _db_proyectos()
    asyncio.run(server.create_project(server.ProjectIn(**BASE, **extra), COORD))
    return db.projects.insert_one.await_args.args[0]


def _encendidos(modulos):
    return {(cat, clave) for cat, mods in modulos.items() for clave, activo in mods.items() if activo}


# ---------------------------------------------------------------- modelo
def test_el_proyecto_nuevo_es_generica_por_defecto():
    assert server.ProjectIn(**BASE).tipo_obra == "generica"


@pytest.mark.parametrize("tipo", ["generica", "carretera", "edificacion", "hidraulica", "puente"])
def test_acepta_los_cinco_tipos(tipo):
    assert server.ProjectIn(**BASE, tipo_obra=tipo).tipo_obra == tipo
    assert server.ProjectPatch(tipo_obra=tipo).tipo_obra == tipo


@pytest.mark.parametrize("valor", ["legado", "cablebus", "", "Puente", "otro"])
def test_rechaza_cualquier_otro_valor_incluido_legado(valor):
    with pytest.raises(ValidationError):
        server.ProjectIn(**BASE, tipo_obra=valor)
    with pytest.raises(ValidationError):
        server.ProjectPatch(tipo_obra=valor)


def test_patch_sin_tipo_no_lo_toca():
    assert server.ProjectPatch().tipo_obra is None


# ---------------------------------------------------------------- creación
def test_crear_sin_tipo_guarda_generica_y_sus_modulos_por_defecto():
    doc = _crear()
    assert doc["tipo_obra"] == "generica"
    assert doc["modulos"] == server.modulos_por_defecto_de_tipo("generica")
    assert doc["modulos"]["reportes_diarios"]["seguridad_higiene"] is True


@pytest.mark.parametrize("tipo", server.TIPOS_OBRA_IDS)
def test_cada_tipo_aplica_sus_modulos_y_nunca_enciende_control_de_obra(tipo):
    doc = _crear(tipo_obra=tipo)
    assert doc["modulos"] == server.modulos_por_defecto_de_tipo(tipo)
    assert _encendidos(doc["modulos"])  # algo queda encendido
    assert all(clave != "control_obra" for _, clave in _encendidos(doc["modulos"]))


def test_los_tipos_encienden_modulos_distintos():
    generica = _encendidos(server.modulos_por_defecto_de_tipo("generica"))
    puente = _encendidos(server.modulos_por_defecto_de_tipo("puente"))
    assert ("reportes_mensuales", "impacto_ambiental") in puente
    assert ("reportes_mensuales", "impacto_ambiental") not in generica


def test_modulos_explicitos_mandan_sobre_el_tipo():
    doc = _crear(tipo_obra="puente", modulos={"reportes_diarios": {"forestal_arbolado": True}})
    assert _encendidos(doc["modulos"]) == {("reportes_diarios", "forestal_arbolado")}


def test_modulos_explicitos_vacios_dejan_todo_apagado():
    doc = _crear(tipo_obra="carretera", modulos={})
    assert _encendidos(doc["modulos"]) == set()


def test_un_proyecto_nuevo_no_recibe_etapas_de_poste():
    assert _crear()["etapas_poste"] == []
    assert _crear(tipo_obra="edificacion")["etapas_poste"] == []


def test_etapas_explicitas_se_conservan():
    etapas = [server.EtapaPosteElemento(nombre="Losa", actividades=["Colado"])]
    doc = _crear(etapas_poste=etapas)
    assert doc["etapas_poste"] == [{"nombre": "Losa", "actividades": ["Colado"]}]


# ---------------------------------------------------------------- lectura / legado
def test_proyecto_anterior_se_lee_como_legado_con_sus_etapas_de_siempre():
    salida = server._project_public({"id": "p1", "name": "Viejo", "constructora": "C", "contract_number": "1"})
    assert salida["tipo_obra"] == "legado"
    assert salida["etapas_poste"] == server.PLANTILLA_ETAPAS_CIMENTACION_POSTES
    assert _encendidos(salida["modulos"]) == set()


def test_leer_no_escribe_el_campo_en_la_base_de_datos():
    db = _db_proyectos({"id": "p1", "name": "Viejo"})
    doc = {"id": "p1", "name": "Viejo"}
    server._project_public(doc)
    assert "tipo_obra" not in doc  # copia superficial: el original no cambia
    db.projects.update_one.assert_not_called()


def test_proyecto_anterior_conserva_sus_modulos_encendidos():
    modulos = server.modulos_por_defecto_de_tipo("legado")
    modulos["reportes_diarios"]["control_obra"] = True
    salida = server._project_public({"id": "p1", "name": "Viejo", "modulos": modulos})
    assert ("reportes_diarios", "control_obra") in _encendidos(salida["modulos"])
    assert salida["tipo_obra"] == "legado"


def test_proyecto_con_tipo_y_sin_etapas_guardadas_devuelve_lista_vacia():
    salida = server._project_public({"id": "p1", "name": "Nuevo", "tipo_obra": "generica"})
    assert salida["tipo_obra"] == "generica" and salida["etapas_poste"] == []


@pytest.mark.parametrize(
    "proyecto,esperado",
    [
        ({}, server.PLANTILLA_ETAPAS_CIMENTACION_POSTES),                                     # legado sin etapas
        ({"etapas_poste": []}, server.PLANTILLA_ETAPAS_CIMENTACION_POSTES),                   # legado con [] (como siempre)
        ({"etapas_poste": [{"nombre": "A", "actividades": ["x"]}]}, [{"nombre": "A", "actividades": ["x"]}]),
        ({"tipo_obra": "generica"}, []),
        ({"tipo_obra": "generica", "etapas_poste": []}, []),
        ({"tipo_obra": "puente", "etapas_poste": [{"nombre": "B", "actividades": ["y"]}]}, [{"nombre": "B", "actividades": ["y"]}]),
    ],
)
def test_etapas_poste_de(proyecto, esperado):
    assert server.etapas_poste_de(proyecto) == esperado


def test_lista_de_proyectos_incluye_el_tipo():
    db = MagicMock()
    db.projects = MagicMock()
    db.projects.find = MagicMock(return_value=_Cursor([{"id": "a", "name": "A"}, {"id": "b", "name": "B", "tipo_obra": "puente"}]))
    server.db = db
    salida = asyncio.run(server.list_projects(COORD))
    assert [p["tipo_obra"] for p in salida] == ["legado", "puente"]


# ---------------------------------------------------------------- consumidores de etapas vacías
def _db_nodo():
    db = MagicMock()
    db.location_nodes = MagicMock()
    db.location_nodes.find_one = AsyncMock(return_value={"id": "n1", "project_id": "p1"})
    db.location_nodes.update_one = AsyncMock()
    server.db = db
    return db


def _actividad(monkeypatch, proyecto, clave):
    proyecto = {"id": "p1", "modulos": {"reportes_diarios": {"control_obra": True}}, **proyecto}
    db = _db_nodo()

    async def acceso(user, pid):
        return proyecto

    monkeypatch.setattr(server, "ensure_project_access", acceso)
    body = server.PosteActividadEstatusPatch(actividad_key=clave, estatus="concluido")
    return asyncio.run(server.update_poste_actividad_estatus("n1", body, COORD)), db


def test_proyecto_con_etapas_vacias_rechaza_la_actividad_sin_romperse(monkeypatch):
    with pytest.raises(HTTPException) as e:
        _actividad(monkeypatch, {"tipo_obra": "generica", "etapas_poste": []}, "Pilas::Colado")
    assert e.value.status_code == 400 and "no es una actividad configurada" in e.value.detail


def test_proyecto_anterior_sigue_aceptando_las_actividades_de_siempre(monkeypatch):
    _, db = _actividad(monkeypatch, {}, "Pilas::Colado")
    db.location_nodes.update_one.assert_awaited()


def test_proyecto_nuevo_con_plantilla_aplicada_acepta_sus_actividades(monkeypatch):
    etapas = [{"nombre": "Pilas", "actividades": ["Colado"]}]
    _, db = _actividad(monkeypatch, {"tipo_obra": "generica", "etapas_poste": etapas}, "Pilas::Colado")
    db.location_nodes.update_one.assert_awaited()


# ---------------------------------------------------------------- cambiar el tipo
def _patch(existente, **cuerpo):
    db = _db_proyectos(existente)
    asyncio.run(server.update_project("p1", server.ProjectPatch(**cuerpo), COORD))
    llamadas = db.projects.update_one.await_args_list
    return llamadas[0].args[1]["$set"] if llamadas else None


def test_cambiar_el_tipo_no_reescribe_modulos_ni_etapas_guardadas():
    modulos = server.modulos_por_defecto_de_tipo("generica")
    etapas = [{"nombre": "A", "actividades": ["x"]}]
    cambio = _patch({"id": "p1", "name": "P", "tipo_obra": "generica", "modulos": modulos, "etapas_poste": etapas}, tipo_obra="carretera")
    assert cambio == {"tipo_obra": "carretera"}


def test_un_proyecto_anterior_que_cambia_de_tipo_conserva_sus_etapas_implicitas():
    cambio = _patch({"id": "p1", "name": "Viejo"}, tipo_obra="carretera")
    assert cambio["tipo_obra"] == "carretera"
    assert cambio["etapas_poste"] == server.PLANTILLA_ETAPAS_CIMENTACION_POSTES
    assert "modulos" not in cambio


def test_un_proyecto_anterior_con_etapas_guardadas_no_las_reescribe_al_cambiar_de_tipo():
    cambio = _patch({"id": "p1", "name": "Viejo", "etapas_poste": [{"nombre": "A", "actividades": ["x"]}]}, tipo_obra="edificacion")
    assert cambio == {"tipo_obra": "edificacion"}


def test_mandar_el_mismo_tipo_no_escribe_nada():
    assert _patch({"id": "p1", "name": "P", "tipo_obra": "puente"}, tipo_obra="puente") is None


# ---------------------------------------------------------------- catálogo de tipos
def test_catalogo_de_tipos_no_incluye_legado_y_trae_lo_necesario():
    _db_proyectos()
    catalogo = asyncio.run(server.list_tipos_obra(COORD))
    assert [t["id"] for t in catalogo] == ["generica", "carretera", "edificacion", "hidraulica", "puente"]
    assert {t["nombre"] for t in catalogo} == {"Genérica", "Carretera", "Edificación", "Hidráulica", "Puente"}
    for t in catalogo:
        assert t["descripcion"]
        assert set(t["modulos_por_defecto"]) == set(CATEGORIAS)
        assert t["plantillas_recomendadas"]


def test_las_plantillas_recomendadas_existen_y_sirven_para_su_tipo():
    codigos = {t["code"]: t for t in server.SEED_REPORT_TEMPLATES}
    for t in server.catalogo_tipos_obra():
        for codigo in t["plantillas_recomendadas"]:
            assert codigo in codigos, codigo
            assert server.plantilla_visible_para_tipo(codigos[codigo], t["id"]), (t["id"], codigo)


def test_los_modulos_de_cada_tipo_son_claves_conocidas():
    for definicion in server.TIPOS_OBRA.values():
        assert set(definicion["modulos"]) <= server.MODULOS_KEYS
        for categorias in definicion["modulos"].values():
            assert set(categorias) <= set(CATEGORIAS)


# ---------------------------------------------------------------- filtro de plantillas
def _db_plantillas():
    docs = [dict(t, id=t["code"]) for t in server.SEED_REPORT_TEMPLATES]
    for d in docs:
        d.pop("tipos_obra", None)  # como las ya sembradas en la base antes del campo
    docs.append({"id": "x", "code": "personalizada", "name": "Personalizada", "category": "General", "fields": []})
    docs.append({"id": "y", "code": "solo_puentes", "name": "Solo puentes", "category": "General", "fields": [], "tipos_obra": ["puente"]})
    db = MagicMock()
    db.report_templates = MagicMock()
    db.report_templates.find = MagicMock(return_value=_Cursor(docs))
    server.db = db


def _codigos(tipo=None):
    _db_plantillas()
    return {t["code"] for t in asyncio.run(server.list_report_templates(tipo_obra=tipo, user=COORD))}


def test_sin_tipo_devuelve_todas_como_hoy():
    todas = {t["code"] for t in server.SEED_REPORT_TEMPLATES} | {"personalizada", "solo_puentes"}
    assert _codigos() == todas
    assert _codigos("legado") == todas


def test_carretera_excluye_la_prueba_de_pilas_y_lo_que_es_solo_de_puentes():
    codigos = _codigos("carretera")
    assert "calidad_pit_concreto" not in codigos and "solo_puentes" not in codigos
    assert {"obra_civil", "hse", "reporte_libre", "personalizada"} <= codigos


def test_puente_incluye_la_prueba_de_pilas_y_lo_propio():
    assert {"calidad_pit_concreto", "solo_puentes", "personalizada"} <= _codigos("puente")


def test_cada_plantilla_sale_con_su_campo_tipos_obra():
    _db_plantillas()
    for t in asyncio.run(server.list_report_templates(tipo_obra=None, user=COORD)):
        assert isinstance(t["tipos_obra"], list) and t["tipos_obra"]


def test_tipo_de_plantillas_invalido_da_400():
    _db_plantillas()
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.list_report_templates(tipo_obra="cablebus", user=COORD))
    assert e.value.status_code == 400


def test_las_plantillas_sembradas_declaran_tipos_obra():
    assert all(t.get("tipos_obra") for t in server.SEED_REPORT_TEMPLATES)


# ---------------------------------------------------------------- plantilla opcional de etapas
def test_catalogo_de_plantillas_de_etapas():
    plantillas = asyncio.run(server.list_plantillas_etapas_poste(COORD))
    assert [p["id"] for p in plantillas] == ["cimentacion_postes"]
    assert [e["nombre"] for e in plantillas[0]["etapas"]] == ["Pilas", "Cabezal", "Fuste", "Poste"]


def test_aplicar_la_plantilla_copia_las_etapas_al_proyecto():
    db = _db_proyectos({"id": "p1", "name": "P", "tipo_obra": "generica", "etapas_poste": []})
    asyncio.run(server.aplicar_plantilla_etapas_poste("p1", server.AplicarPlantillaEtapasIn(plantilla="cimentacion_postes"), COORD))
    etapas = db.projects.update_one.await_args.args[1]["$set"]["etapas_poste"]
    assert etapas == server.PLANTILLA_ETAPAS_CIMENTACION_POSTES


def test_aplicar_plantilla_desconocida_da_400_y_no_escribe():
    db = _db_proyectos({"id": "p1", "name": "P"})
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.aplicar_plantilla_etapas_poste("p1", server.AplicarPlantillaEtapasIn(plantilla="otra"), COORD))
    assert e.value.status_code == 400
    db.projects.update_one.assert_not_called()


def test_aplicar_plantilla_a_proyecto_inexistente_da_404():
    _db_proyectos(None)
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.aplicar_plantilla_etapas_poste("nada", server.AplicarPlantillaEtapasIn(plantilla="cimentacion_postes"), COORD))
    assert e.value.status_code == 404


def test_solo_el_coordinador_general_puede_aplicar_la_plantilla():
    dependencia = server.require_role(server.ROLE_COORD)
    assert asyncio.run(dependencia(COORD)) == COORD
    with pytest.raises(HTTPException) as e:
        asyncio.run(dependencia(ESPECIALISTA))
    assert e.value.status_code == 403
    rutas = {(r.path, tuple(sorted(r.methods))) for r in server.api.routes}
    assert ("/api/projects/{pid}/etapas_poste/aplicar-plantilla", ("POST",)) in rutas or any(
        getattr(r, "path", "").endswith("/etapas_poste/aplicar-plantilla") for r in server.api.routes
    )
