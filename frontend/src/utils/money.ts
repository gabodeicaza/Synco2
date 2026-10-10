// Dinero/cantidades del Catálogo de Conceptos — PROHIBIDO Double/Float.
//
// El backend expone precio_unitario/cantidad/meta/importe como STRING
// decimal exacto (ver backend/money_utils.py, que usa Decimal — el
// equivalente Python de BigDecimal). Este módulo nunca hace aritmética con
// `parseFloat`; los montos se representan como enteros de centavos
// (seguros hasta 2^53, sin el error de redondeo binario de los floats) y
// solo se formatean a texto para mostrarlos.

/** Convierte un string decimal exacto (ej. "1234.5") a enteros de centavos. */
export function decimalStringToCents(value: string | null | undefined): number {
  const s = (value ?? '0').trim();
  const negative = s.startsWith('-');
  const clean = negative ? s.slice(1) : s;
  const [intPart, fracPartRaw = ''] = clean.split('.');
  const fracPart = (fracPartRaw + '00').slice(0, 2); // trunca/rellena a 2 decimales
  const cents = parseInt((intPart || '0') + fracPart, 10);
  if (!Number.isFinite(cents)) return 0;
  return negative ? -cents : cents;
}

/** Convierte enteros de centavos de vuelta a un string decimal exacto ("1234.50"). */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const intPart = Math.floor(abs / 100);
  const fracPart = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/** Formatea un string decimal (o centavos) como moneda MXN para mostrar. */
export function formatMoney(value: string | number | null | undefined): string {
  const cents = typeof value === 'number' ? value : decimalStringToCents(value);
  const decimalStr = centsToDecimalString(cents);
  const [intPart, fracPart] = decimalStr.split('.');
  const negative = intPart.startsWith('-');
  const digits = negative ? intPart.slice(1) : intPart;
  const withThousands = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${withThousands}.${fracPart}`;
}

/** Formatea una cantidad (no monetaria) para mostrar en es-MX: miles con coma (45,000) y sin ceros sobrantes. */
export function formatCantidad(value: string | null | undefined): string {
  const s = (value ?? '0').trim();
  const [intPart, fracPart] = s.split('.');
  const negative = intPart.startsWith('-');
  const digits = negative ? intPart.slice(1) : intPart;
  const conMiles = /^\d+$/.test(digits) ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : digits;
  const entera = `${negative ? '-' : ''}${conMiles}`;
  if (!fracPart) return entera;
  const trimmed = fracPart.replace(/0+$/, '');
  return trimmed ? `${entera}.${trimmed}` : entera;
}

/** Suma exacta de una lista de strings decimales, en centavos (para totalizar en UI). */
export function sumDecimalStringsAsCents(values: Array<string | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + decimalStringToCents(v), 0);
}

/** Valida que un string ingresado por el usuario (edición inline de PU/meta) sea un decimal válido. */
export function isValidDecimalInput(value: string): boolean {
  return /^-?\d+(\.\d{1,2})?$/.test(value.trim());
}

/** Decimal exacto ("12.3456") -> entero escalado a `escala` decimales (12.3456 con escala 4 = 123456).
 * Trunca los decimales de más. Seguro hasta 2^53 (unos 9e11 con escala 4). */
export function decimalStringToScaled(value: string | null | undefined, escala: number): number {
  const s = (value ?? '0').trim();
  const negative = s.startsWith('-');
  const clean = negative ? s.slice(1) : s;
  const [intPart, fracPartRaw = ''] = clean.split('.');
  const fracPart = (fracPartRaw + '0'.repeat(escala)).slice(0, escala);
  const n = parseInt((intPart || '0') + fracPart, 10);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

/** Entero escalado -> decimal exacto con `escala` decimales ("123456" escala 4 -> "12.3456"). */
export function scaledToDecimalString(n: number, escala: number): string {
  const negative = n < 0;
  const abs = Math.abs(Math.trunc(n));
  const base = 10 ** escala;
  const intPart = Math.floor(abs / base);
  const fracPart = String(abs % base).padStart(escala, '0');
  return `${negative ? '-' : ''}${intPart}${escala > 0 ? `.${fracPart}` : ''}`;
}

/** Valida un decimal capturado (con punto) con hasta `maxDecimales` decimales. */
export function isValidDecimalInputN(value: string, maxDecimales: number): boolean {
  return new RegExp(`^-?\\d+(\\.\\d{1,${maxDecimales}})?$`).test(value.trim());
}

/** % que representa `parte` de `total` (ambos decimales exactos), a 1 decimal.
 * Solo para MOSTRAR en UI — no es aritmética de dinero, un float aquí es
 * aceptable porque nunca se vuelve a guardar. `total` en 0 devuelve 0 (no
 * NaN/Infinity) para no romper el render con un concepto recién creado. */
export function pctDeDecimales(parte: string | null | undefined, total: string | null | undefined): number {
  const totalEscalado = decimalStringToScaled(total, 4);
  if (totalEscalado <= 0) return 0;
  const parteEscalada = decimalStringToScaled(parte, 4);
  return Math.round((parteEscalada / totalEscalado) * 1000) / 10;
}
