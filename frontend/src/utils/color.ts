// Colores de identidad (P-02): se exige #RRGGBB exacto. Un valor inválido NUNCA se
// sustituye en silencio por otro color: se avisa junto al campo. Espeja al servidor
// (validar_color_hex en server.py, que es la fuente de verdad).
import { t } from '@/src/i18n';

const HEX_ESTRICTO = /^#[0-9A-Fa-f]{6}$/;

export function esColorHexValido(v: string | null | undefined): boolean {
  return HEX_ESTRICTO.test((v ?? '').trim());
}

/** "#1e40af" -> "#1E40AF". Devuelve null si está vacío. No adivina: si es inválido lo devuelve tal cual. */
export function normalizarColorHex(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  return HEX_ESTRICTO.test(s) ? s.toUpperCase() : s;
}

/** Mensaje de error para mostrar junto al campo, o null si el valor es válido o está vacío. */
export function errorDeColor(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  return HEX_ESTRICTO.test(s) ? null : t('color.formatoInvalido', { valor: s });
}
