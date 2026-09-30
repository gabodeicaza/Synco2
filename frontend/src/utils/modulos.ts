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
import { t } from '@/src/i18n';

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
    label: t('modulosObra.modulos.seguridadHigiene.titulo'),
    subtitle: t('modulosObra.modulos.seguridadHigiene.subtitulo'),
    icon: 'shield-checkmark-outline',
    screen: 'seguridad-higiene',
    area: 'Seguridad',
  },
  {
    key: 'forestal_arbolado',
    label: t('modulosObra.modulos.forestalArbolado.titulo'),
    subtitle: t('modulosObra.modulos.forestalArbolado.subtitulo'),
    icon: 'leaf-outline',
    screen: 'forestal-arbolado',
    area: 'Ambiental',
  },
  {
    key: 'gestion_riesgos',
    label: t('modulosObra.modulos.gestionRiesgos.titulo'),
    subtitle: t('modulosObra.modulos.gestionRiesgos.subtitulo'),
    icon: 'warning-outline',
    screen: 'gestion-riesgos',
    area: 'Riesgos',
  },
  {
    key: 'estudios_proyecto',
    label: t('modulosObra.modulos.estudiosProyecto.titulo'),
    subtitle: t('modulosObra.modulos.estudiosProyecto.subtitulo'),
    icon: 'document-text-outline',
    screen: 'estudios-proyecto',
    area: 'Ingeniería',
  },
  {
    key: 'impacto_ambiental',
    label: t('modulosObra.modulos.impactoAmbiental.titulo'),
    subtitle: t('modulosObra.modulos.impactoAmbiental.subtitulo'),
    icon: 'earth-outline',
    screen: 'impacto-ambiental',
    area: 'Ambiental',
  },
  {
    key: 'tabla_resumen',
    label: t('modulosObra.modulos.tablaResumen.titulo'),
    subtitle: t('modulosObra.modulos.tablaResumen.subtitulo'),
    icon: 'grid-outline',
    screen: 'tabla-resumen',
    area: 'Ingeniería',
  },
  {
    key: 'estado_tiempo',
    label: t('modulosObra.modulos.estadoTiempo.titulo'),
    subtitle: t('modulosObra.modulos.estadoTiempo.subtitulo'),
    icon: 'partly-sunny-outline',
    screen: 'estado-tiempo',
    area: 'Ingeniería',
  },
  {
    key: 'control_obra',
    label: t('modulosObra.modulos.controlObra.titulo'),
    subtitle: t('modulosObra.modulos.controlObra.subtitulo'),
    icon: 'construct-outline',
    screen: 'control-obra',
    area: 'Ingeniería',
  },
];

export const CATEGORIA_LABEL: Record<ModuloCategoria, string> = {
  reportes_diarios: t('modulosObra.categoriaDiario'),
  reportes_semanales: t('modulosObra.categoriaSemanal'),
  reportes_mensuales: t('modulosObra.categoriaMensual'),
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
