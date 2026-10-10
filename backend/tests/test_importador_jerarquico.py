"""C-01 (importador jerárquico) y C-03 (cantidad <= 0 solo con marca deductiva).
Núcleo puro + validación + commit con colecciones falsas: sin Mongo ni backend vivo."""
import asyncio
import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_importador_jerarquico")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from server import ImportMappingIn  # noqa: E402

USER = {"id": "u1", "name": "Ana"}
HEADERS = ["Clave", "Descripcion", "Unidad", "Cantidad", "PU", "Deductiva"]
MAPPING = ImportMappingIn(
    clave="Clave", descripcion="Descripcion", unidad="Unidad", cantidad="Cantidad",
    precio_unitario="PU", deductiva="Deductiva",
)


def correr(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------------ helpers puros
class TestJerarquiaPorClave:
    def test_ancestros_del_mas_cercano_al_mas_lejano(self):
        assert server.ancestros_de_clave("1.1.2") == ["1.1", "1"]
        assert server.ancestros_de_clave("1.1") == ["1"]
        assert server.ancestros_de_clave("1") == []
        assert server.ancestros_de_clave("C-001") == []

    def test_padre_es_la_partida_mas_cercana_que_exista(self):
        assert server.padre_por_prefijo("1.1.2", {"1", "1.1"}) == "1.1"
        assert server.padre_por_prefijo("1.1.2", {"1"}) == "1"  # salta un nivel ausente
        assert server.padre_por_prefijo("1.1.2", set()) is None
        assert server.padre_por_prefijo("2.1", {"1"}) is None

    def test_no_confunde_prefijos_de_texto_con_niveles(self):
        # "10" NO es padre de "1.5" ni "1" de "11.2": el prefijo es por segmento completo.
        assert server.padre_por_prefijo("11.2", {"1"}) is None
        assert server.padre_por_prefijo("1.5", {"10"}) is None

    def test_clave_numerica_de_excel(self):
        assert server.clave_a_texto(1.0) == "1"
        assert server.clave_a_texto(1.1) == "1.1"
        assert server.clave_a_texto("  2.3 ") == "2.3"
        assert server.clave_a_texto("") is None and server.clave_a_texto(None) is None

    def test_fila_partida_es_la_que_no_trae_valores_numericos(self):
        assert server.es_fila_partida(None, "") is True
        assert server.es_fila_partida("  ", None) is True
        assert server.es_fila_partida("10", None) is False
        assert server.es_fila_partida(0, None) is False  # un 0 escrito no es "vacío"

    def test_marca_deductiva(self):
        for v in ("SI", "sí", "X", "x", "1", "Deductiva", True):
            assert server.es_marca_deductiva(v) is True, v
        for v in (None, "", "no", "0", False, "normal"):
            assert server.es_marca_deductiva(v) is False, v

    def test_plan_de_partidas_crea_padres_antes_que_hijos_y_reusa_existentes(self):
        filas = [
            {"clave": "1.1.1", "descripcion": "Hoja"},
            {"clave": "1", "descripcion": "Raíz"},
            {"clave": "1.1", "descripcion": "Medio"},
            {"clave": "2", "descripcion": "Otra raíz"},
        ]
        plan = server.planificar_partidas(filas, {"2": "id-existente-2"})
        assert [p["clave"] for p in plan] == ["1", "1.1", "1.1.1"]  # "2" ya existe: se reutiliza
        assert [p["padre_clave"] for p in plan] == [None, "1", "1.1"]

    def test_plan_de_partidas_no_duplica_claves(self):
        plan = server.planificar_partidas([{"clave": "1", "descripcion": "a"}, {"clave": "1", "descripcion": "b"}], {})
        assert len(plan) == 1


# ------------------------------------------------------------------ validación y vista
def _vista(filas_excel, contexto=None, correcciones=None, existing=None, partidas_existentes=None):
    filas = server._validar_archivo_completo(
        [HEADERS] + filas_excel, 0, MAPPING, None, existing or {}, partidas_existentes=partidas_existentes,
    )
    return filas, server._calcular_vista_filas(filas, correcciones or {}, contexto=contexto)


ARBOL = [
    ["1", "Preliminares", None, None, None, None],
    ["1.1", "Trazo", None, None, None, None],
    ["1.1.1", "Trazo y nivelación", "M2", "100", "12.50", None],
    ["1.1.2", "Limpieza", "M2", "80", "5", None],
    ["2", "Cimentación", None, None, None, None],
    ["2.1", "Excavación", "M3", "50", "140", None],
]


class TestValidacionJerarquica:
    def test_las_filas_sin_cantidad_ni_pu_son_partidas_no_errores(self):
        filas, vista = _vista(ARBOL)
        tipos = {f["clave"]: f["tipo_fila"] for f in filas}
        assert tipos == {"1": "partida", "1.1": "partida", "1.1.1": "concepto", "1.1.2": "concepto", "2": "partida", "2.1": "concepto"}
        assert all(v["estado"] == "ok" for v in vista)

    def test_una_fila_a_medias_sigue_siendo_error(self):
        _, vista = _vista([["1.1.1", "Trazo", "M2", "100", None, None]])
        fila = vista[0]
        assert fila["tipo_fila"] == "concepto" and fila["estado"] == "error"
        assert any(p["campo"] == "precio_unitario" for p in fila["problemas_activos"])

    def test_sin_destino_un_concepto_huerfano_es_error(self):
        _, vista = _vista([["9.9", "Suelto", "M2", "1", "1", None]], contexto={"tiene_destino": False, "claves_partida_existentes": []})
        assert vista[0]["estado"] == "error"
        assert any(p["tipo"] == "sin_partida_destino" for p in vista[0]["problemas_activos"])

    def test_con_destino_el_huerfano_es_valido(self):
        _, vista = _vista([["9.9", "Suelto", "M2", "1", "1", None]], contexto={"tiene_destino": True, "claves_partida_existentes": []})
        assert vista[0]["estado"] == "ok"

    def test_sin_destino_basta_la_partida_del_archivo(self):
        _, vista = _vista(ARBOL, contexto={"tiene_destino": False, "claves_partida_existentes": []})
        assert all(v["estado"] == "ok" for v in vista)

    def test_sin_destino_basta_una_partida_ya_existente_en_el_proyecto(self):
        _, vista = _vista([["5.1", "Suelto", "M2", "1", "1", None]], contexto={"tiene_destino": False, "claves_partida_existentes": ["5"]})
        assert vista[0]["estado"] == "ok"

    def test_descartar_la_partida_deja_huerfanos_a_sus_hijos(self):
        filas, _ = _vista(ARBOL)
        fila_partida_1 = next(f["fila"] for f in filas if f["clave"] == "1")
        fila_partida_11 = next(f["fila"] for f in filas if f["clave"] == "1.1")
        vista = server._calcular_vista_filas(
            filas, {str(fila_partida_1): {"descartar": True}, str(fila_partida_11): {"descartar": True}},
            contexto={"tiene_destino": False, "claves_partida_existentes": []},
        )
        hijos = [v for v in vista if v["clave"] in ("1.1.1", "1.1.2")]
        assert all(v["estado"] == "error" for v in hijos)

    def test_los_nombres_de_nivel_no_intervienen(self):
        """La jerarquía sale de la clave: el mismo archivo con claves genéricas funciona igual."""
        filas = [
            ["A", "Capítulo A", None, None, None, None],
            ["A.1", "Sub A1", "PZA", "3", "10", None],
        ]
        _, vista = _vista(filas, contexto={"tiene_destino": False, "claves_partida_existentes": []})
        assert [v["estado"] for v in vista] == ["ok", "ok"]


class TestCantidadesNoPositivas:
    def test_cero_y_negativo_se_rechazan_sin_marca(self):
        for q in ("0", "-5", "-0.01"):
            _, vista = _vista([["1", "X", "M2", q, "10", None]])
            assert vista[0]["estado"] == "error", q
            assert any(p["tipo"] == "cantidad_no_positiva" for p in vista[0]["problemas_activos"])

    def test_la_marca_deductiva_permite_cero_y_negativo(self):
        for q in ("0", "-5"):
            _, vista = _vista([["1", "Deductiva", "M2", q, "10", "SI"]])
            assert vista[0]["estado"] == "ok", q
            assert vista[0]["deductiva"] is True

    def test_una_cantidad_positiva_no_necesita_marca(self):
        _, vista = _vista([["1", "X", "M2", "5", "10", None]])
        assert vista[0]["estado"] == "ok" and vista[0]["deductiva"] is False

    def test_corregir_a_positivo_resuelve_el_error(self):
        filas, vista = _vista([["1", "X", "M2", "-5", "10", None]])
        corr = {str(filas[0]["fila"]): {"cantidad": "5"}}
        assert server._calcular_vista_filas(filas, corr)[0]["estado"] == "ok"

    def test_corregir_a_otro_valor_no_positivo_sigue_siendo_error(self):
        filas, _ = _vista([["1", "X", "M2", "-5", "10", None]])
        corr = {str(filas[0]["fila"]): {"cantidad": "0"}}
        assert server._calcular_vista_filas(filas, corr)[0]["estado"] == "error"


# ------------------------------------------------------------------ commit
class Col:
    """Colección falsa mínima (insert/find/update/delete por id) para el commit."""

    def __init__(self, docs=None, falla_en_insert=None):
        self.docs = {d["id"]: dict(d) for d in (docs or [])}
        self.falla_en_insert = falla_en_insert
        self.inserts = 0

    def find(self, filtro):
        docs = [d for d in self.docs.values() if all(d.get(k) == v for k, v in filtro.items())]

        class _It:
            def __aiter__(self_inner):
                async def gen():
                    for d in docs:
                        yield dict(d)
                return gen()

        return _It()

    async def find_one(self, filtro):
        return next((dict(d) for d in self.docs.values() if all(d.get(k) == v for k, v in filtro.items())), None)

    async def insert_one(self, doc):
        self.inserts += 1
        if self.falla_en_insert and self.inserts == self.falla_en_insert:
            raise RuntimeError("fallo simulado")
        self.docs[doc["id"]] = dict(doc)

    async def update_one(self, filtro, upd):
        d = self.docs.get(filtro.get("id"))
        if d is not None:
            d.update(upd.get("$set", {}))
            for k, v in upd.get("$push", {}).items():
                d.setdefault(k, []).append(v)

    async def delete_one(self, filtro):
        self.docs.pop(filtro.get("id"), None)


async def _bitacora(*a, **k):
    return None


def _commit(vista, partida_id, conceptos, partidas, sesiones=None):
    return correr(server._ejecutar_commit_con_compensacion(
        conceptos, sesiones or Col([{"id": "imp"}]), _bitacora, "p1", "imp", partida_id, vista, "omitir", USER, "a.xlsx",
        partidas_col=partidas,
    ))


class TestCommitJerarquico:
    def test_crea_el_arbol_y_cuelga_cada_concepto_de_su_partida(self):
        _, vista = _vista(ARBOL, contexto={"tiene_destino": False, "claves_partida_existentes": []})
        conceptos, partidas = Col(), Col()
        r = _commit(vista, None, conceptos, partidas)
        assert r["partidas_creadas"] == 3 and r["creados"] == 3 and r["sin_partida"] == 0
        por_clave = {p["clave"]: p for p in partidas.docs.values()}
        assert por_clave["1"]["partida_padre_id"] is None
        assert por_clave["1.1"]["partida_padre_id"] == por_clave["1"]["id"]
        assert por_clave["2"]["partida_padre_id"] is None
        assert por_clave["1.1"]["nombre"] == "Trazo"
        cpto = {c["clave"]: c for c in conceptos.docs.values()}
        assert cpto["1.1.1"]["partida_id"] == por_clave["1.1"]["id"]
        assert cpto["1.1.2"]["partida_id"] == por_clave["1.1"]["id"]
        assert cpto["2.1"]["partida_id"] == por_clave["2"]["id"]

    def test_la_partida_destino_es_solo_la_raiz_opcional(self):
        _, vista = _vista(ARBOL, contexto={"tiene_destino": True, "claves_partida_existentes": []})
        conceptos, partidas = Col(), Col()
        _commit(vista, "nodo-existente", conceptos, partidas)
        por_clave = {p["clave"]: p for p in partidas.docs.values()}
        assert por_clave["1"]["partida_padre_id"] == "nodo-existente"
        assert por_clave["2"]["partida_padre_id"] == "nodo-existente"
        assert por_clave["1.1"]["partida_padre_id"] == por_clave["1"]["id"]

    def test_un_concepto_huerfano_con_destino_va_al_destino(self):
        _, vista = _vista([["9", "Suelto", "M2", "1", "1", None]], contexto={"tiene_destino": True, "claves_partida_existentes": []})
        conceptos, partidas = Col(), Col()
        _commit(vista, "destino", conceptos, partidas)
        assert next(iter(conceptos.docs.values()))["partida_id"] == "destino"

    def test_reimportar_es_idempotente_y_no_duplica_partidas(self):
        conceptos, partidas = Col(), Col()
        _, vista1 = _vista(ARBOL, contexto={"tiene_destino": False, "claves_partida_existentes": []})
        r1 = _commit(vista1, None, conceptos, partidas)
        existentes = {p["clave"]: p["id"] for p in partidas.docs.values()}
        ya = {c["clave"]: {"id": c["id"]} for c in conceptos.docs.values()}
        _, vista2 = _vista(ARBOL, contexto={"tiene_destino": False, "claves_partida_existentes": list(existentes)}, existing=ya, partidas_existentes=existentes)
        r2 = _commit(vista2, None, conceptos, partidas)
        assert r1["partidas_creadas"] == 3
        assert r2["partidas_creadas"] == 0 and r2["creados"] == 0  # las claves ya existen: se omiten
        assert len(partidas.docs) == 3 and len(conceptos.docs) == 3

    def test_reusa_una_partida_existente_con_la_misma_clave(self):
        partidas = Col([{"id": "pa-1", "project_id": "p1", "clave": "1", "nombre": "Ya estaba", "activo": True}])
        conceptos = Col()
        filas = [["1", "Preliminares (archivo)", None, None, None, None], ["1.1", "Trazo", "M2", "3", "4", None]]
        _, vista = _vista(filas, contexto={"tiene_destino": False, "claves_partida_existentes": ["1"]}, partidas_existentes={"1": "pa-1"})
        r = _commit(vista, None, conceptos, partidas)
        assert r["partidas_creadas"] == 0
        assert next(iter(conceptos.docs.values()))["partida_id"] == "pa-1"
        assert partidas.docs["pa-1"]["nombre"] == "Ya estaba"  # no se pisa lo existente

    def test_el_concepto_deductivo_se_guarda_con_su_marca(self):
        _, vista = _vista([["1", "Deductiva", "M2", "-5", "10", "SI"]], contexto={"tiene_destino": True, "claves_partida_existentes": []})
        conceptos = Col()
        _commit(vista, "d", conceptos, Col())
        c = next(iter(conceptos.docs.values()))
        assert c["deductiva"] is True and c["cantidad"] == "-5"

    def test_si_falla_a_la_mitad_se_revierten_tambien_las_partidas(self):
        _, vista = _vista(ARBOL, contexto={"tiene_destino": False, "claves_partida_existentes": []})
        conceptos, partidas = Col(falla_en_insert=2), Col()
        with pytest.raises(Exception) as e:
            _commit(vista, None, conceptos, partidas)
        assert "revirtió" in str(getattr(e.value, "detail", e.value))
        assert partidas.docs == {} and conceptos.docs == {}

    def test_sin_partida_y_sin_destino_se_cuenta_y_no_se_crea(self):
        # Sin contexto no se marcó como error en la vista; el commit igual se protege.
        filas = [["9", "Suelto", "M2", "1", "1", None]]
        _, vista = _vista(filas)
        conceptos = Col()
        r = _commit(vista, None, conceptos, Col())
        assert r["sin_partida"] == 1 and r["creados"] == 0 and conceptos.docs == {}
