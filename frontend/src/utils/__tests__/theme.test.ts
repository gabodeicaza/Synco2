import { contrastText, colors } from '../../theme';

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
