// Historial de "recetas" de Fuerza de Trabajo: combinaciones de personal y maquinaria que el
// ingeniero ya capturó en reportes anteriores, para reutilizarlas con un toque. No guarda nada
// aparte: se arman con los campos `personnel`/`equipment` de los reportes ya enviados.
import { normalizarNombre } from '@/src/utils/nombres';
import { claveCampo } from '@/src/utils/capturaRapidaFuerzaTrabajo';

export interface ReporteConFuerza {
  id: string;
  personnel?: string[] | null;
  equipment?: string[] | null;
  created_at: string;
  node_path_names?: string[] | null;
  is_mine?: boolean;
}

export interface EntradaReceta {
  qty: number;
  nombre: string;
}

export interface Receta {
  id: string;
  personal: EntradaReceta[];
  equipo: EntradaReceta[];
  /** Cuántos reportes distintos repitieron exactamente esta combinación. */
  veces: number;
  /** Fecha (ISO) del reporte más reciente con esta combinación. */
  ultima: string;
  /** Última ubicación (hoja) donde se usó. */
  ubicacion: string;
}

const MAX_RECETAS = 25;

/** "3 Ayudante (S2)" → { qty: 3, nombre: "Ayudante (S2)" }; sin número cuenta como 1. */
export function parseEntrada(texto: string): EntradaReceta | null {
  const limpio = (texto || '').trim();
  if (!limpio) return null;
  const m = /^(\d+)\s+(.*)$/.exec(limpio);
  const nombre = (m ? m[2] : limpio).trim();
  if (!nombre) return null;
  return { qty: m ? Math.max(1, parseInt(m[1], 10)) : 1, nombre };
}

function entradas(lista: string[] | null | undefined): EntradaReceta[] {
  return (lista || []).map(parseEntrada).filter((e): e is EntradaReceta => e !== null);
}

function firma(lista: EntradaReceta[]): string {
  return lista.map((e) => `${e.qty}|${normalizarNombre(e.nombre)}`).sort().join(';');
}

export function textoEntrada(e: EntradaReceta): string {
  return `${e.qty} ${e.nombre}`;
}

/**
 * Agrupa los reportes en recetas únicas (misma lista de personal y de equipo, mismas cantidades),
 * de la más reciente a la más antigua. Con `soloMios` se ignoran los reportes de otros autores.
 */
export function recetasDesdeReportes(
  reportes: ReporteConFuerza[],
  opciones: { soloMios?: boolean; max?: number } = {},
): Receta[] {
  const { soloMios = true, max = MAX_RECETAS } = opciones;
  const porFirma = new Map<string, Receta>();
  for (const r of reportes) {
    if (soloMios && r.is_mine === false) continue;
    const personal = entradas(r.personnel);
    const equipo = entradas(r.equipment);
    if (personal.length === 0 && equipo.length === 0) continue;
    const id = `${firma(personal)}#${firma(equipo)}`;
    const ruta = r.node_path_names || [];
    const ubicacion = ruta.length ? ruta[ruta.length - 1] : '';
    const previa = porFirma.get(id);
    if (!previa) {
      porFirma.set(id, { id, personal, equipo, veces: 1, ultima: r.created_at, ubicacion });
    } else {
      previa.veces += 1;
      if (r.created_at > previa.ultima) {
        previa.ultima = r.created_at;
        previa.ubicacion = ubicacion || previa.ubicacion;
      }
    }
  }
  return Array.from(porFirma.values())
    .sort((a, b) => (a.ultima < b.ultima ? 1 : a.ultima > b.ultima ? -1 : 0))
    .slice(0, max);
}

/** "3 personas · 2 equipos" para la tarjeta de la receta. */
export function resumenReceta(r: Receta): { personas: number; equipos: number } {
  return {
    personas: r.personal.reduce((a, e) => a + e.qty, 0),
    equipos: r.equipo.reduce((a, e) => a + e.qty, 0),
  };
}

/**
 * Pasa una receta a las cantidades de la captura rápida: solo las categorías que existen hoy en el
 * catálogo del proyecto (por nombre, sin acentos ni mayúsculas). Devuelve cuántas entradas de la
 * receta ya no tienen categoría para avisarlo.
 */
export function cantidadesDesdeReceta(
  receta: Receta,
  personal: string[],
  equipo: string[],
): { cantidades: Record<string, string>; omitidas: number } {
  const cantidades: Record<string, string> = {};
  let omitidas = 0;
  const volcar = (grupo: 'personal' | 'equipo', catalogo: string[], lista: EntradaReceta[]) => {
    for (const e of lista) {
      const clave = normalizarNombre(e.nombre);
      const i = catalogo.findIndex((c) => normalizarNombre(c) === clave);
      if (i < 0) { omitidas += 1; continue; }
      const k = claveCampo(grupo, i);
      const suma = (parseInt(cantidades[k] || '0', 10) || 0) + e.qty;
      cantidades[k] = String(suma);
    }
  };
  volcar('personal', personal, receta.personal);
  volcar('equipo', equipo, receta.equipo);
  return { cantidades, omitidas };
}
