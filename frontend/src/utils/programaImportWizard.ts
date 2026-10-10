// Lógica pura del wizard de importación del Programa desglosado — hermana de
// importWizard.ts (catálogo). Reusa de ahí WizardStep/pasoSiguienteTrasSubir/
// pasoAnterior (la navegación entre pasos es idéntica); lo que cambia es el
// gating de "puedeValidar" (código+importe+meses, no clave/descripción/
// cantidad/PU/partida) y no hay duplicados_accion ni revertir — este
// importador no crea ni edita conceptos, solo adjunta una distribución a uno
// que YA existe, así que la única corrección posible es descartar la fila.
import { ProgramaImportMapping, ProgramaImportResumen, ProgramaSesionPendiente } from '@/src/api';
import { WizardStep } from '@/src/utils/importWizard';
import { t } from '@/src/i18n';

export { WizardStep, pasoSiguienteTrasSubir, pasoAnterior } from '@/src/utils/importWizard';

/** Cuántas filas quedarán fuera del commit: error + descartadas + sin
 * distribución propia (estas últimas no son un error, pero tampoco entran
 * al commit — su curva se calcula sumando la de sus hijos). */
export function filasFueraCount(resumen: ProgramaImportResumen | null): number {
  if (!resumen) return 0;
  return (resumen.error || 0) + (resumen.descartado || 0) + (resumen.sin_distribucion || 0);
}

export function quedanFueraLabel(resumen: ProgramaImportResumen | null): string {
  const n = filasFueraCount(resumen);
  return n > 0 ? t('programa.quedanFuera', { n }) : '';
}

/** Gate del botón "Validar archivo completo": código + importe mapeados y
 * al menos una columna de mes — sin esto no hay nada que distribuir. */
export function puedeValidar(mapping: ProgramaImportMapping): boolean {
  return !!(mapping.codigo && mapping.importe && mapping.meses && mapping.meses.length > 0);
}

/** Al abrir el modal con una sesión pendiente: igual criterio que el
 * catálogo (si ya se validó, directo a revisión; si no, a elegir hoja o
 * mapeo según cuántas hojas tenga el archivo). */
export function pasoInicialDeSesionPendiente(info: Pick<ProgramaSesionPendiente, 'validado' | 'sheet_names'>): WizardStep {
  if (info.validado) return 'revision';
  return info.sheet_names.length > 1 ? 'hoja' : 'mapeo';
}
