// K-03: la fecha límite de un acuerdo debe ser igual o posterior a la fecha de la reunión.
// Espeja al servidor (create_minuta en server.py, que es la fuente de verdad).
import { t } from '@/src/i18n';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es una fecha real AAAA-MM-DD? (rechaza 2026-02-30). */
export function esFechaIsoValida(v: string): boolean {
  if (!FECHA.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export interface ErroresFechasMinuta {
  reunion?: string;
  /** Por posición del acuerdo. */
  acuerdos: Record<number, string>;
}

export function validarFechasMinuta(fechaReunion: string, fechasLimite: string[]): ErroresFechasMinuta {
  const errores: ErroresFechasMinuta = { acuerdos: {} };
  const reunionOk = esFechaIsoValida(fechaReunion);
  if (!reunionOk) errores.reunion = t('minuta.errores.fechaReunionInvalida');
  fechasLimite.forEach((fl, i) => {
    if (!fl) return; // la obligatoriedad se valida aparte
    if (!esFechaIsoValida(fl)) errores.acuerdos[i] = t('minuta.errores.fechaLimiteInvalida');
    else if (reunionOk && fl < fechaReunion) {
      errores.acuerdos[i] = t('minuta.errores.limiteAnteriorAReunion', { limite: fl, reunion: fechaReunion });
    }
  });
  return errores;
}

export function hayErroresFechas(e: ErroresFechasMinuta): boolean {
  return !!e.reunion || Object.keys(e.acuerdos).length > 0;
}
