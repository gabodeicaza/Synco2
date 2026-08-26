// SynCo v2.0 _ Roles del sistema.
//   - coordinador_general (God Mode multi-proyecto)
//   - jefe_proyecto       (Supervision global de un proyecto, read-only)
//   - sub_coordinador     (scope: sub-arbol)
//   - especialista        (scope: hojas asignadas)

export const APP_BRAND = 'SynCo';
export const APP_TAGLINE = 'Reporte de obra inteligente, sin huella local.';

export type AppRole = 'coordinador_general' | 'jefe_proyecto' | 'sub_coordinador' | 'especialista';

export const ROLE_COORD: AppRole = 'coordinador_general';
export const ROLE_JEFE: AppRole = 'jefe_proyecto';
export const ROLE_SUB: AppRole = 'sub_coordinador';
export const ROLE_ESP: AppRole = 'especialista';

export function roleLabel(role?: string | null, areaName?: string | null): string {
  if (!role) return '_';
  if (role === ROLE_COORD) return 'Coordinador General';
  if (role === ROLE_JEFE) return 'Jefe de Proyecto';
  if (role === ROLE_SUB) return 'Sub-Coordinador';
  if (role === ROLE_ESP) {
    return areaName && areaName.trim() ? `Especialista _ ${areaName.trim()}` : 'Especialista';
  }
  return role;
}

export function roleShortLabel(role?: string | null): string {
  if (role === ROLE_COORD) return 'Coord. General';
  if (role === ROLE_JEFE) return 'Jefe de Proyecto';
  if (role === ROLE_SUB) return 'Sub-Coord.';
  if (role === ROLE_ESP) return 'Especialista';
  return '_';
}

export function isCoord(role?: string | null): boolean {
  return role === ROLE_COORD;
}
export function isJefe(role?: string | null): boolean {
  return role === ROLE_JEFE;
}
export function isSubCoord(role?: string | null): boolean {
  return role === ROLE_SUB;
}
export function isEspecialista(role?: string | null): boolean {
  return role === ROLE_ESP;
}

/** Tipo de medicion que un nodo hoja exige. */
export type MeasurementType = 'coord_latlon' | 'cadenamiento' | 'eje' | 'nivel';

export const MEASUREMENT_LABELS: Record<MeasurementType, string> = {
  coord_latlon: 'Coordenadas (lat/lon)',
  cadenamiento: 'Cadenamiento (km+m)',
  eje: 'Eje',
  nivel: 'Nivel (m)',
};

export const MEASUREMENT_ICONS: Record<MeasurementType, string> = {
  coord_latlon: 'location-outline',
  cadenamiento: 'analytics-outline',
  eje: 'git-network-outline',
  nivel: 'water-outline',
};

/** Devuelve la ruta de redirect inicial segun rol. */
export function homeRouteForRole(role?: string | null): string {
  if (role === ROLE_COORD) return '/(coord)';
  if (role === ROLE_JEFE) return '/(coord)'; // Jefe usa el dashboard de coordinador (read-only enforced en backend)
  if (role === ROLE_SUB) return '/(subcoord)';
  if (role === ROLE_ESP) return '/(spec)';
  return '/(auth)/login';
}
