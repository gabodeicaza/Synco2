// Validación del formulario de evento (G-04, X-03). Funciones puras: sin red ni zona del
// dispositivo. Fecha y horas se capturan como texto y se interpretan en la zona del
// PROYECTO con aritmética de desfase (fechas.ts), nunca con Intl/dayjs.tz.
import { t } from '@/src/i18n';
import { dayjs } from '@/src/utils/tz';
import { offsetDe, ZonaProyecto } from '@/src/utils/fechas';

export type CampoEvento = 'titulo' | 'fecha' | 'horaInicio' | 'horaFin';

export interface DatosEvento {
  titulo: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  todoElDia: boolean;
}

const HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es una hora HH:MM válida (00:00 a 23:59)? Acepta "9:30". */
export function esHoraValida(hora: string): boolean {
  return HORA.test(hora.trim());
}

/** "9:30" -> "09:30". Devuelve el texto tal cual si no es una hora válida. */
export function normalizarHora(hora: string): string {
  const m = HORA.exec(hora.trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : hora.trim();
}

/** ¿Es una fecha AAAA-MM-DD que existe en el calendario (no 2026-02-31)? */
export function esFechaValida(fecha: string): boolean {
  const m = FECHA.exec(fecha.trim());
  if (!m) return false;
  const [y, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(y, mes - 1, dia));
  return d.getUTCFullYear() === y && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function minutos(hora: string): number {
  const [h, m] = normalizarHora(hora).split(':').map(Number);
  return h * 60 + m;
}

/**
 * Errores por campo (vacío = válido). Un evento de todo el día no lleva horas: no se
 * validan. El fin debe ser POSTERIOR al inicio (mismo día).
 */
export function validarEvento(d: DatosEvento): Partial<Record<CampoEvento, string>> {
  const errores: Partial<Record<CampoEvento, string>> = {};
  if (!d.titulo.trim()) errores.titulo = t('evento.errores.tituloObligatorio');

  if (!d.fecha.trim()) errores.fecha = t('evento.errores.fechaObligatoria');
  else if (!esFechaValida(d.fecha)) errores.fecha = t('evento.errores.fechaInvalida');

  if (d.todoElDia) return errores;

  const inicioValido = esHoraValida(d.horaInicio);
  if (!d.horaInicio.trim()) errores.horaInicio = t('evento.errores.horaInicioObligatoria');
  else if (!inicioValido) errores.horaInicio = t('evento.errores.horaInvalida');

  if (d.horaFin.trim()) {
    if (!esHoraValida(d.horaFin)) errores.horaFin = t('evento.errores.horaInvalida');
    else if (inicioValido && minutos(d.horaFin) <= minutos(d.horaInicio)) {
      errores.horaFin = t('evento.errores.finAnterior');
    }
  }
  return errores;
}

/** Fecha y hora de pared del proyecto -> instante ISO en UTC. */
export function instanteDelProyecto(fecha: string, hora: string, zona?: ZonaProyecto | null): string {
  return dayjs.utc(`${fecha.trim()}T${normalizarHora(hora)}:00`).subtract(offsetDe(zona), 'minute').toISOString();
}

export interface PayloadEvento {
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  all_day?: boolean;
  area_id: string | null;
  attendee_ids: string[];
}

/** Arma lo que se manda a la API a partir de datos ya validados. */
export function armarPayloadEvento(
  d: DatosEvento & { descripcion: string; ubicacion: string; areaId: string | null; asistentes: string[] },
  zona?: ZonaProyecto | null,
): PayloadEvento {
  const base = {
    title: d.titulo.trim(),
    description: d.descripcion.trim() || null,
    location: d.ubicacion.trim() || null,
    area_id: d.areaId || null,
    attendee_ids: d.asistentes,
  };
  if (d.todoElDia) {
    return { ...base, start_at: d.fecha.trim(), end_at: null, all_day: true };
  }
  return {
    ...base,
    start_at: instanteDelProyecto(d.fecha, d.horaInicio, zona),
    end_at: d.horaFin.trim() ? instanteDelProyecto(d.fecha, d.horaFin, zona) : null,
  };
}
