import { Platform } from 'react-native';

/**
 * Descarga un Blob al dispositivo / navegador.
 *  - Web: dispara un anchor download estandar.
 *  - Native: escribe el blob en cacheDirectory (legacy expo-file-system) y comparte
 *    via expo-sharing si esta disponible. NO se guarda en galeria (Cero Huella).
 */
export async function downloadBlob(
  blob: Blob,
  filename: string,
  mimeType?: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    // @ts-ignore (web only)
    const url = URL.createObjectURL(blob);
    // @ts-ignore
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    // @ts-ignore
    document.body.appendChild(a);
    a.click();
    a.remove();
    // @ts-ignore
    URL.revokeObjectURL(url);
    return;
  }

  // Native
  const reader = new FileReader();
  const dataUri: string = await new Promise((resolve, reject) => {
    reader.onerror = () => reject(reader.error);
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  const base64 = dataUri.split(',')[1] || '';
  const FileSystem: any = await import('expo-file-system/legacy');
  const Sharing: any = await import('expo-sharing');
  const dest = `${FileSystem.cacheDirectory || ''}${filename}`;
  await FileSystem.writeAsStringAsync(dest, base64, {
    encoding: FileSystem.EncodingType?.Base64 || 'base64',
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dest, {
      mimeType: mimeType || 'application/octet-stream',
      dialogTitle: 'Compartir reporte SynCo',
    });
  }
}
