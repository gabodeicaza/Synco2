import React from 'react';
import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';
import RegistrarAvanceScreen from '../RegistrarAvanceScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' }, launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/src/utils/permissions', () => ({ requestMediaLibraryPermission: jest.fn(), requestCameraPermission: jest.fn() }));
jest.mock('@/src/utils/comprimirFoto', () => ({ prepararFotoEvidencia: jest.fn() }));
jest.mock('@/src/utils/confirm', () => ({ confirm: jest.fn() }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({
  api: { getProject: jest.fn(), getTree: jest.fn(), searchConceptos: jest.fn(), createAvance: jest.fn() },
}));
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/src/api';
import { requestCameraPermission, requestMediaLibraryPermission } from '@/src/utils/permissions';
import { prepararFotoEvidencia } from '@/src/utils/comprimirFoto';
import { confirm } from '@/src/utils/confirm';

jest.setTimeout(30000);
configure({ asyncUtilTimeout: 8000 });

const buscar = api.searchConceptos as jest.Mock;
const crear = api.createAvance as jest.Mock;
const camara = ImagePicker.launchCameraAsync as jest.Mock;
const galeria = ImagePicker.launchImageLibraryAsync as jest.Mock;
const permisoCamara = requestCameraPermission as jest.Mock;
const permisoGaleria = requestMediaLibraryPermission as jest.Mock;
const preparar = prepararFotoEvidencia as jest.Mock;
const asset = { uri: 'file:///f.jpg', width: 4000, height: 3000, base64: 'ORIGINAL' };

async function avanzar(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}

async function abrirConcepto() {
  buscar.mockResolvedValue([{
    id: 'a', clave: '1.1', descripcion: 'Descripción 1.1', unidad: 'M3', cantidad: '100', meta: '10',
    cantidad_ejecutada_acumulada: '20', partida_clave: '1', partida_nombre: 'Terracerías',
  }]);
  render(<RegistrarAvanceScreen projectId="p1" />);
  await avanzar(0);
  fireEvent.press(screen.getByText(/1\.1 · Descripción/));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (api.getProject as jest.Mock).mockResolvedValue({ id: 'p1', name: 'Proyecto', modo_avance: 'CANTIDAD', separador_decimal: '.' });
  (api.getTree as jest.Mock).mockResolvedValue([]);
  permisoCamara.mockResolvedValue({ granted: true, canAskAgain: true });
  permisoGaleria.mockResolvedValue({ granted: true, canAskAgain: true });
  camara.mockResolvedValue({ canceled: false, assets: [asset] });
  galeria.mockResolvedValue({ canceled: false, assets: [asset] });
  preparar.mockResolvedValue({ ok: true, dataUri: 'data:image/jpeg;base64,COMPRIMIDA', bytes: 100, comprimida: true });
  (confirm as jest.Mock).mockResolvedValue(false);
});
afterEach(() => { jest.useRealTimers(); });

describe('Registrar avance: evidencia fotográfica (T-05a)', () => {
  it('ofrece las dos opciones: tomar foto y elegir de la galería', async () => {
    await abrirConcepto();
    expect(screen.getByLabelText('Tomar foto')).toBeTruthy();
    expect(screen.getByLabelText('Elegir de la galería')).toBeTruthy();
  });

  it('"Tomar foto" pide el permiso en contexto, abre la cámara y adjunta la foto comprimida', async () => {
    crear.mockResolvedValue({ es_retroceso: false });
    await abrirConcepto();
    fireEvent.press(screen.getByLabelText('Tomar foto'));
    await avanzar(0);
    expect(permisoCamara).toHaveBeenCalledTimes(1);
    expect(camara).toHaveBeenCalledTimes(1);
    expect(preparar).toHaveBeenCalledWith(asset);
    expect(screen.getByLabelText('Foto de evidencia adjunta')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Cantidad ejecutada'), '5');
    fireEvent.press(screen.getByText('Registrar avance'));
    await avanzar(0);
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ fotos: ['data:image/jpeg;base64,COMPRIMIDA'] }));
  });

  it('la galería también pasa por la compresión', async () => {
    await abrirConcepto();
    fireEvent.press(screen.getByLabelText('Elegir de la galería'));
    await avanzar(0);
    expect(galeria).toHaveBeenCalledTimes(1);
    expect(preparar).toHaveBeenCalledWith(asset);
    expect(screen.getByLabelText('Foto de evidencia adjunta')).toBeTruthy();
  });

  it('con el permiso de cámara denegado avisa en línea y no abre la cámara', async () => {
    permisoCamara.mockResolvedValue({ granted: false, canAskAgain: true });
    await abrirConcepto();
    fireEvent.press(screen.getByLabelText('Tomar foto'));
    await avanzar(0);
    expect(camara).not.toHaveBeenCalled();
    expect(screen.getByText('Habilita el acceso a la cámara para tomar fotos de evidencia.')).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('si el permiso está bloqueado ofrece abrir los ajustes (sin Alert)', async () => {
    permisoCamara.mockResolvedValue({ granted: false, canAskAgain: false });
    await abrirConcepto();
    fireEvent.press(screen.getByLabelText('Tomar foto'));
    await avanzar(0);
    expect(confirm).toHaveBeenCalledWith('Permiso de cámara', expect.any(String), expect.objectContaining({ confirmText: 'Abrir ajustes' }));
  });

  it('con el permiso de galería denegado avisa en línea', async () => {
    permisoGaleria.mockResolvedValue({ granted: false, canAskAgain: true });
    await abrirConcepto();
    fireEvent.press(screen.getByLabelText('Elegir de la galería'));
    await avanzar(0);
    expect(galeria).not.toHaveBeenCalled();
    expect(screen.getByText('Habilita el acceso a fotos para adjuntar evidencia.')).toBeTruthy();
  });

  it('cancelar el selector no cambia nada', async () => {
    camara.mockResolvedValue({ canceled: true, assets: [] });
    await abrirConcepto();
    fireEvent.press(screen.getByLabelText('Tomar foto'));
    await avanzar(0);
    expect(preparar).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Foto de evidencia adjunta')).toBeNull();
  });

  it('si no se pudo comprimir adjunta la original con un aviso y no bloquea la captura', async () => {
    preparar.mockResolvedValue({ ok: true, dataUri: 'data:image/jpeg;base64,ORIGINAL', bytes: 100, comprimida: false });
    await abrirConcepto();
    fireEvent.press(screen.getByLabelText('Tomar foto'));
    await avanzar(0);
    expect(screen.getByText('No se pudo reducir el tamaño de la foto; se adjuntó la original.')).toBeTruthy();
    expect(screen.getByLabelText('Foto de evidencia adjunta')).toBeTruthy();
  });

  it('una foto demasiado grande se rechaza con un mensaje en línea', async () => {
    preparar.mockResolvedValue({ ok: false, motivo: 'demasiado_grande', bytes: 6 * 1024 * 1024 });
    await abrirConcepto();
    fireEvent.press(screen.getByLabelText('Elegir de la galería'));
    await avanzar(0);
    expect(screen.getByText(/La foto pesa demasiado \(6\.0 MB\)/)).toBeTruthy();
    expect(screen.queryByLabelText('Foto de evidencia adjunta')).toBeNull();
  });

  it('se puede quitar la foto adjunta', async () => {
    await abrirConcepto();
    fireEvent.press(screen.getByLabelText('Tomar foto'));
    await avanzar(0);
    fireEvent.press(screen.getByLabelText('Quitar foto'));
    expect(screen.queryByLabelText('Foto de evidencia adjunta')).toBeNull();
  });
});
