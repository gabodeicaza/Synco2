// Ubicación GPS real de un nodo (T-05b). Independiente de las coordenadas objetivo
// (target_*), que en la práctica guardan UTM. Las coordenadas GPS son grados decimales
// WGS84: ambos valores o ninguno, latitud -90..90 y longitud -180..180.
export interface PuntoGps {
  lat: number;
  lon: number;
}

export type ErrorGps = 'sin_permiso' | 'servicio_apagado' | 'no_disponible';

const esNumero = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function gpsValido(lat: unknown, lon: unknown): boolean {
  return esNumero(lat) && esNumero(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** Punto guardado en el nodo, o `null` si no hay ubicación GPS (nodos viejos o quitada). */
export function puntoGpsDeNodo(nodo?: { gps_lat?: number | null; gps_lon?: number | null } | null): PuntoGps | null {
  if (!nodo || !gpsValido(nodo.gps_lat, nodo.gps_lon)) return null;
  return { lat: nodo.gps_lat as number, lon: nodo.gps_lon as number };
}

/** Punto a partir de lo que devuelve expo-location; `null` si viene incompleto o fuera de rango. */
export function puntoGpsDeCoords(coords?: { latitude?: number | null; longitude?: number | null } | null): PuntoGps | null {
  if (!coords || !gpsValido(coords.latitude, coords.longitude)) return null;
  return { lat: coords.latitude as number, lon: coords.longitude as number };
}

/** "19.432608, -99.133209" (6 decimales: unos 10 cm). Solo para mostrar. */
export function formatoGps(p: PuntoGps, decimales = 6): string {
  return `${p.lat.toFixed(decimales)}, ${p.lon.toFixed(decimales)}`;
}

/** Enlace que abre el punto en la app de mapas (o en el navegador en web). */
export function urlMapas(p: PuntoGps): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
}

/** Clasifica un fallo de expo-location para mostrar el mensaje correcto. */
export function errorGpsDe(e: unknown): ErrorGps {
  const texto = `${(e as any)?.code ?? ''} ${(e as any)?.message ?? ''}`.toLowerCase();
  if (/services? (are |is )?(disabled|unavailable|off)|location.*disabled|e_location_services_disabled/.test(texto)) {
    return 'servicio_apagado';
  }
  if (/permission|denied|e_location_unauthorized/.test(texto)) return 'sin_permiso';
  return 'no_disponible';
}
