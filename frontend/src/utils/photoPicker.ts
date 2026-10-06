import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Captura de fotos tolerante a cualquier dispositivo.
 *
 * - El picker se abre SIN base64 (en Android con fotos de 50-200 MP el base64 del picker
 *   llega vacío o agota la memoria) y a calidad 1 (sin doble compresión).
 * - La foto se reduce por su lado mayor (sin ampliar las chicas) y se reexporta SIEMPRE
 *   como JPEG, lo que normaliza HEIC/HEIF, WebP, PNG y la orientación EXIF.
 * - Si falla, se reintenta con un tamaño menor antes de avisar al usuario.
 */

export type PhotoSource = 'camera' | 'library';

export interface PickPhotoOptions {
  /** Lado mayor máximo en px (default 1600). */
  maxDim?: number;
  /** Calidad JPEG 0-1 (default 0.8). */
  quality?: number;
  /** Mostrar Alert con el motivo cuando falla (default true). */
  alertOnError?: boolean;
}

// Pasos de reintento: (factor sobre maxDim, calidad).
const ATTEMPTS: Array<[number, number | null]> = [[1, null], [0.65, 0.7], [0.4, 0.6]];

async function ensurePermission(source: PhotoSource): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const perm = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      'Sin permiso',
      source === 'camera'
        ? 'No hay permiso para usar la cámara. Habilítalo en los ajustes del teléfono.'
        : 'No hay permiso para acceder a la galería. Habilítalo en los ajustes del teléfono.',
    );
    return false;
  }
  return true;
}

/** Reduce y convierte a JPEG; devuelve data URL. Lanza si todos los intentos fallan. */
export async function normalizeToJpegDataUrl(
  asset: { uri: string; width?: number; height?: number },
  maxDim = 1600,
  quality = 0.8,
): Promise<string> {
  let lastErr: unknown = null;
  for (const [factor, q] of ATTEMPTS) {
    const dim = Math.round(maxDim * factor);
    try {
      const w = asset.width || 0;
      const h = asset.height || 0;
      const actions: ImageManipulator.Action[] = [];
      if (w && h) {
        // Solo se reduce; nunca se amplía una foto chica.
        if (Math.max(w, h) > dim) {
          actions.push({ resize: w >= h ? { width: dim } : { height: dim } });
        }
      } else {
        // Dimensiones desconocidas: se limita el ancho (no se puede saber si amplía).
        actions.push({ resize: { width: dim } });
      }
      const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: q ?? quality,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      if (out.base64) return `data:image/jpeg;base64,${out.base64}`;
      lastErr = new Error('La imagen salió vacía.');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('No se pudo procesar la imagen.');
}

/**
 * Abre cámara o galería y devuelve la foto como data URL JPEG, o null si se cancela o falla.
 */
export async function pickPhotoDataUrl(
  source: PhotoSource,
  opts: PickPhotoOptions = {},
): Promise<string | null> {
  const { maxDim = 1600, quality = 0.8, alertOnError = true } = opts;
  try {
    if (!(await ensurePermission(source))) return null;
    const pickerOpts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
      base64: false,
      exif: false,
    };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOpts)
      : await ImagePicker.launchImageLibraryAsync(pickerOpts);
    if (result.canceled || !result.assets?.[0]?.uri) return null;
    return await normalizeToJpegDataUrl(result.assets[0], maxDim, quality);
  } catch (e: any) {
    if (alertOnError) {
      Alert.alert(
        'No se pudo cargar la foto',
        `${e?.message || 'Error desconocido.'}\n\nIntenta de nuevo; si persiste, baja la resolución de la cámara del teléfono.`,
      );
    }
    return null;
  }
}

/**
 * Android puede destruir la app mientras la cámara está abierta (poca RAM); la foto tomada
 * queda pendiente y se recupera al volver. Llamar al montar la pantalla.
 */
export async function recoverPendingPhoto(
  opts: PickPhotoOptions = {},
): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const pending = await ImagePicker.getPendingResultAsync();
    const asset = pending && 'assets' in pending ? pending.assets?.[0] : null;
    if (!asset?.uri) return null;
    return await normalizeToJpegDataUrl(asset, opts.maxDim ?? 1600, opts.quality ?? 0.8);
  } catch {
    return null;
  }
}
