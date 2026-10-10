import { excedenteAlCapturar, excedentePorcentajeAlCapturar, hayErrores, sumarCantidades, validarAvance } from '../validacionAvance';

const base = { cantidad: '5', tipo: 'normal' as const, motivo: '', fecha: '2026-09-22', hoy: '2026-09-23', esPorcentaje: false };

describe('validarAvance (A-01)', () => {
  it('una captura normal válida no tiene errores', () => {
    expect(hayErrores(validarAvance(base))).toBe(false);
  });

  it.each(['0', '0.00', '-1', '-0.5'])('rechaza %s como avance normal', (c) => {
    expect(validarAvance({ ...base, cantidad: c }).cantidad).toMatch(/mayor que cero/);
  });

  it.each(['', 'abc', '1.23456', '1,5'])('rechaza "%s" (no es un número)', (c) => {
    expect(validarAvance({ ...base, cantidad: c }).cantidad).toMatch(/número/);
  });

  it.each(['0.0001', '1.2345', '12.5', '7'])('acepta %s (hasta 4 decimales)', (c) => {
    expect(validarAvance({ ...base, cantidad: c }).cantidad).toBeUndefined();
  });

  it('0.0000 no es una cantidad positiva', () => {
    expect(validarAvance({ ...base, cantidad: '0.0000' }).cantidad).toMatch(/mayor que cero/);
  });

  it('rechaza fecha futura pero acepta hoy', () => {
    expect(validarAvance({ ...base, fecha: '2026-09-24' }).fecha).toMatch(/futura/);
    expect(validarAvance({ ...base, fecha: '2026-09-23' }).fecha).toBeUndefined();
  });

  it('un ajuste admite negativos pero exige motivo', () => {
    const e = validarAvance({ ...base, tipo: 'ajuste', cantidad: '-3' });
    expect(e.cantidad).toBeUndefined();
    expect(e.motivo).toMatch(/obligatorio/);
    expect(hayErrores(validarAvance({ ...base, tipo: 'ajuste', cantidad: '-3', motivo: 'Se duplicó el registro' }))).toBe(false);
  });

  it('un ajuste no puede ser cero', () => {
    expect(validarAvance({ ...base, tipo: 'ajuste', cantidad: '0', motivo: 'corrección' }).cantidad).toMatch(/cero/);
  });

  it('pasar de 100% en modo porcentaje NO es error (se permite)', () => {
    expect(hayErrores(validarAvance({ ...base, esPorcentaje: true, cantidad: '120' }))).toBe(false);
  });
});

describe('aviso de excedente (informativo)', () => {
  it('avisa cuando lo acumulado + lo capturado pasa de lo contratado', () => {
    expect(excedenteAlCapturar('95', '30', '100')).toEqual({ excede: true, excedente: '25.0000' });
  });

  it('conserva los 4 decimales sin error de redondeo', () => {
    expect(excedenteAlCapturar('99.9999', '0.0002', '100')).toEqual({ excede: true, excedente: '0.0001' });
    expect(excedenteAlCapturar('99.9999', '0.0001', '100').excede).toBe(false);
    expect(sumarCantidades('0.1', '0.2')).toBe('0.3000');
    expect(sumarCantidades('1234.5678', '0.0001')).toBe('1234.5679');
  });

  it('no avisa dentro de lo contratado', () => {
    expect(excedenteAlCapturar('40', '30', '100').excede).toBe(false);
  });

  it('sin cantidad válida no avisa', () => {
    expect(excedenteAlCapturar('95', '', '100').excede).toBe(false);
  });

  it('contratado en cero (extraordinario): todo es excedente', () => {
    expect(excedenteAlCapturar('0', '7', '0')).toEqual({ excede: true, excedente: '7.0000' });
  });

  it('porcentaje: puntos sobre 100', () => {
    expect(excedentePorcentajeAlCapturar('112.5')).toEqual({ excede: true, excedente: '12.5000' });
    expect(excedentePorcentajeAlCapturar('100').excede).toBe(false);
  });
});
