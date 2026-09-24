import {
  armarPayloadEvento, esFechaValida, esHoraValida, instanteDelProyecto, normalizarHora, validarEvento,
} from '../validacionEvento';

const base = { titulo: 'Junta de obra', fecha: '2026-09-23', horaInicio: '09:00', horaFin: '', todoElDia: false };

describe('horas y fechas', () => {
  it('acepta HH:MM entre 00:00 y 23:59 y normaliza "9:30"', () => {
    for (const ok of ['00:00', '09:30', '9:30', '23:59']) expect(esHoraValida(ok)).toBe(true);
    for (const mal of ['24:00', '12:60', '9', '0930', 'ab:cd', '', '12:5']) expect(esHoraValida(mal)).toBe(false);
    expect(normalizarHora('9:05')).toBe('09:05');
    expect(normalizarHora('x')).toBe('x');
  });

  it('rechaza fechas que no existen', () => {
    expect(esFechaValida('2026-09-23')).toBe(true);
    expect(esFechaValida('2028-02-29')).toBe(true);
    for (const mal of ['2026-02-31', '2027-02-29', '2026-13-01', '23/09/2026', '2026-9-3', '']) {
      expect(esFechaValida(mal)).toBe(false);
    }
  });
});

describe('validarEvento', () => {
  it('un evento correcto no tiene errores', () => {
    expect(validarEvento(base)).toEqual({});
    expect(validarEvento({ ...base, horaFin: '11:30' })).toEqual({});
  });

  it('título vacío o solo espacios', () => {
    expect(validarEvento({ ...base, titulo: '   ' }).titulo).toBe('El título es obligatorio.');
  });

  it('fecha vacía o inválida, cada una con su mensaje', () => {
    expect(validarEvento({ ...base, fecha: '' }).fecha).toBe('La fecha es obligatoria.');
    expect(validarEvento({ ...base, fecha: '2026-02-30' }).fecha).toMatch(/AAAA-MM-DD/);
  });

  it('horas inválidas se marcan en su campo', () => {
    const e = validarEvento({ ...base, horaInicio: '25:00', horaFin: '10:99' });
    expect(e.horaInicio).toMatch(/00:00 y 23:59/);
    expect(e.horaFin).toMatch(/00:00 y 23:59/);
    expect(validarEvento({ ...base, horaInicio: '' }).horaInicio).toBe('La hora de inicio es obligatoria.');
  });

  it('el fin debe ser posterior al inicio (igual también falla)', () => {
    expect(validarEvento({ ...base, horaFin: '08:59' }).horaFin).toBe('La hora de fin debe ser posterior a la de inicio.');
    expect(validarEvento({ ...base, horaFin: '09:00' }).horaFin).toBe('La hora de fin debe ser posterior a la de inicio.');
    expect(validarEvento({ ...base, horaInicio: '9:00', horaFin: '09:01' })).toEqual({});
  });

  it('con hora de inicio inválida no compara el fin (un solo error a la vez)', () => {
    const e = validarEvento({ ...base, horaInicio: '99:00', horaFin: '10:00' });
    expect(e.horaInicio).toBeDefined();
    expect(e.horaFin).toBeUndefined();
  });

  it('todo el día no valida ni exige horas', () => {
    expect(validarEvento({ ...base, todoElDia: true, horaInicio: '', horaFin: '' })).toEqual({});
    expect(validarEvento({ ...base, todoElDia: true, horaInicio: 'xx', horaFin: '07:00' })).toEqual({});
    expect(validarEvento({ ...base, todoElDia: true, titulo: '' }).titulo).toBeDefined();
  });
});

describe('payload', () => {
  const extra = { descripcion: '  ', ubicacion: ' Caseta ', areaId: null, asistentes: ['u1'] };

  it('las 09:00 de CDMX son las 15:00 UTC', () => {
    expect(instanteDelProyecto('2026-09-23', '09:00')).toBe('2026-09-23T15:00:00.000Z');
    expect(instanteDelProyecto('2026-09-23', '9:00')).toBe('2026-09-23T15:00:00.000Z');
  });

  it('respeta el desfase del proyecto (Tijuana -420)', () => {
    expect(instanteDelProyecto('2026-09-23', '09:00', { tz_offset_min: -420 })).toBe('2026-09-23T16:00:00.000Z');
  });

  it('las 20:00 de CDMX caen al día siguiente en UTC, pero se conserva la hora local', () => {
    expect(instanteDelProyecto('2026-09-23', '20:00')).toBe('2026-09-24T02:00:00.000Z');
  });

  it('arma el payload con horas y recorta textos', () => {
    const p = armarPayloadEvento({ ...base, horaFin: '10:30', ...extra });
    expect(p).toEqual({
      title: 'Junta de obra',
      description: null,
      location: 'Caseta',
      start_at: '2026-09-23T15:00:00.000Z',
      end_at: '2026-09-23T16:30:00.000Z',
      area_id: null,
      attendee_ids: ['u1'],
    });
  });

  it('todo el día manda solo la fecha, sin horas y con all_day', () => {
    const p = armarPayloadEvento({ ...base, todoElDia: true, horaInicio: '09:00', horaFin: '10:00', ...extra });
    expect(p.start_at).toBe('2026-09-23');
    expect(p.end_at).toBeNull();
    expect(p.all_day).toBe(true);
  });

  it('sin hora de fin manda end_at nulo', () => {
    expect(armarPayloadEvento({ ...base, ...extra }).end_at).toBeNull();
  });
});
