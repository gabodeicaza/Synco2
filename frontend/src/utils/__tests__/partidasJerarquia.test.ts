import { alTocarPartida, filasDeChips, partidasEnOrdenDeArbol, rutaDePartida } from '../partidasJerarquia';

// Árbol de 3 niveles:
//   1 Obra civil
//     1.1 Cimentación
//       1.1.1 Zapatas
//     1.2 Muros
//   2 Instalaciones
const P = [
  { id: 'r2', clave: '2', nombre: 'Instalaciones', partida_padre_id: null },
  { id: 'n3', clave: '1.1.1', nombre: 'Zapatas', partida_padre_id: 'n2a' },
  { id: 'n2b', clave: '1.2', nombre: 'Muros', partida_padre_id: 'r1' },
  { id: 'r1', clave: '1', nombre: 'Obra civil', partida_padre_id: null },
  { id: 'n2a', clave: '1.1', nombre: 'Cimentación', partida_padre_id: 'r1' },
  { id: 'r10', clave: '10', nombre: 'Limpieza', partida_padre_id: null },
];

describe('rutaDePartida', () => {
  it('va de la raíz a la partida', () => {
    expect(rutaDePartida(P, 'n3')).toEqual(['r1', 'n2a', 'n3']);
    expect(rutaDePartida(P, 'r1')).toEqual(['r1']);
  });

  it('sin elegida o inexistente, vacía', () => {
    expect(rutaDePartida(P, null)).toEqual([]);
    expect(rutaDePartida(P, 'nope')).toEqual([]);
  });

  it('un ciclo en los datos no se cuelga', () => {
    const ciclo = [
      { id: 'a', clave: '1', nombre: 'A', partida_padre_id: 'b' },
      { id: 'b', clave: '2', nombre: 'B', partida_padre_id: 'a' },
    ];
    expect(rutaDePartida(ciclo, 'a').length).toBeLessThanOrEqual(2);
  });
});

describe('filasDeChips', () => {
  it('sin elección solo muestra las raíces, ordenadas por clave numérica', () => {
    const filas = filasDeChips(P, null);
    expect(filas).toHaveLength(1);
    expect(filas[0].nivel).toBe(0);
    expect(filas[0].chips.map((c) => c.clave)).toEqual(['1', '2', '10']);
    expect(filas[0].chips.every((c) => !c.enRuta && !c.elegida)).toBe(true);
    expect(filas[0].chips.find((c) => c.id === 'r1')!.tieneHijas).toBe(true);
    expect(filas[0].chips.find((c) => c.id === 'r2')!.tieneHijas).toBe(false);
  });

  it('elegida una raíz agrega la fila de sus hijas', () => {
    const filas = filasDeChips(P, 'r1');
    expect(filas.map((f) => f.nivel)).toEqual([0, 1]);
    expect(filas[0].chips.find((c) => c.id === 'r1')).toMatchObject({ enRuta: true, elegida: true });
    expect(filas[1].chips.map((c) => c.clave)).toEqual(['1.1', '1.2']);
  });

  it('elegida una nieta muestra un nivel por cada ancestro y marca la ruta', () => {
    const filas = filasDeChips(P, 'n3');
    expect(filas.map((f) => f.nivel)).toEqual([0, 1, 2]);
    expect(filas[1].chips.find((c) => c.id === 'n2a')).toMatchObject({ enRuta: true, elegida: false, tieneHijas: true });
    expect(filas[2].chips).toEqual([expect.objectContaining({ id: 'n3', elegida: true, enRuta: true, tieneHijas: false })]);
  });

  it('una hoja elegida no agrega filas vacías', () => {
    expect(filasDeChips(P, 'n2b').map((f) => f.nivel)).toEqual([0, 1]);
  });

  it('un padre que ya no existe deja a la partida como raíz', () => {
    const filas = filasDeChips([{ id: 'x', clave: '9', nombre: 'Huérfana', partida_padre_id: 'borrada' }], null);
    expect(filas[0].chips.map((c) => c.id)).toEqual(['x']);
  });

  it('sin partidas no hay filas', () => {
    expect(filasDeChips([], null)).toEqual([]);
  });
});

describe('alTocarPartida', () => {
  it('tocar otra la elige', () => {
    expect(alTocarPartida(P, null, 'r1')).toBe('r1');
    expect(alTocarPartida(P, 'r1', 'n2a')).toBe('n2a');
    expect(alTocarPartida(P, 'n3', 'r1')).toBe('r1'); // subir a un ancestro
  });

  it('tocar la elegida sube un nivel; en la raíz quita el filtro', () => {
    expect(alTocarPartida(P, 'n3', 'n3')).toBe('n2a');
    expect(alTocarPartida(P, 'n2a', 'n2a')).toBe('r1');
    expect(alTocarPartida(P, 'r1', 'r1')).toBeNull();
  });
});

describe('partidasEnOrdenDeArbol', () => {
  it('ordena en profundidad con su nivel', () => {
    expect(partidasEnOrdenDeArbol(P).map((x) => [x.partida.clave, x.nivel])).toEqual([
      ['1', 0], ['1.1', 1], ['1.1.1', 2], ['1.2', 1], ['2', 0], ['10', 0],
    ]);
  });

  it('un ciclo no se repite', () => {
    const ciclo = [
      { id: 'a', clave: '1', nombre: 'A', partida_padre_id: 'b' },
      { id: 'b', clave: '2', nombre: 'B', partida_padre_id: 'a' },
    ];
    expect(partidasEnOrdenDeArbol(ciclo)).toEqual([]);
  });
});
