import { unir, unirOVacio } from '../texto';

describe('unir', () => {
  it('une con " · " y omite partes vacías', () => {
    expect(unir(['Obra', '', null, undefined, false, '  ', 'Sur'])).toBe('Obra · Sur');
  });

  it('acepta números y recorta espacios', () => {
    expect(unir([12, ' km 3 ', 0])).toBe('12 · km 3 · 0');
  });

  it('permite otro separador', () => {
    expect(unir(['a', 'b'], ' / ')).toBe('a / b');
  });

  it('sin partes devuelve cadena vacía', () => {
    expect(unir([])).toBe('');
    expect(unir([null, '', false])).toBe('');
  });
});

describe('unirOVacio', () => {
  it('devuelve el guion largo cuando no hay nada que mostrar', () => {
    expect(unirOVacio([])).toBe('—');
    expect(unirOVacio([null, ''], 'Sin datos')).toBe('Sin datos');
  });

  it('si hay partes, las une', () => {
    expect(unirOVacio(['A', 'B'])).toBe('A · B');
  });
});
