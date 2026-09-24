import { esFechaIsoValida, hayErroresFechas, validarFechasMinuta } from '../validacionMinuta';

describe('K-03: fecha límite >= fecha de la reunión', () => {
  it('rechaza un acuerdo que vence antes de la reunión y dice cuál', () => {
    const e = validarFechasMinuta('2026-09-23', ['2026-09-30', '2026-09-22']);
    expect(e.acuerdos[0]).toBeUndefined();
    expect(e.acuerdos[1]).toMatch(/no puede ser anterior/);
    expect(e.acuerdos[1]).toContain('2026-09-22');
    expect(hayErroresFechas(e)).toBe(true);
  });

  it('el mismo día de la reunión es válido', () => {
    expect(hayErroresFechas(validarFechasMinuta('2026-09-23', ['2026-09-23']))).toBe(false);
  });

  it('fechas mal formadas o imposibles se rechazan', () => {
    expect(esFechaIsoValida('2026-02-30')).toBe(false);
    expect(esFechaIsoValida('23/09/2026')).toBe(false);
    expect(esFechaIsoValida('2028-02-29')).toBe(true);
    expect(validarFechasMinuta('23/09/2026', []).reunion).toMatch(/reunión/);
    expect(validarFechasMinuta('2026-09-23', ['2026-13-01']).acuerdos[0]).toMatch(/fecha real/);
  });

  it('una fecha límite vacía no es este error (la obligatoriedad se valida aparte)', () => {
    expect(hayErroresFechas(validarFechasMinuta('2026-09-23', ['']))).toBe(false);
  });
});
