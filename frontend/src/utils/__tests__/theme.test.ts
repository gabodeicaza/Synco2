import { calendarioColores, contrastRatio, contrastText, colors, cumpleContraste } from '../../theme';

describe('contrastRatio (WCAG 2.x)', () => {
  it('negro sobre blanco es 21:1 y un color contra sí mismo es 1:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });

  it('el bug del título del día: blanco sobre el fondo de pantalla casi no se distingue', () => {
    expect(contrastRatio('#FFFFFF', colors.bg)).toBeLessThan(1.1);
    expect(cumpleContraste('#FFFFFF', colors.bg)).toBe(false);
  });

  it('acepta hex corto y devuelve 1 si algún color no es válido', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('no-es-color', '#FFFFFF')).toBe(1);
  });

  it('cumpleContraste usa 4.5 por defecto y acepta otro mínimo', () => {
    expect(cumpleContraste('#777777', '#FFFFFF')).toBe(false); // ~4.48:1: justo debajo de 4.5
    expect(cumpleContraste('#777777', '#FFFFFF', 4.4)).toBe(true);
    expect(cumpleContraste('#767676', '#FFFFFF')).toBe(true); // ~4.54:1
  });
});

describe('colores del Calendario (G-03): texto normal >= 4.5:1', () => {
  const c = calendarioColores;
  it.each([
    ['título del día sobre el fondo de la pantalla', c.tituloDia, c.fondoPantalla],
    ['día normal sobre el calendario', c.textoDia, c.fondoCalendario],
    ['encabezado de semana sobre el calendario', c.textoSeccion, c.fondoCalendario],
    ['título del mes sobre el calendario', c.textoMes, c.fondoCalendario],
    ['día de hoy sobre el calendario', c.hoy, c.fondoCalendario],
    ['flechas sobre el calendario', c.flecha, c.fondoCalendario],
    ['día seleccionado', c.seleccionadoTexto, c.seleccionadoFondo],
  ])('%s', (_nombre, fg, bg) => {
    expect(cumpleContraste(fg, bg, 4.5)).toBe(true);
  });
});

describe('contrastText', () => {
  it('blanco (o casi) devuelve el texto oscuro del tema, no blanco', () => {
    expect(contrastText('#FFFFFF')).toBe(colors.text);
    expect(contrastText('#FAFAFA')).toBe(colors.text);
  });

  it('negro (o oscuro) devuelve blanco', () => {
    expect(contrastText('#000000')).toBe('#FFFFFF');
    expect(contrastText('#1E293B')).toBe('#FFFFFF');
  });

  it('azul primario del tema (oscuro) devuelve blanco', () => {
    expect(contrastText(colors.primary)).toBe('#FFFFFF');
  });

  it('acepta hex corto (3 dígitos)', () => {
    expect(contrastText('#fff')).toBe(colors.text);
    expect(contrastText('#000')).toBe('#FFFFFF');
  });

  it('sin color, null o inválido: blanco por defecto (mismo comportamiento que antes)', () => {
    expect(contrastText(undefined)).toBe('#FFFFFF');
    expect(contrastText(null)).toBe('#FFFFFF');
    expect(contrastText('no-es-un-color')).toBe('#FFFFFF');
    expect(contrastText('')).toBe('#FFFFFF');
  });
});
