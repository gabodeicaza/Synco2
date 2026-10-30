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

/** '2026-09-29' → '29-09-2026' (formato de captura de las fechas del proyecto). */
export function isoADmy(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || '');
}

/**
 * '29-09-2026' → '2026-09-29'. Tolera separadores - / . y días/meses de un dígito
 * ('9/3/2026'), y acepta también AAAA-MM-DD (con hora opcional). null si el texto no
 * es una fecha o no existe (31-02-2026).
 */
export function dmyAIso(texto: string): string | null {
  const t = (texto || '').trim();
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(t);
  let d: number, mes: number, y: number;
  if (dmy) [d, mes, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else if (ymd) [y, mes, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
  else return null;
  const f = new Date(Date.UTC(y, mes - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(mes)}-${p(d)}`;
}
