// Ícono, color y título de cada tipo de la Lista por excepción (A-02 / A-03). Vive aparte del
// tablero para poder probar que TODO tipo del servidor tiene entrada.
import type { Ionicons } from '@expo/vector-icons';
import type { ExcepcionEvm } from '@/src/api';
import { colors } from '@/src/theme';

export type TipoExcepcion = ExcepcionEvm['tipo'];

export const EXCEPCION_META: Record<TipoExcepcion, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  fuera_de_ventana: { icon: 'time-outline', color: colors.warning },
  atrasado: { icon: 'alert-circle-outline', color: colors.error },
  // Informativas (nunca bloquean): se permiten y se hacen visibles.
  excedente_volumen: { icon: 'layers-outline', color: colors.warning },
  sobrecosto: { icon: 'cash-outline', color: colors.warning },
  ajuste_negativo: { icon: 'remove-circle-outline', color: colors.warning },
  acuerdo_vencido: { icon: 'calendar-outline', color: colors.error },
  sin_avance_en_ventana: { icon: 'hourglass-outline', color: colors.warning },
};

/** Clave i18n del título de un tipo de excepción. */
export function claveTituloExcepcion(tipo: TipoExcepcion) {
  return `excepciones.tipos.${tipo}` as const;
}

/** "1.1 · Concreto" o solo la descripción cuando no hay clave (acuerdos y sobrecosto). */
export function etiquetaExcepcion(e: Pick<ExcepcionEvm, 'clave' | 'descripcion'>): string {
  return e.clave ? `${e.clave} · ${e.descripcion}` : e.descripcion;
}
