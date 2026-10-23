import { aplanar, conteoPorCategoria, indexar, rutaLegible, visiblesPorFiltro } from '../trazabilidad';
import type { TrazArchivo, TrazNodo } from '@/src/api';

const n = (id: string, parent_id: string | null, name: string, order = 0): TrazNodo => ({ id, parent_id, name, order });
const f = (id: string, node_id: string, name: string, extra: Partial<TrazArchivo> = {}): TrazArchivo => ({
  id, node_id, name, categoria: '', ext: '.pdf', size: 1, rev: '', oficio: '', fecha: '', obs: '', ...extra,
});

const NODOS: TrazNodo[] = [
  n('t1', null, 'Tramo 1'),
  n('e1', 't1', 'Estación 1', 0),
  n('e2', 't1', 'Estación 2', 1),
  n('t2', null, 'Tramo 2', 1),
];
const ARCHIVOS: TrazArchivo[] = [
  f('a', 'e1', 'plano-arq.pdf', { categoria: 'A3012 · Arquitectónico', oficio: 'DIR-CL4-150-2026' }),
  f('b', 'e1', 'cimentacion.dwg', { categoria: 'A3014 · Cimentación', ext: '.dwg' }),
  f('c', 't1', 'general.xlsx', { ext: '.xlsx' }),
  f('huerfano', 'borrado', 'x.pdf'),
];

describe('trazabilidad', () => {
  it('cuenta archivos por rama e ignora los de nodos borrados', () => {
    const ind = indexar(NODOS, ARCHIVOS);
    expect(ind.total.get('e1')).toBe(2);
    expect(ind.total.get('t1')).toBe(3);
    expect(ind.total.get('t2')).toBe(0);
    expect(ind.archivosDe.has('borrado')).toBe(false);
  });

  it('aplana solo lo abierto, con su nivel y orden', () => {
    const ind = indexar(NODOS, ARCHIVOS);
    expect(aplanar(ind, new Set(), null).map((x) => x.nodo.id)).toEqual(['t1', 't2']);
    expect(aplanar(ind, new Set(['t1']), null).map((x) => [x.nodo.id, x.nivel])).toEqual([['t1', 0], ['e1', 1], ['e2', 1], ['t2', 0]]);
  });

  it('filtra por categoría mostrando los ancestros', () => {
    const ind = indexar(NODOS, ARCHIVOS);
    const v = visiblesPorFiltro(ind, NODOS, '', 'A3014 · Cimentación');
    expect([...(v as Set<string>)].sort()).toEqual(['e1', 't1']);
    expect(aplanar(ind, new Set(), v).map((x) => x.nodo.id)).toEqual(['t1', 'e1']);
    expect(visiblesPorFiltro(ind, NODOS, '  ', null)).toBeNull();
  });

  it('busca sin acentos en nombre de nodo y en datos del archivo', () => {
    const ind = indexar(NODOS, ARCHIVOS);
    const porNodo = visiblesPorFiltro(ind, NODOS, 'estacion 2', null);
    expect([...(porNodo as Set<string>)].sort()).toEqual(['e2', 't1']);
    const porOficio = visiblesPorFiltro(ind, NODOS, 'cl4-150', null);
    expect([...(porOficio as Set<string>)].sort()).toEqual(['e1', 't1']);
    const porTramo = visiblesPorFiltro(ind, NODOS, 'tramo 1', null);
    expect([...(porTramo as Set<string>)].sort()).toEqual(['e1', 'e2', 't1']);
  });

  it('ruta legible y conteo por categoría', () => {
    const ind = indexar(NODOS, ARCHIVOS);
    expect(rutaLegible(ind, 'e2')).toBe('Tramo 1');
    expect(rutaLegible(ind, 't1')).toBe('');
    const c = conteoPorCategoria(ARCHIVOS);
    expect(c.get('')).toBe(2);
    expect(c.get('A3012 · Arquitectónico')).toBe(1);
  });

  it('un padre inexistente deja el nodo en la raíz', () => {
    const ind = indexar([n('x', 'borrado', 'Huérfano')], []);
    expect(aplanar(ind, new Set(), null).map((x) => x.nodo.id)).toEqual(['x']);
  });
});
