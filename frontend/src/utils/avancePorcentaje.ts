// Validación pura de la captura de avance en modo_avance=PORCENTAJE
// (Etapa 4) — separada de RegistrarAvanceScreen.tsx para poder probarla sin
// renderizar nada, mismo criterio que claveComparator.ts / programaImportWizard.ts.
import { isValidDecimalInput } from '@/src/utils/money';

/** 0-100 con hasta 2 decimales — regla obligatoria del plan para
 * modo_avance=PORCENTAJE. Reusa isValidDecimalInput para el formato (nunca
 * vacío, nunca más de 2 decimales) y le agrega el rango. */
export function esPorcentajeValido(v: string): boolean {
  if (!isValidDecimalInput(v)) return false;
  const n = parseFloat(v);
  return n >= 0 && n <= 100;
}

/** true si `nuevo` es menor que `anterior` — mismo criterio que
 * es_retroceso en el backend (create_avance), duplicado aquí SOLO para
 * poder avisar antes de enviar (el backend es la fuente de verdad: la
 * respuesta de la API trae su propio es_retroceso, que es el que se
 * termina guardando y mostrando). */
export function esRetrocesoLocal(nuevo: string, anterior: string): boolean {
  return parseFloat(nuevo) < parseFloat(anterior || '0');
}
