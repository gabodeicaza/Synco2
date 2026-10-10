// Validación pura de los formularios del catálogo (Nueva partida y Nuevo concepto):
// devuelve un error por campo para mostrarlo junto al campo. Sin React ni red, para
// poder probarla sola. Los números se leen con el separador decimal del proyecto.
import { t } from '@/src/i18n';
import { claveComparable, PeriodicidadMeta } from '@/src/utils/unidades';
import { cadenciaDeProyecto, duracionEnDias, metaPorDefecto } from '@/src/utils/metaPorDefecto';
import {
  DECIMALES_CANTIDAD, DECIMALES_IMPORTE, SeparadorDecimal, mensajeNumeroInvalido, parseNumeroEntrada,
} from '@/src/utils/numeros';

export type CampoPartida = 'clave' | 'nombre';
export type CampoConcepto = 'clave' | 'descripcion' | 'unidad' | 'cantidad' | 'precioUnitario' | 'fechaInicio' | 'fechaFin' | 'meta';

export interface PartidaMinima {
  clave: string;
  nombre: string;
  partida_padre_id?: string | null;
}

/** Nueva partida: clave y nombre obligatorios; la clave no se repite en el proyecto y el nombre no se repite entre hermanas. */
export function validarNuevaPartida(
  datos: { clave: string; nombre: string },
  hermanas: PartidaMinima[],
  todas: PartidaMinima[],
): Partial<Record<CampoPartida, string>> {
  const errores: Partial<Record<CampoPartida, string>> = {};
  const clave = datos.clave.trim();
  const nombre = datos.nombre.trim();
  if (!clave) errores.clave = t('catalogoForm.claveObligatoria');
  else if (todas.some((p) => claveComparable(p.clave) === claveComparable(clave))) {
    errores.clave = t('catalogoForm.claveEnUso', { clave });
  }
  if (!nombre) errores.nombre = t('catalogoForm.nombreObligatorio');
  else if (hermanas.some((p) => claveComparable(p.nombre) === claveComparable(nombre))) {
    errores.nombre = t('catalogoForm.nombreEnUso', { nombre });
  }
  return errores;
}

export interface DatosConcepto {
  clave: string;
  descripcion: string;
  unidad: string;
  cantidad: string;
  precioUnitario: string;
  extraordinario: boolean;
  /** YYYY-MM-DD, opcionales: con ambas se calcula la meta por defecto (C-06). */
  fechaInicio?: string;
  fechaFin?: string;
  /** Meta capturada a mano (con el separador del proyecto); vacía = usar la calculada. */
  meta?: string;
}

export interface ConceptoParaApi {
  clave: string;
  descripcion: string;
  unidad: string;
  cantidad: string;
  precio_unitario: string;
  /** "" si no hay programa ni meta capturada (C-06). */
  meta: string;
  periodicidad_meta: PeriodicidadMeta;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  extraordinario: boolean;
}

export interface ResultadoConcepto {
  errores: Partial<Record<CampoConcepto, string>>;
  valores: ConceptoParaApi | null;
}

/** Nuevo concepto: cantidad > 0 (hasta 4 decimales) y P.U. >= 0 (hasta 2). Un extraordinario puede dejar el P.U. vacío (queda en 0, pendiente de autorización). */
export function validarNuevoConcepto(
  datos: DatosConcepto,
  opciones: { separador: SeparadorDecimal; unidadesValidas: string[]; clavesExistentes?: string[]; cadencia?: string | null },
): ResultadoConcepto {
  const errores: Partial<Record<CampoConcepto, string>> = {};
  const clave = datos.clave.trim();
  const descripcion = datos.descripcion.trim();

  if (!clave) errores.clave = t('catalogoForm.claveObligatoria');
  else if ((opciones.clavesExistentes || []).some((c) => claveComparable(c) === claveComparable(clave))) {
    errores.clave = t('catalogoForm.claveEnUso', { clave });
  }
  if (!descripcion) errores.descripcion = t('catalogoForm.descripcionObligatoria');
  if (!opciones.unidadesValidas.includes(datos.unidad)) errores.unidad = t('catalogoForm.unidadInvalida');

  let cantidad = '';
  const c = parseNumeroEntrada(datos.cantidad, { separador: opciones.separador, maxDecimales: DECIMALES_CANTIDAD });
  if (!c.ok) errores.cantidad = mensajeNumeroInvalido(c.motivo, DECIMALES_CANTIDAD, t('catalogoForm.cantidad'));
  else if (/^0(\.0*)?$/.test(c.valor)) errores.cantidad = t('catalogoForm.cantidadNoPositiva');
  else cantidad = c.valor;

  let precio = '0';
  const etiquetaPu = datos.extraordinario ? t('catalogoForm.precioUnitarioPropuesto') : t('catalogoForm.precioUnitario');
  if (datos.extraordinario && !datos.precioUnitario.trim()) {
    precio = '0';
  } else {
    const p = parseNumeroEntrada(datos.precioUnitario, { separador: opciones.separador, maxDecimales: DECIMALES_IMPORTE });
    if (!p.ok) errores.precioUnitario = mensajeNumeroInvalido(p.motivo, DECIMALES_IMPORTE, etiquetaPu);
    else precio = p.valor;
  }

  const inicio = (datos.fechaInicio || '').trim();
  const fin = (datos.fechaFin || '').trim();
  if (inicio && duracionEnDias(inicio, inicio) === null) {
    errores.fechaInicio = t('meta.fechaInvalida', { campo: t('meta.campoFechaInicio') });
  }
  if (fin && duracionEnDias(fin, fin) === null) {
    errores.fechaFin = t('meta.fechaInvalida', { campo: t('meta.campoFechaFin') });
  }
  if (inicio && fin && !errores.fechaInicio && !errores.fechaFin && duracionEnDias(inicio, fin) === null) {
    errores.fechaFin = t('meta.finAnterior');
  }

  // C-06: la meta capturada manda; si no hay, se calcula con la duración y la cadencia del proyecto;
  // sin programa queda vacía (ya no es "toda la cantidad por semana").
  const periodicidad = cadenciaDeProyecto(opciones.cadencia);
  let meta = '';
  if ((datos.meta || '').trim()) {
    const m = parseNumeroEntrada(datos.meta!, { separador: opciones.separador, maxDecimales: DECIMALES_CANTIDAD });
    if (!m.ok) errores.meta = mensajeNumeroInvalido(m.motivo, DECIMALES_CANTIDAD, t('meta.campoMeta'));
    else meta = m.valor;
  } else if (cantidad) {
    meta = metaPorDefecto(cantidad, inicio, fin, periodicidad) ?? '';
  }

  if (Object.keys(errores).length > 0) return { errores, valores: null };
  return {
    errores,
    valores: {
      clave, descripcion, unidad: datos.unidad, cantidad, precio_unitario: precio,
      meta, periodicidad_meta: periodicidad, fecha_inicio: inicio || null, fecha_fin: fin || null,
      extraordinario: datos.extraordinario,
    },
  };
}
