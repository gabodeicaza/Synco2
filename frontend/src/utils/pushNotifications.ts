/**
 * Push notifications bootstrap for Dirac.
 *
 * Responsibilities:
 *   1. Ask for notification permissions ONLY when `pedirPermiso` is true (after the user
 *      accepted the in-app explanation, see PedirNotificaciones.tsx) — never at launch/login.
 *   2. Obtain the Expo Push Token (only on physical devices).
 *   3. Send the token to the backend (`POST /api/users/push-token`).
 *   4. Configure the Android notification channel (required for SDK 33+).
 *
 * IMPORTANT: This module is safe to call on every app start. It will short-circuit
 * cleanly on web, on simulators, and when the user has previously denied permission.
 *
 * NOTE: Push notifications require a development build / production build to actually
 * receive notifications on iOS and Android. They will NOT work inside the Expo Go
 * app for SDK 53+ on iOS. This is expected behavior.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

import { api } from '@/src/api';
import { storage } from '@/src/utils/storage';
import { dayjs } from '@/src/utils/tz';

// Configura el handler global de notificaciones recibidas en foreground.
// (Mostrar como alerta + sonido al recibirla con la app abierta.)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const STORAGE_KEY_LAST_TOKEN = 'synco_last_push_token';

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notificaciones generales',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1E40AF',
    });
  } catch {
    // ignore: not fatal
  }
}

function getProjectId(): string | undefined {
  // SDK 49+ uses `EAS projectId` from app.json under `extra.eas.projectId`.
  const expoConfig: any = Constants.expoConfig ?? {};
  const easProjectId =
    expoConfig?.extra?.eas?.projectId ||
    (Constants as any)?.easConfig?.projectId;
  return easProjectId;
}

/**
 * Pide permiso (si no ha sido pedido), obtiene el token de Expo, y lo registra en el backend.
 *
 * Devuelve el token, o `null` si:
 *   - Estamos en web o simulador.
 *   - El usuario denego permiso.
 *   - Ocurrio un error en cualquier paso (sin romper la app).
 */
export async function registerForPushNotificationsAsync(
  opts: { pedirPermiso?: boolean } = {},
): Promise<string | null> {
  // 1) Web: expo-notifications no soporta web push de manera consistente. Salir limpio.
  if (Platform.OS === 'web') {
    return null;
  }

  // 2) Solo dispositivos fisicos pueden obtener push tokens.
  if (!Device.isDevice) {
    if (__DEV__) {
      console.log('[push] Saltado: no es dispositivo físico (simulador).');
    }
    return null;
  }

  await ensureAndroidChannel();

  // 3) Check permisos actuales.
  let { status: existingStatus, canAskAgain } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted' && canAskAgain && opts.pedirPermiso) {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    if (__DEV__) {
      console.log('[push] Permiso de notificaciones no concedido:', finalStatus);
    }
    return null;
  }

  // 4) Obtener el Expo Push Token.
  let tokenString: string | null = null;
  try {
    const projectId = getProjectId();
    const response = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    tokenString = response?.data || null;
  } catch (err) {
    if (__DEV__) console.warn('[push] getExpoPushTokenAsync fallo:', err);
    return null;
  }

  if (!tokenString) return null;

  // 5) Enviar al backend (solo si el token cambio, para ahorrar requests).
  try {
    const cached = await storage.getItem<string>(STORAGE_KEY_LAST_TOKEN, '');
    if (cached !== tokenString) {
      await api.registerPushToken(tokenString, Platform.OS);
      await storage.setItem(STORAGE_KEY_LAST_TOKEN, tokenString);
      if (__DEV__) console.log('[push] Token registrado en backend.');
    } else if (__DEV__) {
      console.log('[push] Token ya estaba registrado (cache hit).');
    }
  } catch (err) {
    if (__DEV__) console.warn('[push] registerPushToken backend fallo:', err);
    // No bloquear: la proxima sesion re-intentara.
  }

  return tokenString;
}

/**
 * Lanza una notificacion local inmediata.
 */
export async function triggerLocalNotification(title: string, body: string, data: any = {}) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
      },
      trigger: null, // null = inmediato
    });
  } catch (err) {
    if (__DEV__) console.warn('[notifications] triggerLocalNotification fallo:', err);
  }
}

/**
 * Programa un recordatorio para una minuta (acuerdo) 24h antes de su vencimiento.
 * @param title Titulo del acuerdo o minuta.
 * @param dueDate Fecha limite en formato "YYYY-MM-DD".
 */
export async function scheduleMinuteReminder(id: string, title: string, dueDate: string) {
  try {
    // [FIX 2026-07-17] Uso de dayjs.tz para garantizar que 9 AM sea en CDMX
    const triggerTime = dayjs.tz(`${dueDate} 09:00:00`).subtract(24, 'hour').valueOf();

    const now = Date.now();
    if (triggerTime <= now) {
      if (__DEV__) console.log('[notifications] El recordatorio es para el pasado, ignorando.');
      return;
    }

    await Notifications.scheduleNotificationAsync({
      identifier: `reminder_${id}`,
      content: {
        title: 'Recordatorio de minuta',
        body: `El acuerdo "${title}" vence mañana.`,
        data: { minuteId: id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(triggerTime),
      },
    });
    if (__DEV__) console.log(`[notifications] Recordatorio programado para: ${new Date(triggerTime).toLocaleString()}`);
  } catch (err) {
    if (__DEV__) console.warn('[notifications] scheduleMinuteReminder fallo:', err);
  }
}

/**
 * Borra el token cacheado (usalo durante el logout para que el siguiente login
 * vuelva a registrar el token y el backend lo asocie al nuevo usuario).
 */
export async function clearCachedPushToken() {
  await storage.removeItem(STORAGE_KEY_LAST_TOKEN);
}

export type EstadoNotificaciones = 'activas' | 'inactivas' | 'sin_decidir';

/** Estado del permiso de notificaciones y si todavía se puede preguntar. */
export async function estadoNotificaciones(): Promise<{ estado: EstadoNotificaciones; puedePreguntar: boolean }> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return { estado: 'activas', puedePreguntar: false };
    if (p.status === 'undetermined') return { estado: 'sin_decidir', puedePreguntar: p.canAskAgain !== false };
    return { estado: 'inactivas', puedePreguntar: !!p.canAskAgain };
  } catch {
    return { estado: 'sin_decidir', puedePreguntar: false };
  }
}
