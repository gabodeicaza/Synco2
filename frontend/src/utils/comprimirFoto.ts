// Fotos de evidencia (T-05a): se reducen antes de adjuntarlas al avance. Una foto de cámara de
// 12 MP pesa varios MB en base64 y en obra puede tener que esperar en la cola sin conexión;
// a 1600 px por el lado mayor y JPEG 0.7 basta para evidencia y pesa unos cientos de KB.
import * as ImageManipulator from 'expo-image-manipulator';

export const LADO_MAXIMO_PX = 1600;
export const CALIDAD_JPEG = 0.7;
/** Tope de la foto ya comprimida (bytes reales, no de base64). */
export const LIMITE_BYTES = 4 * 1024 * 1024;

export interface TamanoDestino {
  ancho: number;
  alto: number;
  redimensionar: boolean;
}

/** Tamaño final que respeta la proporción y nunca amplía una imagen pequeña. */
export function calcularTamanoDestino(ancho: number, alto: number, ladoMaximo = LADO_MAXIMO_PX): TamanoDestino {
  if (!(ancho > 0) || !(alto > 0)) return { ancho, alto, redimensionar: false };
  const ladoMayor = Math.max(ancho, alto);
  if (ladoMayor <= ladoMaximo) return { ancho, alto, redimensionar: false };
  const factor = ladoMaximo / ladoMayor;
  return {
    ancho: Math.max(1, Math.round(ancho * factor)),
    alto: Math.max(1, Math.round(alto * factor)),
    redimensionar: true,
  };
}

/** Bytes reales que representa un texto base64 (sin encabezado data:). */
export function bytesDeBase64(base64: string): number {
  const limpio = base64.replace(/^data:[^,]*,/, '');
  const relleno = limpio.endsWith('==') ? 2 : limpio.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((limpio.length * 3) / 4) - relleno);
}

export interface AssetFoto {
  uri: string;
  width?: number;
  height?: number;
  base64?: string | null;
  mimeType?: string | null;
}

export type ResultadoFoto =
  | { ok: true; dataUri: string; bytes: number; comprimida: boolean }
  | { ok: false; motivo: 'sin_datos' | 'demasiado_grande'; bytes?: number };

/**
 * Convierte lo que devuelve el selector/cámara en el data URI que espera el API.
 * Si la compresión falla cae a la imagen original (si el selector la trajo en base64):
 * una foto sin comprimir es mejor que bloquear la captura.
 */
export async function prepararFotoEvidencia(asset: AssetFoto): Promise<ResultadoFoto> {
  let dataUri: string | null = null;
  let comprimida = false;

  try {
    const destino = calcularTamanoDestino(asset.width ?? 0, asset.height ?? 0);
    const acciones = destino.redimensionar
      ? [{ resize: destino.ancho >= destino.alto ? { width: destino.ancho } : { height: destino.alto } }]
      : [];
    const salida = await ImageManipulator.manipulateAsync(asset.uri, acciones, {
      compress: CALIDAD_JPEG,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (salida?.base64) {
      dataUri = `data:image/jpeg;base64,${salida.base64}`;
      comprimida = true;
    }
  } catch {
    dataUri = null;
  }

  if (!dataUri) {
    if (!asset.base64) return { ok: false, motivo: 'sin_datos' };
    dataUri = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
  }

  const bytes = bytesDeBase64(dataUri);
  if (bytes > LIMITE_BYTES) return { ok: false, motivo: 'demasiado_grande', bytes };
  return { ok: true, dataUri, bytes, comprimida };
}
