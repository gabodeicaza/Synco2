// Validación de la captura de avance en el CLIENTE (A-01). Espeja al servidor
// (validar_avance en server.py, que es la fuente de verdad) para avisar antes de
// enviar. Lo que se rechaza: cantidad <= 0, texto y fecha futura. Lo que NO se
// rechaza (decisión A-02): capturar más de lo contratado o más de 100%; eso se
// permite y se avisa como volumen excedente.
//
// La cantidad admite hasta 4 decimales (DECIMALES_CANTIDAD). La aritmética se hace con
// enteros escalados a 4 decimales, nunca con Float.
import { t } from '@/src/i18n';
import { decimalStringToScaled, isValidDecimalInputN, scaledToDecimalString } from '@/src/utils/money';
import { DECIMALES_CANTIDAD } from '@/src/utils/numeros';

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

const esValida = (texto: string) => isValidDecimalInputN(texto, DECIMALES_CANTIDAD);
const escalar = (texto: string) => decimalStringToScaled(texto, DECIMALES_CANTIDAD);
const CIEN_PORCIENTO = 100 * 10 ** DECIMALES_CANTIDAD;

export function validarAvance(e: EntradaAvance): ErroresAvance {
  const errores: ErroresAvance = {};
  const texto = (e.cantidad || '').trim();
  if (!texto || !esValida(texto)) {
    errores.cantidad = t('avance.errores.cantidadNoNumerica');
  } else {
    const valor = escalar(texto);
    if (e.tipo === 'ajuste') {
      if (valor === 0) errores.cantidad = t('avance.errores.ajusteCero');
    } else if (valor <= 0) {
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

/** Suma exacta (texto decimal) de dos cantidades de avance, con hasta 4 decimales. */
export function sumarCantidades(a: string, b: string): string {
  return scaledToDecimalString(escalar(a) + escalar(b), DECIMALES_CANTIDAD);
}

/** Aviso INFORMATIVO (no bloquea): ¿esta captura deja el concepto por encima de lo
 * contratado? Devuelve el excedente total resultante, en texto decimal. */
export function excedenteAlCapturar(
  acumulado: string, cantidad: string, contratada: string,
): { excede: boolean; excedente: string } {
  if (!esValida((cantidad || '').trim())) return { excede: false, excedente: '0' };
  const total = escalar(acumulado) + escalar(cantidad);
  const exc = total - Math.max(escalar(contratada), 0);
  return exc > 0
    ? { excede: true, excedente: scaledToDecimalString(exc, DECIMALES_CANTIDAD) }
    : { excede: false, excedente: '0' };
}

/** Igual que `excedenteAlCapturar` pero en modo porcentaje: puntos por encima de 100. */
export function excedentePorcentajeAlCapturar(cantidad: string): { excede: boolean; excedente: string } {
  if (!esValida((cantidad || '').trim())) return { excede: false, excedente: '0' };
  const exc = escalar(cantidad) - CIEN_PORCIENTO;
  return exc > 0
    ? { excede: true, excedente: scaledToDecimalString(exc, DECIMALES_CANTIDAD) }
    : { excede: false, excedente: '0' };
}
