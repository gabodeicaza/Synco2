// Comparador de claves jerárquicas (ej. "3.3", "10.3", "1.10", "A1011") para
// el Catálogo de Conceptos. Ordenar estas claves como texto es un error:
// "10.3" quedaría antes que "3.3", "1.10" antes que "1.2", y "A1010" antes
// que "A102".
//
// Divide cada clave por "." y compara segmento por segmento. Un segmento
// puramente numérico se compara como entero y SIEMPRE ordena antes que uno
// que no lo es (ej. "3" y "10" antes que "3A") — esa regla no cambia. Entre
// dos segmentos no puramente numéricos (ej. "A101" vs "A1010"), en vez de
// texto plano se tokeniza en corridas dígito/no-dígito alternadas
// (_tokenizeAlnum) para que el prefijo alfabético compare como texto y la
// corrida numérica como entero: "A101" < "A102" < "A1010" < "A1011".
// No asume un número fijo de segmentos. Espejo (mismo algoritmo) de
// backend/server.py (clave_sort_key), que es la fuente de verdad del orden
// que devuelve la API — este comparador se usa solo para reordenar
// resultados ya cacheados en el cliente (ej. tras filtrar una búsqueda
// global local).

type AlnumToken = readonly [0, number] | readonly [1, string];

function _tokenizeAlnum(segment: string): AlnumToken[] {
  const tokens: AlnumToken[] = [];
  for (const run of segment.match(/\d+|\D+/g) || []) {
    tokens.push(/^\d+$/.test(run) ? [0, parseInt(run, 10)] : [1, run]);
  }
  return tokens;
}

function _compareTokens(ta: AlnumToken[], tb: AlnumToken[]): number {
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const a = ta[i];
    const b = tb[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[0] === 0) {
      if (a[1] !== b[1]) return (a[1] as number) - (b[1] as number);
    } else {
      const c = (a[1] as string).localeCompare(b[1] as string);
      if (c !== 0) return c;
    }
  }
  return 0;
}

export function compareClaves(a: string, b: string): number {
  const as = (a || '').split('.');
  const bs = (b || '').split('.');
  const len = Math.max(as.length, bs.length);

  for (let i = 0; i < len; i++) {
    const sa = as[i];
    const sb = bs[i];
    // Una clave que es prefijo de otra ("1.2" vs "1.2.1") ordena primero.
    if (sa === undefined) return -1;
    if (sb === undefined) return 1;

    const na = /^\d+$/.test(sa) ? parseInt(sa, 10) : null;
    const nb = /^\d+$/.test(sb) ? parseInt(sb, 10) : null;

    if (na !== null && nb !== null) {
      if (na !== nb) return na - nb;
      continue;
    }
    // Segmento numérico ordena antes que uno no-numérico en la misma posición.
    if (na !== null) return -1;
    if (nb !== null) return 1;
    const c = _compareTokens(_tokenizeAlnum(sa), _tokenizeAlnum(sb));
    if (c !== 0) return c;
  }
  return 0;
}

export function sortByClave<T>(items: T[], claveOf: (item: T) => string = (it: any) => it.clave): T[] {
  return [...items].sort((a, b) => compareClaves(claveOf(a), claveOf(b)));
}
