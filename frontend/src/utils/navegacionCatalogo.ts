// Navegación del Catálogo de Conceptos: pestañas de la vista del nodo (C-11), ruta de
// una partida para llegar a un concepto encontrado en la búsqueda (C-10) y márgenes
// inferiores que evitan que el botón flotante tape contenido (C-15). Todo puro y probado.

export type NodoTab = 'estructura' | 'conceptos';

export interface ConteoNodo {
  /** Partidas hijas directas del nodo. */
  subniveles: number;
  /** Conceptos directos del nodo (null mientras cargan). */
  conceptos: number | null;
}

/** Pestaña con la que abre un nodo cuando el usuario aún no eligió una. Un nodo con
 * subniveles abre en "Estructura"; uno sin subniveles (una hoja) abre en "Conceptos",
 * que es donde está su contenido y donde se crea el primero. La regla solo depende de
 * los subniveles (ya cargados) para que la vista no cambie de pestaña al terminar de
 * cargar los conceptos. */
export function pestanaPorDefecto(c: Pick<ConteoNodo, 'subniveles'>): NodoTab {
  return c.subniveles > 0 ? 'estructura' : 'conceptos';
}

/** Pestaña que se muestra: la elegida por el usuario para ese nodo (o forzada por un
 * atajo, como "ver conceptos" o un resultado de búsqueda) y, si no hay, la de por defecto. */
export function resolverPestana(
  elegida: NodoTab | null | undefined,
  c: Pick<ConteoNodo, 'subniveles'>,
): NodoTab {
  return elegida ?? pestanaPorDefecto(c);
}

/** Texto del conteo de una pestaña: el número, o "…" mientras cargan los conceptos. */
export function conteoDePestana(tab: NodoTab, c: ConteoNodo): string {
  if (tab === 'estructura') return String(c.subniveles);
  return c.conceptos === null ? '…' : String(c.conceptos);
}

interface NodoConPadre {
  id: string;
  partida_padre_id?: string | null;
}

/** Ids de las partidas que hay que abrir, de la raíz al nodo `partidaId`, o null si la
 * partida no existe. Protege de ciclos y de padres que ya no existen (el camino se corta
 * en el último ancestro conocido). */
export function rutaDePartida(partidas: NodoConPadre[], partidaId: string | null | undefined): string[] | null {
  if (!partidaId) return null;
  const porId = new Map(partidas.map((p) => [p.id, p]));
  if (!porId.has(partidaId)) return null;
  const ruta: string[] = [];
  const vistos = new Set<string>();
  let actual: string | null | undefined = partidaId;
  while (actual && porId.has(actual) && !vistos.has(actual)) {
    vistos.add(actual);
    ruta.unshift(actual);
    actual = porId.get(actual)!.partida_padre_id ?? null;
  }
  return ruta;
}

/** Alturas base (px) del pie fijo y del botón flotante; con margen de seguridad. */
export const ALTO_PIE_CATALOGO = 46;
export const ALTO_BOTON_FLOTANTE = 40;
export const SEPARACION_CATALOGO = 12;

export interface MargenesCatalogo {
  /** Relleno inferior del pie fijo (deja libre la barra de gestos). */
  piePaddingBottom: number;
  /** Distancia del botón flotante al borde inferior: queda sobre el pie fijo. */
  botonBottom: number;
  /** Relleno inferior de las listas: el último elemento queda alcanzable por encima del pie y del botón. */
  listaPaddingBottom: number;
}

/** Márgenes inferiores del catálogo según el área segura del dispositivo. */
export function margenesCatalogo(insetInferior: number | null | undefined, hayBoton: boolean): MargenesCatalogo {
  const inferior = Math.max(0, Number.isFinite(insetInferior as number) ? (insetInferior as number) : 0);
  const pie = ALTO_PIE_CATALOGO + inferior;
  return {
    piePaddingBottom: SEPARACION_CATALOGO + inferior,
    botonBottom: pie + SEPARACION_CATALOGO,
    listaPaddingBottom: pie + (hayBoton ? ALTO_BOTON_FLOTANTE : 0) + SEPARACION_CATALOGO * 2,
  };
}
