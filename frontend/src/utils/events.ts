// SynCo v2.0 _ Helpers de formato/agrupacion de eventos.
// Todo el bucketing se hace en CDMX (nunca en la zona horaria del dispositivo)
// y "semana" siempre es la semana natural (domingo-sabado), no una ventana
// rodante de 7 dias.
import { ProjectEvent } from '@/src/api';
import { dayjs, CDMX_TZ, getStartOfNaturalWeekCDMX } from '@/src/utils/tz';

export interface EventSection {
  key: string;
  title: string;
  items: ProjectEvent[];
}

/**
 * Agrupa una lista de eventos por seccion temporal.
 *   range='upcoming' _ Hoy / Manana / Esta semana / Mas adelante
 *   range='past'     _ Esta semana / Anteriores
 */
export function groupEvents(items: ProjectEvent[], range: 'upcoming' | 'past'): EventSection[] {
  const today = dayjs().tz(CDMX_TZ).startOf('day');
  const tomorrow = today.add(1, 'day');
  const weekStart = getStartOfNaturalWeekCDMX();
  const weekEnd = weekStart.add(7, 'day'); // inicio de la siguiente semana natural (exclusivo)

  if (range === 'upcoming') {
    const buckets: Record<string, ProjectEvent[]> = {
      today: [], tomorrow: [], week: [], later: [],
    };
    for (const e of items) {
      const d = dayjs.utc(e.start_at).tz(CDMX_TZ);
      if (d.isSame(today, 'day')) buckets.today.push(e);
      else if (d.isSame(tomorrow, 'day')) buckets.tomorrow.push(e);
      else if (d.isAfter(tomorrow) && d.isBefore(weekEnd)) buckets.week.push(e);
      else buckets.later.push(e);
    }
    const out: EventSection[] = [];
    if (buckets.today.length) out.push({ key: 'today', title: 'Hoy', items: buckets.today });
    if (buckets.tomorrow.length) out.push({ key: 'tomorrow', title: 'Manana', items: buckets.tomorrow });
    if (buckets.week.length) out.push({ key: 'week', title: 'Esta semana', items: buckets.week });
    if (buckets.later.length) out.push({ key: 'later', title: 'Mas adelante', items: buckets.later });
    return out;
  }
  // past: dentro de la semana natural actual vs anteriores.
  const recent: ProjectEvent[] = [];
  const older: ProjectEvent[] = [];
  for (const e of items) {
    const d = dayjs.utc(e.start_at).tz(CDMX_TZ);
    if (d.isSameOrAfter(weekStart)) recent.push(e);
    else older.push(e);
  }
  const out: EventSection[] = [];
  if (recent.length) out.push({ key: 'recent_past', title: 'Esta semana', items: recent });
  if (older.length) out.push({ key: 'older', title: 'Anteriores', items: older });
  return out;
}

export function formatEventTime(e: ProjectEvent): string {
  const start = dayjs.utc(e.start_at).tz(CDMX_TZ);
  const time = start.format('HH:mm');
  if (!e.end_at) return time;
  const end = dayjs.utc(e.end_at).tz(CDMX_TZ);
  const endTime = end.format('HH:mm');
  if (start.isSame(end, 'day')) return `${time} _ ${endTime}`;
  const endDate = end.format('DD MMM');
  return `${time} _ ${endDate} ${endTime}`;
}

export function formatEventDate(iso: string): string {
  const d = dayjs.utc(iso).tz(CDMX_TZ);
  if (!d.isValid()) return '_';
  return d.format('ddd DD MMM YYYY');
}
