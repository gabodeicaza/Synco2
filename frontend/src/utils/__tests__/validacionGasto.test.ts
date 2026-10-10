import { esFechaCalendarioValida, validarGasto } from '../validacionGasto';

const base = { fecha: '2026-02-15', monto: '200,000.50', descripcion: 'Nómina semana 12' };

describe('esFechaCalendarioValida', () => {
  it('acepta días reales y rechaza los que no existen', () => {
    expect(esFechaCalendarioValida('2026-02-15')).toBe(true);
    expect(esFechaCalendarioValida('2024-02-29')).toBe(true);
    expect(esFechaCalendarioValida('2026-02-29')).toBe(false);
    expect(esFechaCalendarioValida('2026-02-31')).toBe(false);
    expect(esFechaCalendarioValida('2026-13-01')).toBe(false);
    expect(esFechaCalendarioValida('15/02/2026')).toBe(false);
    expect(esFechaCalendarioValida('')).toBe(false);
  });
});

describe('validarGasto', () => {
  it('un gasto correcto no tiene errores y normaliza el monto a decimal con punto', () => {
    expect(validarGasto(base)).toEqual({ errores: {}, monto: '200000.50' });
  });

  it('acepta "1,500" y "1500" como el mismo monto', () => {
    expect(validarGasto({ ...base, monto: '1,500' }).monto).toBe('1500');
    expect(validarGasto({ ...base, monto: '1500' }).monto).toBe('1500');
  });

  it('respeta la coma como decimal cuando el proyecto la usa', () => {
    expect(validarGasto({ ...base, monto: '1.500,25', separador: ',' }).monto).toBe('1500.25');
  });

  it('marca cada campo con su propio mensaje', () => {
    const { errores, monto } = validarGasto({ fecha: '2026-02-31', monto: '', descripcion: '  ' });
    expect(monto).toBeNull();
    expect(errores.fecha).toMatch(/fecha no es válida/);
    expect(errores.monto).toBe('Monto es obligatorio.');
    expect(errores.descripcion).toMatch(/Describe brevemente/);
  });

  it('rechaza cero, negativos, texto y más de 2 decimales', () => {
    expect(validarGasto({ ...base, monto: '0' }).errores.monto).toBe('El monto debe ser mayor que cero.');
    expect(validarGasto({ ...base, monto: '0.00' }).errores.monto).toBe('El monto debe ser mayor que cero.');
    expect(validarGasto({ ...base, monto: '-5' }).errores.monto).toBe('Monto debe ser un número válido.');
    expect(validarGasto({ ...base, monto: 'abc' }).errores.monto).toBe('Monto debe ser un número válido.');
    expect(validarGasto({ ...base, monto: '10.123' }).errores.monto).toBe('Monto admite hasta 2 decimales.');
  });

  it('un monto enorme (sobrecosto) NO se rechaza: solo se valida el formato', () => {
    expect(validarGasto({ ...base, monto: '999,999,999.99' })).toEqual({ errores: {}, monto: '999999999.99' });
  });
});
