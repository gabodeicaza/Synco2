// Tipo de obra del proyecto (K-13 / T-10): nombre legible y módulos recomendados.
// "legado" es el tipo con el que se LEEN los proyectos anteriores que nunca guardaron el campo:
// no se puede elegir ni restablecer.
import type { ModuloCategoria, ModulosConfig, TipoObra, TipoObraInfo } from '@/src/api';
import { t } from '@/src/i18n';
import { CATEGORIA_ORDEN, MODULOS } from '@/src/utils/modulos';

export type TipoObraElegible = Exclude<TipoObra, 'legado'>;

export const TIPO_OBRA_DEFECTO: TipoObraElegible = 'generica';

const NOMBRES_RESPALDO: Record<TipoObraElegible, string> = {
  generica: t('tipoObra.nombres.generica'),
  carretera: t('tipoObra.nombres.carretera'),
  edificacion: t('tipoObra.nombres.edificacion'),
  hidraulica: t('tipoObra.nombres.hidraulica'),
  puente: t('tipoObra.nombres.puente'),
};

export function esTipoElegible(tipo: string | null | undefined): tipo is TipoObraElegible {
  return !!tipo && Object.prototype.hasOwnProperty.call(NOMBRES_RESPALDO, tipo);
}

/** Nombre para mostrar: el del catálogo del servidor si lo hay; si no, uno de respaldo. */
export function nombreTipoObra(tipo: TipoObra | null | undefined, catalogo?: TipoObraInfo[] | null): string {
  if (!tipo || tipo === 'legado') return t('tipoObra.legado');
  return catalogo?.find((x) => x.id === tipo)?.nombre ?? NOMBRES_RESPALDO[tipo as TipoObraElegible] ?? tipo;
}

/** Solo un tipo elegible (no el "legado") admite restablecer sus módulos recomendados. */
export function puedeRestablecerModulos(tipo: TipoObra | null | undefined): boolean {
  return esTipoElegible(tipo);
}

/** Cuerpo del PUT de módulos que deja el proyecto EXACTAMENTE como el tipo lo recomienda: el servidor
 * actualiza solo las claves enviadas, así que se mandan las 8 en cada informe (las que el tipo no
 * recomienda, en false). */
export function moduloPayloadRecomendado(info: Pick<TipoObraInfo, 'modulos_por_defecto'>): ModulosConfig {
  const salida = {} as ModulosConfig;
  for (const categoria of CATEGORIA_ORDEN) {
    const activos = info.modulos_por_defecto?.[categoria as ModuloCategoria] ?? {};
    salida[categoria] = Object.fromEntries(MODULOS.map((m) => [m.key, activos[m.key] === true]));
  }
  return salida;
}
