// Género gramatical de los nombres de nivel del proyecto (C-14): «Nueva partida» / «Nuevo concepto».
// El servidor deduce el género por la terminación de la palabra; el proyecto puede forzarlo con
// `genero_niveles` (clave = nombre del nivel, sin distinguir mayúsculas). «Automático» = sin clave.
export type GeneroNivel = 'auto' | 'm' | 'f';
export type MapaGeneros = Record<string, 'm' | 'f'>;

/** Clave con la que se guarda el género del nivel de concepto cuando el proyecto no le puso nombre. */
export const CLAVE_CONCEPTO_SIN_NOMBRE = 'concepto';

const norm = (s: string) => (s ?? '').trim().toLowerCase();

const esGenero = (v: unknown): v is 'm' | 'f' => v === 'm' || v === 'f';

/** Solo pares con nombre y valor válidos (lo que llega del servidor puede traer basura). */
export function normalizarGeneros(mapa: Record<string, unknown> | null | undefined): MapaGeneros {
  const salida: MapaGeneros = {};
  for (const [clave, valor] of Object.entries(mapa ?? {})) {
    const nombre = (clave ?? '').trim();
    if (nombre && esGenero(valor)) salida[nombre] = valor;
  }
  return salida;
}

export function generoDe(mapa: MapaGeneros | null | undefined, nombre: string): GeneroNivel {
  const buscado = norm(nombre);
  if (!buscado) return 'auto';
  for (const [clave, valor] of Object.entries(mapa ?? {})) {
    if (norm(clave) === buscado && esGenero(valor)) return valor;
  }
  return 'auto';
}

/** Devuelve un mapa nuevo con el género del nivel `nombre` (o sin él si es «automático»). */
export function ponerGenero(mapa: MapaGeneros | null | undefined, nombre: string, genero: GeneroNivel): MapaGeneros {
  const buscado = norm(nombre);
  const salida: MapaGeneros = {};
  for (const [clave, valor] of Object.entries(mapa ?? {})) {
    if (norm(clave) !== buscado) salida[clave] = valor;
  }
  const limpio = (nombre ?? '').trim();
  if (limpio && genero !== 'auto') salida[limpio] = genero;
  return salida;
}

/** Si se renombra un nivel, su género pasa a la clave nueva (o se descarta si no había). */
export function migrarGenero(mapa: MapaGeneros | null | undefined, viejo: string, nuevo: string): MapaGeneros {
  const genero = generoDe(mapa, viejo);
  return ponerGenero(ponerGenero(mapa, viejo, 'auto'), nuevo, genero);
}

/** Deja solo los géneros de los nombres vigentes (al quitar un nivel se descarta el suyo). */
export function podarGeneros(mapa: MapaGeneros | null | undefined, nombresVigentes: string[]): MapaGeneros {
  const vigentes = new Map(nombresVigentes.map((n) => [norm(n), n.trim()] as const).filter(([k]) => !!k));
  const salida: MapaGeneros = {};
  for (const [clave, valor] of Object.entries(mapa ?? {})) {
    const nombre = vigentes.get(norm(clave));
    if (nombre && esGenero(valor)) salida[nombre] = valor;
  }
  return salida;
}

/** Nombre con el que se guarda el género del nivel de concepto. */
export function claveDeConcepto(nombreConcepto: string): string {
  return (nombreConcepto ?? '').trim() || CLAVE_CONCEPTO_SIN_NOMBRE;
}

/** Mapa que se envía al guardar la configuración: solo niveles vigentes y el concepto. */
export function generosParaGuardar(
  mapa: MapaGeneros | null | undefined, nombresNiveles: string[], nombreConcepto: string,
): MapaGeneros {
  return podarGeneros(mapa, [...nombresNiveles, claveDeConcepto(nombreConcepto)]);
}
