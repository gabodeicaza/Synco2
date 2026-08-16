"""Tests del wizard de importación del Programa desglosado (Etapa 2, parte
2/2): _validar_archivo_programa_completo, _calcular_vista_programa, y el
commit versionado con compensación (_ejecutar_commit_programa_con_compensacion)
usando colecciones Mongo FALSAS en memoria, mismo criterio que
test_import_commit_compensacion.py del catálogo.
"""
import asyncio
import functools
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_programa_wizard")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import (
    _validar_archivo_programa_completo,
    _calcular_vista_programa,
    _resumen_de_vista_programa,
    _ejecutar_commit_programa_con_compensacion,
    ProgramaImportMappingIn,
)
from fastapi import HTTPException


def run_async(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return asyncio.run(fn(*args, **kwargs))
    return wrapper


# Encabezado real-ish: Código, Descripción, Unidad, Cantidad, PU, Importe,
# Inicio, Fin, Mes 1, Mes 2, Mes 3.
HEADERS = ["Codigo", "Descripcion", "Unidad", "Cantidad", "PU", "Importe", "Inicio", "Fin", "Mes 1", "Mes 2", "Mes 3"]
RANGOS = [None, None, None, None, None, None, None, None, "DEL 1/12/25 AL 31/12/25", "DEL 1/1/26 AL 31/1/26", "DEL 1/2/26 AL 28/2/26"]
MAPPING = ProgramaImportMappingIn(codigo="Codigo", importe="Importe", inicio="Inicio", fin="Fin", meses=["Mes 1", "Mes 2", "Mes 3"])


def _bloque(codigo, importe, mes1, mes2, mes3, inicio=None, fin=None):
    """4 filas de un concepto: datos+fracción, porcentaje, IMPORTES, barra."""
    return [
        [codigo, f"Concepto {codigo}", "PZA", "1", importe, importe, inicio, fin, "0.3", "0.4", "0.3"],
        [None] * 8 + ["30", "40", "30"],
        [None] * 8 + [mes1, mes2, mes3],
        [None] * 8 + ["Barra=1-100,0-…"],
    ]


def _filas_de(bloques_concepto, conceptos_by_clave=None):
    rows = [HEADERS, RANGOS] + [r for b in bloques_concepto for r in b]
    return _validar_archivo_programa_completo(rows, 0, MAPPING, "punto", conceptos_by_clave or {})


# ============================================================================
# _validar_archivo_programa_completo
# ============================================================================
def test_concepto_encontrado_y_cuadrado_queda_ok():
    filas = _filas_de(
        [_bloque("A101", "1000", "300", "400", "300", inicio=datetime(2025, 12, 1), fin=datetime(2026, 2, 28))],
        conceptos_by_clave={"A101": {"id": "concepto-1"}},
    )
    assert len(filas) == 1
    f = filas[0]
    assert f["concepto_id"] == "concepto-1"
    assert f["problemas"] == []
    assert f["fecha_inicio_contractual"] == "2025-12-01"
    assert f["fecha_fin_contractual"] == "2026-02-28"
    assert [m["importe"] for m in f["meses"]] == ["300", "400", "300"]
    assert f["meses"][0]["fecha_inicio"] == "2025-12-01"
    assert f["meses"][0]["fecha_fin"] == "2025-12-31"


def test_concepto_no_encontrado_en_catalogo_se_reporta():
    filas = _filas_de([_bloque("A999", "1000", "300", "400", "300")], conceptos_by_clave={})
    assert filas[0]["concepto_id"] is None
    tipos = {p["tipo"] for p in filas[0]["problemas"]}
    assert "concepto_no_encontrado" in tipos


def test_distribucion_no_cuadra_se_reporta_con_ambos_valores():
    filas = _filas_de([_bloque("A101", "1000", "300", "400", "200")], conceptos_by_clave={"A101": {"id": "c1"}})
    problema = next(p for p in filas[0]["problemas"] if p["tipo"] == "distribucion_no_cuadra")
    assert problema["importe_concepto"] == "1000.00"
    assert problema["suma_distribucion"] == "900.00"


def test_renglon_de_nivel_superior_sin_distribucion_no_es_error():
    rows = [HEADERS, RANGOS, ["A1", "Partida raíz", "", "", "", "50000", None, None]]
    filas = _validar_archivo_programa_completo(rows, 0, MAPPING, "punto", {"A1": {"id": "c-raiz"}})
    assert len(filas) == 1
    assert filas[0]["tiene_distribucion_propia"] is False
    assert filas[0]["problemas"] == []  # ausencia de distribución no es un problema aquí


def test_mapeo_sin_codigo_ni_importe_falla():
    rows = [HEADERS, RANGOS]
    with pytest.raises(HTTPException):
        _validar_archivo_programa_completo(rows, 0, ProgramaImportMappingIn(), "punto", {})


def test_columna_de_mes_inexistente_en_mapeo_falla():
    rows = [HEADERS, RANGOS]
    mapping_malo = ProgramaImportMappingIn(codigo="Codigo", importe="Importe", meses=["Mes Fantasma"])
    with pytest.raises(HTTPException):
        _validar_archivo_programa_completo(rows, 0, mapping_malo, "punto", {})


# ============================================================================
# _calcular_vista_programa / _resumen_de_vista_programa
# ============================================================================
def test_vista_clasifica_ok_error_sin_distribucion_y_descartado():
    filas = _filas_de(
        [
            _bloque("A101", "1000", "300", "400", "300"),  # ok
            _bloque("A102", "1000", "300", "400", "200"),  # no cuadra -> error
        ],
        conceptos_by_clave={"A101": {"id": "c1"}, "A102": {"id": "c2"}},
    )
    vista = _calcular_vista_programa(filas, {})
    estados = {f["clave"]: f["estado"] for f in vista}
    assert estados["A101"] == "ok"
    assert estados["A102"] == "error"

    # Descartar A102 manualmente lo saca de "error".
    fila_a102 = next(f for f in filas if f["clave"] == "A102")
    vista_2 = _calcular_vista_programa(filas, {str(fila_a102["fila"]): {"descartar": True}})
    estados_2 = {f["clave"]: f["estado"] for f in vista_2}
    assert estados_2["A102"] == "descartado"

    resumen = _resumen_de_vista_programa(vista_2)
    assert resumen["ok"] == 1
    assert resumen["descartado"] == 1


# ============================================================================
# _ejecutar_commit_programa_con_compensacion — colecciones falsas
# ============================================================================
class _FakeCollection:
    def __init__(self, docs=None):
        self.docs = {d["id"]: dict(d) for d in (docs or [])}
        self._fail_on = None
        self._counts = {}

    def fail_on(self, op, n):
        self._fail_on = (op, n)

    def _maybe_fail(self, op):
        self._counts[op] = self._counts.get(op, 0) + 1
        if self._fail_on and self._fail_on[0] == op and self._counts[op] == self._fail_on[1]:
            raise RuntimeError(f"fallo simulado en {op} #{self._fail_on[1]}")

    async def find_one(self, query):
        doc = self.docs.get(query.get("id"))
        return dict(doc) if doc else None

    async def insert_one(self, doc):
        self._maybe_fail("insert_one")
        self.docs[doc["id"]] = dict(doc)

    async def update_one(self, query, update):
        self._maybe_fail("update_one")
        _id = query.get("id")
        if _id in self.docs and "$set" in update:
            self.docs[_id].update(update["$set"])

    async def delete_one(self, query):
        self._maybe_fail("delete_one")
        self.docs.pop(query.get("id"), None)


async def _noop_bitacora(*args, **kwargs):
    pass


TEST_USER = {"id": "user-1", "name": "Test User"}


@run_async
async def test_commit_crea_version_y_distribucion_desactiva_la_anterior():
    versiones_col = _FakeCollection([{"id": "version-vieja", "project_id": "p1", "vigente": True}])
    distribucion_col = _FakeCollection()
    sessions_col = _FakeCollection([{"id": "import-1"}])

    filas = _filas_de([_bloque("A101", "1000", "300", "400", "300")], conceptos_by_clave={"A101": {"id": "c1"}})
    vista = _calcular_vista_programa(filas, {})

    resultado = await _ejecutar_commit_programa_con_compensacion(
        versiones_col, distribucion_col, sessions_col, _noop_bitacora,
        "p1", "import-1", "Etiqueta v1", vista, [versiones_col.docs["version-vieja"]], TEST_USER, "archivo.xlsx",
    )
    assert resultado["conceptos_importados"] == 1
    assert versiones_col.docs["version-vieja"]["vigente"] is False
    nueva = versiones_col.docs[resultado["version_id"]]
    assert nueva["vigente"] is True
    assert len(distribucion_col.docs) == 1
    dist = list(distribucion_col.docs.values())[0]
    assert dist["concepto_id"] == "c1"
    assert [m["importe"] for m in dist["meses"]] == ["300", "400", "300"]


@run_async
async def test_reimportar_no_borra_la_version_anterior_solo_la_desactiva():
    versiones_col = _FakeCollection([{"id": "version-vieja", "project_id": "p1", "vigente": True}])
    distribucion_col = _FakeCollection()
    sessions_col = _FakeCollection([{"id": "import-1"}])
    filas = _filas_de([_bloque("A101", "1000", "300", "400", "300")], conceptos_by_clave={"A101": {"id": "c1"}})
    vista = _calcular_vista_programa(filas, {})

    await _ejecutar_commit_programa_con_compensacion(
        versiones_col, distribucion_col, sessions_col, _noop_bitacora,
        "p1", "import-1", "Etiqueta v2", vista, [versiones_col.docs["version-vieja"]], TEST_USER, "archivo.xlsx",
    )
    # La versión vieja sigue existiendo (solo no vigente) -- nunca se borra.
    assert "version-vieja" in versiones_col.docs
    assert versiones_col.docs["version-vieja"]["vigente"] is False
    assert len(versiones_col.docs) == 2


@run_async
async def test_fallo_a_mitad_del_commit_revierte_version_y_distribucion():
    versiones_col = _FakeCollection([{"id": "version-vieja", "project_id": "p1", "vigente": True}])
    distribucion_col = _FakeCollection()
    sessions_col = _FakeCollection([{"id": "import-1"}])
    # Forzar que el SEGUNDO insert_one de distribución truene.
    distribucion_col.fail_on("insert_one", 2)

    filas = _filas_de(
        [
            _bloque("A101", "1000", "300", "400", "300"),
            _bloque("A102", "500", "200", "150", "150"),
        ],
        conceptos_by_clave={"A101": {"id": "c1"}, "A102": {"id": "c2"}},
    )
    vista = _calcular_vista_programa(filas, {})

    with pytest.raises(HTTPException) as exc_info:
        await _ejecutar_commit_programa_con_compensacion(
            versiones_col, distribucion_col, sessions_col, _noop_bitacora,
            "p1", "import-1", "Etiqueta v3", vista, [versiones_col.docs["version-vieja"]], TEST_USER, "archivo.xlsx",
        )
    assert exc_info.value.status_code == 500

    # La versión nueva se borró (compensada) y la vieja volvió a vigente=True.
    assert "version-vieja" in versiones_col.docs
    assert versiones_col.docs["version-vieja"]["vigente"] is True
    assert len(versiones_col.docs) == 1  # la nueva versión fue revertida
    # La primera distribución (que sí se alcanzó a crear) también se revirtió.
    assert len(distribucion_col.docs) == 0


@run_async
async def test_commit_sin_filas_ok_falla_sin_crear_nada():
    versiones_col = _FakeCollection()
    distribucion_col = _FakeCollection()
    sessions_col = _FakeCollection([{"id": "import-1"}])
    filas = _filas_de([_bloque("A999", "1000", "300", "400", "300")], conceptos_by_clave={})  # no encontrado -> error
    vista = _calcular_vista_programa(filas, {})

    with pytest.raises(HTTPException) as exc_info:
        await _ejecutar_commit_programa_con_compensacion(
            versiones_col, distribucion_col, sessions_col, _noop_bitacora,
            "p1", "import-1", "Etiqueta", vista, [], TEST_USER, "archivo.xlsx",
        )
    assert exc_info.value.status_code == 400
    assert len(versiones_col.docs) == 0
    assert len(distribucion_col.docs) == 0
