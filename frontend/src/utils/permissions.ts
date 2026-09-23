// Permisos de galería. En Android se usa el selector de fotos del sistema
// (Photo Picker), que no necesita ningún permiso de almacenamiento: declararlos
// solo sirve para que Google Play rechace la app. Por eso en Android se
// devuelve "concedido" sin preguntar; en iOS se conserva la solicitud normal.
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

type PermisoGaleria = { status: string; granted: boolean; canAskAgain: boolean };

const CONCEDIDO: PermisoGaleria = { status: 'granted', granted: true, canAskAgain: true };

export async function getMediaLibraryPermission(): Promise<PermisoGaleria> {
  if (Platform.OS === 'android') return CONCEDIDO;
  return ImagePicker.getMediaLibraryPermissionsAsync();
}

export async function requestMediaLibraryPermission(): Promise<PermisoGaleria> {
  if (Platform.OS === 'android') return CONCEDIDO;
  return ImagePicker.requestMediaLibraryPermissionsAsync();
}
