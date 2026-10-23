// Ayudas puras del árbol de Trazabilidad: índice por padre, conteos de documentos,
// búsqueda y aplanado de las filas visibles (el árbol real tiene ~1,500 nodos, así
// que se pinta como lista plana y no como componentes anidados).
import type { TrazNodo } from '@/src/api';

export interface TrazConteo { docs: number; conArchivo: number; validados: number; firmados: number }
export interface TrazIndice {
  porId: Map<string, TrazNodo>;
  hijos: Map<string | null, TrazNodo[]>;
  conteo: Map<string, TrazConteo>;
}
export interface TrazFila { nodo: TrazNodo; nivel: number }

export function normalizar(t: string): string {
  return (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function indexar(nodos: TrazNodo[]): TrazIndice {
  const porId = new Map<string, TrazNodo>();
  const hijos = new Map<string | null, TrazNodo[]>();
  for (const n of nodos) porId.set(n.id, n);
  for (const n of nodos) {
    // Un padre inexistente (borrado por fuera) deja al nodo en la raíz en vez de perderlo.
    const p = n.parent_id && porId.has(n.parent_id) ? n.parent_id : null;
    const lista = hijos.get(p);
    if (lista) lista.push(n); else hijos.set(p, [n]);
  }
  for (const lista of hijos.values()) {
    lista.sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
  }
  const conteo = new Map<string, TrazConteo>();
  const contar = (n: TrazNodo): TrazConteo => {
    const c: TrazConteo = n.kind === 'documento'
      ? {
        docs: 1,
        conArchivo: n.files.length > 0 ? 1 : 0,
        validados: n.fields.val_fecha ? 1 : 0,
        // "Firmado" = DIRAC ya entregó firmado (fecha) o se marcó el estatus a mano.
        firmados: n.fields.ent_fecha || n.fields.estatus === 'Firmado' ? 1 : 0,
      }
      : { docs: 0, conArchivo: 0, validados: 0, firmados: 0 };
    for (const h of hijos.get(n.id) || []) {
      const ch = contar(h);
      c.docs += ch.docs;
      c.conArchivo += ch.conArchivo;
      c.validados += ch.validados;
      c.firmados += ch.firmados;
    }
    conteo.set(n.id, c);
    return c;
  };
  for (const r of hijos.get(null) || []) contar(r);
  return { porId, hijos, conteo };
}

/** Ids del nodo y todo lo que cuelga de él. */
export function subarbol(ind: TrazIndice, id: string): Set<string> {
  const out = new Set<string>([id]);
  const pila = [id];
  while (pila.length) {
    const actual = pila.pop() as string;
    for (const h of ind.hijos.get(actual) || []) {
      out.add(h.id);
      pila.push(h.id);
    }
  }
  return out;
}

/** Cadena de ancestros (del más cercano a la raíz). */
export function ancestros(ind: TrazIndice, id: string): TrazNodo[] {
  const out: TrazNodo[] = [];
  let actual = ind.porId.get(id);
  const vistos = new Set<string>();
  while (actual && actual.parent_id && !vistos.has(actual.id)) {
    vistos.add(actual.id);
    const p = ind.porId.get(actual.parent_id);
    if (!p) break;
    out.push(p);
    actual = p;
  }
  return out;
}

export function textoBusqueda(n: TrazNodo): string {
  return normalizar([n.code, n.name, ...Object.values(n.fields), ...n.extra.map((e) => e.value),
    ...n.files.map((f) => f.name)].join(' '));
}

/**
 * Ids que deben verse al buscar: coincidencias + sus ancestros (para llegar a
 * ellas) + el contenido de las categorías/grupos que coinciden por nombre.
 */
export function visiblesPorBusqueda(ind: TrazIndice, nodos: TrazNodo[], consulta: string): Set<string> | null {
  const q = normalizar(consulta).trim();
  if (!q) return null;
  const visibles = new Set<string>();
  for (const n of nodos) {
    if (!textoBusqueda(n).includes(q)) continue;
    visibles.add(n.id);
    for (const a of ancestros(ind, n.id)) visibles.add(a.id);
    if (n.kind !== 'documento') for (const id of subarbol(ind, n.id)) visibles.add(id);
  }
  return visibles;
}

/** Filas visibles en orden de árbol. `visibles` (búsqueda) fuerza todo abierto. */
export function aplanar(
  ind: TrazIndice, abiertos: Set<string>, visibles: Set<string> | null, raiz: string | null = null,
): TrazFila[] {
  const filas: TrazFila[] = [];
  const recorrer = (padre: string | null, nivel: number) => {
    for (const n of ind.hijos.get(padre) || []) {
      if (visibles && !visibles.has(n.id)) continue;
      filas.push({ nodo: n, nivel });
      if (n.kind !== 'documento' && (visibles || abiertos.has(n.id))) recorrer(n.id, nivel + 1);
    }
  };
  const foco = raiz ? ind.porId.get(raiz) : undefined;
  if (foco) {
    // Vista de una sola rama: la categoría arriba y su contenido abierto debajo.
    filas.push({ nodo: foco, nivel: 0 });
    recorrer(foco.id, 1);
  } else {
    recorrer(null, 0);
  }
  return filas;
}

/** Contenedores a los que se puede mover un nodo (no él mismo ni su descendencia, no documentos). */
export function destinosDeMovimiento(ind: TrazIndice, nodos: TrazNodo[], id: string): TrazNodo[] {
  const excluidos = subarbol(ind, id);
  return nodos.filter((n) => n.kind !== 'documento' && !excluidos.has(n.id));
}

/** Ruta legible "A101 › Estudios › Estación E1" de un nodo (sin incluirlo). */
export function rutaLegible(ind: TrazIndice, id: string): string {
  return ancestros(ind, id).reverse().map((a) => a.code || a.name).join(' › ');
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
