// Datos de la app que se muestran en "Acerca de" y enlaces legales públicos.
import Constants from 'expo-constants';
import { BACKEND_URL } from '@/src/httpClient';

export const SOPORTE_EMAIL: string = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'gabodeicaza@gmail.com';

export type PaginaLegal = 'privacidad' | 'terminos' | 'eliminar-cuenta';

/** URL pública de las páginas legales que sirve el backend. */
export function urlLegal(pagina: PaginaLegal, base: string = BACKEND_URL): string {
  return `${base.replace(/\/+$/, '')}/api/${pagina}`;
}

/** Versión y compilación tal como las declara el binario instalado. */
export function versionApp(c: any = Constants): { version: string; build: string } {
  const version = c?.expoConfig?.version || c?.nativeAppVersion || '—';
  const build =
    c?.nativeBuildVersion ||
    (c?.expoConfig?.android?.versionCode != null ? String(c.expoConfig.android.versionCode) : '') ||
    (c?.expoConfig?.ios?.buildNumber ?? '') ||
    '—';
  return { version: String(version), build: String(build) };
}
