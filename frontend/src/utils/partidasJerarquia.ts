// Filtro por partida jerárquico (A-09). Las partidas forman un árbol (partida_padre_id, N niveles).
// Elegir una partida incluye todo lo que contiene (el servidor filtra con toda la descendencia),
// así que la interfaz la muestra por niveles: primero las raíces y, a partir de la elegida, sus
// hijas fila por fila. Funciones puras, sin React.
import { sortByClave } from '@/src/utils/claveComparator';

export interface PartidaArbol {
  id: string;
  clave: string;
  nombre: string;
  partida_padre_id?: string | null;
}

export interface ChipPartida {
  id: string;
  clave: string;
  nombre: string;
  /** Está en la ruta de la partida elegida (ella misma o uno de sus ancestros). */
  enRuta: boolean;
  /** Es exactamente la partida elegida. */
  elegida: boolean;
  /** Tiene subpartidas. */
  tieneHijas: boolean;
}

export interface FilaChips {
  /** 0 = raíces. */
  nivel: number;
  chips: ChipPartida[];
}

function hijasPorPadre<T extends PartidaArbol>(partidas: T[]): Map<string | null, T[]> {
  const ids = new Set(partidas.map((p) => p.id));
  const mapa = new Map<string | null, T[]>();
  for (const p of partidas) {
    // Un padre que ya no está en la lista (borrada o inactiva) deja a la partida como raíz.
    const padre = p.partida_padre_id && ids.has(p.partida_padre_id) ? p.partida_padre_id : null;
    const lista = mapa.get(padre) ?? [];
    lista.push(p);
    mapa.set(padre, lista);
  }
  for (const [k, lista] of mapa) mapa.set(k, sortByClave(lista));
  return mapa;
}

/** Ancestros de `id` (de la raíz hacia abajo) más la propia partida; [] si no existe. */
export function rutaDePartida(partidas: PartidaArbol[], id: string | null): string[] {
  if (!id) return [];
  const porId = new Map(partidas.map((p) => [p.id, p]));
  const ruta: string[] = [];
  const vistos = new Set<string>();
  let actual: string | null | undefined = id;
  while (actual && porId.has(actual) && !vistos.has(actual)) {
    vistos.add(actual);
    ruta.unshift(actual);
    actual = porId.get(actual)!.partida_padre_id;
  }
  return ruta;
}

/** Filas de chips por nivel: raíces, y luego las hijas de cada partida de la ruta elegida. */
export function filasDeChips(partidas: PartidaArbol[], elegidaId: string | null): FilaChips[] {
  const hijas = hijasPorPadre(partidas);
  const ruta = rutaDePartida(partidas, elegidaId);
  const enRuta = new Set(ruta);
  const aChip = (p: PartidaArbol): ChipPartida => ({
    id: p.id, clave: p.clave, nombre: p.nombre,
    enRuta: enRuta.has(p.id), elegida: p.id === elegidaId, tieneHijas: (hijas.get(p.id) ?? []).length > 0,
  });

  const filas: FilaChips[] = [];
  const raices = hijas.get(null) ?? [];
  if (raices.length > 0) filas.push({ nivel: 0, chips: raices.map(aChip) });
  ruta.forEach((id, i) => {
    const hijasDe = hijas.get(id) ?? [];
    if (hijasDe.length > 0) filas.push({ nivel: i + 1, chips: hijasDe.map(aChip) });
  });
  return filas;
}

/** Qué partida queda elegida al tocar `tocadaId`: la misma la desmarca y sube un nivel (o quita el filtro en la raíz). */
export function alTocarPartida(partidas: PartidaArbol[], elegidaId: string | null, tocadaId: string): string | null {
  if (tocadaId !== elegidaId) return tocadaId;
  const ruta = rutaDePartida(partidas, tocadaId);
  return ruta.length >= 2 ? ruta[ruta.length - 2] : null;
}

/** Lista plana en orden de árbol con su profundidad (para sangrar una lista vertical). */
export function partidasEnOrdenDeArbol<T extends PartidaArbol>(partidas: T[]): Array<{ partida: T; nivel: number }> {
  const hijas = hijasPorPadre(partidas);
  const salida: Array<{ partida: T; nivel: number }> = [];
  const visitar = (padre: string | null, nivel: number, vistos: Set<string>) => {
    for (const p of hijas.get(padre) ?? []) {
      if (vistos.has(p.id)) continue; // protege de ciclos
      salida.push({ partida: p, nivel });
      visitar(p.id, nivel + 1, new Set([...vistos, p.id]));
    }
  };
  visitar(null, 0, new Set());
  return salida;
}
