// SynCo v2.0 — Generador del "Modo WhatsApp".
// Construye el texto exacto que el Especialista copia al portapapeles tras
// finalizar una captura, listo para pegar en WhatsApp.

const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function formatDateLongES(d: Date = new Date()): string {
  const day = d.getDate();
  const month = MESES_ES[d.getMonth()];
  const year = d.getFullYear();
  return `${day} de ${month} de ${year}.`;
}

/**
 * Convierte un measurement_value y su measurement_type en texto legible para
 * la línea "Ubicación:" del reporte WhatsApp.
 */
export function formatMeasurementValue(
  measurementType: string,
  value: Record<string, any> | null | undefined,
): string {
  if (!value) return '—';
  switch (measurementType) {
    case 'coord_latlon': {
      const lat = Number(value.lat);
      const lon = Number(value.lon);
      const elev = Number(value.elev);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const base = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        return Number.isFinite(elev) ? `${base} · Z ${elev}` : base;
      }
      return '—';
    }
    case 'cadenamiento':
      return String(value.cadenamiento || value.value || '—');
    case 'eje':
      return String(value.eje || value.value || '—');
    case 'nivel': {
      const v = value.nivel ?? value.value;
      if (typeof v === 'number' && Number.isFinite(v)) {
        return `${v} m`;
      }
      return v != null ? String(v) : '—';
    }
    default:
      try { return JSON.stringify(value); } catch { return '—'; }
  }
}

export type Unidad = 'km' | 'm' | 'cm';

export interface WhatsAppPayload {
  /** Nombre completo del especialista (sin "Ing."). */
  userName: string;
  /** Área (disciplina) o Puesto del especialista. */
  areaOrPuesto: string;
  /** Número de contrato del proyecto. */
  contractNumber: string;
  /** Nodo padre directo del nodo hoja seleccionado (ej. "Estación 02+450"). */
  parentNodeName: string;
  /** Nodo hoja seleccionado (ej. "Poste 12"). */
  leafNodeName: string;
  /** Texto ya formateado del valor de medición (ver formatMeasurementValue). */
  ubicacion: string;
  /** Constructora global del proyecto (read-only). */
  constructora: string;
  /** Listas serializadas (ej. ["3 Albañil", "1 Maestro"]). */
  personal: string[];
  equipo: string[];
  /** Actividades del día (texto libre multiline). */
  actividades?: string;
  /** Observaciones del día (texto libre multiline). */
  observaciones?: string;
  /** Lecturas numéricas. */
  primeraLectura?: number | null;
  ultimaLectura?: number | null;
  /** Unidad de las lecturas (km | m | cm). */
  unidad?: Unidad;
  /** Opcional, override de fecha; por defecto usa "hoy". */
  date?: Date;
}

/** Formato profesional: máximo 2 decimales, sin ceros sobrantes. */
export function fmtNum2(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (Number.isInteger(n)) return String(n);
  // 2 decimales fijos, sin ceros sobrantes a la derecha.
  let s = n.toFixed(2);
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

export function buildWhatsAppMessage(p: WhatsAppPayload): string {
  const dateLine = formatDateLongES(p.date || new Date());
  const lines: string[] = [];
  const unidad: Unidad = p.unidad || 'm';

  lines.push(dateLine);
  lines.push('');
  lines.push(`Ing. ${(p.userName || '').trim()}`);
  if ((p.areaOrPuesto || '').trim()) {
    lines.push(p.areaOrPuesto.trim());
  }
  lines.push('');
  // Contratista (Constructora) — se coloca ARRIBA del No. de contrato por
  // requerimiento ejecutivo. Aparece HASTA ARRIBA del reporte, seguido del
  // número de contrato. Se elimina de la sección final para evitar duplicado.
  lines.push(`Constructora: ${(p.constructora || '').trim() || '—'}`);
  lines.push(`No de contrato: ${(p.contractNumber || '').trim()}`);
  if ((p.parentNodeName || '').trim()) {
    lines.push(`${p.parentNodeName.trim()}: ${(p.leafNodeName || '').trim()}`);
  } else {
    lines.push((p.leafNodeName || '').trim());
  }
  lines.push(`Ubicación: ${(p.ubicacion || '').trim()}`);

  // Lecturas con unidad + Avance calculado
  const pl = fmtNum2(p.primeraLectura);
  const ul = fmtNum2(p.ultimaLectura);
  if (pl != null || ul != null) {
    lines.push('');
    if (pl != null) lines.push(`Primera lectura: ${pl} ${unidad}`);
    if (ul != null) lines.push(`Última lectura: ${ul} ${unidad}`);
    // Avance = Última - Primera (cuando ambas existen)
    if (
      p.primeraLectura != null && Number.isFinite(p.primeraLectura) &&
      p.ultimaLectura != null && Number.isFinite(p.ultimaLectura)
    ) {
      const avance = (p.ultimaLectura as number) - (p.primeraLectura as number);
      const avanceStr = fmtNum2(avance);
      if (avanceStr != null) {
        lines.push(`Avance: ${avanceStr} ${unidad}`);
      }
    }
  }

  // Actividades
  const act = (p.actividades || '').trim();
  if (act) {
    lines.push('');
    lines.push('Actividades:');
    lines.push(act);
  }

  // Observaciones
  const obs = (p.observaciones || '').trim();
  if (obs) {
    lines.push('');
    lines.push('Observaciones:');
    lines.push(obs);
  }

  // Constructora se movió ARRIBA del reporte (junto al No. de contrato).
  // Aquí solo listamos Personal y Equipo del reporte.
  lines.push('');
  const personal = (p.personal || []).map((s) => s.trim()).filter(Boolean);
  lines.push('Personal:');
  if (personal.length) {
    for (const item of personal) lines.push(`• ${item}`);
  } else {
    lines.push('—');
  }

  const equipo = (p.equipo || []).map((s) => s.trim()).filter(Boolean);
  lines.push('Equipo:');
  if (equipo.length) {
    for (const item of equipo) lines.push(`• ${item}`);
  } else {
    lines.push('—');
  }

  return lines.join('\n');
}
