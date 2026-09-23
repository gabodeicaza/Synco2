// Validación de la captura de avance en el CLIENTE (A-01). Espeja al servidor
// (validar_avance en server.py, que es la fuente de verdad) para avisar antes de
// enviar. Lo que se rechaza: cantidad <= 0, texto y fecha futura. Lo que NO se
// rechaza (decisión A-02): capturar más de lo contratado o más de 100%; eso se
// permite y se avisa como volumen excedente.
import { t } from '@/src/i18n';
import { centsToDecimalString, decimalStringToCents, isValidDecimalInput } from '@/src/utils/money';

export type TipoAvance = 'normal' | 'ajuste';
export const MOTIVO_AJUSTE_MIN = 5;

export interface ErroresAvance {
  cantidad?: string;
  motivo?: string;
  fecha?: string;
}

export interface EntradaAvance {
  cantidad: string;
  tipo: TipoAvance;
  motivo: string;
  /** YYYY-MM-DD de la captura. */
  fecha: string;
  /** Hoy en la zona del proyecto (YYYY-MM-DD). */
  hoy: string;
  esPorcentaje: boolean;
}

export function validarAvance(e: EntradaAvance): ErroresAvance {
  const errores: ErroresAvance = {};
  const texto = (e.cantidad || '').trim();
  if (!texto || !isValidDecimalInput(texto)) {
    errores.cantidad = t('avance.errores.cantidadNoNumerica');
  } else {
    const centavos = decimalStringToCents(texto);
    if (e.tipo === 'ajuste') {
      if (centavos === 0) errores.cantidad = t('avance.errores.ajusteCero');
    } else if (centavos <= 0) {
      errores.cantidad = t('avance.errores.cantidadNoPositiva');
    }
  }
  if (e.tipo === 'ajuste' && (e.motivo || '').trim().length < MOTIVO_AJUSTE_MIN) {
    errores.motivo = t('avance.errores.motivoObligatorio', { minimo: MOTIVO_AJUSTE_MIN });
  }
  if (e.fecha > e.hoy) errores.fecha = t('avance.errores.fechaFutura');
  return errores;
}

export function hayErrores(e: ErroresAvance): boolean {
  return Object.keys(e).length > 0;
}

/** Aviso INFORMATIVO (no bloquea): ¿esta captura deja el concepto por encima de lo
 * contratado? Devuelve el excedente total resultante, en texto decimal. */
export function excedenteAlCapturar(
  acumulado: string, cantidad: string, contratada: string,
): { excede: boolean; excedente: string } {
  if (!isValidDecimalInput((cantidad || '').trim())) return { excede: false, excedente: '0.00' };
  const total = decimalStringToCents(acumulado) + decimalStringToCents(cantidad);
  const exc = total - Math.max(decimalStringToCents(contratada), 0);
  return exc > 0 ? { excede: true, excedente: centsToDecimalString(exc) } : { excede: false, excedente: '0.00' };
}

/** Igual que `excedenteAlCapturar` pero en modo porcentaje: puntos por encima de 100. */
export function excedentePorcentajeAlCapturar(cantidad: string): { excede: boolean; excedente: string } {
  if (!isValidDecimalInput((cantidad || '').trim())) return { excede: false, excedente: '0.00' };
  const exc = decimalStringToCents(cantidad) - 10000;
  return exc > 0 ? { excede: true, excedente: centsToDecimalString(exc) } : { excede: false, excedente: '0.00' };
}
