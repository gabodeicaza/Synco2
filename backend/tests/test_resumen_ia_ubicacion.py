"""Tests puros de los helpers del resumen con IA por ubicación del hub
Actividades Generales (`_armar_entrada_resumen_ia_ubicacion`,
`_parsear_resumen_ia_ubicacion`, `_ia_rango_clave`, `_ia_resumen_visible`).
Sin red ni Mongo: la llamada a Gemini y el guardado no se prueban aquí."""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_resumen_ia_ubicacion")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from server import (  # noqa: E402
    _armar_entrada_resumen_ia_ubicacion, _parsear_resumen_ia_ubicacion,
    _ia_rango_clave, _ia_resumen_visible,
    NIVEL_GENERAL, NIVEL_NODO,
)


def _it(texto, node_id="n1", nombre="Poste 1", nivel=NIVEL_NODO, oculta=False, area_id="a1", ia=False):
    return {"texto": texto, "node_id": node_id, "node_name": nombre, "nivel": nivel, "oculta": oculta,
            "area_id": area_id, "area_name": "Estructuras", "ia_resumen": ia}


def _d(dia, h=0):
    return datetime(2026, 10, dia, h, tzinfo=timezone.utc)


def test_agrupa_por_area_y_nodo_y_excluye_generales_ocultas_e_ia():
    items = [
        _it("Colado de zapata", "n1", "Poste 1"),
        _it("Armado de acero", "n1", "Poste 1"),
        _it("Excavación", "n2", "Poste 2"),
        _it("Excavación otra área", "n2", "Poste 2", area_id="a2"),
        _it("Nota general", None, None, NIVEL_GENERAL),
        _it("Oculta", "n3", "Poste 3", oculta=True),
        _it("Resumen previo", "n4", "Poste 4", ia=True),
    ]
    texto, meta = _armar_entrada_resumen_ia_ubicacion(items)
    assert list(meta) == ["k1", "k2", "k3"]
    assert (meta["k1"]["area_id"], meta["k1"]["node_id"], meta["k1"]["nombre"]) == ("a1", "n1", "Poste 1")
    assert meta["k3"]["area_id"] == "a2"
    assert "Colado de zapata" in texto and "Armado de acero" in texto
    for fuera in ("Nota general", "Oculta", "Resumen previo"):
        assert fuera not in texto


def test_deduplica_y_trunca():
    items = [_it("Igual"), _it("Igual"), _it("x" * 1000)]
    texto, _ = _armar_entrada_resumen_ia_ubicacion(items)
    assert texto.count("- Igual") == 1
    assert "x" * 301 not in texto


def test_sin_actividades_devuelve_vacio():
    assert _armar_entrada_resumen_ia_ubicacion([]) == ("", {})
    assert _armar_entrada_resumen_ia_ubicacion([_it("a", oculta=True)]) == ("", {})


def test_parseo_tolera_cercas_y_filtra_ids():
    raw = '```json\n{"n1": "  Se coló\\n la zapata. ", "zzz": "ajeno", "n2": "", "n3": 5}\n```'
    assert _parsear_resumen_ia_ubicacion(raw, ["n1", "n2", "n3"]) == {"n1": "Se coló la zapata."}


def test_parseo_invalido_lanza():
    with pytest.raises(ValueError):
        _parsear_resumen_ia_ubicacion("sin json", ["n1"])


def test_rango_clave():
    assert _ia_rango_clave(None) == (None, None)
    assert _ia_rango_clave({}) == (None, None)
    assert _ia_rango_clave({"$gte": _d(5), "$lte": _d(6)}) == ("2026-10-05T00:00:00", "2026-10-06T00:00:00")


def _doc(gte=None, lte=None):
    g, l = _ia_rango_clave({**({"$gte": gte} if gte else {}), **({"$lte": lte} if lte else {})})
    return {"ia_resumen": True, "ia_gte": g, "ia_lte": l}


def test_visibilidad_mismo_periodo_y_sin_periodo():
    dia = {"$gte": _d(5), "$lte": _d(6)}
    assert _ia_resumen_visible(_doc(_d(5), _d(6)), dia)
    assert _ia_resumen_visible(_doc(), None)            # "todo el periodo" ve el de "todo el periodo"
    assert not _ia_resumen_visible(_doc(_d(5), _d(6)), None)   # y no los de un día
    assert not _ia_resumen_visible(_doc(), dia)         # un día no ve el de "todo el periodo"


def test_visibilidad_dia_dentro_de_semana_y_fuera():
    semana = {"$gte": _d(4), "$lte": _d(11)}
    assert _ia_resumen_visible(_doc(_d(5), _d(6)), semana)
    assert not _ia_resumen_visible(_doc(_d(12), _d(13)), semana)
    assert not _ia_resumen_visible(_doc(_d(3), _d(6)), semana)
    assert not _ia_resumen_visible(_doc(_d(5), _d(6)), {"$gte": _d(7), "$lte": _d(8)})


def test_parseo_tolera_envoltorio_mayusculas_y_objetos():
    assert _parsear_resumen_ia_ubicacion('{"resumenes": {"K1": "Uno.", "k2": {"resumen": "Dos."}}}', ["k1", "k2"]) == {"k1": "Uno.", "k2": "Dos."}
    assert _parsear_resumen_ia_ubicacion('{"k1": "Solo uno."}', ["k1", "k2"]) == {"k1": "Solo uno."}


def test_impresion_solo_generales_separa_titulo_de_resumen_ia():
    from server import _actividades_resumen_por_frente
    def g(texto, ia=False, path=None):
        return {"texto": texto, "nivel": NIVEL_GENERAL, "area_name": "OBRA CIVIL", "ia_resumen": ia, "node_path_names_origen": path or []}
    items = [
        g("Nota manual"),
        g("Estacion 1, UNIVERSIDAD: Se relleno el cajon.", True, ["Linea", "Estacion 1, UNIVERSIDAD"]),
        g("Resumen editado sin prefijo", True, ["Linea", "Estacion 2"]),
        g("Estacion 3: Colado.", True, ["Estacion 3"]),
    ]
    out = _actividades_resumen_por_frente(items, {}, solo_general=True)
    assert len(out) == 1 and out[0]["area"] == "OBRA CIVIL"
    assert out[0]["bloques"] == [
        {"titulo": "", "lineas": ["Nota manual", "Resumen editado sin prefijo"]},
        {"titulo": "Estacion 1, UNIVERSIDAD", "lineas": ["Se relleno el cajon."]},
        {"titulo": "Estacion 3", "lineas": ["Colado."]},
    ]
