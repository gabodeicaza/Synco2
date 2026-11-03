// Lógica del formulario "Resumen del periodo". Espejo de `_resumen_estatus` /
// `_resumen_desviacion` (backend/server.py): el semáforo sale de la desviación
// (real − programado, en puntos) cuando no se captura a mano.
import type { ResumenSemaforo } from '@/src/api';

export const SEMAFORO_AMBAR_PTS = -5;
export const SEMAFORO_ROJO_PTS = -15;

export const SEMAFORO_ETIQUETA: Record<ResumenSemaforo, string> = {
  verde: 'En tiempo', ambar: 'Atención', rojo: 'Crítico',
};

/** "42,5" / "42.5 %" → 42.5 · vacío → null · fuera de 0–100 o no numérico → undefined (inválido). */
export function parsePorcentaje(txt: string): number | null | undefined {
  const limpio = (txt || '').replace('%', '').replace(',', '.').trim();
  if (!limpio) return null;
  if (!/^\d+(\.\d+)?$/.test(limpio)) return undefined;
  const n = parseFloat(limpio);
  return n >= 0 && n <= 100 ? n : undefined;
}

export function desviacion(fisico: number | null, programado: number | null): number | null {
  return fisico == null || programado == null ? null : Math.round((fisico - programado) * 100) / 100;
}

/** Estatus capturado o, si falta, el calculado de la desviación (null si no hay de dónde). */
export function estatusEfectivo(
  manual: ResumenSemaforo | null, fisico: number | null, programado: number | null,
): ResumenSemaforo | null {
  if (manual) return manual;
  const d = desviacion(fisico, programado);
  if (d == null) return null;
  return d >= SEMAFORO_AMBAR_PTS ? 'verde' : d >= SEMAFORO_ROJO_PTS ? 'ambar' : 'rojo';
}

export function formatoDesviacion(d: number | null): string {
  if (d == null) return '—';
  const n = Math.round(d * 10) / 10;
  return `${n > 0 ? '+' : ''}${n} pts`;
}
