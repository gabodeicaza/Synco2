import { aplanar, destinosDeMovimiento, indexar, visiblesPorBusqueda } from '../trazabilidad';
import type { TrazNodo } from '@/src/api';

const n = (id: string, parent_id: string | null, kind: TrazNodo['kind'], name: string, extra: Partial<TrazNodo> = {}): TrazNodo => ({
  id, parent_id, kind, code: '', name, order: 0, fields: {}, extra: [], files: [], ...extra,
});

const NODOS: TrazNodo[] = [
  n('a', null, 'categoria', 'ESTUDIOS', { code: 'A101' }),
  n('g', 'a', 'grupo', 'Estación E1'),
  n('d1', 'g', 'documento', 'Altimetría', { code: 'PLN-E1-1201', files: [{ file_id: 'f', name: 'x.pdf', ext: '.pdf', size: 1 }] }),
  n('d2', 'g', 'documento', 'Planimetría', { code: 'PLN-E1-1101', fields: { val_oficio: 'DIR-CL4-150-2026', val_fecha: '2026-04-29' } }),
  n('b', null, 'categoria', 'PROYECTO', { code: 'A301' }),
];

describe('trazabilidad', () => {
  it('cuenta documentos y documentos con archivo por rama', () => {
    const ind = indexar(NODOS);
    expect(ind.conteo.get('a')).toEqual({ docs: 2, conArchivo: 1, validados: 1, firmados: 0 });
    expect(ind.conteo.get('b')).toEqual({ docs: 0, conArchivo: 0, validados: 0, firmados: 0 });
  });

  it('aplana solo lo abierto, con su nivel', () => {
    const ind = indexar(NODOS);
    expect(aplanar(ind, new Set(), null).map((f) => f.nodo.id)).toEqual(['a', 'b']);
    const filas = aplanar(ind, new Set(['a', 'g']), null);
    expect(filas.map((f) => [f.nodo.id, f.nivel])).toEqual([['a', 0], ['g', 1], ['d1', 2], ['d2', 2], ['b', 0]]);
  });

  it('muestra una sola rama cuando hay foco', () => {
    const ind = indexar(NODOS);
    expect(aplanar(ind, new Set(), null, 'g').map((f) => [f.nodo.id, f.nivel])).toEqual([['g', 0], ['d1', 1], ['d2', 1]]);
  });

  it('busca sin acentos y en las características; muestra ancestros', () => {
    const ind = indexar(NODOS);
    const porOficio = visiblesPorBusqueda(ind, NODOS, 'cl4-150');
    expect([...(porOficio as Set<string>)].sort()).toEqual(['a', 'd2', 'g']);
    const porNombre = visiblesPorBusqueda(ind, NODOS, 'estacion e1');
    expect([...(porNombre as Set<string>)].sort()).toEqual(['a', 'd1', 'd2', 'g']);
    expect(visiblesPorBusqueda(ind, NODOS, '  ')).toBeNull();
    expect(aplanar(ind, new Set(), porOficio).map((f) => f.nodo.id)).toEqual(['a', 'g', 'd2']);
  });

  it('no ofrece como destino al propio nodo, su descendencia ni documentos', () => {
    const ind = indexar(NODOS);
    expect(destinosDeMovimiento(ind, NODOS, 'g').map((x) => x.id)).toEqual(['a', 'b']);
    expect(destinosDeMovimiento(ind, NODOS, 'a').map((x) => x.id)).toEqual(['b']);
  });

  it('un padre inexistente deja el nodo en la raíz', () => {
    const ind = indexar([n('x', 'borrado', 'documento', 'Huérfano')]);
    expect(aplanar(ind, new Set(), null).map((f) => f.nodo.id)).toEqual(['x']);
  });
});
