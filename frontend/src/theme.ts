// Dirac · Royal Blue & White design tokens.
export const colors = {
  primary: '#1E40AF',
  primaryDark: '#1E3A8A',
  primaryLight: '#DBEAFE',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  text: '#0F172A',
  textBody: '#334155',
  textMuted: '#64748B',
  textInverse: '#FFFFFF',
  online: '#10B981',
  offline: '#94A3B8',
  syncing: '#F59E0B',
  error: '#EF4444',
  errorBg: '#FEE2E2',
  warning: '#F59E0B',
  warningBg: '#FEF3C7',
  success: '#10B981',
  successBg: '#D1FAE5',
  black: '#000000',
  overlay: 'rgba(0,0,0,0.6)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = { sm: 6, md: 10, lg: 14, full: 999 };

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sm: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  lg: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
};

// Helpers to color area chips consistently when an area lacks a color.
export function areaTone(hex?: string) {
  const c = hex || colors.primary;
  return { bg: c + '22', border: c + '55', text: c };
}

/**
 * Texto/ícono legible sobre un fondo de color arbitrario (ej. color_tema del
 * proyecto, configurable por el Coordinador — puede terminar siendo claro o
 * incluso blanco). Antes de esto varias pantallas (Catálogo de Conceptos,
 * Registrar/Visualizar avance) pintaban el ícono de "atrás" y la marca en
 * blanco fijo sobre ese fondo: si color_tema era claro, quedaban
 * invisibles ("no veo ninguna flecha ni nada"). Luminancia percibida
 * (ITU-R BT.601): fondos claros devuelven el texto oscuro del tema, fondos
 * oscuros devuelven blanco.
 */
export function contrastText(hex?: string | null): string {
  if (!hex) return '#FFFFFF';
  const raw = hex.replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return '#FFFFFF';
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 160 ? colors.text : '#FFFFFF';
}

/**
 * Versión de `hex` garantizada legible como TEXTO/ACENTO sobre fondo
 * blanco (a diferencia de `contrastText`, que resuelve el caso inverso:
 * texto sobre un fondo de ese color). Mismo problema, otro lugar: un tab
 * activo, un ícono de estado, un borde de acento pintado directo con
 * `color_tema` se vuelve ilegible si el color del proyecto es un pastel.
 * Si ya es suficientemente oscuro se devuelve tal cual; si no, se
 * oscurece progresivamente mezclando con negro; como último recurso cae a
 * `colors.primary`. Espejo de `_readable_dark_hex` en el backend
 * (server.py) — mismo criterio de luminancia, para que un color de marca
 * claro se vea consistente en PDF/PPTX y en la app.
 */
export function readableAccent(hex?: string | null): string {
  if (!hex) return colors.primary;
  const raw = hex.replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return colors.primary;
  let r = parseInt(full.slice(0, 2), 16);
  let g = parseInt(full.slice(2, 4), 16);
  let b = parseInt(full.slice(4, 6), 16);
  const rel = (rr: number, gg: number, bb: number) => (rr * 299 + gg * 587 + bb * 114) / 1000;
  if (rel(r, g, b) <= 153) return `#${full.toUpperCase()}`; // 0.6 * 255 ≈ 153
  const blackFrac = 0.55;
  r = Math.round(r * (1 - blackFrac));
  g = Math.round(g * (1 - blackFrac));
  b = Math.round(b * (1 - blackFrac));
  if (rel(r, g, b) <= 153) {
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  return colors.primary;
}

function rgbDeHex(hex: string): [number, number, number] | null {
  const raw = (hex || '').replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** Luminancia relativa WCAG 2.x de un color #RRGGBB (0 = negro, 1 = blanco); null si el hex no es válido. */
function luminanciaRelativa(hex: string): number | null {
  const rgb = rgbDeHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste WCAG 2.x entre dos colores #RRGGBB (de 1 a 21); 1 si alguno no es válido. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = luminanciaRelativa(hexA);
  const b = luminanciaRelativa(hexB);
  if (a === null || b === null) return 1;
  const [claro, oscuro] = a >= b ? [a, b] : [b, a];
  return (claro + 0.05) / (oscuro + 0.05);
}

/** ¿El texto `fg` sobre el fondo `bg` alcanza el contraste mínimo (4.5:1 = AA para texto normal)? */
export function cumpleContraste(fg: string, bg: string, min = 4.5): boolean {
  return contrastRatio(fg, bg) >= min;
}

/** Colores del Calendario, todos derivados de los tokens del tema. Cada par texto/fondo se prueba a 4.5:1. */
export const calendarioColores = {
  fondoPantalla: colors.bg,
  fondoCalendario: colors.surface,
  tituloDia: colors.text,
  textoDia: colors.text,
  textoSeccion: colors.textBody,
  textoMes: colors.text,
  hoy: colors.primary,
  seleccionadoFondo: colors.primary,
  seleccionadoTexto: colors.textInverse,
  flecha: colors.primary,
  // Los días fuera del mes están inactivos (WCAG exime al texto inactivo del 4.5:1).
  deshabilitado: colors.borderStrong,
};

/** Colores por defecto de la identidad del proyecto (los mismos que aplica el servidor). */
export const COLOR_IDENTIDAD_DEFECTO = '#003366';
export const COLOR_TEXTO_REPORTE_DEFECTO = '#0F172A';

/** Paleta sugerida para elegir el color de identidad (además de escribir #RRGGBB). */
export const paletaIdentidad = [
  '#003366', '#1E40AF', '#0F766E', '#15803D', '#B45309', '#B91C1C', '#7E22CE', '#0F172A',
];
