import { cadenciaDeProyecto, duracionEnDias, metaPorDefecto } from '../metaPorDefecto';

// Los mismos casos que backend/tests/test_meta_por_defecto.py: el espejo debe dar lo mismo que el servidor.
describe('metaPorDefecto (espejo de meta_por_defecto del servidor)', () => {
  it('diaria: cantidad entre los días inclusive', () => {
    expect(metaPorDefecto('1000', '2026-10-01', '2026-10-10', 'DIARIA')).toBe('100');
  });

  it('semanal: cantidad entre semanas', () => {
    expect(metaPorDefecto('1000', '2026-10-01', '2026-10-14', 'SEMANAL')).toBe('500');
    expect(metaPorDefecto('1000', '2026-10-01', '2026-10-10', 'SEMANAL')).toBe('700');
  });

  it('mensual: meses de 30.4 días', () => {
    expect(metaPorDefecto('1000', '2026-01-01', '2026-10-31', 'MENSUAL')).toBe('100');
  });

  it('redondea HALF_UP a 4 decimales solo al final', () => {
    expect(metaPorDefecto('100', '2026-10-01', '2026-10-03', 'DIARIA')).toBe('33.3333');
    expect(metaPorDefecto('200', '2026-10-01', '2026-10-03', 'DIARIA')).toBe('66.6667');
  });

  it('un solo día deja la cantidad completa en cadencia diaria', () => {
    expect(metaPorDefecto('250.5', '2026-10-01', '2026-10-01', 'DIARIA')).toBe('250.5');
  });

  it('nunca devuelve 0 si hay cantidad', () => {
    expect(metaPorDefecto('0.0001', '2026-01-01', '2036-01-01', 'DIARIA')).toBe('0.0001');
  });

  it('conserva los 4 decimales', () => {
    expect(metaPorDefecto('1234.5678', '2026-10-01', '2026-10-07', 'SEMANAL')).toBe('1234.5678');
  });

  it.each([
    ['1000', null, null],
    ['1000', '2026-10-01', null],
    ['1000', null, '2026-10-10'],
    ['1000', '', ''],
    ['1000', '2026-10-10', '2026-10-01'],
    ['1000', 'no-es-fecha', '2026-10-10'],
    ['1000', '2026-02-31', '2026-03-10'],
    [null, '2026-10-01', '2026-10-10'],
    ['', '2026-10-01', '2026-10-10'],
    ['abc', '2026-10-01', '2026-10-10'],
    ['0', '2026-10-01', '2026-10-10'],
    ['-5', '2026-10-01', '2026-10-10'],
  ])('sin programa o datos inválidos (%s, %s, %s) la meta queda vacía', (cantidad, inicio, fin) => {
    expect(metaPorDefecto(cantidad as any, inicio as any, fin as any, 'SEMANAL')).toBeNull();
  });

  it('una cadencia desconocida se trata como mensual', () => {
    expect(metaPorDefecto('1000', '2026-01-01', '2026-10-31', 'OTRA')).toBe(
      metaPorDefecto('1000', '2026-01-01', '2026-10-31', 'MENSUAL'),
    );
  });

  it('cantidades absurdamente grandes no rompen: sin meta', () => {
    expect(metaPorDefecto('99999999999999', '2026-10-01', '2026-10-10', 'MENSUAL')).toBeNull();
  });
});

describe('utilidades', () => {
  it('cadenciaDeProyecto', () => {
    expect(cadenciaDeProyecto('DIARIA')).toBe('DIARIA');
    expect(cadenciaDeProyecto('semanal')).toBe('SEMANAL');
    expect(cadenciaDeProyecto('quincenal')).toBe('MENSUAL');
    expect(cadenciaDeProyecto(undefined)).toBe('MENSUAL');
  });

  it('duracionEnDias es inclusive y valida el calendario', () => {
    expect(duracionEnDias('2026-10-01', '2026-10-10')).toBe(10);
    expect(duracionEnDias('2026-10-01', '2026-10-01')).toBe(1);
    expect(duracionEnDias('2026-02-28', '2026-03-01')).toBe(2);
    expect(duracionEnDias('2026-10-10', '2026-10-01')).toBeNull();
    expect(duracionEnDias('2026-02-30', '2026-03-01')).toBeNull();
  });
});
