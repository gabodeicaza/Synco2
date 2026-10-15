// Edición completa de un reporte: solo su autor y solo durante las 8 h siguientes a la
// captura. Debe coincidir con `REPORTE_EDITABLE_HORAS` / `reporte_editable_por` del backend.
export const REPORTE_EDITABLE_HORAS = 8;

export function reporteEditableHasta(createdAt?: string | null): Date | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + REPORTE_EDITABLE_HORAS * 3600 * 1000);
}

export function puedeEditarReporte(
  r: { captured_by?: string; created_at?: string | null; id?: string },
  userId?: string,
  ahora: Date = new Date(),
): boolean {
  if (!userId || r.captured_by !== userId || !r.id || r.id.startsWith('local-')) return false;
  const limite = reporteEditableHasta(r.created_at);
  return !!limite && ahora <= limite;
}

/** Ruta de la pantalla de captura según el rol (los demás roles no capturan). */
export function rutaEditarReporte(role?: string): string | null {
  if (role === 'especialista') return '/(spec)/nuevo';
  if (role === 'sub_coordinador') return '/(subcoord)/nuevo';
  return null;
}

// Aviso interno: tras editar un reporte, las pantallas con el feed (Inicio) lo recargan.
const oyentes = new Set<() => void>();
export function suscribirReporteEditado(cb: () => void): () => void {
  oyentes.add(cb);
  return () => { oyentes.delete(cb); };
}
export function emitirReporteEditado(): void {
  oyentes.forEach((cb) => { try { cb(); } catch { /* un oyente roto no frena a los demás */ } });
}
