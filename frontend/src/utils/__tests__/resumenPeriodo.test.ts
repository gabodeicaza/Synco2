import { desviacion, estatusEfectivo, formatoDesviacion, parsePorcentaje } from '../resumenPeriodo';

describe('parsePorcentaje', () => {
  it('acepta coma, símbolo % y espacios', () => {
    expect(parsePorcentaje('42,5')).toBe(42.5);
    expect(parsePorcentaje(' 42.5 % ')).toBe(42.5);
    expect(parsePorcentaje('0')).toBe(0);
    expect(parsePorcentaje('100')).toBe(100);
  });
  it('vacío es null y lo inválido es undefined', () => {
    expect(parsePorcentaje('')).toBeNull();
    expect(parsePorcentaje('  ')).toBeNull();
    expect(parsePorcentaje('101')).toBeUndefined();
    expect(parsePorcentaje('-3')).toBeUndefined();
    expect(parsePorcentaje('abc')).toBeUndefined();
    expect(parsePorcentaje('4.5.6')).toBeUndefined();
  });
});

describe('desviación y semáforo (mismos cortes que el backend)', () => {
  it('desviación es real menos programado', () => {
    expect(desviacion(42.5, 45)).toBe(-2.5);
    expect(desviacion(null, 45)).toBeNull();
    expect(desviacion(40, null)).toBeNull();
  });
  it.each([
    [50, 50, 'verde'], [45, 50, 'verde'], [44.9, 50, 'ambar'], [35, 50, 'ambar'], [34.9, 50, 'rojo'], [60, 50, 'verde'],
  ])('real %s vs programado %s → %s', (f, p, esperado) => {
    expect(estatusEfectivo(null, f as number, p as number)).toBe(esperado);
  });
  it('el estatus manual manda y sin datos no hay estatus', () => {
    expect(estatusEfectivo('verde', 10, 80)).toBe('verde');
    expect(estatusEfectivo(null, 10, null)).toBeNull();
  });
  it('formatea la desviación', () => {
    expect(formatoDesviacion(-2.5)).toBe('-2.5 pts');
    expect(formatoDesviacion(3)).toBe('+3 pts');
    expect(formatoDesviacion(0)).toBe('0 pts');
    expect(formatoDesviacion(null)).toBe('—');
  });
});
