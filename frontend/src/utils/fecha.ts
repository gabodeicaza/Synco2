// Validación ligera de una fecha tecleada a mano: acepta AAAA-MM-DD y también
// DD/MM/AAAA, DD-MM-AAAA y DD.MM.AAAA (lo que suele copiarse del Excel). El
// backend (`_fecha_flexible`) la normaliza a AAAA-MM-DD y valida que exista.
export const FECHA_AYUDA = 'Usa AAAA-MM-DD o DD/MM/AAAA (ej. 2026-06-26 o 26/06/2026).';

export function fechaTecleadaOk(texto: string): boolean {
  return /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](\d{2}|\d{4}))$/.test((texto || '').trim());
}

/** '2026-09-29' → '29/09/2026'; cualquier otra cosa se devuelve tal cual. */
export function fechaCorta(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}
