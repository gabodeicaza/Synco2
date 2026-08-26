import { dayjs } from '@/src/utils/tz';
import {
  rangoEstaSemana, rangoEsteMes, rangoMesAnterior, formatearRangoLegible, validarRango, marcarPeriodoCalendario,
} from '../rangoFechas';

describe('rangoEstaSemana — domingo de la semana actual → hoy (misma convención que el backend)', () => {
  it('un miércoles: el domingo es 3 días atrás', () => {
    // 2026-03-11 es miércoles, 2026-03-08 es domingo (verificado con `date -d ... +%A`).
    const hoy = dayjs('2026-03-11');
    expect(rangoEstaSemana(hoy)).toEqual({ desde: '2026-03-08', hasta: '2026-03-11' });
  });

  it('un domingo: el rango es un solo día (el domingo es hoy mismo, nunca salta al que viene)', () => {
    const hoy = dayjs('2026-03-08'); // domingo
    expect(rangoEstaSemana(hoy)).toEqual({ desde: '2026-03-08', hasta: '2026-03-08' });
  });

  it('un sábado: el domingo es el de la semana que TERMINA hoy, 6 días atrás', () => {
    const hoy = dayjs('2026-03-07'); // sábado
    expect(rangoEstaSemana(hoy)).toEqual({ desde: '2026-03-01', hasta: '2026-03-07' });
  });
});

describe('rangoEsteMes — día 1 del mes actual → hoy', () => {
  it('calcula el día 1 del mes en curso', () => {
    const hoy = dayjs('2026-03-11');
    expect(rangoEsteMes(hoy)).toEqual({ desde: '2026-03-01', hasta: '2026-03-11' });
  });
});

describe('rangoMesAnterior — día 1 al último día del mes pasado', () => {
  it('mes de 28 días (febrero, no bisiesto)', () => {
    const hoy = dayjs('2026-03-11');
    expect(rangoMesAnterior(hoy)).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
  });

  it('cruza el límite de año (enero -> diciembre del año anterior)', () => {
    const hoy = dayjs('2026-01-01');
    expect(rangoMesAnterior(hoy)).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
  });
});

describe('formatearRangoLegible', () => {
  it('mismo día: fecha simple, no "del X al X"', () => {
    expect(formatearRangoLegible('2026-03-11', '2026-03-11')).toBe('11 de marzo de 2026');
  });

  it('mismo mes y año: no repite el mes en la fecha de inicio', () => {
    expect(formatearRangoLegible('2026-03-03', '2026-03-17')).toBe('Del 3 al 17 de marzo de 2026');
  });

  it('mismo año, distinto mes: repite el mes en ambos extremos', () => {
    expect(formatearRangoLegible('2026-02-28', '2026-03-03')).toBe('Del 28 de febrero al 3 de marzo de 2026');
  });

  it('distinto año: fecha completa en ambos extremos', () => {
    expect(formatearRangoLegible('2025-12-28', '2026-01-03')).toBe('Del 28 de diciembre de 2025 al 3 de enero de 2026');
  });
});

describe('validarRango', () => {
  const hoy = dayjs('2026-03-11');

  it('inválido si falta cualquiera de las dos fechas', () => {
    expect(validarRango(null, '2026-03-11', hoy).valido).toBe(false);
    expect(validarRango('2026-03-01', null, hoy).valido).toBe(false);
  });

  it('inválido si el fin es anterior al inicio', () => {
    const r = validarRango('2026-03-11', '2026-03-01', hoy);
    expect(r.valido).toBe(false);
    expect(r.motivo).toMatch(/anterior/i);
  });

  it('inválido si cualquiera de las dos fechas es futura', () => {
    expect(validarRango('2026-03-01', '2026-03-12', hoy).valido).toBe(false);
    expect(validarRango('2026-03-12', '2026-03-12', hoy).valido).toBe(false);
  });

  it('válido: rango normal dentro del pasado/hoy', () => {
    expect(validarRango('2026-03-01', '2026-03-11', hoy).valido).toBe(true);
  });

  it('válido: un solo día (desde === hasta === hoy)', () => {
    expect(validarRango('2026-03-11', '2026-03-11', hoy).valido).toBe(true);
  });
});

describe('marcarPeriodoCalendario', () => {
  it('sin selección: objeto vacío', () => {
    expect(marcarPeriodoCalendario(null, null, '#123456')).toEqual({});
  });

  it('solo el primer toque: un solo día marcado como inicio Y fin', () => {
    const marks = marcarPeriodoCalendario('2026-03-05', null, '#123456');
    expect(Object.keys(marks)).toEqual(['2026-03-05']);
    expect(marks['2026-03-05']).toMatchObject({ startingDay: true, endingDay: true, color: '#123456' });
  });

  it('rango de varios días: marca cada día, con startingDay/endingDay solo en los extremos', () => {
    const marks = marcarPeriodoCalendario('2026-03-05', '2026-03-08', '#123456');
    expect(Object.keys(marks)).toEqual(['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']);
    expect(marks['2026-03-05']).toMatchObject({ startingDay: true, endingDay: false });
    expect(marks['2026-03-06']).toMatchObject({ startingDay: false, endingDay: false });
    expect(marks['2026-03-07']).toMatchObject({ startingDay: false, endingDay: false });
    expect(marks['2026-03-08']).toMatchObject({ startingDay: false, endingDay: true });
  });

  it('si el usuario toca el segundo día antes que el primero, igual arma el rango correcto', () => {
    const marks = marcarPeriodoCalendario('2026-03-08', '2026-03-05', '#123456');
    expect(Object.keys(marks)).toEqual(['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']);
    expect(marks['2026-03-05'].startingDay).toBe(true);
    expect(marks['2026-03-08'].endingDay).toBe(true);
  });

  it('rango inclusivo en ambos extremos: el primer y el último día SIEMPRE están en el objeto', () => {
    const marks = marcarPeriodoCalendario('2026-03-05', '2026-03-05', '#123456');
    expect(marks['2026-03-05']).toBeDefined();
  });
});
