"""K-02: el selector de responsables de minutas lista solo miembros del proyecto.
`/members?solo_miembros=1` excluye a coordinadores/jefes ajenos al proyecto, la lista amplia
(asistentes de eventos, mensajes directos) no cambia, y crear una minuta rechaza a un
responsable que no es miembro. Pruebas sin Mongo (db falso)."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_miembros_responsables")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

PID = "p1"
OTRO = "p2"

USUARIOS = [
    {"id": "u-esp", "email": "e@x.mx", "name": "Especialista", "role": server.ROLE_ESPECIALISTA, "project_ids": [PID]},
    {"id": "u-sub", "email": "s@x.mx", "name": "Sub", "role": server.ROLE_SUB, "project_ids": [PID, OTRO]},
    {"id": "u-coord-miembro", "email": "c1@x.mx", "name": "Coord miembro", "role": server.ROLE_COORD, "project_ids": [PID]},
    {"id": "u-coord-ajeno", "email": "c2@x.mx", "name": "Coord ajeno", "role": server.ROLE_COORD, "project_ids": [OTRO]},
    {"id": "u-jefe-ajeno", "email": "j@x.mx", "name": "Jefe ajeno", "role": server.ROLE_JEFE, "project_ids": []},
    {"id": "u-otro", "email": "o@x.mx", "name": "Otro proyecto", "role": server.ROLE_ESPECIALISTA, "project_ids": [OTRO]},
]


def _coincide(u, filtro):
    if "deleted_at" in filtro and u.get("deleted_at") is not None and "deleted_at" in u:
        return False
    if "project_ids" in filtro and filtro["project_ids"] not in (u.get("project_ids") or []):
        return False
    if "$or" in filtro:
        def rama(r):
            if "project_ids" in r:
                return r["project_ids"] in (u.get("project_ids") or [])
            if "role" in r:
                return u.get("role") in r["role"]["$in"]
            return False
        if not any(rama(r) for r in filtro["$or"]):
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, length=None):
        return list(self.docs)


class _Usuarios:
    def find(self, filtro):
        return _Cursor([u for u in USUARIOS if _coincide(u, filtro)])


class _Db:
    users = _Usuarios()


def _miembros(monkeypatch, usuario, solo_miembros):
    monkeypatch.setattr(server, "db", _Db())

    async def acceso(user, pid):
        return {"id": pid}

    monkeypatch.setattr(server, "ensure_project_access", acceso)
    salida = asyncio.run(server.list_project_members(PID, solo_miembros=solo_miembros, user=usuario))
    return {u["id"] for u in salida}


def test_lista_amplia_sin_cambios(monkeypatch):
    coord = {"id": "u-coord-miembro", "role": server.ROLE_COORD}
    ids = _miembros(monkeypatch, coord, solo_miembros=False)
    # Incluye a los coordinadores y jefes aunque no sean del proyecto (comportamiento previo).
    assert {"u-coord-ajeno", "u-jefe-ajeno", "u-esp", "u-sub", "u-coord-miembro"} <= ids
    assert "u-otro" not in ids


def test_solo_miembros_excluye_a_coordinadores_y_jefes_ajenos(monkeypatch):
    coord = {"id": "u-coord-miembro", "role": server.ROLE_COORD}
    ids = _miembros(monkeypatch, coord, solo_miembros=True)
    assert ids == {"u-esp", "u-sub", "u-coord-miembro"}


def test_solo_miembros_incluye_al_propio_consultante_si_es_miembro(monkeypatch):
    sub = {"id": "u-sub", "role": server.ROLE_SUB}
    assert "u-sub" in _miembros(monkeypatch, sub, solo_miembros=True)


def test_especialista_sigue_sin_ver_coordinadores(monkeypatch):
    esp = {"id": "u-esp", "role": server.ROLE_ESPECIALISTA}
    ids = _miembros(monkeypatch, esp, solo_miembros=True)
    assert ids == {"u-esp", "u-sub"}
    ids_amplia = _miembros(monkeypatch, esp, solo_miembros=False)
    assert "u-coord-miembro" not in ids_amplia and "u-coord-ajeno" not in ids_amplia


def test_filtro_solo_miembros_exige_el_proyecto():
    f = server.filtro_miembros_proyecto(PID, True)
    assert f["project_ids"] == PID and "$or" not in f
    amplio = server.filtro_miembros_proyecto(PID, False)
    assert "$or" in amplio and "project_ids" not in amplio


def test_es_miembro_de_proyecto():
    assert server.es_miembro_de_proyecto({"project_ids": [PID]}, PID)
    assert not server.es_miembro_de_proyecto({"project_ids": [OTRO]}, PID)
    assert not server.es_miembro_de_proyecto({}, PID)
    assert not server.es_miembro_de_proyecto(None, PID)


USERS_MAP = {u["id"]: u for u in USUARIOS}


def test_responsable_miembro_se_acepta():
    assert server.resolver_responsable_acuerdo("u-esp", USERS_MAP, PID, 1) == ("Especialista", server.ROLE_ESPECIALISTA)


def test_contratista_siempre_se_acepta():
    assert server.resolver_responsable_acuerdo("contratista", USERS_MAP, PID, 1) == ("Contratista", "contratista")


@pytest.mark.parametrize("rid", ["u-coord-ajeno", "u-jefe-ajeno", "u-otro"])
def test_responsable_que_no_es_miembro_se_rechaza_con_mensaje_legible(rid):
    with pytest.raises(HTTPException) as e:
        server.resolver_responsable_acuerdo(rid, USERS_MAP, PID, 2)
    assert e.value.status_code == 400
    assert e.value.detail == "Acuerdo #2: el responsable debe ser miembro del proyecto o el contratista."


def test_responsable_inexistente_sigue_siendo_invalido():
    with pytest.raises(HTTPException) as e:
        server.resolver_responsable_acuerdo("no-existe", USERS_MAP, PID, 3)
    assert e.value.detail == "Acuerdo #3: responsable inválido"
