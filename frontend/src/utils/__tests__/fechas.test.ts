import {
  esFechaFutura, esSoloFecha, fmtFecha, fmtFechaHora, fmtHora, hoyProyecto, offsetDe, semanaDe, sumarDias,
} from '../fechas';

const CDMX = { tz_offset_min: -360 };

describe('la hora de CDMX sigue saliendo bien (sin Intl, sin depender de la zona del dispositivo)', () => {
  it('un instante UTC se muestra en CDMX (-6 h)', () => {
    // 23 sep 2026 14:47 UTC = 08:47 en CDMX
    expect(fmtFechaHora('2026-09-23T14:47:00Z', CDMX)).toBe('23 sep 2026, 08:47');
    expect(fmtHora('2026-09-23T14:47:00Z', CDMX)).toBe('08:47');
  });

  it('cruza de día: 03:30 UTC del 24 es 21:30 del 23 en CDMX', () => {
    expect(fmtFecha('2026-09-24T03:30:00Z', CDMX)).toBe('23 sep 2026');
    expect(fmtFechaHora('2026-09-24T03:30:00Z', CDMX)).toBe('23 sep 2026, 21:30');
  });

  it('sin proyecto usa CDMX', () => {
    expect(offsetDe(undefined)).toBe(-360);
    expect(fmtFechaHora('2026-09-23T14:47:00Z')).toBe('23 sep 2026, 08:47');
  });

  it('sin zona en el texto (como llega de Mongo) se lee como UTC, igual que antes', () => {
    expect(fmtFechaHora('2026-09-23T14:47:00', CDMX)).toBe('23 sep 2026, 08:47');
  });

  it('otra zona (Tijuana en verano, -7 h)', () => {
    expect(fmtFechaHora('2026-09-23T14:47:00Z', { tz_offset_min: -420 })).toBe('23 sep 2026, 07:47');
  });
});

describe('fecha sin hora = día de calendario (no se convierte de zona)', () => {
  it('"2026-09-23" siempre es 23 sep, nunca 22 (el bug de las 18:00)', () => {
    expect(esSoloFecha('2026-09-23')).toBe(true);
    expect(fmtFecha('2026-09-23', CDMX)).toBe('23 sep 2026');
    expect(fmtFecha('2026-09-23', { tz_offset_min: -720 })).toBe('23 sep 2026');
  });

  it('una fecha sin hora no muestra hora', () => {
    expect(fmtFechaHora('2026-09-23', CDMX)).toBe('23 sep 2026');
    expect(fmtHora('2026-09-23', CDMX)).toBe('');
  });

  it('vacíos y basura no truenan', () => {
    expect(fmtFecha(null)).toBe('—');
    expect(fmtFechaHora(undefined)).toBe('—');
    expect(fmtFecha('no-es-fecha')).toBe('no-es-fecha');
  });
});

describe('hoyProyecto — nunca el día UTC', () => {
  it('a las 21:30 de CDMX (03:30 UTC del día siguiente) sigue siendo el mismo día', () => {
    const ahora = Date.UTC(2026, 8, 24, 3, 30);
    expect(hoyProyecto(CDMX, ahora)).toBe('2026-09-23');
  });

  it('respeta el desfase del proyecto', () => {
    const ahora = Date.UTC(2026, 8, 24, 3, 30);
    expect(hoyProyecto({ tz_offset_min: 120 }, ahora)).toBe('2026-09-24');
  });

  it('esFechaFutura compara contra el hoy del proyecto', () => {
    const ahora = Date.UTC(2026, 8, 24, 3, 30); // hoy en CDMX: 23 sep
    expect(esFechaFutura('2026-09-23', CDMX, ahora)).toBe(false);
    expect(esFechaFutura('2026-09-24', CDMX, ahora)).toBe(true);
  });
});

describe('semana lunes-domingo', () => {
  it('un miércoles', () => {
    expect(semanaDe('2026-09-23')).toEqual({ desde: '2026-09-21', hasta: '2026-09-27' });
  });
  it('un domingo pertenece a la semana que empezó el lunes anterior', () => {
    expect(semanaDe('2026-09-27')).toEqual({ desde: '2026-09-21', hasta: '2026-09-27' });
  });
  it('un lunes es el primer día', () => {
    expect(semanaDe('2026-09-21')).toEqual({ desde: '2026-09-21', hasta: '2026-09-27' });
  });
  it('respeta el día de inicio del proyecto (sábado a viernes)', () => {
    expect(semanaDe('2026-09-23', 'SABADO')).toEqual({ desde: '2026-09-19', hasta: '2026-09-25' });
  });
  it('cruza mes y año', () => {
    expect(semanaDe('2026-01-01')).toEqual({ desde: '2025-12-29', hasta: '2026-01-04' });
    expect(sumarDias('2026-02-28', 1)).toBe('2026-03-01');
  });
});
