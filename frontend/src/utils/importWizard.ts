// Lógica pura del wizard de importación de catálogo — extraída de
// ImportarCatalogoModal.tsx para poder probarla sin renderizar nada
// (cálculo de textos, gating de avance entre pasos, navegación hacia atrás
// que preserva mapeo/partida/convención, y reconstrucción del paso inicial
// al retomar una sesión sin terminar).
import { ConvencionDecimal, ImportMapping, ImportResumen, SesionPendiente } from '@/src/api';

export type WizardStep = 'archivo' | 'hoja' | 'mapeo' | 'revision' | 'resultado';

export interface WizardState {
  step: WizardStep;
  sheetNames: string[];
  mapping: ImportMapping;
  partidaId: string | null;
  convencion: ConvencionDecimal | undefined;
}

/** Cuántas filas quedarán fuera del commit: error + descartadas (las
 * duplicadas dependen de duplicados_accion, no se cuentan aquí). */
export function filasFueraCount(resumen: ImportResumen | null): number {
  if (!resumen) return 0;
  return (resumen.error || 0) + (resumen.descartado || 0);
}

/** Texto del botón "Importar": cuántas filas quedarán fuera. Vacío si no
 * queda ninguna fuera. */
export function quedanFueraLabel(resumen: ImportResumen | null): string {
  const n = filasFueraCount(resumen);
  return n > 0 ? ` (${n} quedarán fuera)` : '';
}

/** Gate del botón "Validar archivo completo": clave/descripción/cantidad/
 * precio unitario mapeados. La partida destino es OPCIONAL (C-01): la
 * jerarquía sale de la clave de cada fila. Unidad, importe y deductiva son
 * opcionales. */
export function puedeValidar(mapping: ImportMapping, _partidaId?: string | null): boolean {
  return !!(mapping.clave && mapping.descripcion && mapping.cantidad && mapping.precio_unitario);
}

/** Paso al que se llega tras subir el archivo: si el libro tiene más de
 * una hoja hay que preguntar cuál, si no se salta directo a mapeo. */
export function pasoSiguienteTrasSubir(requiereSeleccionHoja: boolean): WizardStep {
  return requiereSeleccionHoja ? 'hoja' : 'mapeo';
}

/** Paso anterior desde uno dado, sin tocar ningún otro estado — usado por
 * el botón "atrás" del header. */
export function pasoAnterior(paso: WizardStep, tieneVariasHojas: boolean): WizardStep {
  if (paso === 'hoja') return 'archivo';
  if (paso === 'mapeo') return tieneVariasHojas ? 'hoja' : 'archivo';
  if (paso === 'revision') return 'mapeo';
  return 'archivo';
}

/** Retroceder un paso SIN perder lo capturado: solo cambia `step`, el
 * resto del estado (mapeo, partida, convención) se copia tal cual —
 * separarlo en una función pura hace que "no se pierde nada al
 * retroceder" sea una propiedad verificable, no una promesa implícita del
 * código del componente. */
export function retroceder(estado: WizardState): WizardState {
  return { ...estado, step: pasoAnterior(estado.step, estado.sheetNames.length > 1) };
}

/** Al abrir el modal con una sesión pendiente: si ya se validó, se salta
 * directo a la revisión (validated_rows ya está calculado en el backend,
 * no hay que re-validar). Si no, se manda a elegir hoja (si el archivo
 * tiene varias) o a mapeo (si solo tiene una) — el mapeo en sí no
 * sobrevive un cierre de app porque nunca se confirmó con "Validar".*/
export function pasoInicialDeSesionPendiente(info: Pick<SesionPendiente, 'validado' | 'sheet_names'>): WizardStep {
  if (info.validado) return 'revision';
  return info.sheet_names.length > 1 ? 'hoja' : 'mapeo';
}
