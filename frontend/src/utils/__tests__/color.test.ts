import { errorDeColor, esColorHexValido, normalizarColorHex } from '../color';

describe('color de identidad (P-02)', () => {
  it.each(['#1E40AF', '#1e40af', ' #ABCDEF '])('acepta %s', (v) => {
    expect(esColorHexValido(v)).toBe(true);
    expect(errorDeColor(v)).toBeNull();
  });

  it.each(['1E40AF', '#1E4', '#GGGGGG', 'azul', '#1E40AF0', '##112233'])('rechaza "%s" con un mensaje que lo cita', (v) => {
    expect(esColorHexValido(v)).toBe(false);
    expect(errorDeColor(v)).toContain('#RRGGBB');
    expect(errorDeColor(v)).toContain(v);
  });

  it('vacío no es error (significa "sin configurar")', () => {
    expect(errorDeColor('')).toBeNull();
    expect(errorDeColor('   ')).toBeNull();
    expect(normalizarColorHex('  ')).toBeNull();
  });

  it('normaliza a mayúsculas pero nunca corrige un valor inválido en silencio', () => {
    expect(normalizarColorHex('#1e40af')).toBe('#1E40AF');
    expect(normalizarColorHex('azul')).toBe('azul');
  });
});
