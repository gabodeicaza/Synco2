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
import type { CustomModule, ModuloCategoria, ModulosConfig } from '@/src/api';
import { t } from '@/src/i18n';

export type ModuloDef = {
  key: string;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  // Nombre de ruta bajo cada grupo de rol — igual en (coord)/projects/[id]/,
  // (subcoord)/ y (spec)/ (ver app/(subcoord)/<screen>.tsx).
  // Ausente en módulos CALCULADOS (sin captura propia, ej. avance_obra): solo
  // se encienden/apagan por informe y no aparecen en el menú ni en el hub.
  screen?: string;
  // Área temática fija de la plantilla (ver nota arriba) — informativa,
  // ya no determina agrupación en ninguna pantalla.
  area: string;
  // Solo en módulos creados con el Creador de módulos: id del módulo
  // personalizado (su pantalla es siempre `modulo-personalizado` + este id).
  customId?: string;
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
    key: 'pruebas_calidad',
    label: 'Pruebas de Calidad',
    subtitle: 'Concentrado de pruebas por frente: elemento, muestra, tipo y observaciones',
    icon: 'flask-outline',
    screen: 'pruebas-calidad',
    area: 'Calidad',
  },
  {
    key: 'control_calidad',
    label: 'Control de Calidad',
    subtitle: 'Fotos de actividades de control de calidad con descripción y pie de foto',
    icon: 'camera-outline',
    screen: 'control-calidad',
    area: 'Calidad',
  },
  {
    key: 'avance_obra',
    label: 'Avance de Obra',
    subtitle: 'Programa en barras, tabla de avance por partidas y gráficas (calculado del avance capturado)',
    icon: 'stats-chart-outline',
    area: 'Ingeniería',
  },
  {
    key: 'estimaciones',
    label: 'Estimaciones',
    subtitle: 'Concentrado de estimaciones de obra y de supervisión',
    icon: 'cash-outline',
    screen: 'estimaciones',
    area: 'Ingeniería',
  },
  {
    key: 'pendientes_generales',
    label: 'Pendientes Generales',
    subtitle: 'Pendientes o requerimientos generales de obra y de supervisión',
    icon: 'list-outline',
    screen: 'pendientes-generales',
    area: 'Ingeniería',
  },
  {
    key: 'aspectos_sociales',
    label: 'Aspectos Sociales',
    subtitle: 'Dictámenes y fe notarial, y salvamento arqueológico (con gráficas)',
    icon: 'people-outline',
    screen: 'aspectos-sociales',
    area: 'Social',
  },
  {
    key: 'electromecanica',
    label: 'Electromecánica',
    subtitle: 'Avance de fabricación, suministro y montaje, documentación, pilonas y observaciones',
    icon: 'hardware-chip-outline',
    screen: 'electromecanica',
    area: 'Electromecánica',
  },
  {
    key: 'indicadores_seguridad',
    label: 'Indicadores de Seguridad',
    subtitle: 'Cumplimiento en campo, documental y PIPC (con medidor y gráficas)',
    icon: 'speedometer-outline',
    screen: 'indicadores-seguridad',
    area: 'Seguridad',
  },
  {
    key: 'actividades_particulares',
    label: 'Actividades particulares',
    subtitle: 'Actividades por estación e intertramo, con categorías y subcategorías editables',
    icon: 'list-circle-outline',
    screen: 'actividades-particulares',
    area: 'Ingeniería',
  },
  {
    key: 'supervision_ambiental',
    label: 'Supervisión Ambiental',
    subtitle: 'Informes de cumplimiento, autorizaciones, arbolado, resarcimiento y estudios (todo editable)',
    icon: 'leaf-outline',
    screen: 'supervision-ambiental',
    area: 'Ambiental',
  },
  {
    key: 'juntas_trabajo',
    label: 'Relación de Juntas de Trabajo',
    subtitle: 'Consecutivo, fecha y asunto de las minutas del periodo (calculado de Minutas)',
    icon: 'people-circle-outline',
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

export const SIN_AREA_ID = '__general__';

export type GrupoModulos = { areaId: string; nombre: string; color?: string; modulos: ModuloDef[] };

/** Agrupa los módulos activos con captura por el Área que el Coordinador les
 * asignó (`project.modulos_areas`). Solo salen las áreas que tienen módulos;
 * los que no tienen área (o cuya área ya se borró) van en "General", al final. */
export function agruparModulosPorArea(
  activos: ModuloDef[],
  asignaciones: Record<string, string> | null | undefined,
  areas: { id: string; name: string; color?: string }[],
): GrupoModulos[] {
  const porId = new Map(areas.map((a) => [a.id, a]));
  const grupos = new Map<string, GrupoModulos>();
  for (const m of activos) {
    const aid = asignaciones?.[m.key];
    const area = aid ? porId.get(aid) : undefined;
    const id = area ? area.id : SIN_AREA_ID;
    if (!grupos.has(id)) grupos.set(id, { areaId: id, nombre: area ? area.name : 'General', color: area?.color, modulos: [] });
    grupos.get(id)!.modulos.push(m);
  }
  const lista = Array.from(grupos.values());
  lista.sort((a, b) => (a.areaId === SIN_AREA_ID ? 1 : b.areaId === SIN_AREA_ID ? -1 : a.nombre.localeCompare(b.nombre, 'es')));
  return lista;
}

/** Plantillas ENCENDIDAS (en cualquier categoría) para un proyecto, en una
 * sola lista plana (orden del catálogo `MODULOS`) — sin agrupar por área.
 * Usado por el menú hamburguesa (ver HeaderMenu.tsx) para que Especialista/
 * Sub-Coordinador vean los módulos en una única sección "Módulos", igual
 * presentación que la pestaña Operación de Coordinador General
 * (index.tsx), que tampoco los separa por área. */
export function modulosActivos(modulos: ModulosConfig | null | undefined): ModuloDef[] {
  return MODULOS.filter((m) => !!m.screen && moduloActivo(modulos, m.key));
}

/** Módulos creados con el Creador de módulos → tarjetas del hub/Operación, con
 * la misma forma que las plantillas fijas (`ModuloDef`). Solo los ACTIVOS. */
export function modulosPersonalizadosDef(lista: CustomModule[] | null | undefined): ModuloDef[] {
  return (lista || []).filter((m) => m.activo).map((m) => ({
    key: m.key,
    label: m.nombre,
    subtitle: m.descripcion || `${m.campos.length} campos`,
    icon: (m.icono || 'cube-outline') as ModuloDef['icon'],
    screen: 'modulo-personalizado',
    area: 'Personalizado',
    customId: m.id,
  }));
}

/** `project.modulos_areas` + el área elegida en cada módulo personalizado. */
export function asignacionesConPersonalizados(
  asignaciones: Record<string, string> | null | undefined,
  lista: CustomModule[] | null | undefined,
): Record<string, string> {
  const out = { ...(asignaciones || {}) };
  for (const m of lista || []) if (m.area_id) out[m.key] = m.area_id;
  return out;
}
