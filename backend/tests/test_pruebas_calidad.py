"""Tests puros (sin HTTP ni Mongo) del módulo Concentrado de Pruebas de Calidad
(server.py)."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_pruebas_calidad")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from server import (  # noqa: E402
    _prueba_calidad_fecha, _pruebas_calidad_bloques, _sanitize_modulos,
)


def test_modulo_en_el_catalogo():
    m = _sanitize_modulos({"reportes_semanales": {"pruebas_calidad": True}})
    assert m["reportes_semanales"]["pruebas_calidad"] is True
    assert m["reportes_diarios"]["pruebas_calidad"] is False


def test_fecha_valida_y_default():
    assert _prueba_calidad_fecha("2026-06-26") == "2026-06-26"
    assert len(_prueba_calidad_fecha(None)) == 10
    with pytest.raises(HTTPException):
        _prueba_calidad_fecha("ayer")


def test_bloques_agrupan_por_nodo_o_grupo_y_formatean_fila():
    registros = [
        {"node_id": "n1", "frente": "Banqueta adecuación Poste S-2", "localizacion": "E1- E2",
         "elemento": "banqueta", "muestra_no": None, "fecha": "2026-06-26",
         "tipo": "Concreto normal", "observaciones": "Se verifica concreto"},
        {"node_id": None, "grupo": "Suministro Gefsa-Puebla", "frente": "POSTE S-2", "fecha": "2026-06-27",
         "tipo": "PRUEBAS NO DESTRUCTIVAS", "muestra_no": "M-1"},
        {"node_id": "n1", "frente": "Otro", "fecha": "2026-06-25"},
    ]
    bloques = _pruebas_calidad_bloques(registros, {"n1": "Intertramo E1-E2"})
    assert [b["heading"] for b in bloques] == [
        "CONCENTRADO DE PRUEBAS DE CALIDAD · INTERTRAMO E1-E2",
        "CONCENTRADO DE PRUEBAS DE CALIDAD · SUMINISTRO GEFSA-PUEBLA",
    ]
    filas = bloques[0]["rows"]
    # Ordenadas por fecha dentro del grupo.
    assert [f[0] for f in filas] == ["Otro", "Banqueta adecuación Poste S-2"]
    assert filas[1] == ["Banqueta adecuación Poste S-2", "E1- E2", "banqueta", "No Aplica",
                        "26/06/2026", "Concreto normal", "Se verifica concreto"]
    assert bloques[1]["rows"][0][3] == "M-1"
    assert all(len(b["headers"]) == len(r) for b in bloques for r in b["rows"])
    assert abs(sum(bloques[0]["col_widths"]) - 1.0) < 1e-9


def test_sin_registros_no_hay_bloques():
    assert _pruebas_calidad_bloques([], {}) == []
