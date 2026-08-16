import { compareClaves, sortByClave } from '../claveComparator';

describe('compareClaves', () => {
  it('ordena numéricamente por segmento, no como texto (caso obligatorio)', () => {
    const claves = ['10.3', '3.3', '1.10', '1.2', '4.3', '1.9'];
    const ordenadas = [...claves].sort(compareClaves);
    expect(ordenadas).toEqual(['1.2', '1.9', '1.10', '3.3', '4.3', '10.3']);
  });

  it('el orden de texto plano sería distinto (prueba de que el bug es real)', () => {
    const claves = ['10.3', '3.3', '1.10', '1.2', '4.3', '1.9'];
    const textoOrdenado = [...claves].sort();
    const numericoOrdenado = [...claves].sort(compareClaves);
    expect(textoOrdenado).not.toEqual(numericoOrdenado);
  });

  it('no asume un número fijo de segmentos', () => {
    const claves = ['1', '1.2', '1.2.1', '1.10', '2'];
    expect([...claves].sort(compareClaves)).toEqual(['1', '1.2', '1.2.1', '1.10', '2']);
  });

  it('una clave prefijo ordena antes que su hija', () => {
    expect(compareClaves('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('segmento no numérico ordena después de los numéricos en esa posición', () => {
    const claves = ['3.3A', '3.3', '3.10'];
    expect([...claves].sort(compareClaves)).toEqual(['3.3', '3.10', '3.3A']);
  });

  it('claves alfanuméricas sin punto (caso obligatorio del plan de Ampliación)', () => {
    const claves = ['A101', 'A1011', 'A1011.1', 'A102', 'A1010'];
    expect([...claves].sort(compareClaves)).toEqual(['A101', 'A102', 'A1010', 'A1011', 'A1011.1']);
  });

  it('claves alfanuméricas: el orden de texto plano sería distinto', () => {
    const claves = ['A101', 'A1011', 'A1011.1', 'A102', 'A1010'];
    const textoOrdenado = [...claves].sort();
    const numericoOrdenado = [...claves].sort(compareClaves);
    expect(textoOrdenado).not.toEqual(numericoOrdenado);
  });
});

describe('sortByClave', () => {
  it('ordena objetos por su campo clave', () => {
    const items = [{ clave: '10.3', x: 1 }, { clave: '3.3', x: 2 }, { clave: '1.2', x: 3 }];
    expect(sortByClave(items).map((i) => i.clave)).toEqual(['1.2', '3.3', '10.3']);
  });
});
