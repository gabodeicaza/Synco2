// Llaves de sesión. Antes se llamaban `syncsite_token` y `synco_user`; ahora
// llevan la marca Dirac. La migración es transparente: si la llave nueva está
// vacía se lee la vieja, se escribe la nueva y solo entonces se borra la vieja
// (nunca queda la sesión sin guardar si algo falla a la mitad).
import { storage as almacenGlobal } from '@/src/utils/storage';

export const TOKEN_KEY = 'dirac_token';
export const USER_KEY = 'dirac_user';
export const LEGACY_TOKEN_KEY = 'syncsite_token';
export const LEGACY_USER_KEY = 'synco_user';

export type AlmacenSesion = Pick<
  typeof almacenGlobal,
  'getItem' | 'setItem' | 'removeItem' | 'secureGet' | 'secureSet' | 'secureRemove'
>;

export async function leerToken(s: AlmacenSesion = almacenGlobal): Promise<string> {
  const nuevo = await s.secureGet<string>(TOKEN_KEY, '');
  if (nuevo) return nuevo;
  const viejo = await s.secureGet<string>(LEGACY_TOKEN_KEY, '');
  if (!viejo) return '';
  if (await s.secureSet(TOKEN_KEY, viejo)) await s.secureRemove(LEGACY_TOKEN_KEY);
  return viejo;
}

export async function leerUsuarioCacheado(s: AlmacenSesion = almacenGlobal): Promise<string> {
  const nuevo = await s.getItem<string>(USER_KEY, '');
  if (nuevo) return nuevo;
  const viejo = await s.getItem<string>(LEGACY_USER_KEY, '');
  if (!viejo) return '';
  if (await s.setItem(USER_KEY, viejo)) await s.removeItem(LEGACY_USER_KEY);
  return viejo;
}

export async function guardarSesion(token: string, usuarioJson: string, s: AlmacenSesion = almacenGlobal) {
  await s.secureSet(TOKEN_KEY, token);
  await s.setItem(USER_KEY, usuarioJson);
  // Si quedaba una sesión con las llaves viejas, ya no debe sobrevivir.
  await s.secureRemove(LEGACY_TOKEN_KEY);
  await s.removeItem(LEGACY_USER_KEY);
}

export async function guardarUsuarioCacheado(usuarioJson: string, s: AlmacenSesion = almacenGlobal) {
  await s.setItem(USER_KEY, usuarioJson);
  await s.removeItem(LEGACY_USER_KEY);
}

export async function borrarSesion(s: AlmacenSesion = almacenGlobal) {
  await s.secureRemove(TOKEN_KEY);
  await s.secureRemove(LEGACY_TOKEN_KEY);
  await s.removeItem(USER_KEY);
  await s.removeItem(LEGACY_USER_KEY);
}
