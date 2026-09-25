import { etiquetaDiaReunion, horaReunion, ordenarReuniones } from '../reuniones';

// 23 sep 2026 a las 12:00 en CDMX (UTC-6) = 18:00 UTC
const AHORA = Date.UTC(2026, 8, 23, 18, 0);

const ev = (id: string, start_at: string, extra: Record<string, unknown> = {}) => ({ id, title: id, start_at, ...extra });

describe('ordenarReuniones (G-02)', () => {
  it('ordena por día y luego por hora, sin depender del orden de llegada', () => {
    const items = [
      ev('tarde', '2026-09-24T21:00:00Z'), // 24 sep 15:00 CDMX
      ev('manana-temprano', '2026-09-24T14:00:00Z'), // 24 sep 08:00
      ev('hoy', '2026-09-23T20:00:00Z'), // 23 sep 14:00
    ];
    expect(ordenarReuniones(items).map((e) => e.id)).toEqual(['hoy', 'manana-temprano', 'tarde']);
  });

  it('los eventos de todo el día van antes que los de hora en el mismo día', () => {
    const items = [
      ev('con-hora', '2026-09-23T15:00:00Z'),
      ev('todo-el-dia', '2026-09-23', { all_day: true, fecha: '2026-09-23' }),
    ];
    expect(ordenarReuniones(items).map((e) => e.id)).toEqual(['todo-el-dia', 'con-hora']);
  });

  it('una minuta (sin hora) de un día no se corre al día anterior por la zona', () => {
    const items = [ev('a-las-20', '2026-09-23T02:00:00Z'), ev('minuta:abc', '2026-09-23', { fecha: '2026-09-23' })];
    // 23 sep 02:00 UTC = 22 sep 20:00 CDMX: cae en el día 22, antes que la minuta del 23.
    expect(ordenarReuniones(items).map((e) => e.id)).toEqual(['a-las-20', 'minuta:abc']);
  });

  it('fusiona varios proyectos en orden cronológico global', () => {
    const p1 = [ev('p1-a', '2026-09-25T15:00:00Z'), ev('p1-b', '2026-09-23T15:00:00Z')];
    const p2 = [ev('p2-a', '2026-09-24T15:00:00Z')];
    expect(ordenarReuniones([...p1, ...p2]).map((e) => e.id)).toEqual(['p1-b', 'p2-a', 'p1-a']);
  });

  it('desempata por título y no modifica el arreglo original', () => {
    const items = [ev('b', '2026-09-23T15:00:00Z'), ev('a', '2026-09-23T15:00:00Z')];
    const copia = [...items];
    expect(ordenarReuniones(items).map((e) => e.id)).toEqual(['a', 'b']);
    expect(items).toEqual(copia);
  });

  it('respeta el desfase del proyecto al decidir el día', () => {
    // 24 sep 03:30 UTC: en CDMX (-360) sigue siendo el 23; en un proyecto en Madrid-ish (+120) ya es el 24.
    const items = [ev('x', '2026-09-24T03:30:00Z'), ev('y', '2026-09-23T23:00:00Z')];
    expect(ordenarReuniones(items, { tz_offset_min: -360 }).map((e) => e.id)).toEqual(['y', 'x']);
  });
});

describe('etiquetaDiaReunion / horaReunion', () => {
  it('Hoy y Mañana según el "hoy" del proyecto, no según UTC', () => {
    // A las 22:00 CDMX del 23 sep ya es 24 sep en UTC, pero el "hoy" del proyecto sigue siendo el 23.
    const noche = Date.UTC(2026, 8, 24, 4, 0);
    expect(etiquetaDiaReunion(ev('h', '2026-09-24T02:00:00Z'), null, noche)).toBe('Hoy');
    expect(etiquetaDiaReunion(ev('m', '2026-09-24T16:00:00Z'), null, noche)).toBe('Mañana');
  });

  it('otros días con el formato único "23 sep 2026"', () => {
    expect(etiquetaDiaReunion(ev('f', '2026-09-28T16:00:00Z'), null, AHORA)).toBe('28 sep 2026');
  });

  it('todo el día no lleva hora; con hora, HH:mm en la zona del proyecto', () => {
    expect(horaReunion(ev('d', '2026-09-23', { all_day: true }))).toBe('Todo el día');
    expect(horaReunion(ev('minuta:1', '2026-09-23'))).toBe('Todo el día');
    expect(horaReunion(ev('h', '2026-09-23T15:30:00Z'))).toBe('09:30');
  });
});
