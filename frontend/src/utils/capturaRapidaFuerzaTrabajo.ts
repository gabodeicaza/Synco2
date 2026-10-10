// Captura rápida de Fuerza de Trabajo (R-02): reporte mínimo con solo Personal y Equipo
// elegidos del catálogo del proyecto, con su cantidad. Aquí vive la lógica pura (catálogos,
// ubicaciones y validación) para probarla sin renderizar nada.
import type { LocationNodeTree } from '@/src/api';
import { t } from '@/src/i18n';
import { normalizarNombre } from '@/src/utils/nombres';
import { mensajeNumeroInvalido, parseNumeroEntrada } from '@/src/utils/numeros';

// Mismas llaves de almacenamiento local que usa "Nuevo reporte" (app/(spec)/nuevo.tsx):
// lo capturado allí alimenta también este catálogo.
export const CATALOGO_PERSONAL_KEY = 'syncsite_catalog_personal';
export const CATALOGO_EQUIPO_KEY = 'syncsite_catalog_equipo';

const PACK_SEP = ' :: ';

function nombreDeEquipo(item: unknown): string {
  if (typeof item === 'string') return item.split(PACK_SEP)[0].trim();
  const nombre = (item as any)?.nombre;
  return typeof nombre === 'string' ? nombre.trim() : '';
}

function sinRepetidos(nombres: string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const n of nombres) {
    const clave = normalizarNombre(n);
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(n);
  }
  return salida;
}

/** Categorías de personal: las del proyecto primero y luego las capturadas antes en este teléfono. */
export function categoriasPersonal(proyecto: string[] | null | undefined, locales: unknown[] | null | undefined): string[] {
  const todas = [...(proyecto || []), ...(locales || [])].map((x) => (typeof x === 'string' ? x.trim() : nombreDeEquipo(x)));
  return sinRepetidos(todas);
}

/** Categorías de equipo. El catálogo del proyecto empaqueta "Nombre :: Marca :: Modelo :: Serie": aquí solo importa el nombre. */
export function categoriasEquipo(proyecto: unknown[] | null | undefined, locales: unknown[] | null | undefined): string[] {
  return sinRepetidos([...(proyecto || []), ...(locales || [])].map(nombreDeEquipo));
}

export interface HojaConRuta {
  id: string;
  nombre: string;
  ruta: string;
}

/** Nodos hoja del árbol con su ruta ("Tramo › Hoja"). Si el usuario tiene ubicaciones asignadas, solo esas. */
export function hojasConRuta(arbol: LocationNodeTree[], permitidas?: string[] | null): HojaConRuta[] {
  const solo = permitidas && permitidas.length > 0 ? new Set(permitidas) : null;
  const salida: HojaConRuta[] = [];
  const recorrer = (nodos: LocationNodeTree[], ruta: string[]) => {
    for (const n of nodos) {
      const actual = [...ruta, n.name];
      if (n.is_leaf) {
        if (!solo || solo.has(n.id)) salida.push({ id: n.id, nombre: n.name, ruta: actual.join(' › ') });
      }
      if (n.children?.length) recorrer(n.children, actual);
    }
  };
  recorrer(arbol || [], []);
  return salida;
}

export function filtrarHojas(hojas: HojaConRuta[], texto: string): HojaConRuta[] {
  const buscado = normalizarNombre(texto);
  if (!buscado) return hojas;
  return hojas.filter((h) => normalizarNombre(h.ruta).includes(buscado));
}

export type GrupoCategoria = 'personal' | 'equipo';

export function claveCampo(grupo: GrupoCategoria, indice: number): string {
  return `${grupo}:${indice}`;
}

export interface EntradaCapturaRapida {
  nodeId: string | null;
  personal: string[];
  equipo: string[];
  /** Texto capturado por categoría, con la clave de `claveCampo`. */
  cantidades: Record<string, string>;
}

export interface ResultadoCapturaRapida {
  errores: Record<string, string>;
  /** Formato "4 Albañiles", el mismo que guarda "Nuevo reporte". */
  personnel: string[];
  equipment: string[];
}

export function validarCapturaRapida(e: EntradaCapturaRapida): ResultadoCapturaRapida {
  const errores: Record<string, string> = {};
  const personnel: string[] = [];
  const equipment: string[] = [];
  if (!e.nodeId) errores.ubicacion = t('fuerzaTrabajo.errorUbicacion');

  const revisar = (grupo: GrupoCategoria, nombres: string[], destino: string[]) => {
    nombres.forEach((nombre, i) => {
      const clave = claveCampo(grupo, i);
      const texto = (e.cantidades[clave] || '').trim();
      if (!texto) return;
      const r = parseNumeroEntrada(texto, { maxDecimales: 0 });
      const valida = r.ok && r.valor !== '0' && !r.valor.startsWith('-');
      if (!valida) {
        errores[clave] = r.ok || r.motivo === 'vacio'
          ? t('fuerzaTrabajo.cantidadEntera', { nombre })
          : r.motivo === 'decimales'
            ? mensajeNumeroInvalido('decimales', 0, nombre)
            : t('fuerzaTrabajo.cantidadEntera', { nombre });
        return;
      }
      destino.push(`${r.valor} ${nombre}`);
    });
  };
  revisar('personal', e.personal, personnel);
  revisar('equipo', e.equipo, equipment);

  if (personnel.length === 0 && equipment.length === 0 && Object.keys(errores).every((k) => k === 'ubicacion')) {
    errores.cantidades = t('fuerzaTrabajo.sinCantidades');
  }
  return { errores, personnel, equipment };
}
