"""Vista previa del índice: usa la última estructura (con páginas) y la config en edición."""
import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_test_indice_preview")
os.environ.setdefault("JWT_SECRET", "dummy_test_secret")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402

ESTRUCTURA = [
    {"key": "a", "title": "Datos generales", "n": 2, "inicio": 1, "caps": [20, 25]},
    {"key": "b", "title": "Estación 1", "n": 3, "inicio": 3},
    {"key": "c", "title": "Estación 2", "n": 1, "inicio": 6},
]


def _correr(estructura, cfg, monkeypatch=None):
    db = MagicMock()
    db.projects.find_one = AsyncMock(return_value={"indice_estructura": {"diario": estructura}})
    server.db = db
    server.ensure_project_access = AsyncMock(return_value={})
    return asyncio.run(server.preview_indice("p1", "diario", cfg, {"id": "u", "role": server.ROLE_COORD}))


def test_numera_paginas_despues_de_portada_e_indice():
    r = _correr(ESTRUCTURA, {})
    assert r["disponible"] and r["paginas_portada"] == 1 and r["paginas_indice"] == 1
    assert [(e["titulo"], e["pagina"]) for e in r["entradas"]] == [("Datos generales", 3), ("Estación 1", 5), ("Estación 2", 8)]
    assert r["total_paginas"] == 1 + 1 + 6


def test_orden_titulo_y_ocultas_se_reflejan_sin_guardar():
    r = _correr(ESTRUCTURA, {"order": ["c", "a", "b"], "titles": {"a": "Generales"}, "hidden": ["b"], "titulo": "CONTENIDO"})
    assert r["titulo"] == "CONTENIDO"
    assert [(e["titulo"], e["pagina"]) for e in r["entradas"]] == [("Estación 2", 3), ("Generales", 4)]


def test_sin_indice_no_hay_entradas_ni_pagina_de_indice():
    r = _correr(ESTRUCTURA, {"enabled": False})
    assert r["entradas"] == [] and r["paginas_indice"] == 0 and not r["habilitado"]


def test_estructura_vieja_sin_paginas_no_esta_disponible():
    assert _correr([{"key": "a", "title": "X"}], {}) == {"disponible": False}
    assert _correr([], {}) == {"disponible": False}
