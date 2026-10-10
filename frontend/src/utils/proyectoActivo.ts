// Reglas puras del proyecto activo compartido (P-05) y de la pestaña recordada por proyecto (P-04).
// Van aparte del contexto para poder probarlas sin renderizar nada.

export const CLAVE_PROYECTO_ACTIVO = 'dirac_proyecto_activo';
export const CLAVE_PESTANA_PROYECTO = 'dirac_pestana_proyecto';

/** Clave de almacenamiento del último proyecto elegido por un usuario. */
export const clavePestanaProyecto = (pid: string) => `${CLAVE_PESTANA_PROYECTO}_${pid}`;
export const claveProyectoActivo = (uid: string) => `${CLAVE_PROYECTO_ACTIVO}_${uid}`;

export interface ProyectoBasico {
  id: string;
}

const ROLES_CON_TODOS_LOS_PROYECTOS = new Set(['coordinador_general', 'jefe_proyecto']);

/** Proyectos que el usuario puede elegir: Coordinador y Jefe ven todos los que devuelve la API; el resto,
 * solo los de su `project_ids`. */
export function proyectosDelUsuario<P extends ProyectoBasico>(
  proyectos: P[], user?: { role?: string | null; project_ids?: string[] | null } | null,
): P[] {
  if (!user) return [];
  if (ROLES_CON_TODOS_LOS_PROYECTOS.has(user.role || '')) return proyectos;
  const permitidos = new Set(user.project_ids || []);
  return proyectos.filter((p) => permitidos.has(p.id));
}

/** El candidato (recordado o pedido) si sigue existiendo; si no, el primero; si no hay ninguno, `null`. */
export function resolverProyectoActivo(candidato: string | null | undefined, proyectos: ProyectoBasico[]): string | null {
  if (candidato && proyectos.some((p) => p.id === candidato)) return candidato;
  return proyectos[0]?.id ?? null;
}

export type PestanaProyecto = 'reportes' | 'operacion' | 'configuracion';
export const PESTANAS_PROYECTO: readonly PestanaProyecto[] = ['reportes', 'operacion', 'configuracion'];

/** Pestaña guardada si es válida; cualquier otra cosa (vacío, valor viejo, basura) cae a 'reportes'. */
export function pestanaValida(valor: unknown): PestanaProyecto {
  return PESTANAS_PROYECTO.includes(valor as PestanaProyecto) ? (valor as PestanaProyecto) : 'reportes';
}
