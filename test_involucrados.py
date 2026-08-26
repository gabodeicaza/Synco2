#!/usr/bin/env python3
"""
Test específico del feature "Involucrados" (Fase 1.5).

Escenario:
  1. Coord crea minuta con involved_ids = [maria].
  2. Coord lista con mine=1 → debe aparecer (autor).
  3. Maria lista con mine=1 → debe aparecer (involucrada, aunque no sea
     responsable de ningún acuerdo).
  4. Un tercer usuario NO involucrado, con mine=1 → NO debe aparecer.
  5. Cleanup: borrar la minuta.
"""
import json
import sys
import urllib.error
import urllib.request as _r

BASE = "http://localhost:8001/api"


def _req(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = _r.Request(url, data=data, method=method, headers=headers)
    try:
        with _r.urlopen(req, timeout=30) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read()) if e.headers.get("content-type", "").startswith("application/json") else {"detail": e.read().decode()}


def _login(email, pwd):
    st, data = _req("POST", "/auth/login", {"email": email, "password": pwd})
    assert st == 200, f"login {email} → {st} {data}"
    return data["token"], data["user"]


def main() -> int:
    print("── 1) Logins ──")
    tok_g, u_g = _login("gabriel@synco.mx", "SynCo2026!Coord")
    tok_m, u_m = _login("maria@synco.mx", "SynCo2026!Coord2")
    print(f"   Coord: {u_g['name']}  ·  Sub-Coord: {u_m['name']}")

    print("── 2) Proyectos + otro user no involucrado ──")
    st, projs = _req("GET", "/projects", token=tok_g)
    assert st == 200 and projs, projs
    pid = projs[0]["id"]
    st, members = _req("GET", f"/projects/{pid}/members", token=tok_g)
    assert st == 200
    # Un tercero (que NO va como involucrado)
    third = next((m for m in members if m["id"] not in (u_g["id"], u_m["id"])), None)
    print(f"   Proyecto {pid} · Miembros {len(members)}. Tercero: {third['name'] if third else 'N/A'}")

    print("── 3) Coord crea minuta con Maria como involucrada ──")
    st, minuta = _req("POST", f"/projects/{pid}/minutas", body={
        "titulo": "TEST · Involucrados",
        "descripcion": "Verifica que Maria (involucrada) la vea en Mis Minutas.",
        "involved_ids": [u_m["id"]],
        "fecha_reunion": "2026-07-07",
        "acuerdos": [
            {"descripcion": "Tarea única (responsable Gabriel)",
             "responsable_id": u_g["id"], "fecha_limite": "2026-08-15"},
        ],
    }, token=tok_g)
    assert st == 200, (st, minuta)
    mid = minuta["id"]
    assert minuta.get("involved_ids") == [u_m["id"]]
    assert u_m["name"] in (minuta.get("involved_names") or [])
    print(f"   OK minuta {mid} · involved_names={minuta['involved_names']}")

    print("── 4) Coord con mine=1 → la ve (autor) ──")
    st, lst = _req("GET", f"/projects/{pid}/minutas?mine=1", token=tok_g)
    assert st == 200 and any(m["id"] == mid for m in lst), "Coord debe verla"
    print("   OK Coord la ve")

    print("── 5) Maria con mine=1 → la ve (involucrada, no responsable) ──")
    st, lst = _req("GET", f"/projects/{pid}/minutas?mine=1", token=tok_m)
    assert st == 200 and any(m["id"] == mid for m in lst), (
        f"Maria (involucrada) debe verla — respuesta={[m.get('titulo') for m in lst]}"
    )
    print("   OK Maria la ve por 'involved_ids'")

    print("── 6) Tercero (login opcional): con mine=1 NO debe verla ──")
    # Sólo si el tercero tiene un login público. Intentamos con contraseñas de prueba conocidas del md.
    third_token = None
    if third:
        for pwd in ("FeedTest2026!", "Test1234!", "Espec2026!"):
            st2, res2 = _req("POST", "/auth/login", {"email": third["email"], "password": pwd})
            if st2 == 200:
                third_token = res2["token"]
                break
    if third_token:
        st, lst = _req("GET", f"/projects/{pid}/minutas?mine=1", token=third_token)
        assert st == 200 and not any(m["id"] == mid for m in lst), \
            "Tercero (no involucrado) NO debía verla"
        print(f"   OK {third['email']} NO la ve (correcto)")
    else:
        print("   ⚠ Sin credenciales de un tercero; salto la validación negativa.")

    print("── 7) Cleanup ──")
    st, _ = _req("DELETE", f"/minutas/{mid}", token=tok_g)
    assert st == 200
    print("   OK borrada")

    print("\n✅ Involucrados: FLUJO END-TO-END OK.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f"\n❌ FAIL: {e}")
        sys.exit(1)
