import { filtrarPorGravedad, gravedadDe } from '../../components/GravedadDot';

describe('filtro por semáforo de gravedad', () => {
  const lista = [{ id: 'a' }, { id: 'b', gravedad: 'amarillo' }, { id: 'c', gravedad: 'rojo' }, { id: 'd', gravedad: 'verde' }];

  it('sin dato cuenta como verde (informativo)', () => {
    expect(gravedadDe({})).toBe('verde');
    expect(gravedadDe({ gravedad: 'raro' })).toBe('verde');
  });

  it('todas no filtra', () => {
    expect(filtrarPorGravedad(lista, 'todas')).toHaveLength(4);
  });

  it('filtra por color e incluye los reportes viejos en verde', () => {
    expect(filtrarPorGravedad(lista, 'verde').map((r) => r.id)).toEqual(['a', 'd']);
    expect(filtrarPorGravedad(lista, 'amarillo').map((r) => r.id)).toEqual(['b']);
    expect(filtrarPorGravedad(lista, 'rojo').map((r) => r.id)).toEqual(['c']);
  });
});
