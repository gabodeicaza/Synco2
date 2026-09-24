// Catálogo de Conceptos — Unidad de medida. Selector, nunca texto libre.
// Mismo patrón que MeasurementType en roles.ts: union type + Record<Tipo,Label>.

export type Unidad =
  | 'UNIVERSAL'
  | 'PZA'
  | 'KG'
  | 'TON'
  | 'G'
  | 'M'
  | 'KM'
  | 'CM'
  | 'M2'
  | 'M3'
  | 'L'
  | 'ML'
  | 'LOTE'
  | 'JGO'
  | 'HR'
  | 'JORNADA'
  | 'SERV';

export const UNIDAD_DEFAULT: Unidad = 'UNIVERSAL';

export const UNIDADES: Unidad[] = [
  'UNIVERSAL', 'PZA', 'KG', 'TON', 'G', 'M', 'KM', 'CM', 'M2', 'M3',
  'L', 'ML', 'LOTE', 'JGO', 'HR', 'JORNADA', 'SERV',
];

export const UNIDAD_LABELS: Record<Unidad, string> = {
  UNIVERSAL: 'Universal',
  PZA: 'Pieza',
  KG: 'Kilogramo',
  TON: 'Tonelada',
  G: 'Gramo',
  M: 'Metro',
  KM: 'Kilómetro',
  CM: 'Centímetro',
  M2: 'Metro cuadrado',
  M3: 'Metro cúbico',
  L: 'Litro',
  ML: 'Metro lineal',
  LOTE: 'Lote',
  JGO: 'Juego',
  HR: 'Hora',
  JORNADA: 'Jornada',
  SERV: 'Servicio',
};

export function isUnidad(value: string | null | undefined): value is Unidad {
  return !!value && (UNIDADES as string[]).includes(value);
}

/** Periodicidad de la Meta (ritmo objetivo) de un concepto. */
export type PeriodicidadMeta = 'DIARIA' | 'SEMANAL' | 'MENSUAL';

export const PERIODICIDADES_META: PeriodicidadMeta[] = ['DIARIA', 'SEMANAL', 'MENSUAL'];

export const PERIODICIDAD_META_LABELS: Record<PeriodicidadMeta, string> = {
  DIARIA: 'Diaria',
  SEMANAL: 'Semanal',
  MENSUAL: 'Mensual',
};

// --- Unidades del proyecto (C-04 / C-12) ---------------------------------------
// Las unidades que se ofrecen en filtros, importador y captura son la lista base
// MÁS las personalizadas del proyecto, sin repetirse.

/** Texto sin acentos, sin espacios sobrantes y en minúsculas, para comparar nombres. */
export function claveComparable(texto: string | null | undefined): string {
  return (texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

const NOMBRES_BASE_COMPARABLES = new Set<string>([
  ...UNIDADES.map((u) => claveComparable(u)),
  ...UNIDADES.map((u) => claveComparable(UNIDAD_LABELS[u])),
]);

/** Lista base + personalizadas del proyecto, sin duplicados (sin acentos ni mayúsculas); la base va primero. */
export function unidadesDelProyecto(personalizadas?: string[] | null): string[] {
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const u of [...UNIDADES, ...(personalizadas || [])]) {
    const texto = (u ?? '').trim();
    const clave = claveComparable(texto);
    if (!clave || vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(texto);
  }
  return salida;
}

export type ResultadoUnidadPersonalizada =
  | { ok: true; unidad: string }
  | { ok: false; motivo: 'vacia' | 'repetida' };

/** Valida una unidad personalizada nueva: no vacía y que no exista ya en la lista base ni entre las del proyecto. */
export function validarUnidadPersonalizada(actuales: string[], nueva: string): ResultadoUnidadPersonalizada {
  const unidad = (nueva ?? '').trim().toUpperCase();
  const clave = claveComparable(unidad);
  if (!clave) return { ok: false, motivo: 'vacia' };
  if (NOMBRES_BASE_COMPARABLES.has(clave) || actuales.some((u) => claveComparable(u) === clave)) {
    return { ok: false, motivo: 'repetida' };
  }
  return { ok: true, unidad };
}

export type ResultadoNombreNivel =
  | { ok: true; nombre: string }
  | { ok: false; motivo: 'vacio' | 'repetido' };

/** Valida el nombre de un nivel del catálogo: no vacío y sin repetir otro nivel (sin acentos ni mayúsculas). */
export function validarNombreNivel(actuales: string[], nuevo: string): ResultadoNombreNivel {
  const nombre = (nuevo ?? '').trim();
  const clave = claveComparable(nombre);
  if (!clave) return { ok: false, motivo: 'vacio' };
  if (actuales.some((n) => claveComparable(n) === clave)) return { ok: false, motivo: 'repetido' };
  return { ok: true, nombre };
}
