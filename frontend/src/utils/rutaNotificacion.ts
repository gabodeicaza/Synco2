// A dónde lleva tocar una notificación push (T-05c). Función pura: a partir del `data`
// que manda el servidor y el rol de quien la recibe devuelve la ruta de expo-router, o
// `null` si el tipo no se conoce (nunca lanza: una notificación rara no debe romper la app).
import { ROLE_COORD, ROLE_ESP, ROLE_JEFE, ROLE_SUB } from '@/src/utils/roles';

export type TipoNotificacion =
  | 'meeting_reminder'
  | 'agreement_due'
  | 'urgent_announcement'
  | 'invitation_accepted'
  | 'new_report';

export interface DestinoNotificacion {
  pathname: string;
  params?: Record<string, string>;
}

export function grupoDeRol(rol?: string | null): '(coord)' | '(subcoord)' | '(spec)' | null {
  if (rol === ROLE_COORD || rol === ROLE_JEFE) return '(coord)';
  if (rol === ROLE_SUB) return '(subcoord)';
  if (rol === ROLE_ESP) return '(spec)';
  return null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function rutaDeNotificacion(data: unknown, rol?: string | null): DestinoNotificacion | null {
  const grupo = grupoDeRol(rol);
  if (!grupo || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const tipo = texto(d.type);
  const pid = texto(d.project_id);

  switch (tipo) {
    case 'meeting_reminder':
      return { pathname: `/${grupo}/calendario` };
    case 'urgent_announcement':
      return { pathname: `/${grupo}/noticias` };
    case 'agreement_due':
      // El coordinador ve las minutas del proyecto; Sub y Especialista tienen una sola pantalla de minutas.
      if (grupo === '(coord)' && pid) return { pathname: '/(coord)/projects/[id]/minutas', params: { id: pid } };
      return { pathname: `/${grupo}/minutas` };
    case 'invitation_accepted':
      // Solo el Coordinador administra invitaciones.
      if (rol !== ROLE_COORD || !pid) return null;
      return { pathname: '/(coord)/projects/[id]/invitations', params: { id: pid } };
    case 'new_report':
      // Solo los supervisores lo reciben: van a la lista de reportes del proyecto.
      if (grupo !== '(coord)' || !pid) return null;
      return { pathname: '/(coord)/projects/[id]', params: { id: pid } };
    default:
      return null;
  }
}
