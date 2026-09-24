import { esNombreRepetido, normalizarNombre } from '../nombres';

describe('nombres', () => {
  it('ignora acentos, mayúsculas y espacios sobrantes', () => {
    expect(normalizarNombre('  Topografía   Vial ')).toBe('topografia vial');
    expect(normalizarNombre('ALBAÑILES')).toBe('albaniles');
    expect(normalizarNombre(null)).toBe('');
  });

  it('detecta repetidos aunque cambie la escritura', () => {
    expect(esNombreRepetido('topografia ', ['Geotecnia', 'Topografía'])).toBe(true);
    expect(esNombreRepetido('Seguridad', ['Geotecnia', 'Topografía'])).toBe(false);
  });

  it('un nombre vacío nunca cuenta como repetido', () => {
    expect(esNombreRepetido('   ', ['', ' '])).toBe(false);
  });
});
