import {
  claveAcuerdo, esFechaIsoValida, hayErroresFechas, hayErroresMinuta, primerCampoConError,
  reindexarErroresAcuerdos, validarFechasMinuta, validarMinuta,
} from '../validacionMinuta';

const acuerdoVacio = { descripcion: '', responsable_id: '', fecha_limite: '2026-09-30' };
const base = {
  tipo: 'compromiso' as const,
  titulo: 'Arranque',
  ubicacionId: 'n1',
  fechaReunion: '2026-09-23',
  acuerdos: [{ descripcion: 'Entregar planos', responsable_id: 'u1', fecha_limite: '2026-09-30' }],
};

describe('K-04: validarMinuta marca todos los campos que faltan', () => {
  it('una minuta completa no tiene errores', () => {
    expect(hayErroresMinuta(validarMinuta(base))).toBe(false);
  });

  it('todo vacío: marca título, ubicación y los tres campos del acuerdo a la vez', () => {
    const e = validarMinuta({ ...base, titulo: '  ', ubicacionId: '', acuerdos: [{ descripcion: '', responsable_id: '', fecha_limite: '' }] });
    expect(Object.keys(e).sort()).toEqual(
      ['acuerdo.0.descripcion', 'acuerdo.0.fecha', 'acuerdo.0.responsable', 'titulo', 'ubicacion'].sort(),
    );
    expect(e.titulo).toBe('Escribe el título de la minuta.');
    expect(e.ubicacion).toMatch(/ubicación/);
  });

  it('solo acuerdos sin responsable: señala cada acuerdo por su índice', () => {
    const e = validarMinuta({
      ...base,
      acuerdos: [
        { descripcion: 'A', responsable_id: 'u1', fecha_limite: '2026-09-30' },
        { descripcion: 'B', responsable_id: '', fecha_limite: '2026-09-30' },
        { descripcion: 'C', responsable_id: '', fecha_limite: '2026-09-30' },
      ],
    });
    expect(Object.keys(e).sort()).toEqual([claveAcuerdo(1, 'responsable'), claveAcuerdo(2, 'responsable')].sort());
  });

  it('compromiso sin acuerdos pide al menos uno; informativa no', () => {
    expect(validarMinuta({ ...base, acuerdos: [] }).acuerdos).toBe('Registra al menos un acuerdo.');
    expect(hayErroresMinuta(validarMinuta({ ...base, tipo: 'informativo', acuerdos: [acuerdoVacio] }))).toBe(false);
  });

  it('K-03 sigue vigente: fecha límite anterior a la reunión se marca en su acuerdo', () => {
    const e = validarMinuta({ ...base, acuerdos: [{ descripcion: 'A', responsable_id: 'u1', fecha_limite: '2026-09-22' }] });
    expect(e[claveAcuerdo(0, 'fecha')]).toMatch(/no puede ser anterior/);
  });

  it('fecha de reunión vacía o imposible se marca en su campo', () => {
    expect(validarMinuta({ ...base, fechaReunion: '' }).reunion).toMatch(/fecha de la reunión/);
    expect(validarMinuta({ ...base, fechaReunion: '2026-02-30' }).reunion).toMatch(/fecha real/);
  });
});

describe('primerCampoConError y reindexarErroresAcuerdos', () => {
  it('elige el campo que aparece primero en el formulario', () => {
    expect(primerCampoConError({})).toBeNull();
    expect(primerCampoConError({ [claveAcuerdo(1, 'fecha')]: 'x', [claveAcuerdo(0, 'responsable')]: 'y', ubicacion: 'z' })).toBe('ubicacion');
    expect(primerCampoConError({ [claveAcuerdo(1, 'descripcion')]: 'x', [claveAcuerdo(0, 'fecha')]: 'y' })).toBe(claveAcuerdo(0, 'fecha'));
    expect(primerCampoConError({ [claveAcuerdo(2, 'fecha')]: 'x', titulo: 'y' })).toBe('titulo');
  });

  it('al quitar un acuerdo se descartan sus errores y los siguientes se recorren', () => {
    const e = reindexarErroresAcuerdos(
      { titulo: 't', [claveAcuerdo(0, 'fecha')]: 'a', [claveAcuerdo(1, 'fecha')]: 'b', [claveAcuerdo(2, 'responsable')]: 'c' },
      1,
    );
    expect(e).toEqual({ titulo: 't', [claveAcuerdo(0, 'fecha')]: 'a', [claveAcuerdo(1, 'responsable')]: 'c' });
  });
});

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
