import dayjs from 'dayjs';
import type { ConfigType } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import 'dayjs/locale/es';

// [MANDATORY] Import and extend plugins before any other code
dayjs.extend(utc);
dayjs.extend(isSameOrAfter);
dayjs.locale('es');

/**
 * Helpers de zona horaria _ SynCo opera SIEMPRE en `America/Mexico_City` (CDMX).
 *
 * El backend almacena/expone timestamps en UTC. El frontend debe convertirlos
 * a CDMX para display coherente, sin que el sistema operativo del dispositivo
 * (que puede estar en UTC, PDT, GMT, etc.) cambie la vista.
 */
export const CDMX_TZ = 'America/Mexico_City';
export const CDMX_LOCALE = 'es-MX';

// CDMX no tiene horario de verano desde 2022 -- es UTC-6 fijo todo el año.
const CDMX_OFFSET_MIN = -360;

// [BUG REAL: "mi reporte dice que se redactó 6h después"] `dayjs/plugin/timezone`
// resuelve `.tz('America/Mexico_City')` vía `Intl.DateTimeFormat`. En el APK
// compilado con Hermes esa resolución fallaba en silencio (sin lanzar error)
// y devolvía el dato SIN convertir -- se mostraba la hora UTC cruda como si
// fuera CDMX, 6h adelantada. Confirmado: funcionaba bien en Node (Intl
// completo) pero no en el build real del dispositivo, y persistía tras
// reconstruir app y backend porque el bug estaba aquí, no en los datos.
// Como CDMX es un offset fijo, reemplazamos `.tz()` por aritmética simple de
// offset -- no depende de Intl ni de la tabla de zonas IANA del dispositivo.
dayjs.prototype.tz = function (_zone?: string) {
  return this.utcOffset(CDMX_OFFSET_MIN);
};
(dayjs as any).tz = function (input?: any, _zone?: string) {
  if (input === undefined) return dayjs().utcOffset(CDMX_OFFSET_MIN);
  return dayjs(input).utcOffset(CDMX_OFFSET_MIN, true);
};
(dayjs as any).tz.setDefault = function (_zone: string) {};

// Tipos equivalentes a los que aportaba `dayjs/plugin/timezone` (ya no se
// carga en runtime -- ver comentario arriba), para no perder el tipado de
// `.tz()` en los ~15 call-sites que ya lo usan en toda la app.
declare module 'dayjs' {
  interface Dayjs {
    tz(timezone?: string): Dayjs;
  }
  interface DayjsTimezone {
    (date?: ConfigType, timezone?: string): Dayjs;
    setDefault(timezone?: string): void;
  }
  const tz: DayjsTimezone;
}

export { dayjs };

/** `06 jul 2026, 17:42` _ para tarjetas y modales. */
export function fmtDateTimeCDMX(input: string | number | Date | null | undefined): string {
  if (!input) return '_';
  try {
    // [FIX] Forzar parseo UTC antes de convertir a la zona horaria CDMX
    return dayjs.utc(input).tz(CDMX_TZ).format('DD MMM YYYY, HH:mm');
  } catch {
    return String(input);
  }
}

export function timeAgoCDMX(iso?: string | null): string {
  if (!iso) return '_';
  try {
    // [FIX] Forzar parseo UTC para evitar el offset de +6h
    const created = dayjs.utc(iso).tz(CDMX_TZ);
    const now = dayjs().tz(CDMX_TZ);
    const diffMin = now.diff(created, 'minute');

    if (diffMin < 1) return 'ahora';
    if (diffMin < 60) return `hace ${diffMin}m`;
    const diffHr = now.diff(created, 'hour');
    if (diffHr < 24) return `hace ${diffHr}h`;

    return created.format('DD MMM');
  } catch {
    return '_';
  }
}

/** `06 jul 2026` _ solo fecha. */
export function fmtDateCDMX(input: string | number | Date | null | undefined): string {
  if (!input) return '_';
  try {
    return dayjs.utc(input).tz(CDMX_TZ).format('DD MMM YYYY');
  } catch {
    return String(input);
  }
}

/** `17:42` _ solo hora local. */
export function fmtTimeCDMX(input: string | number | Date | null | undefined): string {
  if (!input) return '_';
  try {
    return dayjs.utc(input).tz(CDMX_TZ).format('HH:mm');
  } catch {
    return String(input);
  }
}

/** `YYYY-MM-DD` calculado en zona CDMX (util para filtrar por dia calendario). */
export function toISODateCDMX(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  try {
    return dayjs.utc(input).tz(CDMX_TZ).format('YYYY-MM-DD');
  } catch {
    return String(input).slice(0, 10);
  }
}

/**
 * Devuelve el inicio del "día actual" en CDMX, convertido a Dayjs objeto.
 */
export function getStartOfTodayCDMX() {
  return dayjs().tz(CDMX_TZ).startOf('day');
}

/**
 * Devuelve el inicio de la "semana natural" (Domingo) en CDMX.
 */
export function getStartOfNaturalWeekCDMX() {
  // day(0) siempre es Domingo en Dayjs, independientemente del locale.
  return dayjs().tz(CDMX_TZ).startOf('day').day(0);
}

/**
 * Devuelve el inicio del "mes natural" (Día 1) en CDMX.
 */
export function getStartOfNaturalMonthCDMX() {
  return dayjs().tz(CDMX_TZ).startOf('month');
}
