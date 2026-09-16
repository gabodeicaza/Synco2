#!/usr/bin/env python
"""Quita el alcance por nodos (scope_node_ids) a los Especialistas YA
existentes, para que tengan acceso GLOBAL al proyecto — igual que los
Especialistas creados desde ahora (wizard sin paso de alcance / carga
masiva por Excel), consistente con la decisión de eliminar por completo
esa restricción.

No borra usuarios ni reportes: solo vacía el campo `scope_node_ids` de los
documentos con role="especialista" que todavía lo tuvieran no-vacío. El
resto de los datos del usuario (email, nombre, área, puesto, etc.) no se
toca.

Por seguridad corre en modo DRY-RUN por default (solo imprime qué haría).
Antes de escribir, guarda en un .json un respaldo de los valores actuales
de scope_node_ids por si hay que revertir.

USO (en el servidor, mismo Mongo que usa server.py — MONGO_URL/DB_NAME ya
están en su entorno):
    cd ~   # o donde esté el .env / las variables de entorno del servicio
    python3 migrate_especialista_global_scope.py            # dry-run, no escribe nada
    python3 migrate_especialista_global_scope.py --apply     # aplica el cambio de verdad
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

from pymongo import MongoClient


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Aplica el cambio (sin esta bandera solo hace dry-run).")
    args = parser.parse_args()

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        sys.exit("Faltan las variables de entorno MONGO_URL / DB_NAME (las mismas que usa server.py).")

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    db = client[db_name]

    afectados = list(db.users.find(
        {"role": "especialista", "scope_node_ids": {"$exists": True, "$not": {"$size": 0}}},
        {"id": 1, "email": 1, "name": 1, "scope_node_ids": 1},
    ))

    if not afectados:
        print("No hay Especialistas con scope_node_ids no vacío. Nada que hacer.")
        return

    print(f"Especialistas con alcance restringido encontrados: {len(afectados)}")
    for u in afectados:
        print(f"  - {u.get('name')} <{u.get('email')}> — {len(u.get('scope_node_ids') or [])} nodo(s)")

    backup_path = f"backup_scope_node_ids_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(
            [{"id": u["id"], "email": u.get("email"), "scope_node_ids": u.get("scope_node_ids") or []} for u in afectados],
            f, indent=2, ensure_ascii=False,
        )
    print(f"Respaldo de los valores actuales guardado en: {backup_path}")

    if not args.apply:
        print("\nDRY-RUN: no se modificó nada. Vuelve a correr con --apply para aplicar el cambio de verdad.")
        return

    ids = [u["id"] for u in afectados]
    result = db.users.update_many({"id": {"$in": ids}}, {"$set": {"scope_node_ids": []}})
    print(f"\nListo: {result.modified_count} usuario(s) actualizado(s) a acceso GLOBAL (scope_node_ids = []).")


if __name__ == "__main__":
    main()
