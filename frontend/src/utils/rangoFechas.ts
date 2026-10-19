// Selector de rango de fechas (Etapa 4) — atajos de CALENDARIO real (esta
// semana natural, este mes natural, mes anterior), no ventanas móviles de N
// días. Todo en dayjs (misma librería que ya usa el proyecto vía
// src/utils/tz.ts — trae el locale 'es' y la zona CDMX ya configurados),
// nunca Date nativo.
//
// Semana natural = LUNES a Domingo (K-05). MISMA convención que el backend
// (`inicio_semana`/`_inicio_semana_local` en server.py) y que
// `getStartOfNaturalWeekCDMX` en tz.ts: "Esta semana" en Visualizar
// Avance/Actividades Generales coincide con "Semana" en los exports/feed.
// `hoy` default usa `.tz(CDMX)`, no la zona horaria del dispositivo.
import { dayjs, CDMX_TZ } from '@/src/utils/tz';

export interface RangoFechas {
  /** "YYYY-MM-DD" inclusive */
  desde: string;
  /** "YYYY-MM-DD" inclusive */
  hasta: string;
}

const FMT = 'YYYY-MM-DD';

function hoyCDMX() {
  return dayjs().tz(CDMX_TZ);
}

/** Hoy, un solo día. */
export function rangoHoy(hoy = hoyCDMX()): RangoFechas {
  const d = hoy.format(FMT);
  return { desde: d, hasta: d };
}

/** Ayer, un solo día. */
export function rangoAyer(hoy = hoyCDMX()): RangoFechas {
  const d = hoy.subtract(1, 'day').format(FMT);
  return { desde: d, hasta: d };
}

/** Lunes de la semana actual → hoy (la semana va de lunes a domingo). Nunca
 * salta hacia adelante: si hoy es lunes da hoy mismo; si es domingo, retrocede
 * al lunes que empezó esa semana. */
export function rangoEstaSemana(hoy = hoyCDMX()): RangoFechas {
  const dia = hoy.startOf('day');
  const lunes = dia.subtract((dia.day() + 6) % 7, 'day');
  return { desde: lunes.format(FMT), hasta: hoy.format(FMT) };
}

/** Día 1 del mes actual → hoy. */
export function rangoEsteMes(hoy = hoyCDMX()): RangoFechas {
  return { desde: hoy.startOf('month').format(FMT), hasta: hoy.format(FMT) };
}

/** Día 1 al último día del mes pasado (28/29/30/31 según el mes). */
export function rangoMesAnterior(hoy = hoyCDMX()): RangoFechas {
  const mesPasado = hoy.subtract(1, 'month');
  return { desde: mesPasado.startOf('month').format(FMT), hasta: mesPasado.endOf('month').format(FMT) };
}

/** "Del 3 al 17 de marzo de 2026" — colapsa mes/año repetidos, y un solo
 * día se muestra como fecha simple en vez de "del X al X". */
export function formatearRangoLegible(desdeISO: string, hastaISO: string): string {
  const d = dayjs(desdeISO);
  const h = dayjs(hastaISO);
  if (!d.isValid() || !h.isValid()) return '';
  if (d.isSame(h, 'day')) return d.format('D [de] MMMM [de] YYYY');
  if (d.isSame(h, 'month') && d.year() === h.year()) {
    return `Del ${d.format('D')} al ${h.format('D [de] MMMM [de] YYYY')}`;
  }
  if (d.year() === h.year()) {
    return `Del ${d.format('D [de] MMMM')} al ${h.format('D [de] MMMM [de] YYYY')}`;
  }
  return `Del ${d.format('D [de] MMMM [de] YYYY')} al ${h.format('D [de] MMMM [de] YYYY')}`;
}

/** Periodo de exportación (PDF/Word/PPTX) para un rango elegido a mano:
 * `custom_YYYYMMDD_YYYYMMDD`. El backend lo interpreta en `_period_range`. */
export function codificarPeriodoPersonalizado(desde: string, hasta: string): `custom_${string}` {
  return `custom_${desde.replace(/-/g, '')}_${hasta.replace(/-/g, '')}`;
}

/** Inverso de `codificarPeriodoPersonalizado`; `null` si no es un periodo personalizado. */
export function decodificarPeriodoPersonalizado(periodo: string): RangoFechas | null {
  const m = /^custom_(\d{4})(\d{2})(\d{2})_(\d{4})(\d{2})(\d{2})$/.exec(periodo);
  if (!m) return null;
  return { desde: `${m[1]}-${m[2]}-${m[3]}`, hasta: `${m[4]}-${m[5]}-${m[6]}` };
}

/** "Del 3 al 17 de marzo de 2026" para un periodo personalizado; '' si no lo es. */
export function etiquetaPeriodoPersonalizado(periodo: string): string {
  const r = decodificarPeriodoPersonalizado(periodo);
  return r ? formatearRangoLegible(r.desde, r.hasta) : '';
}

export interface ValidacionRango {
  valido: boolean;
  motivo?: string;
}

/** hasta >= desde, y ninguno de los dos en el futuro. */
export function validarRango(desde: string | null, hasta: string | null, hoy = hoyCDMX()): ValidacionRango {
  if (!desde || !hasta) return { valido: false, motivo: 'Elige fecha de inicio y de fin' };
  const hoyStr = hoy.format(FMT);
  if (desde > hoyStr || hasta > hoyStr) return { valido: false, motivo: 'No se pueden elegir fechas futuras' };
  if (hasta < desde) return { valido: false, motivo: 'La fecha final no puede ser anterior a la inicial' };
  return { valido: true };
}

/** markedDates para <Calendar markingType="period" .../> — pinta cada día
 * del rango (inclusive en ambos extremos) con el color de identidad del
 * proyecto. Selección de un solo extremo (hasta === null) marca solo ese
 * día como inicio Y fin, para que se vea resaltado mientras se espera el
 * segundo toque. */
export function marcarPeriodoCalendario(desde: string | null, hasta: string | null, color: string): Record<string, any> {
  if (!desde) return {};
  if (!hasta) {
    return { [desde]: { startingDay: true, endingDay: true, color, textColor: '#fff' } };
  }
  const [inicio, fin] = desde <= hasta ? [desde, hasta] : [hasta, desde];
  const marks: Record<string, any> = {};
  let cursor = dayjs(inicio);
  while (cursor.format(FMT) <= fin) {
    const iso = cursor.format(FMT);
    marks[iso] = { color, textColor: '#fff', startingDay: iso === inicio, endingDay: iso === fin };
    cursor = cursor.add(1, 'day');
  }
  return marks;
}
