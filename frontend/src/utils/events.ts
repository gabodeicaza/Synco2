// Dirac v2.0 _ Helpers de formato/agrupacion de eventos.
// Todo el bucketing se hace en CDMX (nunca en la zona horaria del dispositivo)
// y "semana" siempre es la semana natural (lunes-domingo), no una ventana
// rodante de 7 dias.
import { ProjectEvent } from '@/src/api';
import { dayjs, CDMX_TZ } from '@/src/utils/tz';
import {
  ZonaProyecto, diaDelEvento, esDiaCompleto, esSoloFecha, hoyProyecto, semanaDe, sumarDias,
} from '@/src/utils/fechas';

export interface EventSection {
  key: string;
  title: string;
  items: ProjectEvent[];
}

/**
 * Agrupa una lista de eventos por seccion temporal.
 *   range='upcoming' _ Hoy / Manana / Esta semana / Mas adelante
 *   range='past'     _ Esta semana / Anteriores
 * Se compara por DIA de calendario (YYYY-MM-DD) en la zona del proyecto, no por
 * instantes: un evento de todo el dia (minuta) no se corre de dia por la zona.
 */
export function groupEvents(items: ProjectEvent[], range: 'upcoming' | 'past', zona?: ZonaProyecto | null): EventSection[] {
  const hoy = hoyProyecto(zona);
  const manana = sumarDias(hoy, 1);
  const semana = semanaDe(hoy, zona?.dia_inicio_semana);

  if (range === 'upcoming') {
    const buckets: Record<string, ProjectEvent[]> = {
      today: [], tomorrow: [], week: [], later: [],
    };
    for (const e of items) {
      const d = diaDelEvento(e, zona);
      if (d === hoy) buckets.today.push(e);
      else if (d === manana) buckets.tomorrow.push(e);
      else if (d > manana && d <= semana.hasta) buckets.week.push(e);
      else buckets.later.push(e);
    }
    const out: EventSection[] = [];
    if (buckets.today.length) out.push({ key: 'today', title: 'Hoy', items: buckets.today });
    if (buckets.tomorrow.length) out.push({ key: 'tomorrow', title: 'Mañana', items: buckets.tomorrow });
    if (buckets.week.length) out.push({ key: 'week', title: 'Esta semana', items: buckets.week });
    if (buckets.later.length) out.push({ key: 'later', title: 'Mas adelante', items: buckets.later });
    return out;
  }
  // past: dentro de la semana actual vs anteriores.
  const recent: ProjectEvent[] = [];
  const older: ProjectEvent[] = [];
  for (const e of items) {
    if (diaDelEvento(e, zona) >= semana.desde) recent.push(e);
    else older.push(e);
  }
  const out: EventSection[] = [];
  if (recent.length) out.push({ key: 'recent_past', title: 'Esta semana', items: recent });
  if (older.length) out.push({ key: 'older', title: 'Anteriores', items: older });
  return out;
}

export function formatEventTime(e: ProjectEvent): string {
  if (esDiaCompleto(e)) return 'Todo el día';
  const start = dayjs.utc(e.start_at).tz(CDMX_TZ);
  const time = start.format('HH:mm');
  if (!e.end_at) return time;
  const end = dayjs.utc(e.end_at).tz(CDMX_TZ);
  const endTime = end.format('HH:mm');
  if (start.isSame(end, 'day')) return `${time} · ${endTime}`;
  const endDate = end.format('DD MMM');
  return `${time} · ${endDate} ${endTime}`;
}

export function formatEventDate(iso: string): string {
  const d = esSoloFecha(iso) ? dayjs.utc(iso) : dayjs.utc(iso).tz(CDMX_TZ);
  if (!d.isValid()) return '—';
  return d.format('ddd DD MMM YYYY');
}
