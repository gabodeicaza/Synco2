"""Asigna el grupo de WhatsApp (Whapi.cloud) a un proyecto.

Uso (desde backend/, con el mismo .env que el servidor):
    python scripts/asignar_whatsapp_grupo.py "Prueba" 120363430765044545@g.us
    python scripts/asignar_whatsapp_grupo.py "Prueba" ""      # desactiva el envío

El nombre se compara sin distinguir mayúsculas y debe coincidir con UN solo
proyecto activo; si hay 0 o varios, no toca nada. Alternativa sin script: el
Coordinador puede cambiarlo en la app (Proyecto > Identidad institucional).
"""
import asyncio
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

_GROUP_RE = re.compile(r"^\d+(-\d+)*@g\.us$")


async def main(nombre: str, group_id: str) -> int:
    group_id = group_id.strip()
    if group_id and not _GROUP_RE.match(group_id):
        print(f"ID inválido: {group_id!r} (formato esperado 1203634...@g.us)")
        return 2
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    found = await db.projects.find(
        {"name": {"$regex": f"^{re.escape(nombre.strip())}$", "$options": "i"}, "archived": {"$ne": True}},
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(length=10)
    if len(found) != 1:
        print(f"Se esperaba 1 proyecto llamado {nombre!r}, se encontraron {len(found)}: {found}")
        return 1
    await db.projects.update_one({"id": found[0]["id"]}, {"$set": {"whatsapp_group_id": group_id or None}})
    print(f"Proyecto {found[0]['name']!r} ({found[0]['id']}): whatsapp_group_id = {group_id or None}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1], sys.argv[2])))
