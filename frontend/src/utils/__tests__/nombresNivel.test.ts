import {
  articulo, concordancia, concordanciaConcepto, concordanciaNivel, generoForzado, generoNombre, nombreConcepto,
  nombreNivel, pluralizar, pluralizarEs,
} from '../nombresNivel';

describe('generoNombre (mismas reglas que genero_nombre_es del backend)', () => {
  it.each([
    ['Frente', 'm'], ['Partida', 'f'], ['Tramo', 'm'], ['Estructura', 'f'], ['Concepto', 'm'],
    ['Actividad', 'f'], ['Capítulo', 'm'], ['Sistema', 'm'], ['Nivel', 'm'], ['Etapa', 'f'],
    ['Zona', 'f'], ['Sección', 'f'], ['Obra civil', 'f'], ['Sub-partida', 'f'], ['Programa', 'm'],
    ['Mano de obra', 'f'], ['Fase', 'f'], ['Tesis', 'f'], ['Área', 'f'],
  ])('%s es %s', (nombre, genero) => {
    expect(generoNombre(nombre)).toBe(genero);
  });

  it('un nombre vacío cae a masculino', () => {
    expect(generoNombre('')).toBe('m');
    expect(generoNombre('   ')).toBe('m');
  });

  it('el género forzado manda sobre la heurística', () => {
    expect(generoNombre('Frente', 'f')).toBe('f');
    expect(generoNombre('Partida', 'm')).toBe('m');
  });
});

describe('pluralizarEs (mismas reglas que pluralizar_es del backend)', () => {
  it.each([
    ['nivel', 'niveles'], ['actividad', 'actividades'], ['frente', 'frentes'], ['capítulo', 'capítulos'],
    ['estación', 'estaciones'], ['sistema', 'sistemas'], ['partida', 'partidas'], ['concepto', 'conceptos'],
    ['luz', 'luces'], ['crisis', 'crisis'], ['lunes', 'lunes'], ['mes', 'meses'], ['país', 'países'],
    ['sección', 'secciones'], ['zona', 'zonas'], ['etapa de obra', 'etapas de obra'],
    ['Sub-partida', 'Sub-partidas'], ['Estructura', 'Estructuras'],
  ])('%s → %s', (singular, plural) => {
    expect(pluralizarEs(singular)).toBe(plural);
  });

  it('nunca produce "nivels" (el error del plural anterior)', () => {
    expect(pluralizarEs('nivel')).not.toBe('nivels');
    expect(pluralizarEs('Nivel 3')).toBe('Niveles');
    expect(pluralizarEs('nivel 12')).toBe('niveles');
  });

  it('pluralizar es el mismo comportamiento (alias histórico)', () => {
    expect(pluralizar('nivel')).toBe('niveles');
    expect(pluralizar('')).toBe('');
  });
});

describe('articulo', () => {
  it('definido e indefinido, singular y plural', () => {
    expect(articulo('Tramo')).toBe('el');
    expect(articulo('Partida')).toBe('la');
    expect(articulo('Tramo', { definido: false })).toBe('un');
    expect(articulo('Partida', { definido: false })).toBe('una');
    expect(articulo('Frente', { plural: true })).toBe('los');
    expect(articulo('Zona', { plural: true })).toBe('las');
    expect(articulo('Zona', { plural: true, definido: false })).toBe('unas');
  });

  it('a tónica: "el área" y "un área"', () => {
    expect(articulo('Área')).toBe('el');
    expect(articulo('Área', { definido: false })).toBe('un');
    expect(articulo('Área', { plural: true })).toBe('las');
  });

  it('respeta el género forzado', () => {
    expect(articulo('Frente', { forzado: 'f' })).toBe('la');
    expect(articulo('Frente', { forzado: 'f', definido: false })).toBe('una');
  });
});

describe('generoForzado', () => {
  it('lee el género del proyecto sin distinguir mayúsculas', () => {
    const p = { genero_niveles: { Frente: 'f' as const } };
    expect(generoForzado(p, 'Frente')).toBe('f');
    expect(generoForzado(p, 'frente')).toBe('f');
    expect(generoForzado(p, 'Tramo')).toBeUndefined();
  });

  it('sin proyecto o sin mapa no fuerza nada', () => {
    expect(generoForzado(null, 'Frente')).toBeUndefined();
    expect(generoForzado({}, 'Frente')).toBeUndefined();
  });
});

describe('concordancia', () => {
  it('masculino', () => {
    const c = concordancia('Tramo');
    expect(c).toMatchObject({
      genero: 'm', minuscula: 'tramo', plural: 'tramos', el: 'el', un: 'un', este: 'este', ningun: 'ningún',
      nuevo: 'Nuevo', creado: 'creado', borrado: 'borrado', los: 'los', estos: 'estos',
    });
  });

  it('femenino', () => {
    const c = concordancia('Partida');
    expect(c).toMatchObject({
      genero: 'f', minuscula: 'partida', plural: 'partidas', el: 'la', un: 'una', este: 'esta', ningun: 'ninguna',
      nuevo: 'Nueva', creado: 'creada', borrado: 'borrada', los: 'las', estos: 'estas',
    });
  });

  it('con género forzado', () => {
    expect(concordancia('Frente', 'f').nuevo).toBe('Nueva');
    expect(concordancia('Frente', 'f').Este).toBe('Esta');
    expect(concordancia('Frente').Este).toBe('Este');
  });

  it('nunca genera "nivel 3s": el plural de un nombre con número no rompe la palabra', () => {
    expect(concordancia('Nivel').plural).toBe('niveles');
  });
});

describe('concordanciaNivel / concordanciaConcepto con el proyecto', () => {
  const proyecto = {
    nombres_niveles_partida: ['Frente', 'Tramo', 'Estructura'],
    nombre_nivel_concepto: 'Actividad',
    genero_niveles: { Frente: 'f' as const },
  };

  it('usa los nombres configurados por profundidad', () => {
    expect(concordanciaNivel(proyecto, 0)).toMatchObject({ nombre: 'Frente', nuevo: 'Nueva' }); // forzado
    expect(concordanciaNivel(proyecto, 1)).toMatchObject({ nombre: 'Tramo', nuevo: 'Nuevo' });
    expect(concordanciaNivel(proyecto, 2)).toMatchObject({ nombre: 'Estructura', nuevo: 'Nueva' });
  });

  it('un nivel más profundo que los configurados cae a "Nivel N" masculino y plural correcto', () => {
    const c = concordanciaNivel(proyecto, 4);
    expect(c.nombre).toBe('Nivel 5');
    expect(c.nuevo).toBe('Nuevo');
  });

  it('el concepto usa su nombre y género', () => {
    expect(concordanciaConcepto(proyecto)).toMatchObject({ nombre: 'Actividad', nuevo: 'Nueva', el: 'la' });
    expect(concordanciaConcepto({ ...proyecto, genero_niveles: { Actividad: 'm' } })).toMatchObject({ nuevo: 'Nuevo' });
  });

  it('sin configurar conserva los nombres históricos', () => {
    expect(concordanciaNivel(null, 0)).toMatchObject({ nombre: 'Partida', nuevo: 'Nueva', minuscula: 'partida' });
    expect(concordanciaConcepto(null)).toMatchObject({ nombre: 'Concepto', nuevo: 'Nuevo', minuscula: 'concepto' });
    expect(nombreNivel(null, 1)).toBe('Sub-partida');
    expect(nombreConcepto(null)).toBe('Concepto');
  });
});
