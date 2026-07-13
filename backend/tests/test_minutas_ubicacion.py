"""Smoke test: valida flujo completo de Minutas con ubicacion_id.

Ejecutar:
    cd /app && python3 backend/tests/test_minutas_ubicacion.py

Requiere backend corriendo en localhost:8001 y credenciales del proyecto
raíz configuradas en /app/memory/test_credentials.md.
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://localhost:8001/api"


def req(method: str, path: str, token=None, body=None, qs=None):
    url = BASE + path
    if qs:
        url += "?" + urllib.parse.urlencode(qs)
    data = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            payload = resp.read().decode("utf-8")
            return resp.status, json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(err_body)
        except Exception:
            return e.code, {"raw": err_body}


def die(msg):
    print(f"❌ {msg}")
    sys.exit(1)


def ok(msg):
    print(f"✅ {msg}")


# 1) LOGIN
print("=== 1. Login ===")
status, r = req("POST", "/auth/login", body={"email": "gabriel@synco.mx", "password": "SynCo2026!Coord"})
if status != 200 or "token" not in r:
    die(f"Login falló: {status} {r}")
token = r["token"]
ok(f"Login OK — token len={len(token)}")

# 2) Proyecto
print("\n=== 2. Listar proyectos ===")
status, projects = req("GET", "/projects", token=token)
if status != 200 or not projects:
    die(f"No hay proyectos: {status} {projects}")
project = projects[0]
pid = project["id"]
ok(f"Proyecto: {project.get('name')} ({pid})")

# 3) Nodos (ubicaciones)
print("\n=== 3. Listar nodos del proyecto ===")
status, nodes = req("GET", f"/projects/{pid}/nodes", token=token)
if status != 200:
    die(f"Nodes falló: {status} {nodes}")
if not nodes:
    die("Proyecto sin nodos — no se puede probar ubicacion_id")
node = nodes[0]
nid = node["id"]
deepest = max(nodes, key=lambda n: n.get("depth", 0))
ok(f"Nodo root: {node.get('name')} ({nid}) | Más profundo: {deepest['name']} depth={deepest['depth']}")

# 4) Usuario responsable (nosotros mismos sirve)
print("\n=== 4. GET /auth/me ===")
status, me = req("GET", "/auth/me", token=token)
if status != 200:
    die(f"/auth/me falló: {status} {me}")
my_id = me["id"]
ok(f"Yo: {me['name']} ({my_id})")

# 5) CREAR minuta CON ubicacion_id VÁLIDA (root)
print("\n=== 5. Crear minuta CON ubicacion_id root ===")
minuta_body = {
    "titulo": "TEST — Minuta smoke con ubicación root",
    "descripcion": "Prueba de integración 2026-07",
    "area_ids": [],
    "involved_ids": [],
    "fecha_reunion": "2026-07-15",
    "ubicacion_id": nid,
    "acuerdos": [
        {
            "descripcion": "Verificar cimentación",
            "responsable_id": my_id,
            "fecha_limite": "2026-07-30",
        }
    ],
}
status, m = req("POST", f"/projects/{pid}/minutas", token=token, body=minuta_body)
if status != 200:
    die(f"POST minutas falló: {status} {m}")
if m.get("ubicacion_id") != nid:
    die(f"ubicacion_id no persistió: {m.get('ubicacion_id')} != {nid}")
if not m.get("ubicacion_name"):
    die("ubicacion_name vacío")
if not isinstance(m.get("ubicacion_path_names"), list):
    die(f"ubicacion_path_names no es lista: {m.get('ubicacion_path_names')}")
minuta_id = m["id"]
ok(f"Minuta creada: {minuta_id}")
ok(f"  ubicacion_id={m['ubicacion_id']}")
ok(f"  ubicacion_name={m['ubicacion_name']}")
ok(f"  ubicacion_path_names={m['ubicacion_path_names']}")

# 5b) Crear minuta con nodo PROFUNDO — validar breadcrumb
print("\n=== 5b. Crear minuta con nodo profundo (breadcrumb) ===")
deep_body = dict(minuta_body)
deep_body["ubicacion_id"] = deepest["id"]
deep_body["titulo"] = "TEST — breadcrumb profundo"
status, dm = req("POST", f"/projects/{pid}/minutas", token=token, body=deep_body)
if status != 200:
    die(f"POST minutas profunda falló: {status} {dm}")
breadcrumb = " > ".join(dm.get("ubicacion_path_names") or [])
ok(f"Breadcrumb profundo: {breadcrumb}")
deep_id = dm["id"]

# 6) CREAR minuta SIN ubicacion_id → debe rechazar
print("\n=== 6. Crear minuta SIN ubicacion_id (debe fallar 400) ===")
bad = dict(minuta_body)
bad.pop("ubicacion_id")
bad["titulo"] = "TEST — sin ubicacion"
status, r = req("POST", f"/projects/{pid}/minutas", token=token, body=bad)
if status != 400:
    die(f"Se esperaba 400 sin ubicacion_id, obtuvo {status}: {r}")
ok(f"Rechazo correcto: {r.get('detail')}")

# 7) CREAR minuta con ubicacion_id inválido → debe rechazar
print("\n=== 7. Crear minuta con ubicacion_id inválido ===")
bad2 = dict(minuta_body)
bad2["ubicacion_id"] = "no-existe-xyz"
bad2["titulo"] = "TEST — ubicacion inválida"
status, r = req("POST", f"/projects/{pid}/minutas", token=token, body=bad2)
if status != 400:
    die(f"Se esperaba 400, obtuvo {status}: {r}")
ok(f"Rechazo correcto: {r.get('detail')}")

# 8) LISTAR minutas SIN filtro
print("\n=== 8. Listar minutas sin filtro ===")
status, items = req("GET", f"/projects/{pid}/minutas", token=token)
if status != 200:
    die(f"List falló: {status} {items}")
found = [x for x in items if x["id"] == minuta_id]
if not found:
    die(f"Minuta recién creada no aparece en listado (got {len(items)} items)")
ok(f"Listado devolvió {len(items)} minuta(s), la nueva está presente")

# 9) LISTAR con filtro ubicacion_ids (match)
print("\n=== 9. Filtrar por ubicacion_ids (match) ===")
status, items = req("GET", f"/projects/{pid}/minutas", token=token, qs={"ubicacion_ids": nid})
if status != 200:
    die(f"Filter falló: {status} {items}")
found = [x for x in items if x["id"] == minuta_id]
if not found:
    die("Filtro por ubicacion_ids no devolvió la minuta")
ok(f"Filtro OK: {len(items)} minuta(s) con ubicacion={nid}")

# 10) LISTAR con filtro ubicacion_ids inexistente
print("\n=== 10. Filtrar por ubicacion_ids inexistente ===")
status, items = req("GET", f"/projects/{pid}/minutas", token=token, qs={"ubicacion_ids": "nada-xyz"})
if status != 200:
    die(f"Filter falló: {status} {items}")
found = [x for x in items if x["id"] == minuta_id]
if found:
    die("Filtro con ubicacion inexistente devolvió minutas indebidamente")
ok(f"Filtro por ubicación inexistente devolvió {len(items)} (esperado 0)")

# 11) LIMPIEZA
print("\n=== 11. Limpieza (delete minutas de prueba) ===")
for _id in (minuta_id, deep_id):
    status, r = req("DELETE", f"/minutas/{_id}", token=token)
    if status not in (200, 204):
        print(f"⚠️  DELETE {_id[:8]}… status {status}: {r} (no crítico)")
    else:
        ok(f"Minuta {_id[:8]}… eliminada")

print("\n" + "=" * 50)
print("✅ TODAS LAS PRUEBAS DE MINUTAS PASARON")
print("=" * 50)
