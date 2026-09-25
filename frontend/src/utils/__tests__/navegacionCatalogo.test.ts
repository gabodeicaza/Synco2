import {
  ALTO_BOTON_FLOTANTE, ALTO_PIE_CATALOGO, SEPARACION_CATALOGO, conteoDePestana, margenesCatalogo, pestanaPorDefecto,
  resolverPestana, rutaDePartida,
} from '../navegacionCatalogo';

describe('pestañas del nodo (C-11)', () => {
  it('un nodo con subniveles abre en Estructura', () => {
    expect(pestanaPorDefecto({ subniveles: 3 })).toBe('estructura');
  });

  it('una hoja (sin subniveles) abre en Conceptos, tenga o no conceptos todavía', () => {
    expect(pestanaPorDefecto({ subniveles: 0 })).toBe('conceptos');
  });

  it('lo elegido por el usuario manda sobre la pestaña por defecto', () => {
    expect(resolverPestana('conceptos', { subniveles: 3 })).toBe('conceptos');
    expect(resolverPestana('estructura', { subniveles: 0 })).toBe('estructura');
    expect(resolverPestana(undefined, { subniveles: 2 })).toBe('estructura');
    expect(resolverPestana(null, { subniveles: 0 })).toBe('conceptos');
  });

  it('el conteo muestra "…" mientras cargan los conceptos', () => {
    expect(conteoDePestana('conceptos', { subniveles: 2, conceptos: null })).toBe('…');
    expect(conteoDePestana('conceptos', { subniveles: 2, conceptos: 0 })).toBe('0');
    expect(conteoDePestana('estructura', { subniveles: 4, conceptos: null })).toBe('4');
  });
});

describe('rutaDePartida (C-10)', () => {
  const partidas = [
    { id: 'a', partida_padre_id: null },
    { id: 'b', partida_padre_id: 'a' },
    { id: 'c', partida_padre_id: 'b' },
    { id: 'd', partida_padre_id: 'c' },
    { id: 'x', partida_padre_id: null },
  ];

  it('devuelve los ids de la raíz al nodo, a cualquier profundidad', () => {
    expect(rutaDePartida(partidas, 'd')).toEqual(['a', 'b', 'c', 'd']);
    expect(rutaDePartida(partidas, 'a')).toEqual(['a']);
    expect(rutaDePartida(partidas, 'x')).toEqual(['x']);
  });

  it('devuelve null si la partida no existe o no se indica', () => {
    expect(rutaDePartida(partidas, 'zzz')).toBeNull();
    expect(rutaDePartida(partidas, null)).toBeNull();
    expect(rutaDePartida(partidas, undefined)).toBeNull();
  });

  it('corta en el último ancestro conocido si el padre ya no existe', () => {
    expect(rutaDePartida([{ id: 'h', partida_padre_id: 'borrado' }], 'h')).toEqual(['h']);
  });

  it('no se cicla si los datos tienen un ciclo', () => {
    const ciclo = [{ id: 'p', partida_padre_id: 'q' }, { id: 'q', partida_padre_id: 'p' }];
    const ruta = rutaDePartida(ciclo, 'p');
    expect(ruta).not.toBeNull();
    expect(ruta!.length).toBe(2);
  });
});

describe('márgenes inferiores del catálogo (C-15)', () => {
  it('sin área segura reproduce los márgenes de antes (botón 58 sobre el pie, lista 110)', () => {
    const m = margenesCatalogo(0, true);
    expect(m.piePaddingBottom).toBe(SEPARACION_CATALOGO);
    expect(m.botonBottom).toBe(ALTO_PIE_CATALOGO + SEPARACION_CATALOGO);
    expect(m.listaPaddingBottom).toBe(ALTO_PIE_CATALOGO + ALTO_BOTON_FLOTANTE + SEPARACION_CATALOGO * 2);
    expect(m.listaPaddingBottom).toBe(110);
  });

  it('con barra de gestos (inset inferior) sube el botón, el pie y el final de la lista', () => {
    const sin = margenesCatalogo(0, true);
    const con = margenesCatalogo(34, true);
    expect(con.piePaddingBottom).toBe(sin.piePaddingBottom + 34);
    expect(con.botonBottom).toBe(sin.botonBottom + 34);
    expect(con.listaPaddingBottom).toBe(sin.listaPaddingBottom + 34);
  });

  it('el botón queda por encima del pie y la lista deja pasar botón y pie', () => {
    const m = margenesCatalogo(20, true);
    expect(m.botonBottom).toBeGreaterThan(ALTO_PIE_CATALOGO + 20);
    expect(m.listaPaddingBottom).toBeGreaterThanOrEqual(m.botonBottom + ALTO_BOTON_FLOTANTE);
  });

  it('sin botón flotante la lista no reserva su espacio', () => {
    expect(margenesCatalogo(0, false).listaPaddingBottom).toBe(ALTO_PIE_CATALOGO + SEPARACION_CATALOGO * 2);
  });

  it('un inset inválido o negativo se trata como 0', () => {
    expect(margenesCatalogo(NaN, true)).toEqual(margenesCatalogo(0, true));
    expect(margenesCatalogo(-10, true)).toEqual(margenesCatalogo(0, true));
    expect(margenesCatalogo(undefined, true)).toEqual(margenesCatalogo(0, true));
    expect(margenesCatalogo(null, false)).toEqual(margenesCatalogo(0, false));
  });
});
