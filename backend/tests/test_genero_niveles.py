"""C-14: género gramatical de los nombres de nivel (`genero_niveles`) y mensajes de los importadores
con el nombre configurado. Núcleo puro + handlers con `db` falso: sin Mongo ni backend vivo."""
import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_genero_niveles")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402

COORD = {"id": "u1", "name": "Coord", "role": server.ROLE_COORD}


def _body(**extra):
    return server.ProjectIn(name="P", constructora="C", contract_number="1", **extra)


class TestModelo:
    def test_por_defecto_esta_vacio(self):
        assert _body().genero_niveles == {}
        assert server.ProjectPatch().genero_niveles is None
        assert server.ProjectOut.model_fields["genero_niveles"].default_factory() == {}

    def test_acepta_m_y_f(self):
        assert _body(genero_niveles={"Frente": "m", "Zona": "f"}).genero_niveles == {"Frente": "m", "Zona": "f"}

    @pytest.mark.parametrize("valor", ["x", "", "masculino", "M", None])
    def test_rechaza_cualquier_otro_valor(self, valor):
        with pytest.raises(ValidationError):
            _body(genero_niveles={"Frente": valor})
        with pytest.raises(ValidationError):
            server.ProjectPatch(genero_niveles={"Frente": valor})


class TestSanitizar:
    def test_limpia_espacios_en_las_claves(self):
        assert server.sanitizar_genero_niveles({"  Frente ": "m"}) == {"Frente": "m"}

    def test_vacio_o_none_da_dict_vacio(self):
        assert server.sanitizar_genero_niveles(None) == {}
        assert server.sanitizar_genero_niveles({}) == {}

    def test_clave_vacia_da_400(self):
        with pytest.raises(HTTPException) as e:
            server.sanitizar_genero_niveles({"   ": "m"})
        assert e.value.status_code == 400 and "vacío" in e.value.detail

    def test_clave_de_mas_de_60_caracteres_da_400(self):
        with pytest.raises(HTTPException) as e:
            server.sanitizar_genero_niveles({"a" * 61: "f"})
        assert e.value.status_code == 400 and "60" in e.value.detail
        assert server.sanitizar_genero_niveles({"a" * 60: "f"}) == {"a" * 60: "f"}

    def test_maximo_20_entradas(self):
        assert len(server.sanitizar_genero_niveles({f"N{i}": "m" for i in range(20)})) == 20
        with pytest.raises(HTTPException) as e:
            server.sanitizar_genero_niveles({f"N{i}": "m" for i in range(21)})
        assert e.value.status_code == 400 and "20" in e.value.detail

    def test_genero_invalido_da_400(self):
        with pytest.raises(HTTPException) as e:
            server.sanitizar_genero_niveles({"Frente": "x"})
        assert e.value.status_code == 400


class TestHandlers:
    def _db(self, existente=None):
        db = MagicMock()
        db.projects = MagicMock()
        db.projects.insert_one = AsyncMock()
        db.projects.find_one = AsyncMock(return_value=existente or {"id": "p1", "name": "P"})
        db.projects.update_one = AsyncMock()
        db.areas = MagicMock()
        db.areas.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
        server.db = db
        return db

    def test_crear_guarda_el_genero_limpio(self):
        db = self._db()
        asyncio.run(server.create_project(_body(genero_niveles={" Frente ": "f"}), COORD))
        assert db.projects.insert_one.await_args.args[0]["genero_niveles"] == {"Frente": "f"}

    def test_crear_sin_el_campo_guarda_vacio(self):
        db = self._db()
        asyncio.run(server.create_project(_body(), COORD))
        assert db.projects.insert_one.await_args.args[0]["genero_niveles"] == {}

    def test_actualizar_reemplaza_el_genero(self):
        db = self._db()
        asyncio.run(server.update_project("p1", server.ProjectPatch(genero_niveles={"Tramo": "m"}), COORD))
        cambios = db.projects.update_one.await_args.args[1]["$set"]
        assert cambios["genero_niveles"] == {"Tramo": "m"}

    def test_actualizar_con_dict_vacio_borra_los_overrides(self):
        db = self._db()
        asyncio.run(server.update_project("p1", server.ProjectPatch(genero_niveles={}), COORD))
        assert db.projects.update_one.await_args.args[1]["$set"]["genero_niveles"] == {}

    def test_actualizar_sin_el_campo_no_lo_toca(self):
        db = self._db()
        asyncio.run(server.update_project("p1", server.ProjectPatch(nombre_nivel_concepto="Actividad"), COORD))
        assert "genero_niveles" not in db.projects.update_one.await_args.args[1]["$set"]

    def test_actualizar_con_clave_invalida_da_400_y_no_escribe(self):
        db = self._db()
        with pytest.raises(HTTPException) as e:
            asyncio.run(server.update_project("p1", server.ProjectPatch(genero_niveles={" ": "m"}), COORD))
        assert e.value.status_code == 400
        db.projects.update_one.assert_not_called()

    def test_un_proyecto_anterior_sin_el_campo_se_lee_con_dict_vacio(self):
        salida = server._project_public({"id": "p1", "name": "P", "constructora": "C", "contract_number": "1"})
        assert salida["genero_niveles"] == {}

    def test_un_proyecto_con_el_campo_lo_devuelve_tal_cual(self):
        salida = server._project_public({"id": "p1", "name": "P", "genero_niveles": {"Frente": "f"}})
        assert salida["genero_niveles"] == {"Frente": "f"}


class TestNombresNivel:
    def test_el_override_manda_sobre_la_heuristica(self):
        # 'Frente' es masculino por heurística; el proyecto lo fuerza a femenino.
        p = {"nombres_niveles_partida": ["Frente"], "genero_niveles": {"Frente": "f"}}
        ficha = server.nombres_nivel_proyecto(p)["partida"]
        assert (ficha["genero"], ficha["articulo"], ficha["indefinido"], ficha["demostrativo"]) == ("f", "la", "una", "esta")

    def test_el_override_no_distingue_mayusculas(self):
        p = {"nombres_niveles_partida": ["frente"], "genero_niveles": {"Frente": "f"}}
        assert server.nombres_nivel_proyecto(p)["partida"]["genero"] == "f"

    def test_sin_override_se_deduce_por_la_palabra(self):
        p = {"nombres_niveles_partida": ["Tramo"], "nombre_nivel_concepto": "Actividad"}
        n = server.nombres_nivel_proyecto(p)
        assert (n["partida"]["genero"], n["partida"]["demostrativo"]) == ("m", "este")
        assert (n["concepto"]["genero"], n["concepto"]["demostrativo"]) == ("f", "esta")

    def test_el_concepto_tambien_admite_override(self):
        p = {"nombre_nivel_concepto": "Actividad", "genero_niveles": {"Actividad": "m"}}
        assert server.nombres_nivel_proyecto(p)["concepto"]["genero"] == "m"

    def test_con_los_nombres_por_defecto_el_texto_no_cambia(self):
        n = server.nombres_nivel_proyecto(None)
        assert (n["concepto"]["indefinido"], n["concepto"]["minuscula"], n["concepto"]["demostrativo"]) == ("un", "concepto", "este")
        assert (n["partida"]["indefinido"], n["partida"]["minuscula"]) == ("una", "partida")

    @pytest.mark.parametrize("nombre,demostrativo", [("Frente", "este"), ("Partida", "esta"), ("Tramo", "este"),
                                                      ("Estructura", "esta"), ("Sistema", "este"), ("Etapa", "esta"),
                                                      ("Zona", "esta"), ("Sección", "esta"), ("Capítulo", "este"),
                                                      ("Nivel", "este"), ("Área", "esta")])
    def test_demostrativo_para_nombres_de_distintos_tipos_de_obra(self, nombre, demostrativo):
        assert server.demostrativo_es(nombre) == demostrativo


class TestPluralConNumero:
    @pytest.mark.parametrize("nombre,plural", [("Nivel 3", "Niveles"), ("nivel 12", "niveles"), ("Nivel", "Niveles"),
                                                ("etapa de obra", "etapas de obra")])
    def test_un_nombre_generico_con_numero_no_produce_nivel_3s(self, nombre, plural):
        assert server.pluralizar_es(nombre) == plural


class TestMensajes:
    def test_concepto_no_existe_con_nombres_por_defecto(self):
        assert server.mensaje_concepto_no_existe("1.2", None) == "No existe ningún concepto con clave '1.2' en este proyecto"

    def test_concepto_no_existe_concuerda_en_femenino(self):
        proyecto = {"nombre_nivel_concepto": "Actividad"}
        assert server.mensaje_concepto_no_existe("A-1", proyecto) == "No existe ninguna actividad con clave 'A-1' en este proyecto"

    def test_concepto_no_existe_respeta_el_override(self):
        proyecto = {"nombre_nivel_concepto": "Actividad", "genero_niveles": {"Actividad": "m"}}
        assert "ningún actividad" in server.mensaje_concepto_no_existe("A-1", proyecto)

    def test_ambito_personalizado(self):
        texto = server.mensaje_concepto_no_existe("X", {"nombre_nivel_concepto": "Partida"}, "en el catálogo de este proyecto")
        assert texto == "No existe ninguna partida con clave 'X' en el catálogo de este proyecto"


def _mapping():
    return server.ImportMappingIn(clave="Clave", descripcion="Descripción", unidad="Unidad", cantidad="Cantidad",
                                  precio_unitario="P.U.")


def _filas(niveles=None, existentes=None):
    rows = [["Clave", "Descripción", "Unidad", "Cantidad", "P.U."], ["A-1", "Muro", "M2", 10, 0]]
    return server._validar_archivo_completo(
        rows, 0, _mapping(), None, existentes or {}, niveles=niveles,
    )


class TestImportadorConNombresConfigurados:
    def _motivos(self, filas):
        return [p["motivo"] for f in filas for p in f["problemas"]]

    def test_precio_cero_con_nombres_por_defecto_conserva_el_texto_de_siempre(self):
        assert "El precio unitario es 0; el importe de este concepto quedará en 0" in self._motivos(_filas())

    def test_precio_cero_con_concepto_femenino(self):
        niveles = server.nombres_nivel_proyecto({"nombre_nivel_concepto": "Actividad"})
        assert "El precio unitario es 0; el importe de esta actividad quedará en 0" in self._motivos(_filas(niveles))

    def test_clave_existente_usa_el_indefinido_correcto(self):
        niveles = server.nombres_nivel_proyecto({"nombre_nivel_concepto": "Actividad"})
        filas = _filas(niveles, existentes={"A-1": {"id": "c1"}})
        assert "Ya existe una actividad con clave 'A-1' en este proyecto" in self._motivos(filas)
        assert "Ya existe un concepto con clave 'A-1' en este proyecto" in self._motivos(_filas(existentes={"A-1": {"id": "c1"}}))
