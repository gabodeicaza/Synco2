// Vigencia de las noticias (G-05): 6 h, 24 h, 48 h o 7 días (el servidor valida los mismos valores).
import { t } from '@/src/i18n';

export const VIGENCIAS_HORAS = [6, 24, 48, 168] as const;
export type VigenciaHoras = (typeof VIGENCIAS_HORAS)[number];
export const VIGENCIA_POR_DEFECTO: VigenciaHoras = 24;

/** Vigencia válida o la de por defecto (noticias anteriores no traen el campo). */
export function vigenciaValida(valor: unknown): VigenciaHoras {
  return VIGENCIAS_HORAS.includes(valor as VigenciaHoras) ? (valor as VigenciaHoras) : VIGENCIA_POR_DEFECTO;
}

export function etiquetaVigencia(horas: VigenciaHoras): string {
  switch (horas) {
    case 6: return t('noticiasVigencia.opcion6');
    case 48: return t('noticiasVigencia.opcion48');
    case 168: return t('noticiasVigencia.opcion168');
    default: return t('noticiasVigencia.opcion24');
  }
}

export function ayudaVigencia(horas: VigenciaHoras): string {
  switch (horas) {
    case 6: return t('noticiasVigencia.ayuda6');
    case 48: return t('noticiasVigencia.ayuda48');
    case 168: return t('noticiasVigencia.ayuda168');
    default: return t('noticiasVigencia.ayuda24');
  }
}

/** "Vence en 45 min" / "Vence en 5 h" / "Vence en 3 d" / "Por expirar" a partir de `expires_at` (ISO). */
export function textoTiempoRestante(expiresAt: string | null | undefined, ahoraMs: number = Date.now()): string {
  if (!expiresAt) return '';
  const vence = new Date(expiresAt).getTime();
  if (Number.isNaN(vence)) return '';
  const diff = vence - ahoraMs;
  if (diff <= 0) return t('noticiasVigencia.porExpirar');
  const minutos = Math.max(1, Math.round(diff / 60000));
  if (minutos < 60) return t('noticiasVigencia.venceEnMinutos', { n: minutos });
  const horas = Math.round(minutos / 60);
  if (horas < 48) return t('noticiasVigencia.venceEnHoras', { n: horas });
  return t('noticiasVigencia.venceEnDias', { n: Math.round(horas / 24) });
}

/** Carga útil de la edición: la vigencia solo se manda si cambió (reinicia el reloj de expiración). */
export function vigenciaParaGuardar(
  elegida: VigenciaHoras, original: VigenciaHoras | null,
): { vigencia_horas?: VigenciaHoras } {
  return original !== null && elegida === original ? {} : { vigencia_horas: elegida };
}
