jest.mock('@/src/utils/storage', () => ({ storage: {} }));

import {
  LEGACY_TOKEN_KEY,
  LEGACY_USER_KEY,
  TOKEN_KEY,
  USER_KEY,
  borrarSesion,
  guardarSesion,
  leerToken,
  leerUsuarioCacheado,
  type AlmacenSesion,
} from '../sessionKeys';

// Almacén en memoria con dos "bóvedas" (segura y general), como el real.
function crearAlmacen(): AlmacenSesion & { seguro: Map<string, string>; general: Map<string, string> } {
  const seguro = new Map<string, string>();
  const general = new Map<string, string>();
  return {
    seguro,
    general,
    getItem: (async (k: string, fb: any) => (general.has(k) ? general.get(k) : fb)) as any,
    setItem: (async (k: string, v: any) => { general.set(k, v); return true; }) as any,
    removeItem: async (k: string) => { general.delete(k); return true; },
    secureGet: (async (k: string, fb: any) => (seguro.has(k) ? seguro.get(k) : fb)) as any,
    secureSet: (async (k: string, v: any) => { seguro.set(k, v); return true; }) as any,
    secureRemove: async (k: string) => { seguro.delete(k); return true; },
  };
}

describe('migración de llaves de sesión', () => {
  it('lee la llave vieja, escribe la nueva y borra la vieja', async () => {
    const s = crearAlmacen();
    s.seguro.set(LEGACY_TOKEN_KEY, 'tok-viejo');
    expect(await leerToken(s)).toBe('tok-viejo');
    expect(s.seguro.get(TOKEN_KEY)).toBe('tok-viejo');
    expect(s.seguro.has(LEGACY_TOKEN_KEY)).toBe(false);
  });

  it('migra también el usuario cacheado', async () => {
    const s = crearAlmacen();
    s.general.set(LEGACY_USER_KEY, '{"id":"u1"}');
    expect(await leerUsuarioCacheado(s)).toBe('{"id":"u1"}');
    expect(s.general.get(USER_KEY)).toBe('{"id":"u1"}');
    expect(s.general.has(LEGACY_USER_KEY)).toBe(false);
  });

  it('no borra la llave vieja si no pudo escribir la nueva', async () => {
    const s = crearAlmacen();
    s.seguro.set(LEGACY_TOKEN_KEY, 'tok-viejo');
    s.secureSet = (async () => false) as any;
    expect(await leerToken(s)).toBe('tok-viejo');
    expect(s.seguro.get(LEGACY_TOKEN_KEY)).toBe('tok-viejo');
  });

  it('es idempotente y la llave nueva tiene prioridad', async () => {
    const s = crearAlmacen();
    s.seguro.set(TOKEN_KEY, 'nuevo');
    s.seguro.set(LEGACY_TOKEN_KEY, 'viejo');
    expect(await leerToken(s)).toBe('nuevo');
    expect(await leerToken(s)).toBe('nuevo');
  });

  it('sin sesión devuelve cadena vacía', async () => {
    expect(await leerToken(crearAlmacen())).toBe('');
  });

  it('guardarSesion y borrarSesion no dejan rastro de las llaves viejas', async () => {
    const s = crearAlmacen();
    s.seguro.set(LEGACY_TOKEN_KEY, 'viejo');
    s.general.set(LEGACY_USER_KEY, 'viejo');
    await guardarSesion('tok', '{"id":"u"}', s);
    expect(s.seguro.has(LEGACY_TOKEN_KEY) || s.general.has(LEGACY_USER_KEY)).toBe(false);
    expect(s.seguro.get(TOKEN_KEY)).toBe('tok');
    await borrarSesion(s);
    expect(s.seguro.size + s.general.size).toBe(0);
  });
});
