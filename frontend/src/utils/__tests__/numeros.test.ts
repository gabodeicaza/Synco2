import { formatoNumero, mensajeNumeroInvalido, numeroParaApi, parseNumeroEntrada } from '../numeros';

describe('parseNumeroEntrada (separador ".")', () => {
  it('acepta "1,500" y "1500" con el mismo valor', () => {
    expect(parseNumeroEntrada('1,500')).toEqual({ ok: true, valor: '1500' });
    expect(parseNumeroEntrada('1500')).toEqual({ ok: true, valor: '1500' });
  });

  it('acepta miles con decimales y decimales sin parte entera', () => {
    expect(parseNumeroEntrada('45,000.25')).toEqual({ ok: true, valor: '45000.25' });
    expect(parseNumeroEntrada('.5')).toEqual({ ok: true, valor: '0.5' });
    expect(parseNumeroEntrada('007.10')).toEqual({ ok: true, valor: '7.10' });
    expect(parseNumeroEntrada(' 1 234 ')).toEqual({ ok: true, valor: '1234' }); // el espacio también agrupa miles
  });

  it('rechaza agrupaciones mal formadas y texto', () => {
    for (const malo of ['1,5', '1,50', '12,34,567', '1.2.3', 'abc', '1e5', '5.', '--1', '1,,500']) {
      expect(parseNumeroEntrada(malo)).toEqual({ ok: false, motivo: 'formato' });
    }
  });

  it('distingue vacío y exceso de decimales', () => {
    expect(parseNumeroEntrada('   ')).toEqual({ ok: false, motivo: 'vacio' });
    expect(parseNumeroEntrada('', {})).toEqual({ ok: false, motivo: 'vacio' });
    expect(parseNumeroEntrada('1.123', { maxDecimales: 2 })).toEqual({ ok: false, motivo: 'decimales' });
    expect(parseNumeroEntrada('1.12', { maxDecimales: 2 })).toEqual({ ok: true, valor: '1.12' });
    expect(parseNumeroEntrada('1.5', { maxDecimales: 0 })).toEqual({ ok: false, motivo: 'decimales' });
  });

  it('el signo menos solo se permite si se pide (ajustes)', () => {
    expect(parseNumeroEntrada('-3')).toEqual({ ok: false, motivo: 'formato' });
    expect(parseNumeroEntrada('-3.5', { permitirNegativo: true })).toEqual({ ok: true, valor: '-3.5' });
    expect(parseNumeroEntrada('-0', { permitirNegativo: true })).toEqual({ ok: true, valor: '0' });
  });

  it('no usa aritmética flotante: conserva todos los dígitos', () => {
    expect(parseNumeroEntrada('9,007,199,254,740,993.1234')).toEqual({ ok: true, valor: '9007199254740993.1234' });
  });
});

describe('parseNumeroEntrada (separador ",")', () => {
  it('con coma decimal, "1,5" es uno y medio y "1.500" es mil quinientos', () => {
    expect(parseNumeroEntrada('1,5', { separador: ',' })).toEqual({ ok: true, valor: '1.5' });
    expect(parseNumeroEntrada('1.500', { separador: ',' })).toEqual({ ok: true, valor: '1500' });
    expect(parseNumeroEntrada('1.500,25', { separador: ',' })).toEqual({ ok: true, valor: '1500.25' });
  });

  it('rechaza el punto como decimal', () => {
    expect(parseNumeroEntrada('1.5', { separador: ',' })).toEqual({ ok: false, motivo: 'formato' });
  });
});

describe('formatoNumero', () => {
  it('agrupa miles con coma (es-MX)', () => {
    expect(formatoNumero('45000')).toBe('45,000');
    expect(formatoNumero('1234567.5')).toBe('1,234,567.5');
    expect(formatoNumero('-1500.25')).toBe('-1,500.25');
  });

  it('respeta decimales mínimos y máximos', () => {
    expect(formatoNumero('1500', { minDecimales: 2 })).toBe('1,500.00');
    expect(formatoNumero('1.50000', { maxDecimales: 4 })).toBe('1.5');
    expect(formatoNumero('1.23456', { maxDecimales: 4 })).toBe('1.2345');
  });

  it('con coma decimal invierte los separadores', () => {
    expect(formatoNumero('1234.5', { separador: ',' })).toBe('1.234,5');
  });

  it('devuelve vacío si no es un decimal válido', () => {
    expect(formatoNumero('')).toBe('');
    expect(formatoNumero('abc')).toBe('');
    expect(formatoNumero(null)).toBe('');
  });

  it('ida y vuelta: lo mostrado se vuelve a leer igual', () => {
    for (const sep of ['.', ','] as const) {
      const mostrado = formatoNumero('1234567.25', { separador: sep, minDecimales: 2 });
      expect(parseNumeroEntrada(mostrado, { separador: sep })).toEqual({ ok: true, valor: '1234567.25' });
    }
  });
});

describe('numeroParaApi y mensajes', () => {
  it('devuelve null si el texto no es válido', () => {
    expect(numeroParaApi('1,500')).toBe('1500');
    expect(numeroParaApi('x')).toBeNull();
  });

  it('los mensajes salen en es-MX con el nombre del campo', () => {
    expect(mensajeNumeroInvalido('vacio', 4, 'Cantidad')).toBe('Cantidad es obligatorio.');
    expect(mensajeNumeroInvalido('formato', 4, 'Cantidad')).toBe('Cantidad debe ser un número válido.');
    expect(mensajeNumeroInvalido('decimales', 2, 'Monto')).toBe('Monto admite hasta 2 decimales.');
    expect(mensajeNumeroInvalido('decimales', 0, 'Piezas')).toBe('Piezas no admite decimales.');
  });
});
