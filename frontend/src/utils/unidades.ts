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
export type PeriodicidadMeta = 'SEMANAL' | 'MENSUAL';

export const PERIODICIDADES_META: PeriodicidadMeta[] = ['SEMANAL', 'MENSUAL'];

export const PERIODICIDAD_META_LABELS: Record<PeriodicidadMeta, string> = {
  SEMANAL: 'Semanal',
  MENSUAL: 'Mensual',
};
