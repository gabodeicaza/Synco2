#!/usr/bin/env python
"""Prueba de conectividad con Google Gemini (SDK moderno `google-genai`).

No usa validación de regex sobre el formato de la API key -- las keys de
Google AI Studio han cambiado de prefijo antes (de "AIza..." al formato
actual "AQ...") y probablemente vuelvan a cambiar; el SDK oficial es quien
decide si una key es válida al llamarlo, nunca un patrón hardcodeado aquí.

Lee GEMINI_API_KEY desde backend/.env (nunca hardcodeada en el código --
ver .gitignore, ese archivo no se versiona) e invoca un modelo Gemini con
un prompt trivial para confirmar que la conexión y la respuesta son
correctas.

NOTA (2026-08-18): "gemini-2.5-flash" ya no está disponible para keys
nuevas -- la API de Google responde 404 y sugiere "gemini-3.6-flash" como
reemplazo directo (confirmado en vivo con esta misma key). Por eso el
default de este script es "gemini-3.6-flash", no "gemini-2.5-flash". El
endpoint de producción (`/api/projects/{pid}/ai_summary` en server.py) no
se ve afectado: usa el alias "gemini-flash-latest" vía GEMINI_MODEL, que
Google mantiene apuntando al flash vigente sin necesitar cambios de código.

USO:
    cd backend
    python scripts/test_gemini_connection.py
    python scripts/test_gemini_connection.py --model gemini-2.5-flash   # reproduce el 404 de deprecación
    python scripts/test_gemini_connection.py --model gemini-flash-latest
"""
import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model", default="gemini-3.6-flash",
        help="Modelo a invocar (default: gemini-3.6-flash -- ver nota de deprecación arriba)",
    )
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("[FAIL] GEMINI_API_KEY no está configurada en backend/.env")
        return 1

    try:
        from google import genai
    except ImportError:
        print("[FAIL] El paquete 'google-genai' no está instalado. Corre: pip install google-genai")
        return 1

    client = genai.Client(api_key=api_key)

    print(f"[INFO] Probando conexión con Gemini -- modelo: {args.model}")
    try:
        response = client.models.generate_content(
            model=args.model,
            contents="Responde únicamente con la palabra: OK",
        )
    except Exception as e:
        print(f"[FAIL] Error al invocar Gemini: {e}")
        return 1

    text = (response.text or "").strip()
    if not text:
        print("[FAIL] Gemini respondió, pero sin texto en el contenido.")
        return 1

    print(f"[OK] Conexión exitosa. Respuesta del modelo: {text!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
