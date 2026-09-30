// Sistema Multi-Proyecto Modular — catálogo de plantillas del lado del
// frontend. Espejo de MODULOS_KEYS en backend/server.py: agregar una
// plantilla nueva requiere declararla en AMBOS lados (aquí para que la
// pantalla de configuración y el menú hamburguesa sepan pintarla; en el
// backend para que la sanitización de `modulos` no la descarte).
//
// Cada plantilla puede encenderse INDEPENDIENTEMENTE en cualquiera de las 3
// categorías de informe (Diario/Semanal/Mensual, ver CATEGORIA_ORDEN) — ya
// no vive bajo una única cadencia fija. El Coordinador decide, por módulo y
// por informe, si quiere ver ahí el recuento de actividades (pantalla de
// configuración, ver app/(coord)/projects/[id]/modulos.tsx).
//
// `area` (disciplina: Ambiental, Seguridad...) es un tag fijo del catálogo,
// NO la lista de Áreas/Disciplinas configurable por proyecto
// (`/projects/{pid}/areas`, ej. "Topografía, Geotecnia..."): esa lista
// varía libremente por proyecto y no garantiza tener "Ambiental" o
// "Seguridad". Ya no se usa para agrupar el menú hamburguesa (ver
// `modulosActivos` — una sola sección plana, sin encabezados por área);
// se conserva por si alguna pantalla lo necesita para otra cosa.
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
  // Área temática fija de la plantilla (ver nota arriba) — informativa,
  // ya no determina agrupación en ninguna pantalla.
  area: string;
};

export const MODULOS: ModuloDef[] = [
  {
    key: 'seguridad_higiene',
    label: 'Seguridad e Higiene',
    subtitle: 'Reporte de accidentes y checklist preventivo/correctivo',
    icon: 'shield-checkmark-outline',
    screen: 'seguridad-higiene',
    area: 'Seguridad',
  },
  {
    key: 'forestal_arbolado',
    label: 'Forestal y Arbolado',
    subtitle: 'Podas, trasplantes y derribos por estación',
    icon: 'leaf-outline',
    screen: 'forestal-arbolado',
    area: 'Ambiental',
  },
  {
    key: 'gestion_riesgos',
    label: 'Gestión de Riesgos',
    subtitle: 'Matriz de riesgos por estación/poste y propuesta de control',
    icon: 'warning-outline',
    screen: 'gestion-riesgos',
    area: 'Riesgos',
  },
  {
    key: 'estudios_proyecto',
    label: 'Estudios y Proyecto Ejecutivo',
    subtitle: 'Avance por disciplina y bitácora de campo',
    icon: 'document-text-outline',
    screen: 'estudios-proyecto',
    area: 'Ingeniería',
  },
  {
    key: 'impacto_ambiental',
    label: 'Impacto Ambiental',
    subtitle: 'Auditoría de cumplimientos e incumplimientos',
    icon: 'earth-outline',
    screen: 'impacto-ambiental',
    area: 'Ambiental',
  },
  {
    key: 'tabla_resumen',
    label: 'Tabla Resumen',
    subtitle: 'Avance acumulado por estación e inter-tramos (%), armable desde cero',
    icon: 'grid-outline',
    screen: 'tabla-resumen',
    area: 'Ingeniería',
  },
  {
    key: 'fotos_lidar',
    label: 'Fotos LiDAR',
    subtitle: 'Foto original y foto actual por frente, reemplazables',
    icon: 'images-outline',
    screen: 'fotos-lidar',
    area: 'Ingeniería',
  },
  {
    key: 'tapial',
    label: 'Tapial',
    subtitle: 'Avance de tapial por tramos sobre plano (con discontinuidades)',
    icon: 'git-branch-outline',
    screen: 'tapial',
    area: 'Ingeniería',
  },
  {
    key: 'estado_tiempo',
    label: 'Estado del Tiempo',
    subtitle: 'Temperatura, viento, precipitación y calidad del aire por estación',
    icon: 'partly-sunny-outline',
    screen: 'estado-tiempo',
    area: 'Ingeniería',
  },
  {
    key: 'control_obra',
    label: 'Control de Obra',
    subtitle: 'Avance de postes, cimentación y perforadoras',
    icon: 'construct-outline',
    screen: 'control-obra',
    area: 'Ingeniería',
  },
];

export const CATEGORIA_LABEL: Record<ModuloCategoria, string> = {
  reportes_diarios: 'Diario',
  reportes_semanales: 'Semanal',
  reportes_mensuales: 'Mensual',
};

export const CATEGORIA_ORDEN: ModuloCategoria[] = ['reportes_diarios', 'reportes_semanales', 'reportes_mensuales'];

/** ¿Está encendido este módulo en AL MENOS UNA de las 3 categorías de
 * informe? Es el criterio de "el módulo está activo para este proyecto" —
 * controla acceso de captura y visibilidad en el menú hamburguesa. Cuál
 * categoría específica está prendida solo importa para decidir en qué
 * informe exportado aparece el recuento (ver backend
 * `_modulos_categoria_para_export`), no para esta pregunta. */
export function moduloActivo(modulos: ModulosConfig | null | undefined, key: string): boolean {
  return CATEGORIA_ORDEN.some((categoria) => !!modulos?.[categoria]?.[key]);
}

/** Plantillas ENCENDIDAS (en cualquier categoría) para un proyecto, en una
 * sola lista plana (orden del catálogo `MODULOS`) — sin agrupar por área.
 * Usado por el menú hamburguesa (ver HeaderMenu.tsx) para que Especialista/
 * Sub-Coordinador vean los módulos en una única sección "Módulos", igual
 * presentación que la pestaña Operación de Coordinador General
 * (index.tsx), que tampoco los separa por área. */
export function modulosActivos(modulos: ModulosConfig | null | undefined): ModuloDef[] {
  return MODULOS.filter((m) => moduloActivo(modulos, m.key));
}
