// Utilidad ÚNICA de fechas (X-04 / A-08 / K-05).
//
// Reglas:
//  - "Hoy" y los rangos se calculan en la zona horaria del PROYECTO, nunca en la
//    del dispositivo ni en UTC. El backend manda `tz_offset_min` (desfase actual
//    respecto a UTC, CDMX = -360) en el proyecto; sin proyecto se usa CDMX.
//  - NO se usa `Intl` ni `dayjs/plugin/timezone`: en el APK con Hermes esa
//    resolución falló en silencio y mostraba la hora UTC como si fuera CDMX
//    (ver el comentario largo en tz.ts). Aquí todo es aritmética de desfase.
//  - Una fecha SIN hora ("2026-09-23") es un día de calendario: se muestra tal
//    cual, sin convertir de zona (convertirla la movía al día anterior).
//  - La semana va de lunes a domingo, salvo que el proyecto configure otro
//    `dia_inicio_semana`.
//  - Un solo formato en pantalla: "23 sep 2026" y "23 sep 2026, 08:47".
import { dayjs } from '@/src/utils/tz';

export const OFFSET_CDMX_MIN = -360;

export type DiaInicioSemana = 'LUNES' | 'MARTES' | 'MIERCOLES' | 'JUEVES' | 'VIERNES' | 'SABADO' | 'DOMINGO';
const INDICE_DIA: Record<DiaInicioSemana, number> = {
  DOMINGO: 0, LUNES: 1, MARTES: 2, MIERCOLES: 3, JUEVES: 4, VIERNES: 5, SABADO: 6,
};

export interface ZonaProyecto {
  tz_offset_min?: number | null;
  dia_inicio_semana?: DiaInicioSemana | null;
}

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function esSoloFecha(v: unknown): v is string {
  return typeof v === 'string' && SOLO_FECHA.test(v);
}

export function offsetDe(zona?: ZonaProyecto | null): number {
  const o = zona?.tz_offset_min;
  return typeof o === 'number' && Number.isFinite(o) ? o : OFFSET_CDMX_MIN;
}

/** Instante -> dayjs "de pared" en la zona (sus campos UTC son la hora local). */
function aLocal(v: string | number | Date, offsetMin: number) {
  return dayjs.utc(v).add(offsetMin, 'minute');
}

/** `23 sep 2026`. Fecha sin hora: sin conversión. Con hora: en la zona del proyecto. */
export function fmtFecha(v: string | number | Date | null | undefined, zona?: ZonaProyecto | null): string {
  if (!v) return '—';
  try {
    const d = esSoloFecha(v) ? dayjs.utc(v) : aLocal(v, offsetDe(zona));
    return d.isValid() ? d.format('DD MMM YYYY') : String(v);
  } catch {
    return String(v);
  }
}

/** `23 sep 2026, 08:47`. Una fecha sin hora se muestra sin hora (todo el día). */
export function fmtFechaHora(v: string | number | Date | null | undefined, zona?: ZonaProyecto | null): string {
  if (!v) return '—';
  if (esSoloFecha(v)) return fmtFecha(v, zona);
  try {
    const d = aLocal(v, offsetDe(zona));
    return d.isValid() ? d.format('DD MMM YYYY, HH:mm') : String(v);
  } catch {
    return String(v);
  }
}

/** `08:47` en la zona del proyecto. */
export function fmtHora(v: string | number | Date | null | undefined, zona?: ZonaProyecto | null): string {
  if (!v || esSoloFecha(v)) return '';
  try {
    const d = aLocal(v, offsetDe(zona));
    return d.isValid() ? d.format('HH:mm') : '';
  } catch {
    return '';
  }
}

/** `YYYY-MM-DD` de hoy en la zona del proyecto (reloj del dispositivo + desfase del proyecto). */
export function hoyProyecto(zona?: ZonaProyecto | null, ahora: number | Date = Date.now()): string {
  return aLocal(ahora, offsetDe(zona)).format('YYYY-MM-DD');
}

/** Suma `dias` a una fecha `YYYY-MM-DD` (calendario puro, sin zona). */
export function sumarDias(fecha: string, dias: number): string {
  return dayjs.utc(fecha).add(dias, 'day').format('YYYY-MM-DD');
}

/** Primer y último día de la semana que contiene `fecha` (lunes-domingo por defecto). */
export function semanaDe(fecha: string, dia: DiaInicioSemana | null | undefined = 'LUNES'): { desde: string; hasta: string } {
  const objetivo = INDICE_DIA[dia || 'LUNES'] ?? 1;
  const actual = dayjs.utc(fecha).day(); // 0 = domingo
  const atras = (actual - objetivo + 7) % 7;
  const desde = sumarDias(fecha, -atras);
  return { desde, hasta: sumarDias(desde, 6) };
}

/** ¿`fecha` (YYYY-MM-DD) es posterior a hoy en la zona del proyecto? */
export function esFechaFutura(fecha: string, zona?: ZonaProyecto | null, ahora: number | Date = Date.now()): boolean {
  return esSoloFecha(fecha) && fecha > hoyProyecto(zona, ahora);
}

export interface EventoConFecha {
  id?: string;
  start_at: string;
  all_day?: boolean | null;
  fecha?: string | null;
}

/** Evento sin hora: minuta, inicio/fin de concepto, o marcado "todo el día". */
export function esDiaCompleto(e: EventoConFecha): boolean {
  return e.all_day === true || /^(minuta|concepto-inicio|concepto-fin):/.test(e.id || '');
}

/** Día de calendario (YYYY-MM-DD) del evento en la zona del proyecto. Antes se
 * cortaba el ISO en UTC y un evento de las 20:00 de CDMX caía en el día siguiente. */
export function diaDelEvento(e: EventoConFecha, zona?: ZonaProyecto | null): string {
  if (esDiaCompleto(e)) return (e.fecha || (e.start_at || '').slice(0, 10) || '').slice(0, 10);
  if (!e.start_at) return '';
  return aLocal(e.start_at, offsetDe(zona)).format('YYYY-MM-DD');
}
