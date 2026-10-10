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

// === C-14: género y plural del nombre de un nivel ===========================
// Espejo de `genero_nombre_es`, `pluralizar_es`, `articulo_es` y `demostrativo_es` de
// backend/server.py: las MISMAS reglas para que un texto de la app y un mensaje del
// servidor concuerden ("Nueva partida" / "Ya existe una partida…", "Nuevo tramo" /
// "Ya existe un tramo…"). El proyecto puede forzar el género de un nombre con
// `Project.genero_niveles` (clave = nombre del nivel); sin clave se deduce de la palabra.
export type Genero = 'm' | 'f';

const MASCULINOS_EN_A = new Set([
  'día', 'dia', 'mapa', 'planeta', 'sistema', 'programa', 'problema', 'tema', 'clima', 'idioma',
  'poema', 'esquema', 'diagrama', 'emblema', 'teorema', 'síntoma', 'sintoma', 'cometa', 'pijama',
]);
const FEMENINOS_ESPECIALES = new Set([
  'mano', 'serie', 'especie', 'superficie', 'calle', 'base', 'clase', 'fase', 'parte', 'torre',
  'tesis', 'crisis', 'noche', 'tarde', 'sede', 'red', 'pared', 'sal', 'luz', 'cruz', 'voz',
]);
const A_TONICA = new Set(['área', 'area', 'agua', 'aula', 'arma', 'alma', 'hacha', 'águila', 'aguila', 'ancla', 'arca']);
const PREPOSICIONES = new Set(['de', 'del', 'en', 'con', 'para', 'por']);

function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Palabra que decide el género: la primera ("Obra civil" → "obra"); en un compuesto con
 * guion, la última ("Sub-partida" → "partida"). */
function palabraNucleo(nombre: string): string {
  const primera = (nombre || '').trim().split(/\s+/)[0] || '';
  const partes = primera.split('-');
  return partes[partes.length - 1].toLowerCase();
}

/** Género forzado por el proyecto para `nombre` (sin distinguir mayúsculas), o undefined. */
export function generoForzado(
  project: Pick<Project, 'genero_niveles'> | null | undefined, nombre: string,
): Genero | undefined {
  const mapa = project?.genero_niveles;
  if (!mapa) return undefined;
  const buscado = (nombre || '').trim().toLowerCase();
  for (const [clave, valor] of Object.entries(mapa)) {
    if (clave.trim().toLowerCase() === buscado && (valor === 'm' || valor === 'f')) return valor;
  }
  return undefined;
}

/** 'm' o 'f' para un nombre de nivel. Heurística por terminación con excepciones; `forzado`
 * (de `generoForzado`) manda sobre ella. */
export function generoNombre(nombre: string, forzado?: Genero): Genero {
  if (forzado) return forzado;
  const p = palabraNucleo(nombre);
  if (!p) return 'm';
  if (FEMENINOS_ESPECIALES.has(p)) return 'f';
  if (MASCULINOS_EN_A.has(p)) return 'm';
  const sin = sinAcentos(p);
  if (/(a|cion|sion|xion|dad|tad|tud|umbre|ie)$/.test(sin)) return 'f';
  return 'm';
}

function pluralPalabra(w: string): string {
  const low = w.toLowerCase();
  if (!low) return w;
  const ultima = low[low.length - 1];
  if (low.endsWith('z')) return `${w.slice(0, -1)}ces`;
  if ('aeiouáéó'.includes(ultima)) return `${w}s`;
  if ('íú'.includes(ultima)) return `${w}es`;
  if (low.endsWith('s')) {
    const gruposVocales = low.match(/[aeiouáéíóúü]+/g) || [];
    const penultima = low.length >= 2 ? low[low.length - 2] : '';
    const acentuadaFinal = 'áéíóú'.includes(penultima) && penultima !== '';
    if (gruposVocales.length <= 1) return `${w}es`;
    if (acentuadaFinal) {
      // 'país' → 'países'; 'autobús' → 'autobuses'; 'inglés' → 'ingleses'.
      const base = penultima === 'í' ? w : `${w.slice(0, -2)}${sinAcentos(w[w.length - 2])}s`;
      return `${base}es`;
    }
    return w; // 'crisis', 'lunes': sílaba final átona, sin cambio
  }
  if (low.endsWith('n') && low.length >= 2 && 'áéíóú'.includes(low[low.length - 2])) {
    return `${w.slice(0, -2)}${sinAcentos(w[w.length - 2])}nes`; // 'estación' → 'estaciones'
  }
  return `${w}es`;
}

/** Plural regular del español para un nombre de nivel: 'nivel' → 'niveles', 'estación' →
 * 'estaciones', 'luz' → 'luces', 'crisis' → 'crisis', 'partida' → 'partidas'. En una frase con
 * 'de/del/en/con/para/por' se pluraliza el primer nombre ('etapa de obra' → 'etapas de obra');
 * si no, la última palabra. Conserva las mayúsculas del original. */
export function pluralizarEs(nombre: string): string {
  const texto = (nombre || '').trim();
  if (!texto) return '';
  const tokens = texto.split(/\s+/);
  // Nombre genérico con número ("Nivel 3"): el plural es el del sustantivo, sin el número
  // ("Niveles"); nunca "Nivel 3s".
  while (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1])) tokens.pop();
  let idx = tokens.length - 1;
  for (let k = 1; k < tokens.length; k += 1) {
    if (PREPOSICIONES.has(tokens[k].toLowerCase())) { idx = k - 1; break; }
  }
  const partes = tokens[idx].split('-');
  partes[partes.length - 1] = pluralPalabra(partes[partes.length - 1]);
  tokens[idx] = partes.join('-');
  return tokens.join(' ');
}

/** Alias histórico de `pluralizarEs` (antes solo agregaba "s": "nivel" → "nivels"). */
export const pluralizar = pluralizarEs;

/** Artículo que concuerda con el nombre: el/la/los/las (definido) o un/una/unos/unas.
 * "el área" / "un área" (a tónica) aunque el género sea femenino. */
export function articulo(
  nombre: string, opciones: { definido?: boolean; plural?: boolean; forzado?: Genero } = {},
): string {
  const { definido = true, plural = false, forzado } = opciones;
  const g = generoNombre(nombre, forzado);
  if (plural) return definido ? (g === 'm' ? 'los' : 'las') : (g === 'm' ? 'unos' : 'unas');
  if (g === 'f' && A_TONICA.has(palabraNucleo(nombre))) return definido ? 'el' : 'un';
  return definido ? (g === 'm' ? 'el' : 'la') : (g === 'm' ? 'un' : 'una');
}

/** Formas concordadas de un nombre de nivel, listas para usar como variables de i18n:
 * `t('nivelesGenero.nuevo', { nuevo: c.nuevo, nivel })` → "Nuevo tramo" / "Nueva partida". */
export interface Concordancia {
  genero: Genero;
  /** minúscula del nombre y su plural */
  minuscula: string;
  plural: string;
  /** el / la */
  el: string;
  /** El / La (inicio de oración) */
  El: string;
  /** un / una */
  un: string;
  /** este / esta */
  este: string;
  /** Este / Esta (inicio de oración) */
  Este: string;
  /** ningún / ninguna */
  ningun: string;
  /** Nuevo / Nueva */
  nuevo: string;
  /** creado / creada */
  creado: string;
  /** borrado / borrada */
  borrado: string;
  /** los / las */
  los: string;
  /** estos / estas */
  estos: string;
}

export function concordancia(nombre: string, forzado?: Genero): Concordancia {
  const genero = generoNombre(nombre, forzado);
  const m = genero === 'm';
  return {
    genero,
    minuscula: (nombre || '').toLowerCase(),
    plural: pluralizarEs((nombre || '').toLowerCase()),
    el: articulo(nombre, { forzado }),
    El: articulo(nombre, { forzado }).charAt(0).toUpperCase() + articulo(nombre, { forzado }).slice(1),
    un: articulo(nombre, { definido: false, forzado }),
    este: m ? 'este' : 'esta',
    Este: m ? 'Este' : 'Esta',
    ningun: m ? 'ningún' : 'ninguna',
    nuevo: m ? 'Nuevo' : 'Nueva',
    creado: m ? 'creado' : 'creada',
    borrado: m ? 'borrado' : 'borrada',
    los: m ? 'los' : 'las',
    estos: m ? 'estos' : 'estas',
  };
}

/** Concordancia del nivel de Partida en `depth` con el nombre y género configurados del proyecto. */
export function concordanciaNivel(
  project: Pick<Project, 'nombres_niveles_partida' | 'genero_niveles'> | null | undefined, depth: number,
): Concordancia & { nombre: string } {
  const nombre = nombreNivel(project, depth);
  return { nombre, ...concordancia(nombre, generoForzado(project, nombre)) };
}

/** Concordancia del nivel de Concepto (la hoja) con el nombre y género configurados del proyecto. */
export function concordanciaConcepto(
  project: Pick<Project, 'nombre_nivel_concepto' | 'genero_niveles'> | null | undefined,
): Concordancia & { nombre: string } {
  const nombre = nombreConcepto(project);
  return { nombre, ...concordancia(nombre, generoForzado(project, nombre)) };
}
