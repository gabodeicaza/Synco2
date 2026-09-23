// Validación pura de la captura de avance en modo_avance=PORCENTAJE
// (Etapa 4) — separada de RegistrarAvanceScreen.tsx para poder probarla sin
// renderizar nada, mismo criterio que claveComparator.ts / programaImportWizard.ts.
import { decimalStringToCents, isValidDecimalInput } from '@/src/utils/money';

/** Porcentaje > 0 con hasta 2 decimales. Ya NO hay tope de 100% (decisión A-02:
 * pasar de 100% se permite y queda como volumen excedente pendiente de
 * autorización). Reusa isValidDecimalInput para el formato (nunca vacío, nunca
 * más de 2 decimales). */
export function esPorcentajeValido(v: string): boolean {
  return isValidDecimalInput(v) && decimalStringToCents(v) > 0;
}

/** true si `nuevo` es menor que `anterior` — mismo criterio que
 * es_retroceso en el backend (create_avance), duplicado aquí SOLO para
 * poder avisar antes de enviar (el backend es la fuente de verdad: la
 * respuesta de la API trae su propio es_retroceso, que es el que se
 * termina guardando y mostrando). */
export function esRetrocesoLocal(nuevo: string, anterior: string): boolean {
  return parseFloat(nuevo) < parseFloat(anterior || '0');
}
