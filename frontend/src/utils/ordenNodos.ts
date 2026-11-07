// Orden de ubicaciones (estaciones, intertramos, postes…) basado en los NÚMEROS del nombre:
// "C40" < "S41" < "S42" < "C52"; "Intertramo 2-3" < "Intertramo 10-11". La letra o el prefijo
// no cuentan. Sin números en el nombre, va después y se desempata con `order` y el nombre.
// Mismo criterio que `_nodo_key` en backend/server.py.

export function numerosDeNombre(nombre?: string | null): number[] {
  return (String(nombre ?? '').match(/\d+/g) || []).map((n) => parseInt(n, 10));
}

export function compararNodos(
  a: { name?: string | null; order?: number | null },
  b: { name?: string | null; order?: number | null },
): number {
  const na = numerosDeNombre(a.name);
  const nb = numerosDeNombre(b.name);
  if (na.length && !nb.length) return -1;
  if (!na.length && nb.length) return 1;
  const n = Math.min(na.length, nb.length);
  for (let i = 0; i < n; i++) {
    if (na[i] !== nb[i]) return na[i] - nb[i];
  }
  if (na.length !== nb.length) return na.length - nb.length;
  return (a.order ?? 0) - (b.order ?? 0) || String(a.name ?? '').localeCompare(String(b.name ?? ''));
}
