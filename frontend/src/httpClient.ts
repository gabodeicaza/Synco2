// SynCo v2.0 _ Cliente HTTP generico (extraido de api.ts para que
// utils/offlineQueue.ts pueda reusar `request`/`ApiError` sin generar un
// import circular con api.ts, que a su vez necesita encolar reportes).
import { leerToken } from '@/src/utils/sessionKeys';
import { mensajeDeError } from '@/src/utils/errores';

/**
 * BASE URL del backend.
 *
 * [ENV 2026-08-21] `EXPO_PUBLIC_API_URL` (ya con `/api` incluido, ej.
 * `http://201.132.19.140/api`) tiene prioridad si esta definida. Si no, cae
 * al hardcode de produccion de siempre.
 *
 * Por que sigue habiendo un fallback hardcoded y no un `throw` si falta la
 * env var: [HARDCODE 2026-07-11] documentaba que el pipeline de EAS Build de
 * Emergent NO inyecta el `.env` en los APKs fisicos (el pipeline hace un
 * auto-commit y `.env` esta en `.gitignore`, asi que nunca llega a la nube).
 * Ese build nativo seguira sin ver `EXPO_PUBLIC_API_URL` y debe caer al
 * dominio de produccion, no romperse. El export web
 * (`npx expo export -p web`) si se corre localmente leyendo el `.env` del
 * repo, asi que ahi la variable si aplica -- justo lo que resuelve el CORS
 * de la version web: en vez de pegarle siempre a `https://apm-app.mx`
 * (origen distinto al host donde qued  desplegada la web), puede apuntar al
 * mismo host/IP que sirve la API, quedando same-origin.
 */
const ENV_API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
export const BASE: string = ENV_API_URL || 'https://apm-app.mx/api';
export const BACKEND_URL: string = BASE.replace(/\/api\/?$/, '');

// [DIAG 2026-07-11] Log visible en Metro/logcat para verificar la URL final.
try {
  console.log(`[SynCo][BASE] BASE="${BASE}" (${ENV_API_URL ? 'EXPO_PUBLIC_API_URL' : 'hardcoded'})`);
} catch {
  /* noop */
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// [PERF 2026-08-07] Cache en memoria del JWT. `SecureStore.getItemAsync` hace
// un roundtrip nativo al Keystore (Android) / Keychain (iOS) en cada llamada;
// pantallas como el Hub de Minutas disparan 4-5 requests en paralelo que cada
// una leia el token por su cuenta. `setAuthTokenCache` se actualiza desde
// auth-context.tsx en login/logout/refresh para que la cache nunca quede
// desincronizada de lo persistido en SecureStore.
let cachedToken: string | null | undefined;

export function setAuthTokenCache(token: string | null): void {
  cachedToken = token;
}

export async function getToken(): Promise<string> {
  if (cachedToken === undefined) {
    cachedToken = (await leerToken()) || null;
  }
  return cachedToken || '';
}

export async function authHeader(): Promise<Record<string, string>> {
  const tok = await getToken();
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

export async function request<T>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
  };
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const msg = (data && (data as any).detail) || `HTTP ${res.status}`;
    throw new ApiError(res.status, mensajeDeError(msg));
  }
  return data as T;
}

export function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}
