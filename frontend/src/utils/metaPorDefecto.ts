// Meta por defecto de un concepto (C-06): la cantidad repartida en su duración programada
// (días inclusive), expresada en la cadencia del proyecto. Sin programa (sin fechas, fechas
// ilegibles o invertidas, o cantidad no positiva) la meta queda VACÍA. Espejo de
// `meta_por_defecto` en backend/server.py; sin Float: enteros escalados a 4 decimales.
//   DIARIA = cantidad ÷ días · SEMANAL = cantidad ÷ (días/7) · MENSUAL = cantidad ÷ (días/30.4)
import { t } from '@/src/i18n';
import { decimalStringToScaled, formatCantidad, scaledToDecimalString } from '@/src/utils/money';
import { DECIMALES_CANTIDAD } from '@/src/utils/numeros';
import { PERIODICIDAD_META_LABELS, type PeriodicidadMeta } from '@/src/utils/unidades';

/** Texto de la meta de un concepto para mostrar: "12.5 M2 / semanal" o "Sin meta" si está vacía. */
export function textoDeMeta(meta: string | null | undefined, unidad: string, periodicidad?: string | null): string {
  if (!(meta ?? '').trim()) return t('meta.sinMeta');
  const p = PERIODICIDAD_META_LABELS[cadenciaDeProyecto(periodicidad)].toLowerCase();
  return `${formatCantidad(meta)} ${unidad} / ${p}`;
}

const ESCALA = DECIMALES_CANTIDAD;
const MINIMO_ESCALADO = 1; // 0.0001

/** Cadencia del proyecto (DIARIA|SEMANAL|MENSUAL); MENSUAL si falta o es inválida. */
export function cadenciaDeProyecto(cadencia?: string | null): PeriodicidadMeta {
  const c = (cadencia || '').toUpperCase();
  return c === 'DIARIA' || c === 'SEMANAL' || c === 'MENSUAL' ? c : 'MENSUAL';
}

/** Días desde la época para "YYYY-MM-DD" (null si no es una fecha real del calendario). */
function diaAbsoluto(fecha?: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((fecha || '').trim());
  if (!m) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(anio, mes - 1, dia);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return Math.round(ms / 86_400_000);
}

/** Duración en días inclusive (fin − inicio + 1), o null si no hay un rango válido. */
export function duracionEnDias(inicio?: string | null, fin?: string | null): number | null {
  const a = diaAbsoluto(inicio);
  const b = diaAbsoluto(fin);
  if (a === null || b === null) return null;
  const dias = b - a + 1;
  return dias >= 1 ? dias : null;
}

/** n/d entero con redondeo HALF_UP (n y d positivos, en enteros seguros). */
function dividirRedondeando(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

/**
 * Meta por defecto como decimal exacto en texto (hasta 4 decimales, sin ceros sobrantes), o
 * null si no hay programa. `cantidad` es un decimal con punto ("1500.25").
 */
export function metaPorDefecto(
  cantidad: string | null | undefined,
  fechaInicio: string | null | undefined,
  fechaFin: string | null | undefined,
  cadencia?: string | null,
): string | null {
  const texto = (cantidad ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(texto)) return null;
  const q = decimalStringToScaled(texto, ESCALA);
  if (q <= 0) return null;
  const dias = duracionEnDias(fechaInicio, fechaFin);
  if (dias === null) return null;
  // Guarda: los productos intermedios deben caber en un entero seguro (cantidades absurdas → sin meta).
  if (!Number.isSafeInteger(q * 3040)) return null;

  let valor: number;
  switch (cadenciaDeProyecto(cadencia)) {
    case 'DIARIA':
      valor = dividirRedondeando(q, dias);
      break;
    case 'SEMANAL':
      valor = dividirRedondeando(q * 7, dias);
      break;
    default: // MENSUAL: 30.4 días por mes = 304/10
      valor = dividirRedondeando(q * 304, dias * 10);
  }
  if (valor < MINIMO_ESCALADO) valor = MINIMO_ESCALADO;
  const salida = scaledToDecimalString(valor, ESCALA);
  return salida.includes('.') ? salida.replace(/0+$/, '').replace(/\.$/, '') : salida;
}
