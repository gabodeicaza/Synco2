"""Presentación: las fotos de "Información particular" se pueden ELEGIR entre todas
las subidas en la semana (referencia a reporte + índice) y se resuelven al exportar."""
import asyncio
import io
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_fotos_semana")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pptx import Presentation  # noqa: E402

import server  # noqa: E402

PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


async def _scenario():
    pid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    user = {"id": uid, "name": "Coord", "role": server.ROLE_COORD, "project_ids": [pid]}
    await server.db.projects.insert_one({"id": pid, "name": "P"})
    now = datetime.now(timezone.utc)
    rid, rid_old = str(uuid.uuid4()), str(uuid.uuid4())
    base = {"project_id": pid, "node_id": "n1", "node_path_ids": ["tramo", "n1"], "node_path_names": ["Tramo", "Estación 1"],
            "title": "Colado", "severidad": ["informativo"]}
    await server.db.reports.insert_many([
        {**base, "id": rid, "images": [PNG_B64] * 3, "photo_captions": ["uno", "dos", "tres"], "created_at": now},
        {**base, "id": rid_old, "images": [PNG_B64], "created_at": datetime(2020, 1, 1, tzinfo=timezone.utc)},
        {**base, "id": str(uuid.uuid4()), "node_id": "otro", "node_path_ids": ["otro"], "images": [PNG_B64],
         "created_at": now},
    ])
    try:
        pres = await server.create_presentacion(
            pid, server.PresentacionIn(project_id=pid, fecha=now.date().isoformat()), user)
        sec = await server.create_presentacion_seccion(
            pid, pres["id"], server.PresentacionSeccionIn(tipo="informacion_particular"), user)
        sec_id = sec["id"] if isinstance(sec, dict) else sec.id

        todas = await server.list_fotos_semana_presentacion(pid, pres["id"], None, 120, user)
        assert len(todas) == 4 and all(f["thumb"] for f in todas)          # 3 + 1 de otro nodo; la vieja no
        solo_n1 = await server.list_fotos_semana_presentacion(pid, pres["id"], "tramo", 120, user)
        assert len(solo_n1) == 3 and solo_n1[0]["caption"] == "uno"

        bloque = server.InformacionParticularBloqueIn(titulo="ESTACIÓN 1", fotos=[
            server.InformacionParticularFotoIn(report_id=rid, index=1),
            server.InformacionParticularFotoIn(report_id=rid, index=9),   # índice inexistente: se omite
        ])
        await server.update_informacion_particular(
            pid, pres["id"], sec_id, server.InformacionParticularBloquesPatch(bloques=[bloque]), user)

        resp = await server.export_presentacion_pptx(pid, pres["id"], user)
        data = b"".join([c async for c in resp.body_iterator])
        prs = Presentation(io.BytesIO(data))
        textos = [sh.text_frame.text for sl in prs.slides for sh in sl.shapes if sh.has_text_frame]
        assert "dos" in textos                                            # pie heredado de la foto del reporte
        n_pics = sum(1 for sl in prs.slides for sh in sl.shapes if sh.shape_type == 13)
        assert n_pics == 1
    finally:
        await server.db.projects.delete_one({"id": pid})
        await server.db.presentaciones.delete_many({"project_id": pid})
        await server.db.reports.delete_many({"project_id": pid})


def test_fotos_semana_elegibles():
    asyncio.run(_scenario())
