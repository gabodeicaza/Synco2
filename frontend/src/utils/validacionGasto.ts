// Validación de la captura manual de Gasto Real (AC) en el cliente. El servidor sigue
// siendo la fuente de verdad; esto avisa junto al campo antes de enviar. Un gasto NUNCA
// se bloquea por superar el presupuesto (AC > BAC): eso se muestra como sobrecosto.
import { t } from '@/src/i18n';
import { esSoloFecha, sumarDias } from '@/src/utils/fechas';
import { DECIMALES_IMPORTE, mensajeNumeroInvalido, parseNumeroEntrada, SeparadorDecimal } from '@/src/utils/numeros';

export interface EntradaGasto {
  fecha: string;
  monto: string;
  descripcion: string;
  separador?: SeparadorDecimal;
}

export interface ErroresGasto {
  fecha?: string;
  monto?: string;
  descripcion?: string;
}

/** ¿`fecha` es un día real del calendario (YYYY-MM-DD)? "2026-02-31" no lo es. */
export function esFechaCalendarioValida(fecha: string): boolean {
  return esSoloFecha(fecha) && sumarDias(fecha, 0) === fecha;
}

export function validarGasto(e: EntradaGasto): { errores: ErroresGasto; monto: string | null } {
  const errores: ErroresGasto = {};
  if (!esFechaCalendarioValida((e.fecha || '').trim())) errores.fecha = t('gasto.fechaInvalida');

  let monto: string | null = null;
  const r = parseNumeroEntrada(e.monto, { separador: e.separador, maxDecimales: DECIMALES_IMPORTE });
  if (!r.ok) {
    errores.monto = mensajeNumeroInvalido(r.motivo, DECIMALES_IMPORTE, t('gasto.monto'));
  } else if (/^0(\.0*)?$/.test(r.valor)) {
    errores.monto = t('gasto.montoNoPositivo');
  } else {
    monto = r.valor;
  }

  if (!(e.descripcion || '').trim()) errores.descripcion = t('gasto.descripcionObligatoria');
  return { errores, monto };
}
