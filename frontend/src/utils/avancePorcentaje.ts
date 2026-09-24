// Validación pura de la captura de avance en modo_avance=PORCENTAJE
// (Etapa 4) — separada de RegistrarAvanceScreen.tsx para poder probarla sin
// renderizar nada, mismo criterio que claveComparator.ts / programaImportWizard.ts.
import { decimalStringToScaled, isValidDecimalInputN } from '@/src/utils/money';
import { DECIMALES_CANTIDAD } from '@/src/utils/numeros';

/** Porcentaje > 0 con hasta 4 decimales. Ya NO hay tope de 100% (decisión A-02:
 * pasar de 100% se permite y queda como volumen excedente pendiente de
 * autorización). Nunca vacío, nunca más de 4 decimales. */
export function esPorcentajeValido(v: string): boolean {
  return isValidDecimalInputN(v, DECIMALES_CANTIDAD) && decimalStringToScaled(v, DECIMALES_CANTIDAD) > 0;
}

/** true si `nuevo` es menor que `anterior` — mismo criterio que
 * es_retroceso en el backend (create_avance), duplicado aquí SOLO para
 * poder avisar antes de enviar (el backend es la fuente de verdad: la
 * respuesta de la API trae su propio es_retroceso, que es el que se
 * termina guardando y mostrando). */
export function esRetrocesoLocal(nuevo: string, anterior: string): boolean {
  return parseFloat(nuevo) < parseFloat(anterior || '0');
}
