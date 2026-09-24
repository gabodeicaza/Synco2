// Captura y presentación de números (A-07 / X-05). Sin aritmética con Float: todo
// se maneja como texto decimal exacto ("1500.25"), el mismo formato que usa la API.
//
// Cada proyecto define su separador decimal: "." (1,500.25) o "," (1.500,25). Con
// "." la coma agrupa miles; con "," el punto agrupa miles. "1,500" y "1500" valen
// lo mismo en un proyecto con ".".

import { t } from '@/src/i18n';

export type SeparadorDecimal = '.' | ',';

export type ResultadoNumero =
  | { ok: true; valor: string }
  | { ok: false; motivo: 'vacio' | 'formato' | 'decimales' };

export interface OpcionesNumero {
  separador?: SeparadorDecimal;
  /** Máximo de decimales permitidos (importes: 2, cantidades: 4). */
  maxDecimales?: number;
  /** Permite el signo menos (ajustes). */
  permitirNegativo?: boolean;
}

export const DECIMALES_IMPORTE = 2;
export const DECIMALES_CANTIDAD = 4;

function agrupador(sep: SeparadorDecimal): string {
  return sep === '.' ? ',' : '.';
}

/** Texto capturado por el usuario -> decimal exacto con punto ("1500.25"). */
export function parseNumeroEntrada(texto: string | null | undefined, op: OpcionesNumero = {}): ResultadoNumero {
  const sep = op.separador ?? '.';
  const max = op.maxDecimales ?? DECIMALES_CANTIDAD;
  const crudo = (texto ?? '').replace(/[\s ]/g, '');
  if (!crudo) return { ok: false, motivo: 'vacio' };

  const negativo = crudo.startsWith('-');
  if (negativo && !op.permitirNegativo) return { ok: false, motivo: 'formato' };
  const cuerpo = negativo ? crudo.slice(1) : crudo;

  const g = agrupador(sep);
  const esc = (c: string) => (c === '.' ? '\\.' : c);
  const conMiles = new RegExp(`^\\d{1,3}(${esc(g)}\\d{3})+(${esc(sep)}\\d+)?$`);
  const simple = new RegExp(`^(\\d+)?(${esc(sep)}\\d+)?$`);
  if (!conMiles.test(cuerpo) && !(simple.test(cuerpo) && /\d/.test(cuerpo))) {
    return { ok: false, motivo: 'formato' };
  }

  const sinMiles = cuerpo.split(g).join('');
  const [entera = '', decimal = ''] = sinMiles.split(sep);
  if (decimal.length > max) return { ok: false, motivo: 'decimales' };

  const enteraLimpia = entera.replace(/^0+(?=\d)/, '') || '0';
  const valor = `${enteraLimpia}${decimal ? `.${decimal}` : ''}`;
  const esCero = /^0(\.0*)?$/.test(valor);
  return { ok: true, valor: negativo && !esCero ? `-${valor}` : valor };
}

/** Decimal exacto ("45000.5") -> texto es-MX para mostrar ("45,000.5"). */
export function formatoNumero(
  valor: string | null | undefined,
  op: { separador?: SeparadorDecimal; minDecimales?: number; maxDecimales?: number } = {},
): string {
  const sep = op.separador ?? '.';
  const min = op.minDecimales ?? 0;
  const max = op.maxDecimales ?? DECIMALES_CANTIDAD;
  const s = (valor ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return '';
  const negativo = s.startsWith('-');
  const [entera, decimalCrudo = ''] = (negativo ? s.slice(1) : s).split('.');
  let decimal = decimalCrudo.slice(0, max);
  decimal = decimal.replace(/0+$/, '');
  while (decimal.length < min) decimal += '0';
  const miles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, agrupador(sep));
  return `${negativo ? '-' : ''}${miles}${decimal ? `${sep}${decimal}` : ''}`;
}

/** Texto capturado válido -> decimal exacto para enviar; `null` si no es un número válido. */
export function numeroParaApi(texto: string | null | undefined, op: OpcionesNumero = {}): string | null {
  const r = parseNumeroEntrada(texto, op);
  return r.ok ? r.valor : null;
}

/** Mensaje es-MX para el error de un número capturado. */
export function mensajeNumeroInvalido(
  motivo: 'vacio' | 'formato' | 'decimales',
  maxDecimales: number,
  etiqueta: string,
): string {
  if (motivo === 'vacio') return t('numeros.obligatorio', { campo: etiqueta });
  if (motivo === 'decimales') {
    return maxDecimales === 0
      ? t('numeros.sinDecimales', { campo: etiqueta })
      : t('numeros.decimales', { campo: etiqueta, max: maxDecimales });
  }
  return t('numeros.formato', { campo: etiqueta });
}
