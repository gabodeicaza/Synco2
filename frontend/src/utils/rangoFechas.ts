// Selector de rango de fechas (Etapa 4) — atajos de CALENDARIO real (esta
// semana natural, este mes natural, mes anterior), no ventanas móviles de N
// días. Todo en dayjs (misma librería que ya usa el proyecto vía
// src/utils/tz.ts — trae el locale 'es' y la zona CDMX ya configurados),
// nunca Date nativo.
//
// Semana natural = Domingo a Sábado (MISMA convención que el backend
// completo — ver `_period_range`/`_feed_range_start` en server.py, que
// calculan `days_to_sunday = (weekday()+1) % 7` — y que `getStartOfNatural-
// WeekCDMX` en tz.ts, vía `.day(0)`). Antes esta función calculaba Lunes a
// Domingo, una convención DISTINTA a la del resto del sistema — "Esta
// semana" en Visualizar Avance/Actividades Generales no coincidía con
// "Semana" en los exports/feed. `hoy` default también usaba `dayjs()` sin
// `.tz()` (zona horaria del dispositivo, no CDMX) — mismo bug de raíz que
// el de RangoFechasPicker.
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

/** Domingo de la semana actual → hoy. `.day(0)` nunca salta hacia adelante
 * (domingo es el día 0, primero de la semana): si hoy ya es domingo, da hoy
 * mismo; para cualquier otro día, retrocede al domingo que ya pasó. */
export function rangoEstaSemana(hoy = hoyCDMX()): RangoFechas {
  const domingo = hoy.startOf('day').day(0);
  return { desde: domingo.format(FMT), hasta: hoy.format(FMT) };
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
