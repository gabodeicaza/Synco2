// Dirac v2.0 _ Formateador compartido del texto completo de un reporte.
// Usado por la pantalla de exito (captura) y por las tarjetas de
// "Actividad reciente" en el feed, para que ambos luzcan IDENTICOS.
import { dayjs, CDMX_TZ } from '@/src/utils/tz';

export interface ReportTextSource {
  created_at?: string | null;
  node_path_names?: string[] | null;
  location?: { lat?: number | string; lon?: number | string; elev?: number | string } | null;
  actividades?: string | null;
  /** Semáforo de gravedad; se muestra como emoji junto a "Actividades". */
  gravedad?: string | null;
  activities?: string | null;
  observaciones?: string | null;
  incidencias?: string | null;
  personnel?: string[] | null;
  equipment?: string[] | null;
  captured_by_name?: string | null;
  /** Reporte estructurado (opcional): valores capturados por plantilla dinámica. */
  dynamic_data?: Record<string, any> | null;
  /** Campos libres del Área (p. ej. banderilleros) con su valor. */
  campos_extra?: { nombre: string; valor: number | string; unidad?: string | null }[] | null;
  /** false cuando el Área del reporte no captura Personal / Equipo. */
  captura_personal?: boolean | null;
  captura_equipo?: boolean | null;
}

export interface ReportTextOptions {
  project?: { constructora?: string | null; contract_number?: string | null } | null;
  /** Nombre a mostrar. Si se omite, usa `report.captured_by_name`. */
  authorName?: string | null;
  authorPuesto?: string | null;
  /** Si es `true`, la fecha se calcula con `dayjs()` (hoy) en vez de `created_at`. */
  useTodayAsDate?: boolean;
  /** Campos de la plantilla elegida (para mostrar label en vez de key en `dynamic_data`). */
  templateFields?: { key: string; label: string }[] | null;
}

/** Emoji del semáforo de gravedad (mismo mapa que el backend, `_GRAVEDAD_EMOJI`). */
export const GRAVEDAD_EMOJI: Record<string, string> = { verde: '🟢', amarillo: '🟡', rojo: '🔴' };

/** Formatea un valor de `dynamic_data` para texto plano (booleanos → Sí/No, listas → join). */
export function formatDynamicValue(v: any): string {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '-';
  return String(v);
}

/** Construye el string completo y formateado de un reporte (identico al de la pantalla de exito). */
export function buildReportShareText(report: ReportTextSource, opts: ReportTextOptions = {}): string {
  const { project, authorPuesto, useTodayAsDate, templateFields } = opts;
  const authorName = opts.authorName ?? report.captured_by_name ?? '';

  const fecha = useTodayAsDate
    ? dayjs().tz(CDMX_TZ).format('D [de] MMMM [de] YYYY')
    : dayjs.utc(report.created_at || undefined).tz(CDMX_TZ).format('D [de] MMMM [de] YYYY');

  // La ubicación es SOLO el nombre del frente/nodo elegido (ej. "Estación 7"):
  // sin la ruta del tramo ("Tramo 2: …") ni coordenadas ("Ubicacion: 0, 0 _ Z 0").
  const pathNames = report.node_path_names || [];
  const leafPart = pathNames[pathNames.length - 1] || '';

  const activitiesText = report.actividades || report.activities || '';

  const sections: string[] = [];
  sections.push(`${fecha}.\n${authorName || ''}\n${authorPuesto || ''}`);
  sections.push(`Constructora: ${project?.constructora || ''}\nNo de contrato: ${project?.contract_number || ''}`);
  if (leafPart) sections.push(leafPart);

  if (activitiesText) sections.push(`*Actividades:*${GRAVEDAD_EMOJI[report.gravedad || ''] || GRAVEDAD_EMOJI.verde}\n${activitiesText}`);

  // Datos del reporte (plantilla dinámica): va justo después de la
  // ubicación y de las actividades (si las hay), antes de observaciones/
  // incidencias/personal/equipo.
  const dynamicData = report.dynamic_data || {};
  const dynamicKeys = Object.keys(dynamicData);
  if (dynamicKeys.length > 0) {
    const labelFor = (key: string) => templateFields?.find((f) => f.key === key)?.label || key;
    const lines = dynamicKeys.map((k) => `${labelFor(k)}: ${formatDynamicValue(dynamicData[k])}`);
    sections.push(`*Datos del reporte:*\n${lines.join('\n')}`);
  }

  if (report.observaciones) sections.push(`*Observaciones:*\n${report.observaciones}`);
  if (report.incidencias) sections.push(`Incidencias:\n${report.incidencias}`);

  if (report.captura_personal !== false) sections.push(`Personal:\n${(report.personnel || []).join('\n') || '-'}`);
  if (report.captura_equipo !== false) sections.push(`Equipo:\n${(report.equipment || []).join('\n') || '-'}`);
  const extras = report.campos_extra || [];
  if (extras.length > 0) {
    sections.push(extras.map((c) => `${c.nombre}: ${c.valor}${c.unidad ? ` ${c.unidad}` : ''}`).join('\n'));
  }

  return sections.join('\n\n');
}
