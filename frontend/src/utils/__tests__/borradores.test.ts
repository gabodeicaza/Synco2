// Borradores del reporte Nuevo: qué cuenta como contenido, orden/tope y persistencia
// (índice liviano + cuerpo en archivo) sobre un sistema de archivos falso en memoria.
jest.mock('expo-file-system/legacy', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    documentDirectory: 'file:///fake-doc/',
    EncodingType: { UTF8: 'utf8' },
    getInfoAsync: jest.fn(async (p: string) => ({ exists: store.has(p) })),
    readAsStringAsync: jest.fn(async (p: string) => {
      if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
      return store.get(p) as string;
    }),
    writeAsStringAsync: jest.fn(async (p: string, c: string) => { store.set(p, c); }),
    deleteAsync: jest.fn(async (p: string) => { store.delete(p); }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      store.set(to, store.get(from) as string);
      store.delete(from);
    }),
  };
});

import * as FileSystem from 'expo-file-system/legacy';
import {
  Borrador, BorradorDatos, MAX_BORRADORES, contarBorradores, datosConContenido, eliminarBorrador,
  guardarBorrador, leerBorrador, listarBorradores, textoHace, upsertResumen,
} from '../borradores';

const vacio = (): BorradorDatos => ({
  nombre: '', severidad: ['informativo'], registrarLecturas: false, unidad: 'm',
  primeraLectura: '', ultimaLectura: '', actividades: '', observaciones: '', incidencias: '',
  personal: [], equipo: [], camposExtra: {}, images: [], captions: ['', ''],
  templateId: 'tpl1', dynamicData: {},
});

const borrador = (id: string, actualizado: number, datos: Partial<BorradorDatos> = {}): Borrador => ({
  id, projectId: 'p1', nodeId: 'n1', ubicacion: ['Tramo 1', 'Estación 3'], titulo: 'Inspección',
  fotos: 0, actualizado, datos: { ...vacio(), ...datos },
});

beforeEach(() => {
  (FileSystem as any).__store.clear();
  jest.clearAllMocks();
  // El índice vive en AsyncStorage (mock en memoria de jest.setup).
  return require('@react-native-async-storage/async-storage').clear();
});

describe('datosConContenido', () => {
  it('un formulario sin tocar (solo plantilla/unidad por defecto) no cuenta', () => {
    expect(datosConContenido(vacio())).toBe(false);
  });
  it('texto con solo espacios no cuenta', () => {
    expect(datosConContenido({ ...vacio(), actividades: '   ' })).toBe(false);
  });
  it.each([
    ['nombre', { nombre: 'x' }],
    ['actividades', { actividades: 'x' }],
    ['observaciones', { observaciones: 'x' }],
    ['incidencias', { incidencias: 'x' }],
    ['fotos', { images: ['data:image/jpeg;base64,AAA'] }],
    ['descripción de foto', { captions: ['', 'x'] }],
    ['personal', { personal: [{ id: '1', desc: 'Oficial', qty: 1 }] }],
    ['campo extra', { camposExtra: { a: '3' } }],
    ['campo de plantilla', { dynamicData: { k: 'v' } }],
    ['lecturas (si están activadas)', { registrarLecturas: true, primeraLectura: '10' }],
  ])('cuenta %s', (_n, parcial) => {
    expect(datosConContenido({ ...vacio(), ...(parcial as Partial<BorradorDatos>) })).toBe(true);
  });
  it('lecturas escritas pero desactivadas no cuentan', () => {
    expect(datosConContenido({ ...vacio(), primeraLectura: '10' })).toBe(false);
  });
  it('un switch de plantilla en falso no cuenta, en verdadero sí', () => {
    expect(datosConContenido({ ...vacio(), dynamicData: { ok: false } })).toBe(false);
    expect(datosConContenido({ ...vacio(), dynamicData: { ok: true } })).toBe(true);
  });
});

describe('upsertResumen', () => {
  it('reemplaza por id y deja el más reciente primero', () => {
    const a = { ...borrador('a', 1), datos: undefined } as any;
    const b = { ...borrador('b', 2), datos: undefined } as any;
    const lista = upsertResumen([a, b], { ...a, actualizado: 5, titulo: 'nuevo' });
    expect(lista.map((x) => x.id)).toEqual(['a', 'b']);
    expect(lista[0].titulo).toBe('nuevo');
  });
  it(`conserva solo los ${MAX_BORRADORES} más recientes`, () => {
    let lista: any[] = [];
    for (let i = 0; i < MAX_BORRADORES + 3; i++) lista = upsertResumen(lista, { ...borrador(`b${i}`, i), datos: undefined } as any);
    expect(lista).toHaveLength(MAX_BORRADORES);
    expect(lista[0].id).toBe(`b${MAX_BORRADORES + 2}`);
    expect(lista.some((x) => x.id === 'b0')).toBe(false);
  });
});

describe('persistencia', () => {
  it('guarda y lee un borrador completo con sus fotos', async () => {
    const b = borrador('x1', 100, { actividades: 'Colado', images: ['data:image/jpeg;base64,AAA'] });
    expect(await guardarBorrador('u1', b)).toBe(true);
    const leido = await leerBorrador('u1', 'x1');
    expect(leido?.datos.actividades).toBe('Colado');
    expect(leido?.datos.images).toEqual(['data:image/jpeg;base64,AAA']);
  });

  it('el índice solo lleva el resumen (sin fotos) con el conteo de fotos', async () => {
    await guardarBorrador('u1', borrador('x1', 100, { images: ['a', 'b'] }));
    const lista = await listarBorradores('u1');
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: 'x1', fotos: 2, titulo: 'Inspección' });
    expect((lista[0] as any).datos).toBeUndefined();
  });

  it('guardar dos veces el mismo id actualiza, no duplica', async () => {
    await guardarBorrador('u1', borrador('x1', 100, { actividades: 'uno' }));
    await guardarBorrador('u1', borrador('x1', 200, { actividades: 'dos' }));
    expect(await contarBorradores('u1')).toBe(1);
    expect((await leerBorrador('u1', 'x1'))?.datos.actividades).toBe('dos');
  });

  it('lista el más reciente primero', async () => {
    await guardarBorrador('u1', borrador('viejo', 100));
    await guardarBorrador('u1', borrador('nuevo', 300));
    await guardarBorrador('u1', borrador('medio', 200));
    expect((await listarBorradores('u1')).map((x) => x.id)).toEqual(['nuevo', 'medio', 'viejo']);
  });

  it('cada usuario ve solo sus borradores', async () => {
    await guardarBorrador('u1', borrador('x1', 100));
    expect(await listarBorradores('u2')).toEqual([]);
    expect(await leerBorrador('u2', 'x1')).toBeNull();
  });

  it('eliminar quita el índice y el archivo', async () => {
    await guardarBorrador('u1', borrador('x1', 100));
    await eliminarBorrador('u1', 'x1');
    expect(await listarBorradores('u1')).toEqual([]);
    expect(await leerBorrador('u1', 'x1')).toBeNull();
    expect((FileSystem as any).__store.size).toBe(0);
  });

  it('al pasar del tope se borra también el archivo del más viejo', async () => {
    for (let i = 0; i < MAX_BORRADORES + 1; i++) await guardarBorrador('u1', borrador(`b${i}`, i));
    expect(await contarBorradores('u1')).toBe(MAX_BORRADORES);
    expect(await leerBorrador('u1', 'b0')).toBeNull();
    expect((FileSystem as any).__store.size).toBe(MAX_BORRADORES);
  });

  it('escrituras simultáneas no se pisan el índice', async () => {
    await Promise.all([
      guardarBorrador('u1', borrador('a', 1)),
      guardarBorrador('u1', borrador('b', 2)),
      guardarBorrador('u1', borrador('c', 3)),
    ]);
    expect((await listarBorradores('u1')).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('sin usuario no guarda nada', async () => {
    expect(await guardarBorrador('', borrador('x1', 1))).toBe(false);
    expect(await listarBorradores('')).toEqual([]);
  });

  it('si falla la escritura del archivo devuelve false y no ensucia el índice', async () => {
    (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('disco lleno'));
    expect(await guardarBorrador('u1', borrador('x1', 1))).toBe(false);
    expect(await listarBorradores('u1')).toEqual([]);
  });
});

describe('textoHace', () => {
  const t0 = 1_000_000_000_000;
  it.each([
    [0, 'hace un momento'],
    [5 * 60_000, 'hace 5 min'],
    [3 * 3_600_000, 'hace 3 h'],
    [30 * 3_600_000, 'ayer'],
    [72 * 3_600_000, 'hace 3 días'],
  ])('%d ms', (dif, esperado) => {
    expect(textoHace(t0 - dif, t0)).toBe(esperado);
  });
});
