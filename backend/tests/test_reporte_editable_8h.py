"""Edición completa de un reporte: solo su autor, solo durante las 8 h siguientes a la captura."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_editable_8h")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402

AHORA = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
AUTOR = {"id": "u1", "role": "especialista", "name": "Ana"}


def rep(horas_atras, autor="u1"):
    return {"id": "r1", "captured_by": autor, "created_at": AHORA - timedelta(hours=horas_atras)}


def test_autor_dentro_de_8h():
    assert server.reporte_editable_por(rep(7.9), AUTOR, AHORA)
    assert server.reporte_editable_por(rep(8), AUTOR, AHORA)


def test_autor_pasadas_8h():
    assert not server.reporte_editable_por(rep(8.1), AUTOR, AHORA)


def test_otro_usuario_no_edita_aunque_sea_coordinador():
    coord = {"id": "u2", "role": "coordinador_general"}
    assert not server.reporte_editable_por(rep(1), coord, AHORA)


def test_created_at_naive_se_toma_como_utc():
    r = {"id": "r1", "captured_by": "u1", "created_at": (AHORA - timedelta(hours=2)).replace(tzinfo=None)}
    assert server.reporte_editable_por(r, AUTOR, AHORA)


def _usar_db(monkeypatch, reporte):
    db = MagicMock()
    db.reports.find_one = AsyncMock(return_value=reporte)
    db.reports.replace_one = AsyncMock()
    monkeypatch.setattr(server, "db", db)
    return db


def test_put_rechaza_ajeno_y_vencido(monkeypatch):
    body = MagicMock(project_id="p1")
    _usar_db(monkeypatch, {**rep(1, autor="otro"), "project_id": "p1"})
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.update_report("r1", body, AUTOR))
    assert e.value.status_code == 403

    viejo = {"id": "r1", "captured_by": "u1", "project_id": "p1",
             "created_at": datetime.now(timezone.utc) - timedelta(hours=9)}
    _usar_db(monkeypatch, viejo)
    with pytest.raises(HTTPException) as e:
        asyncio.run(server.update_report("r1", body, AUTOR))
    assert e.value.status_code == 403
    assert "8 horas" in e.value.detail


def test_put_conserva_identidad_y_fecha(monkeypatch):
    creado = datetime.now(timezone.utc) - timedelta(hours=1)
    db = _usar_db(monkeypatch, {"id": "r1", "captured_by": "u1", "captured_by_name": "Ana",
                                "project_id": "p1", "created_at": creado, "client_id": "c-1"})
    nuevo = {"id": "otro-id", "captured_by": "u1", "captured_by_name": "Ana", "created_at": AHORA, "actividades": "nuevo"}
    monkeypatch.setattr(server, "_preparar_doc_reporte", AsyncMock(return_value=(nuevo, {}, [])))
    out = asyncio.run(server.update_report("r1", MagicMock(project_id="p1"), AUTOR))
    assert out["id"] == "r1" and out["created_at"] == creado and out["client_id"] == "c-1"
    assert out["actividades"] == "nuevo" and out["edited_at"]
    db.reports.replace_one.assert_awaited_once()
