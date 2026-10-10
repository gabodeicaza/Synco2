// Presentación de las cifras financieras del análisis EVM (A-04, A-05). Sin aritmética con
// Float: solo decide qué texto y qué tono mostrar; los montos vienen ya redondeados del servidor.
import { t } from '@/src/i18n';
import type { PeriodoFinanciero } from '@/src/api';
import { decimalStringToCents, formatMoney } from '@/src/utils/money';
import { formatearRangoLegible } from '@/src/utils/rangoFechas';

export const PERIODOS_FINANCIEROS: PeriodoFinanciero[] = ['mes_actual', 'ultimos_3_meses', 'proyecto_completo'];
export const PERIODO_FINANCIERO_DEFECTO: PeriodoFinanciero = 'mes_actual';

/** Periodo de una presentación; las que no lo traen (o traen uno desconocido) usan el mes actual. */
export function periodoDePresentacion(valor?: string | null): PeriodoFinanciero {
  return PERIODOS_FINANCIEROS.includes(valor as PeriodoFinanciero) ? (valor as PeriodoFinanciero) : PERIODO_FINANCIERO_DEFECTO;
}

export function etiquetaPeriodo(periodo: PeriodoFinanciero): string {
  switch (periodo) {
    case 'ultimos_3_meses': return t('finanzas.ultimos3Meses');
    case 'proyecto_completo': return t('finanzas.proyectoCompleto');
    default: return t('finanzas.mesActual');
  }
}

/** "Periodo: Del 1 al 24 de septiembre de 2026" (vacío si las fechas no sirven). */
export function textoRangoPeriodo(start?: string | null, end?: string | null): string {
  if (!start || !end) return '';
  const rango = formatearRangoLegible(start, end);
  return rango ? t('finanzas.periodoDelRango', { rango }) : '';
}

export interface VariacionCostoUI {
  /** Texto para la tarjeta: "—" mientras no hay gasto real. */
  valor: string;
  /** Nota bajo la cifra. */
  nota: string;
  /** Tono del semáforo; `null` = neutro (sin color verde ni rojo). */
  tono: 'positivo' | 'negativo' | null;
}

/** CV = Ganado − Real. Con AC = 0 el servidor manda `null` y aquí queda "—", sin color. */
export function variacionCostoUI(variacionCosto: string | null | undefined): VariacionCostoUI {
  if (variacionCosto == null) {
    return { valor: '—', nota: t('evm.sinGasto'), tono: null };
  }
  return {
    valor: formatMoney(variacionCosto),
    nota: t('finanzas.variacionCostoAyuda'),
    tono: decimalStringToCents(variacionCosto) >= 0 ? 'positivo' : 'negativo',
  };
}
