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

// K-04 / X-03: validación completa de "Nueva minuta". Devuelve un mapa campo -> mensaje
// con TODOS los campos que fallan (no solo el primero) para resaltarlos junto a cada campo.
// Claves: titulo, reunion, ubicacion, acuerdos (no hay ninguno) y acuerdo.<i>.<campo>.
export type ErroresMinuta = Record<string, string>;
export type CampoAcuerdo = 'descripcion' | 'responsable' | 'fecha';

export interface DatosMinuta {
  tipo: 'informativo' | 'compromiso';
  titulo: string;
  ubicacionId: string;
  fechaReunion: string;
  acuerdos: Array<{ descripcion: string; responsable_id: string; fecha_limite: string }>;
}

export const claveAcuerdo = (i: number, campo: CampoAcuerdo) => `acuerdo.${i}.${campo}`;

export function validarMinuta(d: DatosMinuta): ErroresMinuta {
  const e: ErroresMinuta = {};
  if (!d.titulo.trim()) e.titulo = t('minuta.errores.tituloObligatorio');
  if (!d.fechaReunion.trim()) e.reunion = t('minuta.errores.fechaReunionObligatoria');
  if (!d.ubicacionId) e.ubicacion = t('minuta.errores.ubicacionObligatoria');

  const fechas = validarFechasMinuta(d.fechaReunion, d.tipo === 'compromiso' ? d.acuerdos.map((a) => a.fecha_limite) : []);
  if (fechas.reunion && !e.reunion) e.reunion = fechas.reunion;

  if (d.tipo === 'compromiso') {
    if (d.acuerdos.length === 0) e.acuerdos = t('minuta.errores.sinAcuerdos');
    d.acuerdos.forEach((a, i) => {
      if (!a.descripcion.trim()) e[claveAcuerdo(i, 'descripcion')] = t('minuta.errores.acuerdoDescripcionObligatoria');
      if (!a.responsable_id) e[claveAcuerdo(i, 'responsable')] = t('minuta.errores.acuerdoResponsableObligatorio');
      if (!a.fecha_limite.trim()) e[claveAcuerdo(i, 'fecha')] = t('minuta.errores.acuerdoFechaObligatoria');
      else if (fechas.acuerdos[i]) e[claveAcuerdo(i, 'fecha')] = fechas.acuerdos[i];
    });
  }
  return e;
}

export function hayErroresMinuta(e: ErroresMinuta): boolean {
  return Object.values(e).some(Boolean);
}

const ORDEN_CAMPOS: Record<string, number> = { titulo: 0, reunion: 1, ubicacion: 2, acuerdos: 3 };
const ORDEN_CAMPO_ACUERDO: Record<string, number> = { descripcion: 0, responsable: 1, fecha: 2 };

function rango(clave: string): number {
  if (clave in ORDEN_CAMPOS) return ORDEN_CAMPOS[clave];
  const m = /^acuerdo\.(\d+)\.(\w+)$/.exec(clave);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return 10 + Number(m[1]) * 10 + (ORDEN_CAMPO_ACUERDO[m[2]] ?? 9);
}

/** El campo con error que aparece primero en el formulario (para llevar el scroll hasta él). */
export function primerCampoConError(e: ErroresMinuta): string | null {
  const claves = Object.keys(e).filter((k) => e[k]);
  if (claves.length === 0) return null;
  return claves.sort((a, b) => rango(a) - rango(b))[0];
}

/** Al quitar el acuerdo `quitado`, descarta sus errores y recorre los de los acuerdos siguientes. */
export function reindexarErroresAcuerdos(e: Partial<ErroresMinuta>, quitado: number): ErroresMinuta {
  const nuevo: ErroresMinuta = {};
  for (const [clave, msg] of Object.entries(e)) {
    if (!msg) continue;
    const m = /^acuerdo\.(\d+)\.(\w+)$/.exec(clave);
    if (!m) { nuevo[clave] = msg; continue; }
    const i = Number(m[1]);
    if (i === quitado) continue;
    nuevo[i > quitado ? `acuerdo.${i - 1}.${m[2]}` : clave] = msg;
  }
  return nuevo;
}
