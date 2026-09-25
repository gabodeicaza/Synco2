// "Mis reuniones" (G-02): orden explícito por (día, todo el día primero, hora) y etiqueta del día
// en la zona del proyecto ("Hoy", "Mañana" o "23 sep 2026"). Sin depender del orden con que llegan.
import { t } from '@/src/i18n';
import {
  EventoConFecha, ZonaProyecto, diaDelEvento, esDiaCompleto, fmtFecha, fmtHora, hoyProyecto, sumarDias,
} from '@/src/utils/fechas';

type Reunion = EventoConFecha & { title?: string };

function instante(e: EventoConFecha): number {
  const ms = Date.parse(e.start_at || '');
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/** Copia ordenada: por día de calendario, luego las de todo el día, luego por hora de inicio. */
export function ordenarReuniones<T extends Reunion>(items: T[], zona?: ZonaProyecto | null): T[] {
  return [...items].sort((a, b) => {
    const da = diaDelEvento(a, zona);
    const db = diaDelEvento(b, zona);
    if (da !== db) return da < db ? -1 : 1;
    const ta = esDiaCompleto(a) ? 0 : 1;
    const tb = esDiaCompleto(b) ? 0 : 1;
    if (ta !== tb) return ta - tb;
    const ia = instante(a);
    const ib = instante(b);
    if (ia !== ib) return ia - ib;
    return (a.title || '').localeCompare(b.title || '', 'es');
  });
}

/** "Hoy", "Mañana" o la fecha con el formato único de la app ("23 sep 2026"). */
export function etiquetaDiaReunion(
  e: EventoConFecha, zona?: ZonaProyecto | null, ahora: number | Date = Date.now(),
): string {
  const dia = diaDelEvento(e, zona);
  const hoy = hoyProyecto(zona, ahora);
  if (dia === hoy) return t('reuniones.hoy');
  if (dia === sumarDias(hoy, 1)) return t('reuniones.manana');
  return fmtFecha(dia, zona);
}

/** "Todo el día" o la hora de inicio (HH:mm) en la zona del proyecto. */
export function horaReunion(e: EventoConFecha, zona?: ZonaProyecto | null): string {
  return esDiaCompleto(e) ? t('reuniones.todoElDia') : fmtHora(e.start_at, zona);
}
