// Nombres de nivel del Catálogo de Conceptos — configurables por proyecto
// (Project.nombres_niveles_partida / nombre_nivel_concepto, ver api.ts).
// Partida y Concepto son entidades DISTINTAS del modelo (una partida puede
// anidar N niveles vía partida_padre_id; un concepto es siempre la hoja) —
// por eso dos funciones separadas, no una sola lista con una posición
// "especial" al final. Único punto de resolución de estos nombres en toda la
// app: si el fallback se escribiera inline en cada pantalla, en la sexta
// pantalla alguien lo escribiría distinto.
//
// FALLBACK cuando el proyecto no configura nada: "Partida"/"Subpartida"/
// "Concepto" — el vocabulario que ya usaba la app antes de que el catálogo
// fuera multiproyecto. Se preserva a propósito para no cambiar el texto que
// ve cualquier proyecto EXISTENTE (ninguno tiene nombres_niveles_partida
// configurado todavía). Si el criterio de producto es que un proyecto sin
// configurar debería ver "Nivel 1"/"Nivel 2" genérico en vez de "Partida"/
// "Subpartida", es una decisión de producto que cambia el default — no algo
// que este archivo deba decidir solo.
import { Project } from '@/src/api';

const FALLBACK_NIVELES_PARTIDA = ['Partida', 'Sub-partida'];
const FALLBACK_NIVEL_CONCEPTO = 'Concepto';
const FALLBACK_TITULO_MODULO = 'Catálogo de Conceptos';

/** Nombre (singular) del nivel de Partida en `depth` (0 = raíz del catálogo).
 * Si el árbol es más profundo que los nombres configurados/fallback
 * disponibles, cae a "Nivel N" genérico — nunca trunca, nunca repite el
 * último nombre conocido. */
export function nombreNivel(project: Pick<Project, 'nombres_niveles_partida'> | null | undefined, depth: number): string {
  const configurados = project?.nombres_niveles_partida || [];
  if (configurados[depth]) return configurados[depth];
  return FALLBACK_NIVELES_PARTIDA[depth] || `Nivel ${depth + 1}`;
}

/** Nombre (singular) del nivel de Concepto (la hoja). */
export function nombreConcepto(project: Pick<Project, 'nombre_nivel_concepto'> | null | undefined): string {
  return project?.nombre_nivel_concepto || FALLBACK_NIVEL_CONCEPTO;
}

/** Título visible del módulo (pantalla, encabezado del PDF, nombre de
 * archivo exportado — sanitizar por separado en cada uno de esos tres usos
 * según lo que cada uno necesite). NO se pluraliza ni se deriva de
 * nombre_nivel_concepto — texto libre completo, o el fallback histórico. */
export function tituloModuloCatalogo(project: Pick<Project, 'titulo_modulo_catalogo'> | null | undefined): string {
  return project?.titulo_modulo_catalogo || FALLBACK_TITULO_MODULO;
}

/** Pluralización naive (+s) — exacta para los defaults en español de este
 * módulo ("Partida"→"Partidas", "Concepto"→"Conceptos"); para un nombre
 * personalizado es una aproximación razonable, no gramaticalmente perfecta
 * en todos los casos (ej. una palabra terminada en consonante). */
export function pluralizar(palabra: string): string {
  return `${palabra}s`;
}
