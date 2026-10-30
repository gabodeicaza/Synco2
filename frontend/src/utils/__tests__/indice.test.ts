// Copiar la estructura general del indice de un periodo a otro.
import { copiarFormato } from '../indice';
import type { IndiceConfig } from '@/src/api';

const diario: IndiceConfig = {
  enabled: false,
  titulo: 'CONTENIDO',
  order: ['gd', 'recuento'],
  titles: { gd: 'Generales' },
  hidden: ['orphan'],
  portadillas_area: false,
};

const semanal: IndiceConfig = {
  enabled: true,
  titulo: 'ÍNDICE',
  order: [],
  titles: {},
  hidden: [],
  portadillas_area: true,
};

describe('copiarFormato', () => {
  it('copia titulo, orden, titulos, ocultas y enabled', () => {
    const r = copiarFormato(diario, semanal);
    expect(r).toEqual({ ...diario, portadillas_area: true });
  });

  it('conserva las portadillas del destino', () => {
    expect(copiarFormato(diario, semanal).portadillas_area).toBe(true);
  });

  it('no comparte referencias con el origen', () => {
    const r = copiarFormato(diario, semanal);
    r.order.push('x');
    r.titles.y = 'z';
    r.hidden.push('w');
    expect(diario.order).toEqual(['gd', 'recuento']);
    expect(diario.titles).toEqual({ gd: 'Generales' });
    expect(diario.hidden).toEqual(['orphan']);
  });
});
