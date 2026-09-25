// No pinta nada: solo engancha el toque de las notificaciones push con la navegación.
// Debe montarse dentro del AuthProvider (ver app/_layout.tsx).
import { useNotificacionesNavegacion } from '@/src/hooks/useNotificacionesNavegacion';

export function NotificacionesNavegacion() {
  useNotificacionesNavegacion();
  return null;
}
