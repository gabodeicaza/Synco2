import { esPorcentajeValido, esRetrocesoLocal } from '../avancePorcentaje';

describe('esPorcentajeValido', () => {
  it('acepta valores dentro de 0-100', () => {
    expect(esPorcentajeValido('0')).toBe(true);
    expect(esPorcentajeValido('45.5')).toBe(true);
    expect(esPorcentajeValido('100')).toBe(true);
  });

  it('rechaza fuera de rango', () => {
    expect(esPorcentajeValido('100.01')).toBe(false);
    expect(esPorcentajeValido('-1')).toBe(false);
    expect(esPorcentajeValido('101')).toBe(false);
  });

  it('rechaza formato inválido (vacío, más de 2 decimales, no numérico)', () => {
    expect(esPorcentajeValido('')).toBe(false);
    expect(esPorcentajeValido('45.555')).toBe(false);
    expect(esPorcentajeValido('abc')).toBe(false);
  });
});

describe('esRetrocesoLocal', () => {
  it('true cuando el nuevo valor es menor que el anterior', () => {
    expect(esRetrocesoLocal('30', '50')).toBe(true);
  });

  it('false cuando es igual o mayor', () => {
    expect(esRetrocesoLocal('50', '50')).toBe(false);
    expect(esRetrocesoLocal('60', '50')).toBe(false);
  });

  it('sin anterior (primera captura) nunca es retroceso', () => {
    expect(esRetrocesoLocal('10', '')).toBe(false);
  });
});
