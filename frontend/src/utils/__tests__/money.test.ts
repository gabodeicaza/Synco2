import { decimalStringToCents, centsToDecimalString, formatCantidad, formatMoney, isValidDecimalInput } from '../money';

describe('money (enteros de centavos, sin float)', () => {
  it('convierte string decimal a centavos exactos', () => {
    expect(decimalStringToCents('1234.56')).toBe(123456);
    expect(decimalStringToCents('1234.5')).toBe(123450);
    expect(decimalStringToCents('1234')).toBe(123400);
    expect(decimalStringToCents('-10.25')).toBe(-1025);
  });

  it('round-trip centavos -> string decimal', () => {
    expect(centsToDecimalString(123456)).toBe('1234.56');
    expect(centsToDecimalString(-1025)).toBe('-10.25');
  });

  it('formatea moneda con separador de miles', () => {
    expect(formatMoney('37100.00')).toBe('$37,100.00');
    expect(formatMoney('185.5')).toBe('$185.50');
  });

  it('valida entradas decimales de PU/meta', () => {
    expect(isValidDecimalInput('185.50')).toBe(true);
    expect(isValidDecimalInput('185')).toBe(true);
    expect(isValidDecimalInput('185.5')).toBe(true);
    expect(isValidDecimalInput('abc')).toBe(false);
    expect(isValidDecimalInput('185.555')).toBe(false);
  });
});

describe('formatCantidad (formato es-MX)', () => {
  it('agrupa miles con coma y quita ceros sobrantes', () => {
    expect(formatCantidad('45000')).toBe('45,000');
    expect(formatCantidad('1234567.5000')).toBe('1,234,567.5');
    expect(formatCantidad('1500.00')).toBe('1,500');
    expect(formatCantidad('-3200.25')).toBe('-3,200.25');
  });

  it('no altera cantidades pequeñas ni vacías', () => {
    expect(formatCantidad('12.5')).toBe('12.5');
    expect(formatCantidad('0')).toBe('0');
    expect(formatCantidad(null)).toBe('0');
  });
});
