"""Recuperar contraseña por correo (T-08): token de un solo uso con expiración,
solo se guarda el hash, respuesta uniforme y respaldo administrativo sin SMTP.
Usa un `db` falso: no requiere Mongo, SMTP ni backend vivo."""
import asyncio
import os
import sys
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_reset_password")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402

USUARIO = {"id": "u1", "email": "ana@obra.mx", "name": "Ana", "role": "especialista", "project_ids": []}


def _db(**cols):
    db = MagicMock()
    for nombre, col in cols.items():
        setattr(db, nombre, col)
    server.db = db
    return db


def _col(**metodos):
    c = MagicMock()
    for k, v in metodos.items():
        setattr(c, k, v)
    return c


def _tokens(cuantos=0):
    return _col(count_documents=AsyncMock(return_value=cuantos), update_many=AsyncMock(), insert_one=AsyncMock())


def _solicitudes():
    return _col(find_one=AsyncMock(return_value=None), insert_one=AsyncMock())


def test_hash_no_es_el_token_y_es_estable():
    h = server.hash_reset_token("abc")
    assert h != "abc" and h == server.hash_reset_token("abc") and len(h) == 64


def test_crear_token_guarda_hash_y_vence_en_30_minutos():
    tokens = _tokens()
    _db(password_reset_tokens=tokens)
    token = asyncio.run(server.crear_token_reset("u1"))
    doc = tokens.insert_one.call_args.args[0]
    assert doc["token_hash"] == server.hash_reset_token(token)
    assert token not in [str(v) for v in doc.values()]
    assert doc["used_at"] is None
    assert doc["expires_at"] - doc["created_at"] == timedelta(minutes=30)
    # Invalida los tokens anteriores de esa persona.
    assert tokens.update_many.await_args.args[0] == {"user_id": "u1", "used_at": None}


def test_limite_de_solicitudes_por_hora():
    tokens = _tokens(cuantos=3)
    _db(password_reset_tokens=tokens)
    assert asyncio.run(server.crear_token_reset("u1")) is None
    tokens.insert_one.assert_not_called()


def test_reset_consume_el_token_y_cambia_la_contrasena():
    tokens = _col(find_one_and_update=AsyncMock(return_value={"user_id": "u1"}))
    users = _col(update_one=AsyncMock(return_value=MagicMock(matched_count=1)))
    _db(password_reset_tokens=tokens, users=users, password_reset_requests=_col(update_many=AsyncMock()))
    out = asyncio.run(server.reset_password(server.ResetPasswordIn(token="tok", new_password="Nueva-123")))
    assert out == {"ok": True}
    filtro = tokens.find_one_and_update.await_args.args[0]
    assert filtro["token_hash"] == server.hash_reset_token("tok")  # busca por hash, nunca por el token
    assert filtro["used_at"] is None and "$gt" in filtro["expires_at"]  # un solo uso y vigente
    nuevo = users.update_one.await_args.args[1]["$set"]["password"]
    assert server.verify_pw("Nueva-123", nuevo)


def test_reset_rechaza_token_usado_o_vencido():
    tokens = _col(find_one_and_update=AsyncMock(return_value=None))
    _db(password_reset_tokens=tokens, users=_col(), password_reset_requests=_col())
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.reset_password(server.ResetPasswordIn(token="tok", new_password="Nueva-123")))
    assert e.value.status_code == 400


def test_reset_rechaza_contrasena_corta_sin_gastar_el_token():
    tokens = _col(find_one_and_update=AsyncMock())
    _db(password_reset_tokens=tokens)
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.reset_password(server.ResetPasswordIn(token="tok", new_password="123")))
    assert e.value.status_code == 400
    tokens.find_one_and_update.assert_not_called()


def test_correo_en_espanol_con_el_enlace():
    asunto, cuerpo = server.construir_correo_reset("Ana", "https://apm-app.mx/api/restablecer?token=T")
    assert "contraseña" in asunto and "Dirac" in asunto
    assert "https://apm-app.mx/api/restablecer?token=T" in cuerpo and "30 minutos" in cuerpo
    assert "SynCo" not in cuerpo


def test_smtp_envia_con_starttls_y_login(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.ejemplo.mx")
    monkeypatch.setenv("SMTP_USER", "u")
    monkeypatch.setenv("SMTP_PASSWORD", "p")
    smtp = MagicMock()
    monkeypatch.setattr(server.smtplib, "SMTP", MagicMock(return_value=smtp))
    assert asyncio.run(server.enviar_correo("ana@obra.mx", "Asunto", "Cuerpo")) is True
    smtp.starttls.assert_called_once()
    smtp.login.assert_called_once_with("u", "p")
    assert smtp.send_message.call_args.args[0]["To"] == "ana@obra.mx"


def test_correo_falla_sin_lanzar(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.ejemplo.mx")
    monkeypatch.setattr(server.smtplib, "SMTP", MagicMock(side_effect=OSError("sin red")))
    assert asyncio.run(server.enviar_correo("ana@obra.mx", "A", "C")) is False


def test_sin_smtp_no_envia(monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    assert asyncio.run(server.enviar_correo("ana@obra.mx", "A", "C")) is False


def test_sin_smtp_cae_al_respaldo_administrativo(monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    solicitudes = _solicitudes()
    _db(password_reset_requests=solicitudes)
    asyncio.run(server._procesar_reset(dict(USUARIO)))
    assert solicitudes.insert_one.await_args.args[0]["status"] == "pending"


def test_con_smtp_correcto_no_crea_solicitud_administrativa(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.ejemplo.mx")
    monkeypatch.setattr(server.smtplib, "SMTP", MagicMock(return_value=MagicMock()))
    tokens, solicitudes = _tokens(), _solicitudes()
    _db(password_reset_tokens=tokens, password_reset_requests=solicitudes)
    asyncio.run(server._procesar_reset(dict(USUARIO)))
    tokens.insert_one.assert_awaited()
    solicitudes.insert_one.assert_not_called()


def test_con_smtp_caido_cae_al_respaldo(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.ejemplo.mx")
    monkeypatch.setattr(server.smtplib, "SMTP", MagicMock(side_effect=OSError("caído")))
    tokens, solicitudes = _tokens(), _solicitudes()
    _db(password_reset_tokens=tokens, password_reset_requests=solicitudes)
    asyncio.run(server._procesar_reset(dict(USUARIO)))
    solicitudes.insert_one.assert_awaited()


def test_forgot_password_responde_igual_exista_o_no_el_correo(monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)

    async def correr(usuario):
        _db(users=_col(find_one=AsyncMock(return_value=usuario)), password_reset_requests=_solicitudes())
        r = await server.forgot_password(server.ForgotPasswordIn(email="ana@obra.mx"))
        await asyncio.sleep(0.05)  # deja correr la tarea en segundo plano
        return r

    assert asyncio.run(correr(dict(USUARIO))) == asyncio.run(correr(None))


def test_pagina_de_restablecer_en_espanol():
    assert "Crea tu contraseña nueva" in server.RESET_PAGE_HTML
    assert "/api/auth/reset_password" in server.RESET_PAGE_HTML
