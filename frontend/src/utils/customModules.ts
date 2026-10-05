// Creador de módulos — catálogo del lado del cliente: tipos de campo, modos de
// impresión, plantillas de inicio, formato de valores y el evaluador de
// fórmulas (espejo de `_cm_formula_eval` en backend/server.py: el backend es
// la fuente de verdad al guardar; aquí solo se usa para mostrar en vivo).
import type { Ionicons } from '@expo/vector-icons';
import type {
  CustomAgregacion, CustomCampo, CustomCampoTipo, CustomGrafica, CustomImportFila, CustomModo, CustomModuleInput,
  CustomOpciones, CustomPeriodo, CustomRecord, CustomSalida, CustomTemplate, ModuloCategoria,
} from '@/src/api';
import { fechaCorta } from '@/src/utils/fecha';

type IconName = keyof typeof Ionicons.glyphMap;

export const CM_TIPOS: { tipo: CustomCampoTipo; label: string; descripcion: string; icon: IconName }[] = [
  { tipo: 'texto', label: 'Texto corto', descripcion: 'Una línea: nombres, folios, descripciones breves', icon: 'text-outline' },
  { tipo: 'texto_largo', label: 'Texto largo', descripcion: 'Párrafos, observaciones, notas', icon: 'reader-outline' },
  { tipo: 'numero', label: 'Número', descripcion: 'Cantidades, medidas, conteos (con unidad opcional)', icon: 'calculator-outline' },
  { tipo: 'moneda', label: 'Moneda', descripcion: 'Importes en pesos', icon: 'cash-outline' },
  { tipo: 'porcentaje', label: 'Porcentaje', descripcion: 'Avances y cumplimientos', icon: 'speedometer-outline' },
  { tipo: 'fecha', label: 'Fecha', descripcion: 'Una fecha (DD/MM/AAAA)', icon: 'calendar-outline' },
  { tipo: 'seleccion', label: 'Lista (una opción)', descripcion: 'Eliges una opción de una lista que defines', icon: 'list-circle-outline' },
  { tipo: 'multiseleccion', label: 'Lista (varias opciones)', descripcion: 'Marcas todas las opciones que apliquen', icon: 'checkbox-outline' },
  { tipo: 'interruptor', label: 'Interruptor Sí / No', descripcion: 'Cumple / no cumple, aplica / no aplica', icon: 'toggle-outline' },
  { tipo: 'foto', label: 'Foto', descripcion: 'Evidencia fotográfica (cámara o galería)', icon: 'camera-outline' },
  { tipo: 'ubicacion', label: 'Estación / ubicación', descripcion: 'Se elige una estación del árbol de ubicaciones del proyecto', icon: 'location-outline' },
  { tipo: 'calculado', label: 'Calculado', descripcion: 'Se calcula solo con una fórmula de otros campos numéricos', icon: 'git-compare-outline' },
];

export const cmTipoInfo = (t: CustomCampoTipo) => CM_TIPOS.find((x) => x.tipo === t) || CM_TIPOS[0];
export const esNumerico = (t: CustomCampoTipo) => t === 'numero' || t === 'moneda' || t === 'porcentaje';
export const esNumericoOCalc = (t: CustomCampoTipo) => esNumerico(t) || t === 'calculado';

export const CM_MODOS: { modo: CustomModo; label: string; descripcion: string; icon: IconName }[] = [
  { modo: 'oculto', label: 'No imprimir', descripcion: 'No aparece en este informe', icon: 'eye-off-outline' },
  { modo: 'texto', label: 'Texto', descripcion: 'Una lista de registros con sus datos en texto', icon: 'reader-outline' },
  { modo: 'tabla', label: 'Tabla', descripcion: 'Una fila por registro, una columna por campo', icon: 'grid-outline' },
  { modo: 'resumen', label: 'Resumen', descripcion: 'Solo conteo y totales (suma, promedio...)', icon: 'stats-chart-outline' },
  { modo: 'fotos', label: 'Fotos', descripcion: 'Solo las fotos, dos por hoja con su descripción', icon: 'images-outline' },
];

export const CM_PERIODOS: { periodo: CustomPeriodo; label: string; descripcion: string }[] = [
  { periodo: 'periodo', label: 'Del período', descripcion: 'Solo registros con fecha dentro del informe' },
  { periodo: 'acumulado', label: 'Acumulado', descripcion: 'Todo lo registrado hasta el cierre del informe' },
  { periodo: 'ultimo', label: 'Último registro', descripcion: 'Solo el registro más reciente' },
];

export const CM_AGREGACIONES: { agg: CustomAgregacion; label: string }[] = [
  { agg: 'ninguna', label: 'Ninguna' },
  { agg: 'suma', label: 'Suma' },
  { agg: 'promedio', label: 'Promedio' },
  { agg: 'minimo', label: 'Mínimo' },
  { agg: 'maximo', label: 'Máximo' },
  { agg: 'conteo', label: 'Conteo' },
];

export const CM_CATEGORIAS: { cat: ModuloCategoria; label: string; icon: IconName }[] = [
  { cat: 'reportes_diarios', label: 'Diario', icon: 'today-outline' },
  { cat: 'reportes_semanales', label: 'Semanal', icon: 'calendar-outline' },
  { cat: 'reportes_mensuales', label: 'Mensual', icon: 'calendar-number-outline' },
];

export const CM_ICONOS: IconName[] = [
  'cube-outline', 'apps-outline', 'clipboard-outline', 'document-text-outline', 'list-outline', 'checkbox-outline',
  'construct-outline', 'hammer-outline', 'build-outline', 'flask-outline', 'leaf-outline', 'water-outline',
  'flame-outline', 'flash-outline', 'car-outline', 'bus-outline', 'people-outline', 'person-outline',
  'shield-checkmark-outline', 'warning-outline', 'alert-circle-outline', 'camera-outline', 'images-outline',
  'map-outline', 'location-outline', 'calendar-outline', 'time-outline', 'stats-chart-outline', 'bar-chart-outline',
  'pie-chart-outline', 'trending-up-outline', 'cash-outline', 'card-outline', 'pricetag-outline', 'cart-outline',
  'archive-outline', 'folder-outline', 'bookmark-outline', 'flag-outline', 'star-outline', 'bulb-outline',
  'speedometer-outline', 'thermometer-outline', 'rainy-outline', 'sunny-outline', 'cloud-outline',
  'business-outline', 'home-outline', 'trail-sign-outline', 'navigate-outline', 'settings-outline', 'mail-outline',
];

export function nuevoId(): string {
  return 'c' + Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

export function campoNuevo(tipo: CustomCampoTipo, etiqueta = ''): CustomCampo {
  const c: CustomCampo = {
    id: nuevoId(), etiqueta, tipo, requerido: false, en_informe: true, agregacion: 'ninguna', visible_si: null,
  };
  if (tipo === 'seleccion' || tipo === 'multiseleccion') c.opciones = ['Opción 1', 'Opción 2'];
  if (tipo === 'calculado') { c.formula = ''; c.formato = 'numero'; }
  return c;
}

export const OPCIONES_DEFAULT: CustomOpciones = {
  folio_activo: false, folio_prefijo: '', folio_digitos: 4, folio_inicio: 1, mostrar_folio: true, ocultar_cerrados: false,
  titulo: '', intro: '', nota_pie: '', plantilla_texto: '', texto_vacio: 'Sin registros en el período.',
  mostrar_fecha: true, mostrar_autor: false, mostrar_totales: true, numerar: false, incluir_fotos: false,
  imprimir_vacio: false, orden: 'asc', limite: 0, agrupar_por: null,
};

export function salidaDefault(modos: Partial<Record<ModuloCategoria, CustomModo>> = {}): CustomSalida {
  const mk = (cat: ModuloCategoria) => ({ modo: modos[cat] || ('oculto' as CustomModo), periodo: 'periodo' as CustomPeriodo });
  return {
    reportes_diarios: mk('reportes_diarios'),
    reportes_semanales: mk('reportes_semanales'),
    reportes_mensuales: mk('reportes_mensuales'),
  };
}

export function moduloVacio(): CustomModuleInput {
  return {
    nombre: '', descripcion: '', icono: 'cube-outline', area_id: null, activo: true, usar_jerarquia: false,
    solo_coordinacion: false, campos: [], salida: salidaDefault(), opciones: { ...OPCIONES_DEFAULT }, graficas: [],
  };
}

/** Campo de lista usado como estatus de seguimiento (Abierto / En proceso / Cerrado). */
export function campoEstatus(etiqueta = 'Estatus'): CustomCampo {
  return {
    ...campoNuevo('seleccion', etiqueta), opciones: ['Abierto', 'En proceso', 'Cerrado'], estatus: true, cierre: ['Cerrado'],
    valor_defecto: 'Abierto', requerido: true,
  };
}

export function graficaNueva(campos: CustomCampo[]): CustomGrafica {
  const cat = campos.find((c) => c.estatus) || campos.find((c) => ['seleccion', 'ubicacion', 'texto', 'interruptor'].includes(c.tipo));
  return {
    id: 'g' + Math.random().toString(16).slice(2, 10).padEnd(8, '0'), titulo: '', tipo: 'barras',
    categoria: cat ? cat.id : '__fecha', valor: null, agregacion: 'conteo', informes: ['reportes_semanales'],
  };
}

export const GRAFICA_TIPOS: { tipo: CustomGrafica['tipo']; label: string; icon: IconName }[] = [
  { tipo: 'barras', label: 'Barras', icon: 'bar-chart-outline' },
  { tipo: 'barras_h', label: 'Barras horizontales', icon: 'reorder-three-outline' },
  { tipo: 'pastel', label: 'Pastel', icon: 'pie-chart-outline' },
  { tipo: 'linea', label: 'Línea', icon: 'trending-up-outline' },
];

/** Definición lista para el constructor a partir de una plantilla propia guardada. */
export function moduloDesdePlantilla(t: CustomTemplate): CustomModuleInput {
  const d = t.definicion || {};
  const v = moduloVacio();
  return {
    ...v, ...d, area_id: null, activo: true,
    salida: { ...v.salida!, ...(d.salida || {}) },
    opciones: { ...OPCIONES_DEFAULT, ...(d.opciones || {}) },
    campos: (d.campos || []).map((c) => ({ ...c })),
    graficas: (d.graficas || []).map((g) => ({ ...g })),
  };
}

// --- Plantillas de inicio ---------------------------------------------------
export type Plantilla = { clave: string; nombre: string; descripcion: string; icon: IconName; crear: () => CustomModuleInput };

const base = (nombre: string, descripcion: string, icono: string, campos: CustomCampo[], extra: Partial<CustomModuleInput> = {}): CustomModuleInput => ({
  ...moduloVacio(), nombre, descripcion, icono, campos, ...extra,
});
const c = (id: string, etiqueta: string, tipo: CustomCampoTipo, extra: Partial<CustomCampo> = {}): CustomCampo => ({
  ...campoNuevo(tipo, etiqueta), id, ...extra,
});

export const PLANTILLAS: Plantilla[] = [
  {
    clave: 'blanco', nombre: 'En blanco', descripcion: 'Empieza desde cero y agrega tus propios campos', icon: 'add-circle-outline',
    crear: () => moduloVacio(),
  },
  {
    clave: 'bitacora', nombre: 'Bitácora', descripcion: 'Título, descripción, responsable y foto', icon: 'journal-outline',
    crear: () => base('Bitácora', 'Notas y hechos relevantes de la obra', 'document-text-outline', [
      c('titulo', 'Título', 'texto', { requerido: true }),
      c('descripcion', 'Descripción', 'texto_largo'),
      c('responsable', 'Responsable', 'texto'),
      c('foto', 'Foto', 'foto'),
    ], { salida: salidaDefault({ reportes_semanales: 'texto' }), opciones: { ...OPCIONES_DEFAULT, incluir_fotos: true } }),
  },
  {
    clave: 'seguimiento', nombre: 'Seguimiento con folio y estatus', descripcion: 'Folio automático, estación, estatus Abierto/En proceso/Cerrado y gráfica', icon: 'flag-outline',
    crear: () => base('Seguimiento', 'Pendientes y hallazgos con folio y estatus de atención', 'flag-outline', [
      c('asunto', 'Asunto', 'texto', { requerido: true }),
      c('estacion', 'Estación', 'ubicacion'),
      c('detalle', 'Detalle', 'texto_largo'),
      { ...campoEstatus(), id: 'estatus' },
      c('foto', 'Foto', 'foto'),
    ], {
      salida: salidaDefault({ reportes_semanales: 'tabla', reportes_mensuales: 'resumen' }),
      opciones: { ...OPCIONES_DEFAULT, folio_activo: true, folio_prefijo: 'SEG-', ocultar_cerrados: true },
      graficas: [{ id: 'g_estatus', titulo: 'Registros por estatus', tipo: 'pastel', categoria: 'estatus', valor: null, agregacion: 'conteo', informes: ['reportes_semanales', 'reportes_mensuales'] }],
    }),
  },
  {
    clave: 'materiales', nombre: 'Control de materiales', descripcion: 'Cantidad × precio = importe, con totales', icon: 'cube-outline',
    crear: () => base('Control de materiales', 'Material recibido con cantidades e importes', 'cube-outline', [
      c('material', 'Material', 'texto', { requerido: true }),
      c('proveedor', 'Proveedor', 'texto'),
      c('cantidad', 'Cantidad', 'numero', { unidad: 'pza', agregacion: 'suma' }),
      c('precio', 'Precio unitario', 'moneda'),
      c('importe', 'Importe', 'calculado', { formula: '{cantidad} * {precio}', formato: 'moneda', agregacion: 'suma' }),
    ], { salida: salidaDefault({ reportes_semanales: 'tabla', reportes_mensuales: 'tabla' }) }),
  },
  {
    clave: 'checklist', nombre: 'Lista de verificación', descripcion: 'Cumple / no cumple; el motivo solo aparece si no cumple', icon: 'checkbox-outline',
    crear: () => base('Lista de verificación', 'Revisión de conceptos con cumple / no cumple', 'checkbox-outline', [
      c('concepto', 'Concepto', 'texto', { requerido: true }),
      c('cumple', 'Cumple', 'interruptor', { valor_defecto: true, agregacion: 'conteo' }),
      c('motivo', 'Motivo de incumplimiento', 'texto_largo', { visible_si: { campo: 'cumple', igual: false } }),
      c('evidencia', 'Evidencia', 'foto'),
    ], { salida: salidaDefault({ reportes_semanales: 'tabla' }) }),
  },
  {
    clave: 'incidencias', nombre: 'Registro de incidencias', descripcion: 'Tipo, severidad, atención y foto', icon: 'warning-outline',
    crear: () => base('Registro de incidencias', 'Incidencias de la obra con su estatus de atención', 'warning-outline', [
      c('descripcion', 'Descripción', 'texto', { requerido: true }),
      c('tipo', 'Tipo', 'seleccion', { opciones: ['Seguridad', 'Calidad', 'Ambiental', 'Otra'] }),
      c('severidad', 'Severidad', 'seleccion', { opciones: ['Baja', 'Media', 'Alta'] }),
      c('atendida', 'Atendida', 'interruptor', { agregacion: 'conteo' }),
      c('foto', 'Foto', 'foto'),
    ], { salida: salidaDefault({ reportes_diarios: 'texto', reportes_semanales: 'tabla' }), opciones: { ...OPCIONES_DEFAULT, incluir_fotos: true } }),
  },
  {
    clave: 'indicadores', nombre: 'Indicadores meta vs real', descripcion: 'Meta, real y % de cumplimiento calculado', icon: 'speedometer-outline',
    crear: () => base('Indicadores', 'Seguimiento de metas contra lo realizado', 'speedometer-outline', [
      c('indicador', 'Indicador', 'texto', { requerido: true }),
      c('meta', 'Meta', 'numero', { agregacion: 'suma' }),
      c('real', 'Real', 'numero', { agregacion: 'suma' }),
      c('cumplimiento', '% de cumplimiento', 'calculado', { formula: '{real} / {meta} * 100', formato: 'porcentaje', decimales: 1, agregacion: 'promedio' }),
    ], { salida: salidaDefault({ reportes_semanales: 'tabla', reportes_mensuales: 'resumen' }) }),
  },
];

// --- Formato ----------------------------------------------------------------
function fmtMiles(n: number, dec: number | null | undefined, t: string): string {
  const d = dec ?? (t === 'moneda' ? 2 : null);
  if (d != null) return n.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
  return n.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}

export function fmtNumeroCampo(campo: CustomCampo, val: number): string {
  const t = campo.tipo === 'calculado' ? campo.formato || 'numero' : campo.tipo;
  const txt = fmtMiles(val, campo.decimales, t);
  if (t === 'moneda') return val < 0 ? `-$${txt.replace('-', '')}` : `$${txt}`;
  if (t === 'porcentaje') return `${txt}%`;
  return campo.unidad ? `${txt} ${campo.unidad}` : txt;
}

/** Valor almacenado → texto legible ("" si vacío). */
export function fmtValor(campo: CustomCampo, val: any): string {
  if (campo.tipo === 'interruptor') return val ? 'Sí' : 'No';
  if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) return '';
  if (campo.tipo === 'ubicacion') return typeof val === 'object' ? String(val.nombre || '') : String(val);
  if (esNumericoOCalc(campo.tipo)) {
    const n = Number(val);
    return Number.isFinite(n) ? fmtNumeroCampo(campo, n) : String(val);
  }
  if (campo.tipo === 'fecha') return fechaCorta(String(val));
  if (campo.tipo === 'multiseleccion') return Array.isArray(val) ? val.join(', ') : String(val);
  return String(val);
}

// --- Visibilidad condicional -------------------------------------------------
export function campoVisible(campo: CustomCampo, valores: Record<string, any>): boolean {
  const v = campo.visible_si;
  if (!v) return true;
  const actual = valores[v.campo];
  if (Array.isArray(actual)) return actual.includes(v.igual as string);
  if (typeof v.igual === 'boolean') return !!actual === v.igual;
  return actual === v.igual;
}

// --- Fórmulas -----------------------------------------------------------------
const TOKEN_RE = /\{([a-z0-9_]{1,40})\}|(\d+(?:\.\d+)?)|([+\-*/()])|(\s+)/y;

export type TokenFormula = { k: 'ref'; v: string } | { k: 'num'; v: number } | { k: 'op'; v: string };

export function tokensFormula(formula: string): TokenFormula[] {
  const out: TokenFormula[] = [];
  let pos = 0;
  const re = new RegExp(TOKEN_RE.source, 'y');
  while (pos < formula.length) {
    re.lastIndex = pos;
    const m = re.exec(formula);
    if (!m) throw new Error('Carácter no permitido en la fórmula');
    pos = re.lastIndex;
    if (m[1]) out.push({ k: 'ref', v: m[1] });
    else if (m[2]) out.push({ k: 'num', v: parseFloat(m[2]) });
    else if (m[3]) out.push({ k: 'op', v: m[3] });
  }
  return out;
}

export function formulaDesdeTokens(tokens: TokenFormula[]): string {
  return tokens.map((t) => (t.k === 'ref' ? `{${t.v}}` : String(t.v))).join(' ');
}

/** Evalúa la fórmula con `valores`; null si no se puede (sintaxis, división entre 0). */
export function evaluarFormula(formula: string, valores: Record<string, any>): number | null {
  let toks: TokenFormula[];
  try { toks = tokensFormula(formula); } catch { return null; }
  if (!toks.length) return null;
  let i = 0;
  const peek = () => toks[i];
  const isOp = (t: TokenFormula | undefined, ops: string) => !!t && t.k === 'op' && ops.includes(t.v);
  const fail = () => { throw new Error('fórmula inválida'); };
  const expr = (): number | null => {
    let v = term();
    while (isOp(peek(), '+-')) {
      const op = (toks[i++] as { v: string }).v;
      const r = term();
      v = v === null || r === null ? null : op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = (): number | null => {
    let v = factor();
    while (isOp(peek(), '*/')) {
      const op = (toks[i++] as { v: string }).v;
      const r = factor();
      if (v === null || r === null) v = null;
      else if (op === '*') v *= r;
      else v = r === 0 ? null : v / r;
    }
    return v;
  };
  const factor = (): number | null => {
    const t = peek();
    if (!t) return fail() as never;
    if (isOp(t, '-')) { i++; const v = factor(); return v === null ? null : -v; }
    if (t.k === 'num') { i++; return t.v; }
    if (t.k === 'ref') {
      i++;
      const raw = valores[t.v];
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) && raw !== '' && raw !== null && raw !== undefined ? n : 0;
    }
    if (isOp(t, '(')) {
      i++;
      const v = expr();
      if (!isOp(peek(), ')')) fail();
      i++;
      return v;
    }
    return fail() as never;
  };
  try {
    const res = expr();
    if (i !== toks.length) return null;
    return res !== null && Number.isFinite(res) ? res : null;
  } catch { return null; }
}

/** Recalcula los campos `calculado` de un borrador de captura. */
export function recalcular(campos: CustomCampo[], valores: Record<string, any>): Record<string, any> {
  const out = { ...valores };
  for (const c of campos) {
    if (c.tipo !== 'calculado') continue;
    out[c.id] = campoVisible(c, out) && c.formula ? evaluarFormula(c.formula, out) : null;
  }
  return out;
}

/** Texto legible de la fórmula, con los ids cambiados por las etiquetas. */
export function formulaLegible(formula: string, campos: CustomCampo[]): string {
  const por = new Map(campos.map((x) => [x.id, x.etiqueta]));
  return formula.replace(/\{([a-z0-9_]{1,40})\}/g, (_m, id) => `[${por.get(id) || '¿?'}]`).replace(/\*/g, '×').replace(/\//g, '÷');
}

// --- Captura ------------------------------------------------------------------
export function valoresIniciales(campos: CustomCampo[]): Record<string, any> {
  const v: Record<string, any> = {};
  for (const c of campos) {
    if (c.tipo === 'foto' || c.tipo === 'calculado') continue;
    if (c.tipo === 'interruptor') v[c.id] = c.valor_defecto === true;
    else if (c.tipo === 'fecha') v[c.id] = c.valor_defecto === 'hoy' ? new Date().toISOString().slice(0, 10) : c.valor_defecto || '';
    else if (c.valor_defecto !== null && c.valor_defecto !== undefined) v[c.id] = c.valor_defecto;
    else v[c.id] = c.tipo === 'multiseleccion' ? [] : '';
  }
  return recalcular(campos, v);
}

/** Primer error de captura (o null): requeridos visibles y números válidos. */
export function validarCaptura(campos: CustomCampo[], valores: Record<string, any>, fotos: Record<string, any>): string | null {
  for (const c of campos) {
    if (!campoVisible(c, valores) || c.tipo === 'calculado') continue;
    const v = valores[c.id];
    if (c.tipo === 'foto') {
      if (c.requerido && !fotos[c.id]) return `Falta la foto «${c.etiqueta}».`;
      continue;
    }
    const vacio = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (c.requerido && c.tipo !== 'interruptor' && vacio) return `Falta llenar «${c.etiqueta}».`;
    if (esNumerico(c.tipo) && !vacio && !Number.isFinite(parseNumero(v))) return `«${c.etiqueta}»: escribe un número válido.`;
    if (esNumerico(c.tipo) && !vacio) {
      const n = parseNumero(v);
      if (c.minimo != null && n < c.minimo) return `«${c.etiqueta}»: el mínimo es ${c.minimo}.`;
      if (c.maximo != null && n > c.maximo) return `«${c.etiqueta}»: el máximo es ${c.maximo}.`;
    }
  }
  return null;
}

export function parseNumero(v: any): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/[$%\s]/g, '');
  if (/^-?\d+,\d{1,2}$/.test(s)) return Number(s.replace(',', '.'));
  return Number(s.replace(/,/g, ''));
}

/** Resumen de una línea de un registro para la lista de captura. */
export function tituloRegistro(campos: CustomCampo[], r: CustomRecord): string {
  const t = campos.find((c) => c.tipo === 'texto' || c.tipo === 'texto_largo' || c.tipo === 'seleccion');
  const txt = t ? fmtValor(t, r.valores[t.id]) : '';
  return txt || fechaCorta(r.fecha);
}

export function detalleRegistro(campos: CustomCampo[], r: CustomRecord, maxCampos = 4): string {
  const partes: string[] = [];
  for (const c of campos.slice(0, 12)) {
    if (c.tipo === 'foto' || !campoVisible(c, r.valores)) continue;
    const txt = fmtValor(c, r.valores[c.id]);
    if (txt) partes.push(`${c.etiqueta}: ${txt}`);
    if (partes.length >= maxCampos + 1) break;
  }
  return partes.slice(1).join('  ·  ');
}

/** Problemas de una definición antes de guardar (null = ok). */
export function validarDefinicion(d: CustomModuleInput): string | null {
  if (!(d.nombre || '').trim()) return 'Ponle un nombre al módulo.';
  const campos = d.campos || [];
  if (!campos.length) return 'Agrega al menos un campo.';
  for (const c of campos) {
    if (!c.etiqueta.trim()) return 'Todos los campos necesitan un nombre.';
    if ((c.tipo === 'seleccion' || c.tipo === 'multiseleccion') && !(c.opciones || []).some((o) => o.trim())) {
      return `«${c.etiqueta}» necesita al menos una opción.`;
    }
    if (c.tipo === 'calculado') {
      if (!c.formula) return `Arma la fórmula de «${c.etiqueta}».`;
      const probe: Record<string, number> = {};
      try { tokensFormula(c.formula).forEach((t) => { if (t.k === 'ref') probe[t.v] = 1; }); } catch { return `Fórmula inválida en «${c.etiqueta}».`; }
      if (evaluarFormula(c.formula, probe) === null && !c.formula.includes('/')) return `Fórmula inválida en «${c.etiqueta}».`;
    }
  }
  return null;
}

export const MODO_LABEL: Record<CustomModo, string> = {
  oculto: 'No se imprime', texto: 'Texto', tabla: 'Tabla', resumen: 'Resumen', fotos: 'Fotos',
};

export function resumenSalida(salida: CustomSalida | undefined): string {
  if (!salida) return 'No se imprime en ningún informe';
  const partes = CM_CATEGORIAS
    .filter(({ cat }) => salida[cat]?.modo && salida[cat].modo !== 'oculto')
    .map(({ cat, label }) => `${label}: ${MODO_LABEL[salida[cat].modo]}`);
  return partes.length ? partes.join(' · ') : 'No se imprime en ningún informe';
}

// --- Estatus ------------------------------------------------------------------
export function campoEstatusDe(campos: CustomCampo[]): CustomCampo | undefined {
  return campos.find((c) => c.estatus);
}

export function estaCerrado(campos: CustomCampo[], r: CustomRecord): boolean {
  const e = campoEstatusDe(campos);
  return !!e && (e.cierre || []).includes(String(r.valores[e.id] ?? ''));
}

// --- Filtros de la lista de registros ---------------------------------------------
export type FiltrosRegistros = {
  texto: string;
  desde: string; // AAAA-MM-DD o ''
  hasta: string;
  autor: string | null; // nombre exacto del autor
  estatus: string | null; // opción del campo estatus
  soloAbiertos: boolean;
  campoId: string | null; // filtro por el valor de un campo de lista / interruptor
  campoValor: string | null; // opción, o 'si' / 'no' para interruptores
};

export const FILTROS_VACIOS: FiltrosRegistros = {
  texto: '', desde: '', hasta: '', autor: null, estatus: null, soloAbiertos: false, campoId: null, campoValor: null,
};

export function hayFiltros(f: FiltrosRegistros): boolean {
  return !!(f.desde || f.hasta || f.autor || f.estatus || f.soloAbiertos || (f.campoId && f.campoValor));
}

/** Fecha tecleada (AAAA-MM-DD o DD/MM/AAAA) → ISO, o '' si no es válida. */
export function fechaIso(txt: string): string {
  const t = (txt || '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

export function filtrarRegistros(lista: CustomRecord[], campos: CustomCampo[], f: FiltrosRegistros): CustomRecord[] {
  const q = f.texto.trim().toLowerCase();
  const desde = fechaIso(f.desde);
  const hasta = fechaIso(f.hasta);
  const est = campoEstatusDe(campos);
  const campoSel = f.campoId ? campos.find((c) => c.id === f.campoId) : undefined;
  return lista.filter((r) => {
    if (desde && r.fecha < desde) return false;
    if (hasta && r.fecha > hasta) return false;
    if (f.autor && r.created_by_name !== f.autor) return false;
    if (est && f.estatus && r.valores[est.id] !== f.estatus) return false;
    if (f.soloAbiertos && estaCerrado(campos, r)) return false;
    if (campoSel && f.campoValor) {
      const v = r.valores[campoSel.id];
      if (campoSel.tipo === 'interruptor') { if (!!v !== (f.campoValor === 'si')) return false; }
      else if (Array.isArray(v) ? !v.includes(f.campoValor) : v !== f.campoValor) return false;
    }
    if (q) {
      const txt = `${r.folio || ''} ${tituloRegistro(campos, r)} ${detalleRegistro(campos, r, 30)} ${r.created_by_name || ''} ${fechaCorta(r.fecha)}`.toLowerCase();
      if (!txt.includes(q)) return false;
    }
    return true;
  });
}

// --- Importación desde Excel ------------------------------------------------------
const normaliza = (s: any) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Campos que se pueden llenar desde Excel (sin foto ni calculados). */
export const camposImportables = (campos: CustomCampo[]) => campos.filter((c) => c.tipo !== 'foto' && c.tipo !== 'calculado');

/** Columna del Excel → id de campo ('fecha' para la columna Fecha, null = se ignora).
 * Se empareja por el nombre del encabezado (sin acentos, mayúsculas ni el « *»). */
export function mapearColumnas(encabezados: any[], campos: CustomCampo[]): (string | null)[] {
  const usados = new Set<string>();
  return encabezados.map((h) => {
    const n = normaliza(h);
    if (!n) return null;
    if (n === 'fecha' && !usados.has('fecha')) { usados.add('fecha'); return 'fecha'; }
    const c = camposImportables(campos).find((x) => normaliza(x.etiqueta) === n && !usados.has(x.id));
    if (c) usados.add(c.id);
    return c ? c.id : null;
  });
}

/** Valor de celda → algo que el backend entienda (fechas de Excel → AAAA-MM-DD). */
export function valorCelda(v: any): any {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Las celdas de fecha de SheetJS llegan en UTC a medianoche local del archivo.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'string') return v.trim();
  return v;
}

/** Filas de la hoja (primera = encabezados) → filas para `importCustomRecords`.
 * Las filas totalmente vacías se descartan; `fila` es el número real de la hoja. */
export function filasParaImportar(rows: any[][], campos: CustomCampo[]): { filas: CustomImportFila[]; columnasIgnoradas: string[]; mapeo: (string | null)[] } {
  if (!rows.length) return { filas: [], columnasIgnoradas: [], mapeo: [] };
  const mapeo = mapearColumnas(rows[0], campos);
  const columnasIgnoradas = rows[0].filter((h, i) => mapeo[i] === null && normaliza(h)).map((h) => String(h));
  const filas: CustomImportFila[] = [];
  rows.slice(1).forEach((row, idx) => {
    const valores: Record<string, any> = {};
    let fecha: any;
    let alguno = false;
    mapeo.forEach((id, col) => {
      const v = valorCelda(row?.[col]);
      if (id === null || v === undefined || v === null || v === '') return;
      alguno = true;
      if (id === 'fecha') fecha = v; else valores[id] = v;
    });
    if (alguno) filas.push({ fila: idx + 2, ...(fecha !== undefined ? { fecha } : {}), valores });
  });
  return { filas, columnasIgnoradas, mapeo };
}
