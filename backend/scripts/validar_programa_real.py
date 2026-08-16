#!/usr/bin/env python
"""Diagnóstico del parser del Programa desglosado contra un archivo REAL.

No toca Mongo ni el catálogo de un proyecto -- corre exactamente el mismo
código que usará el wizard (agrupar_bloques_programa,
extraer_distribucion_mensual_bloque, validar_cuadre_distribucion,
parse_rango_fechas_mes, vía _validar_archivo_programa_completo) pero en
modo "solo lectura" contra el archivo .xlsx, sin necesitar un backend vivo.

USO:
    cd backend
    python scripts/validar_programa_real.py "C:\\ruta\\a\\Programa desglosado 27-05-26.xlsx"

Con overrides opcionales si el archivo no coincide con lo esperado
(hoja "Cambio", encabezado en la fila 19 = header_row_index 18):
    python scripts/validar_programa_real.py "ruta.xlsx" --sheet "Cambio" --header-row 18 --convencion punto

QUÉ HACE:
    1. Abre el archivo y la hoja, muestra el encabezado detectado y la fila
       de rangos de fecha justo debajo (para que confirmes a simple vista
       que "Mes 1" es diciembre 2025, no enero).
    2. Propone el mapeo de columnas (Código/Importe/Inicio/Fin/Meses) por
       nombre de encabezado -- lo imprime para que lo revises.
    3. Agrupa TODO el archivo en bloques de concepto y corre la validación
       de cuadre (suma mensual vs. importe del concepto, tolerancia 1
       centavo) sobre cada uno.
    4. Imprime un resumen + el detalle de cualquier concepto que:
       - no cuadre (la suma mensual no coincide con su importe)
       - tenga una celda de mes ilegible
       - tenga el importe ilegible

QUÉ ME REPORTAS DE VUELTA:
    - El resumen final completo (las últimas ~10 líneas de la salida).
    - Si "NO CUADRAN" > 0: pega aquí el detalle de 2-3 de esos conceptos
      (clave, importe del concepto, suma de la distribución, diferencia).
    - Si el mapeo propuesto en el paso 2 se ve mal (por ejemplo, "Meses"
      trae menos columnas de las que el archivo realmente tiene, o falta
      Código/Importe), dímelo -- probablemente el encabezado real usa
      nombres de columna distintos a los que busco por patrón.
    - Si la fila de rangos de fecha (paso 1) no corresponde con lo que ves
      en el Excel para esas columnas (ej. "Mes 1" debería ser diciembre y
      el script muestra otra cosa), dímelo con el valor que sí esperabas.
"""
import argparse
import io
import os
import sys
from pathlib import Path

# La consola de Windows (cp1252/cp850 según la máquina) no imprime acentos
# de UTF-8 por default -- sin esto, "validación"/"Código" salen como
# mojibake aunque el script funcione bien. No falla si stdout ya no es un
# stream reconfigurable (ej. corriendo dentro de otro proceso).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Mismas env vars dummy que usan los tests -- server.py las exige para
# arrancar (construye el cliente de Mongo al importar), pero este script
# nunca las usa de verdad: no hace ninguna llamada a la DB.
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "synco_script_validar_programa")
os.environ.setdefault("JWT_SECRET", "dummy_script_secret")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import (  # noqa: E402
    _read_workbook_sheets,
    _propose_mapping_programa,
    _validar_archivo_programa_completo,
    detectar_convencion,
)


class _MappingNS:
    """Objeto mínimo con los mismos atributos que ProgramaImportMapping
    (Pydantic) -- evita depender del modelo exacto para este script suelto."""
    def __init__(self, codigo, importe, inicio, fin, meses):
        self.codigo = codigo
        self.importe = importe
        self.inicio = inicio
        self.fin = fin
        self.meses = meses


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("archivo", help="Ruta al .xlsx del Programa desglosado")
    ap.add_argument("--sheet", default="Cambio", help='Nombre de la hoja (default: "Cambio")')
    ap.add_argument("--header-row", type=int, default=18, help="Índice 0-based de la fila de encabezado (default: 18 = fila 19)")
    ap.add_argument("--convencion", choices=["coma", "punto"], default=None, help="Forzar convención decimal (default: autodetectar)")
    args = ap.parse_args()

    path = Path(args.archivo)
    if not path.exists():
        print(f"ERROR: no existe el archivo: {path}")
        sys.exit(1)

    content = path.read_bytes()
    sheets = _read_workbook_sheets(path.name, content)
    print(f"Hojas encontradas en el archivo: {list(sheets.keys())}")
    if args.sheet not in sheets:
        print(f"ERROR: la hoja '{args.sheet}' no existe. Usa --sheet con una de las de arriba.")
        sys.exit(1)
    rows = sheets[args.sheet]
    print(f"Hoja '{args.sheet}': {len(rows)} filas totales.\n")

    if args.header_row >= len(rows):
        print(f"ERROR: --header-row {args.header_row} está fuera de rango (la hoja solo tiene {len(rows)} filas).")
        sys.exit(1)

    headers = [str(c) if c is not None else "" for c in rows[args.header_row]]
    print(f"--- PASO 1: encabezado detectado en la fila {args.header_row + 1} (1-based) ---")
    for i, h in enumerate(headers):
        if h:
            print(f"  [{i}] {h}")

    fila_rangos = rows[args.header_row + 1] if args.header_row + 1 < len(rows) else []
    print(f"\n--- Fila de rangos de fecha (la siguiente, fila {args.header_row + 2}) ---")
    for i, v in enumerate(fila_rangos):
        if v not in (None, ""):
            print(f"  [{i}] {v!r}")

    print("\n--- PASO 2: mapeo propuesto automáticamente (por nombre de columna) ---")
    propuesto = _propose_mapping_programa(headers)
    print(f"  Código:  {propuesto.get('codigo')!r}")
    print(f"  Importe: {propuesto.get('importe')!r}")
    print(f"  Inicio:  {propuesto.get('inicio')!r}")
    print(f"  Fin:     {propuesto.get('fin')!r}")
    print(f"  Meses ({len(propuesto.get('meses', []))}): {propuesto.get('meses')}")

    if not propuesto.get("codigo") or not propuesto.get("importe") or not propuesto.get("meses"):
        print("\n  AVISO: el mapeo automático no encontró Código, Importe, o ninguna columna de Mes.")
        print("  Revisa los nombres de columna de arriba (PASO 1) -- probablemente no calzan con los")
        print('  patrones que busco ("codigo"/"clave", "importe", "^mes\\s*\\d+"). Repórtamelo con los')
        print("  nombres reales de esas columnas para ajustar la detección.")
        sys.exit(1)

    mapping = _MappingNS(
        codigo=propuesto["codigo"], importe=propuesto["importe"],
        inicio=propuesto.get("inicio"), fin=propuesto.get("fin"), meses=propuesto["meses"],
    )

    convencion = args.convencion
    if convencion is None:
        candidatos = [cell for row in rows for cell in row]
        convencion = detectar_convencion(candidatos)
        print(f"\nConvención decimal autodetectada: {convencion!r} (usa --convencion para forzar otra)")

    print("\n--- PASO 3: agrupando bloques y validando cuadre de TODO el archivo ---")
    filas = _validar_archivo_programa_completo(rows, args.header_row, mapping, convencion, conceptos_by_clave={})

    total = len(filas)
    con_distribucion = [f for f in filas if f["tiene_distribucion_propia"]]
    sin_distribucion = [f for f in filas if not f["tiene_distribucion_propia"]]
    no_cuadran = [f for f in con_distribucion if any(p["tipo"] == "distribucion_no_cuadra" for p in f["problemas"])]
    celda_ilegible = [f for f in filas if any(p["tipo"] == "celda_mes_ilegible" for p in f["problemas"])]
    importe_ilegible = [f for f in filas if any(p["tipo"] == "importe_ilegible" for p in f["problemas"])]

    print(f"\n--- RESUMEN ---")
    print(f"Total de conceptos/renglones encontrados: {total}")
    print(f"  Con distribución mensual propia: {len(con_distribucion)}")
    print(f"  Sin distribución propia (nivel superior, curva se calcula):  {len(sin_distribucion)}")
    print(f"  CUADRAN (suma mensual == importe, tolerancia 1 centavo):     {len(con_distribucion) - len(no_cuadran)}")
    print(f"  NO CUADRAN:                                                  {len(no_cuadran)}")
    print(f"  Con celda de mes ilegible:                                   {len(celda_ilegible)}")
    print(f"  Con importe ilegible:                                        {len(importe_ilegible)}")

    if no_cuadran:
        print(f"\n--- DETALLE: conceptos que NO cuadran (primeros 15) ---")
        for f in no_cuadran[:15]:
            p = next(p for p in f["problemas"] if p["tipo"] == "distribucion_no_cuadra")
            print(f"  {f['clave']}: importe={p['importe_concepto']}  suma_meses={p['suma_distribucion']}  diferencia={p['diferencia']}")

    if celda_ilegible:
        print(f"\n--- DETALLE: celdas de mes ilegibles (primeras 15) ---")
        for f in celda_ilegible[:15]:
            for p in f["problemas"]:
                if p["tipo"] == "celda_mes_ilegible":
                    print(f"  {f['clave']}: {p['motivo']}")

    if importe_ilegible:
        print(f"\n--- DETALLE: importes ilegibles (primeras 15) ---")
        for f in importe_ilegible[:15]:
            for p in f["problemas"]:
                if p["tipo"] == "importe_ilegible":
                    print(f"  {f['clave']}: {p['motivo']}")

    print("\n--- Muestra de fechas parseadas por columna de mes (primer concepto con distribución) ---")
    if con_distribucion:
        muestra = con_distribucion[0]
        print(f"  (concepto de referencia: {muestra['clave']})")
        for i, m in enumerate(muestra["meses"]):
            print(f"  Mes columna '{mapping.meses[i]}': {m['fecha_inicio']} a {m['fecha_fin']}  importe={m['importe']}")

    print("\nListo. Revisa el mapeo (PASO 2), el resumen y el detalle de arriba, y repórtalo de vuelta.")


if __name__ == "__main__":
    main()
