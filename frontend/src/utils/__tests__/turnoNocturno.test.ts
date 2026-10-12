import { normalizarHora, validarTurnoNocturno } from '../turnoNocturno';

describe('turno nocturno del proyecto', () => {
  it('normaliza horas', () => {
    expect(normalizarHora('8:05')).toBe('08:05');
    expect(normalizarHora('  ')).toBeNull();
    expect(normalizarHora('24:00')).toBeUndefined();
    expect(normalizarHora('12:60')).toBeUndefined();
    expect(normalizarHora('abc')).toBeUndefined();
  });

  it('acepta un horario que cruza la medianoche', () => {
    expect(validarTurnoNocturno('20:00', '6:00')).toEqual({ ok: true, inicio: '20:00', fin: '06:00' });
  });

  it('vacío en ambos = sin turno nocturno', () => {
    expect(validarTurnoNocturno('', '')).toEqual({ ok: true, inicio: null, fin: null });
  });

  it('rechaza una sola hora, formato inválido e iguales', () => {
    expect(validarTurnoNocturno('20:00', '')).toEqual({ ok: false, motivo: 'formato' });
    expect(validarTurnoNocturno('20', '06:00')).toEqual({ ok: false, motivo: 'formato' });
    expect(validarTurnoNocturno('20:00', '20:00')).toEqual({ ok: false, motivo: 'iguales' });
  });
});
