// Sistema Multi-Proyecto Modular — catálogo de plantillas del lado del
// frontend. Espejo de MODULOS_CATALOG en backend/server.py: agregar una
// plantilla nueva requiere declararla en AMBOS lados (aquí para que la
// pantalla de configuración y el menú hamburguesa sepan pintarla; en el
// backend para que la sanitización de `modulos` no la descarte).
//
// Dos ejes de clasificación independientes, cada uno con su propio uso:
//   - `categoria` (cadencia de captura: Diario/Semanal/Mensual) — organiza
//     la pantalla de configuración del Coordinador (ver
//     app/(coord)/projects/[id]/modulos.tsx) y sigue viviendo en el backend
//     (`modulos.reportes_diarios/semanales/mensuales`).
//   - `area` (disciplina: Ambiental, Seguridad...) — organiza el MENÚ
//     hamburguesa (ver HeaderMenu.tsx). Es un tag fijo del catálogo, NO la
//     lista de Áreas/Disciplinas configurable por proyecto
//     (`/projects/{pid}/areas`, ej. "Topografía, Geotecnia..."): esa lista
//     varía libremente por proyecto y no garantiza tener "Ambiental" o
//     "Seguridad", así que amarrar el menú a ella sería frágil.
import type { Ionicons } from '@expo/vector-icons';
import type { ModuloCategoria, ModulosConfig } from '@/src/api';

export type ModuloDef = {
  key: string;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  // Nombre de ruta bajo cada grupo de rol — igual en (coord)/projects/[id]/,
  // (subcoord)/ y (spec)/ (ver app/(subcoord)/<screen>.tsx).
  screen: string;
  // Área temática fija de la plantilla (ver nota arriba). Determina el
  // encabezado bajo el que aparece en el menú hamburguesa.
  area: string;
};

export const MODULOS_CATALOG: Record<ModuloCategoria, ModuloDef[]> = {
  reportes_diarios: [
    {
      key: 'seguridad_higiene',
      label: 'Seguridad e Higiene',
      subtitle: 'Reporte de accidentes y checklist preventivo/correctivo',
      icon: 'shield-checkmark-outline',
      screen: 'seguridad-higiene',
      area: 'Seguridad',
    },
  ],
  reportes_semanales: [
    {
      key: 'forestal_arbolado',
      label: 'Forestal y Arbolado',
      subtitle: 'Podas, trasplantes y derribos por estación',
      icon: 'leaf-outline',
      screen: 'forestal-arbolado',
      area: 'Ambiental',
    },
  ],
  reportes_mensuales: [],
};

export const CATEGORIA_LABEL: Record<ModuloCategoria, string> = {
  reportes_diarios: 'Diario',
  reportes_semanales: 'Semanal',
  reportes_mensuales: 'Mensual',
};

export const CATEGORIA_ORDEN: ModuloCategoria[] = ['reportes_diarios', 'reportes_semanales', 'reportes_mensuales'];

// Orden fijo de áreas conocidas — evita que el menú reordene encabezados
// entre sesiones a medida que se activan/desactivan módulos. Un área nueva
// que no esté aquí se agrega al final, en orden alfabético.
export const AREAS_ORDEN: string[] = ['Ambiental', 'Seguridad'];

/** Todas las plantillas del catálogo, sin importar su cadencia — para
 * recorrer/filtrar por área sin repetir la iteración de MODULOS_CATALOG. */
export function todosLosModulos(): ModuloDef[] {
  return CATEGORIA_ORDEN.flatMap((categoria) => MODULOS_CATALOG[categoria]);
}

/** Agrupa las plantillas ENCENDIDAS para un proyecto por área temática,
 * en el orden de AREAS_ORDEN (áreas no listadas ahí van al final,
 * alfabéticamente). Usado por el menú hamburguesa — ver HeaderMenu.tsx. */
export function modulosActivosPorArea(modulos: ModulosConfig | null | undefined): { area: string; modulos: ModuloDef[] }[] {
  const activos = todosLosModulos().filter((m) => {
    const categoria = CATEGORIA_ORDEN.find((c) => MODULOS_CATALOG[c].includes(m))!;
    return !!modulos?.[categoria]?.[m.key];
  });
  const porArea = new Map<string, ModuloDef[]>();
  for (const m of activos) {
    if (!porArea.has(m.area)) porArea.set(m.area, []);
    porArea.get(m.area)!.push(m);
  }
  const areasPresentes = Array.from(porArea.keys());
  areasPresentes.sort((a, b) => {
    const ia = AREAS_ORDEN.indexOf(a);
    const ib = AREAS_ORDEN.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  return areasPresentes.map((area) => ({ area, modulos: porArea.get(area)! }));
}
