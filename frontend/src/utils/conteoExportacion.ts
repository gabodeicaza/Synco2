// R-03: antes de generar un PDF/Word/PPTX se pregunta cuántos reportes entrarían. Si el
// conteo falla (sin red, servidor caído) NUNCA bloquea la exportación: avisa con un toast
// y sigue adelante.
import { api } from '@/src/api';
import { t } from '@/src/i18n';
import { esErrorDeRed } from '@/src/utils/errores';
import { showToast } from '@/src/utils/toast';

export interface ResultadoConteo {
  /** No hay reportes que entren al documento con estos filtros. */
  vacio: boolean;
  /** Reportes del periodo que solo cuentan en las tablas de fuerza de trabajo (otra severidad). */
  otros: number;
}

export interface FiltrosConteo {
  area_id?: string;
  scope?: string;
  period_type?: string;
}

export function interpretarConteo(c: { reportes: number; reportes_fuerza_trabajo: number }): ResultadoConteo {
  return { vacio: c.reportes === 0, otros: Math.max(0, c.reportes_fuerza_trabajo - c.reportes) };
}

export async function verificarConteoExportacion(
  pid: string,
  period: string,
  filtros: FiltrosConteo,
): Promise<ResultadoConteo> {
  try {
    return interpretarConteo(await api.countExportReports(pid, period, filtros));
  } catch (e) {
    if (esErrorDeRed(e)) showToast(t('exportar.sinConexionConteo'));
    return { vacio: false, otros: 0 };
  }
}
