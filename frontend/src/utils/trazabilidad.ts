// Ayudas puras de Trazabilidad: índice del árbol de nodos con sus archivos,
// conteos por rama, filtro (búsqueda + categoría) y aplanado de las filas
// visibles. El árbol puede tener cientos de nodos, así que se pinta como lista
// plana y no como componentes anidados.
import type { TrazArchivo, TrazNodo } from '@/src/api';

export interface TrazIndice {
  porId: Map<string, TrazNodo>;
  hijos: Map<string | null, TrazNodo[]>;
  /** Archivos adjuntos directamente al nodo. */
  archivosDe: Map<string, TrazArchivo[]>;
  /** Archivos del nodo y de todo lo que cuelga de él. */
  total: Map<string, number>;
}
export interface TrazFila { nodo: TrazNodo; nivel: number }

export function normalizar(t: string): string {
  return (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function indexar(nodos: TrazNodo[], archivos: TrazArchivo[]): TrazIndice {
  const porId = new Map<string, TrazNodo>();
  const hijos = new Map<string | null, TrazNodo[]>();
  const archivosDe = new Map<string, TrazArchivo[]>();
  for (const n of nodos) porId.set(n.id, n);
  for (const n of nodos) {
    // Un padre inexistente deja al nodo en la raíz en vez de perderlo.
    const p = n.parent_id && porId.has(n.parent_id) ? n.parent_id : null;
    const lista = hijos.get(p);
    if (lista) lista.push(n); else hijos.set(p, [n]);
  }
  for (const lista of hijos.values()) {
    lista.sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || a.name.localeCompare(b.name));
  }
  for (const f of archivos) {
    if (!porId.has(f.node_id)) continue; // nodo borrado: el archivo no se muestra
    const lista = archivosDe.get(f.node_id);
    if (lista) lista.push(f); else archivosDe.set(f.node_id, [f]);
  }
  const total = new Map<string, number>();
  const contar = (n: TrazNodo): number => {
    let t = (archivosDe.get(n.id) || []).length;
    for (const h of hijos.get(n.id) || []) t += contar(h);
    total.set(n.id, t);
    return t;
  };
  for (const r of hijos.get(null) || []) contar(r);
  return { porId, hijos, archivosDe, total };
}

/** Cadena de ancestros (del más cercano a la raíz). */
export function ancestros(ind: TrazIndice, id: string): TrazNodo[] {
  const out: TrazNodo[] = [];
  const vistos = new Set<string>([id]);
  let actual = ind.porId.get(id);
  while (actual && actual.parent_id && !vistos.has(actual.parent_id)) {
    const p = ind.porId.get(actual.parent_id);
    if (!p) break;
    vistos.add(p.id);
    out.push(p);
    actual = p;
  }
  return out;
}

/** Ruta legible "Tramo 1 › Estación 2" de un nodo (sin incluirlo). */
export function rutaLegible(ind: TrazIndice, id: string): string {
  return ancestros(ind, id).reverse().map((a) => a.name).join(' › ');
}

function descendientes(ind: TrazIndice, id: string): TrazNodo[] {
  const out: TrazNodo[] = [];
  const pila = [...(ind.hijos.get(id) || [])];
  while (pila.length) {
    const n = pila.pop() as TrazNodo;
    out.push(n);
    pila.push(...(ind.hijos.get(n.id) || []));
  }
  return out;
}

export function textoArchivo(f: TrazArchivo): string {
  return normalizar([f.name, f.categoria, f.rev, f.oficio, f.obs].join(' '));
}

/**
 * Ids que deben verse con el filtro activo (búsqueda y/o categoría), o null si
 * no hay filtro. Incluye los ancestros para poder llegar a cada coincidencia.
 */
export function visiblesPorFiltro(
  ind: TrazIndice, nodos: TrazNodo[], consulta: string, categoria: string | null,
): Set<string> | null {
  const q = normalizar(consulta).trim();
  if (!q && !categoria) return null;
  const visibles = new Set<string>();
  const agregarConAncestros = (id: string) => {
    visibles.add(id);
    for (const a of ancestros(ind, id)) visibles.add(a.id);
  };
  for (const [nid, lista] of ind.archivosDe) {
    if (lista.some((f) => (!categoria || f.categoria === categoria) && (!q || textoArchivo(f).includes(q)))) {
      agregarConAncestros(nid);
    }
  }
  if (q) {
    for (const n of nodos) {
      if (!normalizar(n.name).includes(q)) continue;
      agregarConAncestros(n.id);
      // Buscar por nombre de nodo muestra también lo que cuelga de él (sin categoría activa).
      if (!categoria) for (const d of descendientes(ind, n.id)) visibles.add(d.id);
    }
  }
  return visibles;
}

/** Filas visibles en orden de árbol. Con filtro (`visibles`) todo se muestra abierto. */
export function aplanar(ind: TrazIndice, abiertos: Set<string>, visibles: Set<string> | null): TrazFila[] {
  const filas: TrazFila[] = [];
  const recorrer = (padre: string | null, nivel: number) => {
    for (const n of ind.hijos.get(padre) || []) {
      if (visibles && !visibles.has(n.id)) continue;
      filas.push({ nodo: n, nivel });
      if (visibles || abiertos.has(n.id)) recorrer(n.id, nivel + 1);
    }
  };
  recorrer(null, 0);
  return filas;
}

/** Cuántos archivos hay por categoría ('' = sin categoría). */
export function conteoPorCategoria(archivos: TrazArchivo[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of archivos) m.set(f.categoria, (m.get(f.categoria) || 0) + 1);
  return m;
}

export const EXT_ICONOS: Record<string, { icono: string; color: string; etiqueta: string }> = {
  '.pdf': { icono: 'document-text', color: '#DC2626', etiqueta: 'PDF' },
  '.dwg': { icono: 'cube', color: '#0F766E', etiqueta: 'DWG' },
  '.dxf': { icono: 'cube', color: '#0F766E', etiqueta: 'DXF' },
  '.xlsx': { icono: 'grid', color: '#15803D', etiqueta: 'XLS' },
  '.xlsm': { icono: 'grid', color: '#15803D', etiqueta: 'XLS' },
  '.xls': { icono: 'grid', color: '#15803D', etiqueta: 'XLS' },
  '.csv': { icono: 'grid', color: '#15803D', etiqueta: 'CSV' },
  '.pptx': { icono: 'easel', color: '#B45309', etiqueta: 'PPT' },
  '.ppt': { icono: 'easel', color: '#B45309', etiqueta: 'PPT' },
  '.docx': { icono: 'document', color: '#1D4ED8', etiqueta: 'DOC' },
  '.doc': { icono: 'document', color: '#1D4ED8', etiqueta: 'DOC' },
};
