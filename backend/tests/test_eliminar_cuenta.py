"""Tests de la eliminación de cuenta (T-01): anonimización de autoría, borrado
de datos personales, guarda del último Coordinador General y páginas legales.

Usan un `db` falso que registra las llamadas: no requieren Mongo ni backend vivo.
"""
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_eliminar_cuenta")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class FakeDb:
    """Cada colección es un MagicMock con métodos async; se crean al pedirlas."""

    def __init__(self, colecciones, usuario):
        self._cols = {}
        self._nombres = colecciones
        self.list_collection_names = AsyncMock(return_value=colecciones)
        self.users.find_one = AsyncMock(return_value=usuario)
        self.users.update_one = AsyncMock()
        self.users.count_documents = AsyncMock(return_value=1)

    def _col(self, nombre):
        if nombre not in self._cols:
            c = MagicMock()
            res = MagicMock(modified_count=0, deleted_count=0)
            c.update_many = AsyncMock(return_value=res)
            c.delete_many = AsyncMock(return_value=res)
            c.find_one = AsyncMock(return_value=None)
            self._cols[nombre] = c
        return self._cols[nombre]

    def __getattr__(self, nombre):
        if nombre.startswith("_") or nombre in ("list_collection_names",):
            raise AttributeError(nombre)
        return self._col(nombre)

    def __getitem__(self, nombre):
        return self._col(nombre)


USUARIO = {"id": "u1", "email": "Ana@Obra.mx", "name": "Ana", "role": "especialista", "password": "x"}


def _correr(db, coro_fn):
    server.db = db
    return asyncio.run(coro_fn())


def test_campos_usuario_anonimizado_quita_datos_personales():
    ahora = datetime.now(timezone.utc)
    campos = server.campos_usuario_anonimizado("u1", ahora)
    assert campos["name"] == server.USUARIO_ELIMINADO == "Usuario eliminado"
    assert campos["email"] == "eliminado-u1@eliminado.invalid"
    assert campos["expo_push_tokens"] == [] and campos["project_ids"] == []
    assert campos["deleted_at"] == ahora
    assert server.verify_pw("cualquiera", campos["password"]) is False


def test_anonimizar_conserva_registros_y_cambia_solo_el_nombre():
    db = FakeDb(["users", "reports", "minutas", "password_reset_requests"], dict(USUARIO))
    _correr(db, lambda: server.anonimizar_usuario("u1"))

    reports = db["reports"]
    filtros = [c.args[0] for c in reports.update_many.call_args_list]
    sets = [c.args[1] for c in reports.update_many.call_args_list]
    # Filtra por el id del autor y solo toca docs que ya tenían el campo del nombre.
    assert {"created_by": "u1", "created_by_name": {"$exists": True}} in filtros
    assert {"$set": {"created_by_name": "Usuario eliminado"}} in sets
    # Nunca borra reportes ni avances.
    reports.delete_many.assert_not_called()
    # Minutas: responsable dentro de acuerdos, con arrayFilters.
    kw = db["minutas"].update_many.call_args_list[-1].kwargs
    assert kw["array_filters"] == [{"a.responsable_id": "u1"}]
    # Solicitudes de contraseña y el propio usuario.
    db["password_reset_requests"].delete_many.assert_awaited_with({"user_id": "u1"})
    db["channel_reads"].delete_many.assert_awaited_with({"user_id": "u1"})
    args = db.users.update_one.call_args.args
    assert args[0] == {"id": "u1"}
    assert args[1]["$set"]["name"] == "Usuario eliminado"
    assert args[1]["$set"]["email"] == "eliminado-u1@eliminado.invalid"


def test_anonimizar_no_recorre_users_ni_solicitudes():
    db = FakeDb(["users", "password_reset_requests", "deletion_requests"], dict(USUARIO))
    _correr(db, lambda: server.anonimizar_usuario("u1"))
    db["users"].update_many.assert_not_called()
    db["deletion_requests"].update_many.assert_not_called()


def test_invitaciones_pendientes_quedan_revocadas():
    db = FakeDb(["invitations"], dict(USUARIO))
    _correr(db, lambda: server.anonimizar_usuario("u1"))
    llamadas = db["invitations"].update_many.call_args_list
    revoca = [c for c in llamadas if c.args[1] == {"$set": {"status": "revoked"}}]
    assert revoca and revoca[0].args[0]["status"] == "pending"
    quita_pii = [c for c in llamadas if "phone" in c.args[1]["$set"]]
    assert quita_pii[0].args[1]["$set"]["email"] == "eliminado-u1@eliminado.invalid"


def test_usuario_inexistente_da_404():
    db = FakeDb([], None)
    with pytest.raises(HTTPException) as e:
        _correr(db, lambda: server.anonimizar_usuario("nadie"))
    assert e.value.status_code == 404


def test_no_permite_eliminar_al_unico_coordinador_general():
    coord = {**USUARIO, "role": server.ROLE_COORD}
    db = FakeDb([], coord)
    db.users.count_documents = AsyncMock(return_value=0)
    with pytest.raises(HTTPException) as e:
        _correr(db, lambda: server._validar_puede_eliminarse(coord))
    assert e.value.status_code == 409


def test_coordinador_con_otro_coordinador_si_puede():
    coord = {**USUARIO, "role": server.ROLE_COORD}
    db = FakeDb([], coord)
    db.users.count_documents = AsyncMock(return_value=1)
    _correr(db, lambda: server._validar_puede_eliminarse(coord))


def test_delete_account_exige_contrasena_correcta():
    hash_ok = server.hash_pw("Correcta123")
    db = FakeDb([], {**USUARIO, "password": hash_ok})
    server.db = db
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.delete_account(server.DeleteAccountIn(password="mala"), {"id": "u1"}))
    assert e.value.status_code == 403
    db.users.update_one.assert_not_called()


def test_paginas_legales_publicas_en_espanol_con_acentos():
    assert 'lang="es-MX"' in server.PRIVACY_POLICY_HTML
    assert "Política de privacidad" in server.PRIVACY_POLICY_HTML
    assert "Términos de uso" in server.TERMS_HTML
    assert "/api/public/deletion_request" in server.DELETE_ACCOUNT_HTML
    for html in (server.PRIVACY_POLICY_HTML, server.TERMS_HTML, server.DELETE_ACCOUNT_HTML):
        assert "SynCo" not in html and "{{" not in html
