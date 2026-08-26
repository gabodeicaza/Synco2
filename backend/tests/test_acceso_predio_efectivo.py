"""Test puro de `_acceso_predio_efectivo` — server.py.

Antes, `AccesoPredioManager.tsx` mostraba SIEMPRE los nodos de profundidad 1
(Subtramo), sin forma de elegir otros. Ahora el nodo tiene un campo
`acceso_predio_habilitado` (None = default histórico, True/False = decisión
explícita) y este helper resuelve el valor EFECTIVO — se prueba aparte
porque list_nodes (donde se usa) necesita Mongo real.
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_acceso_predio_efectivo")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import _acceso_predio_efectivo


def test_subtramo_sin_decision_explicita_es_efectivo_true_default_historico():
    assert _acceso_predio_efectivo({"depth": 1, "acceso_predio_habilitado": None}) is True


def test_nodo_fuera_de_subtramo_sin_decision_explicita_es_efectivo_false():
    assert _acceso_predio_efectivo({"depth": 0}) is False
    assert _acceso_predio_efectivo({"depth": 2}) is False


def test_campo_ausente_del_todo_se_trata_igual_que_none():
    # Documentos viejos en Mongo, creados antes de que este campo existiera.
    assert _acceso_predio_efectivo({"depth": 1}) is True
    assert _acceso_predio_efectivo({"depth": 3}) is False


def test_decision_explicita_true_gana_incluso_fuera_de_subtramo():
    assert _acceso_predio_efectivo({"depth": 0, "acceso_predio_habilitado": True}) is True
    assert _acceso_predio_efectivo({"depth": 3, "acceso_predio_habilitado": True}) is True


def test_decision_explicita_false_gana_incluso_en_subtramo():
    assert _acceso_predio_efectivo({"depth": 1, "acceso_predio_habilitado": False}) is False
