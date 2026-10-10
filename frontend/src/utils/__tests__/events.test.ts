import { groupEvents, formatEventTime } from '../events';

jest.mock('@/src/api', () => ({}));

const ev = (o: any) => ({ id: 'e', project_id: 'p', title: 't', author_id: 'a', author_name: 'A', created_at: '', ...o });

describe('eventos de todo el día (minutas): ya no salen a las 18:00', () => {
  it('formatEventTime dice "Todo el día", no una hora', () => {
    const minuta = ev({ id: 'minuta:1', start_at: '2026-09-23T06:00:00Z', all_day: true, fecha: '2026-09-23' });
    expect(formatEventTime(minuta)).toBe('Todo el día');
  });

  it('también el formato anterior del servidor (00:00 UTC, sin all_day) se reconoce por su id', () => {
    const viejo = ev({ id: 'minuta:1', start_at: '2026-09-23T00:00:00Z' });
    expect(formatEventTime(viejo)).toBe('Todo el día');
  });

  it('un evento con hora conserva su hora de CDMX', () => {
    expect(formatEventTime(ev({ start_at: '2026-09-23T14:47:00Z' }))).toBe('08:47');
  });
});

describe('groupEvents por día de calendario del proyecto', () => {
  const zona = { tz_offset_min: -360 };
  it('agrupa una minuta de hoy en "Hoy" aunque el instante sea de otro día UTC', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-24T03:30:00Z')); // 21:30 del 23 en CDMX
    const minuta = ev({ id: 'minuta:1', start_at: '2026-09-23T06:00:00Z', all_day: true, fecha: '2026-09-23' });
    const nocturno = ev({ id: 'x', start_at: '2026-09-24T02:00:00Z' }); // 20:00 del 23 en CDMX
    const secciones = groupEvents([minuta, nocturno] as any, 'upcoming', zona);
    expect(secciones).toHaveLength(1);
    expect(secciones[0].key).toBe('today');
    expect(secciones[0].items).toHaveLength(2);
    jest.useRealTimers();
  });
});
