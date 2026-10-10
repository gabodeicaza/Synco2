import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getMediaLibraryPermission, requestMediaLibraryPermission } from '../permissions';

jest.mock('expo-image-picker', () => ({
  getMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'denied', granted: false, canAskAgain: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true })),
}));

describe('permisos de galería', () => {
  const original = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => original });
    jest.clearAllMocks();
  });

  it('en Android no pide permiso de almacenamiento (usa el selector del sistema)', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
    expect((await requestMediaLibraryPermission()).granted).toBe(true);
    expect((await getMediaLibraryPermission()).granted).toBe(true);
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  it('en iOS conserva la solicitud normal', async () => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
    await requestMediaLibraryPermission();
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});
