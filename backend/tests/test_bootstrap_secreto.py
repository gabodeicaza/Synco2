"""/admin/bootstrap solo funciona si BOOTSTRAP_SECRET está definido en el entorno y coincide:
sin variable no hay secreto por defecto que permita crear un Coordinador General."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_bootstrap_secreto")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

CUERPO = dict(email="admin@example.com", password="Contraseña-1", name="Admin")


def _llamar(secreto):
    return asyncio.run(server.bootstrap(server.BootstrapIn(secret=secreto, **CUERPO)))


def test_no_hay_secreto_por_defecto_en_el_codigo():
    fuente = Path(server.__file__).read_text(encoding="utf-8")
    assert "synco_bootstrap_2026_change_me" not in fuente


def test_sin_variable_de_entorno_queda_desactivado_aunque_se_mande_el_valor_antiguo(monkeypatch):
    monkeypatch.setattr(server, "BOOTSTRAP_SECRET", "")
    for intento in ("synco_bootstrap_2026_change_me", "", "cualquier-cosa"):
        with pytest.raises(HTTPException) as e:
            _llamar(intento)
        assert e.value.status_code == 403


def test_con_variable_definida_un_secreto_incorrecto_da_403(monkeypatch):
    monkeypatch.setattr(server, "BOOTSTRAP_SECRET", "secreto-largo-y-privado")
    with pytest.raises(HTTPException) as e:
        _llamar("otro")
    assert e.value.status_code == 403
