// Tocar una notificación push lleva a la pantalla que corresponde (T-05c).
// - App abierta o en segundo plano: `addNotificationResponseReceivedListener`.
// - App cerrada: `getLastNotificationResponseAsync` al arrancar. Ahí se espera un momento
//   antes de navegar, para no competir con la redirección inicial a la pantalla de inicio.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/src/auth-context';
import { rutaDeNotificacion } from '@/src/utils/rutaNotificacion';

export const ESPERA_ARRANQUE_MS = 400;

export function useNotificacionesNavegacion() {
  const { user } = useAuth();
  const router = useRouter();
  const atendidas = useRef<Set<string>>(new Set());
  const rol = user?.role;
  const hayUsuario = !!user;

  useEffect(() => {
    if (Platform.OS === 'web' || !hayUsuario) return;
    let vivo = true;
    let temporizador: ReturnType<typeof setTimeout> | null = null;

    function atender(respuesta: Notifications.NotificationResponse | null | undefined, conEspera: boolean) {
      if (!respuesta || !vivo) return;
      const id = respuesta.notification?.request?.identifier;
      if (id) {
        if (atendidas.current.has(id)) return;
        atendidas.current.add(id);
      }
      const destino = rutaDeNotificacion(respuesta.notification?.request?.content?.data, rol);
      if (!destino) return;
      const ir = () => {
        try {
          router.push(destino as any);
        } catch {
          // una ruta que no existe no debe tumbar la app
        }
      };
      if (conEspera) temporizador = setTimeout(ir, ESPERA_ARRANQUE_MS);
      else ir();
    }

    Notifications.getLastNotificationResponseAsync()
      .then((r) => atender(r, true))
      .catch(() => {});
    const suscripcion = Notifications.addNotificationResponseReceivedListener((r) => atender(r, false));

    return () => {
      vivo = false;
      if (temporizador) clearTimeout(temporizador);
      suscripcion.remove();
    };
  }, [hayUsuario, rol, router]);
}
