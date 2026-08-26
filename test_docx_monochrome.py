#!/usr/bin/env python3
"""
Validación end-to-end del motor DOCX monocromático (Batch Producción V2).

Pasos:
  1. Login como gabriel@synco.mx.
  2. Listar proyectos, tomar el primero con reportes disponibles.
  3. Descargar el DOCX (period=month para asegurar reportes).
  4. Abrir el .docx como ZIP, leer word/document.xml y comprobar:
      - Todo `<w:color w:val="XXXXXX"/>` cumple R==G==B (grayscale puro).
      - No aparece el hex "003366" ni ningún otro color de marca.
  5. Imprimir tabla resumen y exit code 0/1.
"""
import io
import re
import sys
import zipfile
from urllib import request, error

BASE = "http://localhost:8001/api"
EMAIL = "gabriel@synco.mx"
PASS = "SynCo2026!Coord"


def http_json(method, path, body=None, token=None):
    url = BASE + path
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        import json as _json
        data = _json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = request.Request(url, data=data, method=method, headers=headers)
    try:
        with request.urlopen(req, timeout=60) as res:
            raw = res.read()
            import json as _json
            return res.status, (_json.loads(raw) if raw else None), None
    except error.HTTPError as e:
        return e.code, None, e.read().decode(errors="replace")


def http_bin(method, path, token=None):
    url = BASE + path
    req = request.Request(url, method=method, headers={
        "Authorization": f"Bearer {token}" if token else "",
    })
    with request.urlopen(req, timeout=120) as res:
        return res.status, res.read(), dict(res.headers)


def main() -> int:
    print("[1/4] Login...")
    status, data, err = http_json("POST", "/auth/login", {"email": EMAIL, "password": PASS})
    if status != 200 or not data:
        print(f"  ✗ Login falló: {status} {err}")
        return 1
    token = data["token"]
    print(f"  ✓ Token obtenido ({len(token)} chars)")

    print("[2/4] Listar proyectos...")
    status, projects, err = http_json("GET", "/projects", token=token)
    if status != 200 or not projects:
        print(f"  ✗ Sin proyectos: {status} {err}")
        return 1
    print(f"  ✓ Proyectos: {len(projects)}")

    # Elegir el primero con reportes en el mes.
    target_pid = None
    for p in projects:
        pid = p["id"]
        st, feed, _ = http_json("GET", f"/projects/{pid}/reports/feed?range=month&limit=5", token=token)
        if st == 200 and feed and feed.get("reports"):
            target_pid = pid
            print(f"  ✓ Proyecto con reportes: {p['name']} ({pid})")
            break
    if not target_pid:
        # Fallback: usa el primero de todos modos (empty state también valida colores).
        target_pid = projects[0]["id"]
        print(f"  ⚠ Sin reportes recientes, usando {target_pid} en modo empty-state.")

    print("[3/4] Descargar DOCX (period=month)...")
    status, blob, headers = http_bin("GET", f"/projects/{target_pid}/export/reports.docx?period=month", token=token)
    print(f"  ✓ HTTP {status} · {len(blob)} bytes · CT={headers.get('content-type')}")
    if status != 200 or len(blob) < 1024:
        print("  ✗ Descarga fallida o vacía.")
        return 1

    print("[4/4] Auditar word/document.xml (colores)...")
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        with zf.open("word/document.xml") as f:
            xml = f.read().decode("utf-8", errors="replace")

    # Todos los usos de <w:color w:val="RRGGBB"/> — el motor los emite lowercase.
    colors = re.findall(r'<w:color[^/]*w:val="([0-9A-Fa-f]{6})"', xml)
    total = len(colors)
    print(f"  · Total de tokens <w:color/>: {total}")

    non_gray = []
    branded = []
    for c in colors:
        r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
        if not (r == g == b):
            non_gray.append(c)
        cu = c.upper()
        if cu == "003366":  # marca por defecto
            branded.append(c)

    unique_colors = sorted(set(cu.upper() for cu in colors))
    print(f"  · Colores únicos: {unique_colors}")
    print(f"  · Tokens NO-grises: {len(non_gray)}")
    print(f"  · Tokens con marca (#003366): {len(branded)}")

    ok = (len(non_gray) == 0 and len(branded) == 0)
    if ok:
        print("\n✅ DOCX MONOCROMÁTICO CONFIRMADO — sólo negro/gris, sin marca.")
        return 0
    else:
        print("\n❌ DOCX AÚN CONTIENE COLORES NO MONOCROMÁTICOS.")
        if non_gray:
            print(f"   Muestra no-gris: {non_gray[:6]}")
        if branded:
            print(f"   Muestra marca:   {branded[:6]}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
