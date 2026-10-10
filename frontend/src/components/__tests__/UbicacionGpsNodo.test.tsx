import React from 'react';
import { Linking, Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/src/api', () => ({ api: { updateNode: jest.fn() } }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

import * as Location from 'expo-location';
import { api } from '@/src/api';
import { showToast } from '@/src/utils/toast';
import { ESPERA_GPS_MS, UbicacionGpsNodo } from '../UbicacionGpsNodo';

const permisos = Location.getForegroundPermissionsAsync as jest.Mock;
const pedirPermiso = Location.requestForegroundPermissionsAsync as jest.Mock;
const posicion = Location.getCurrentPositionAsync as jest.Mock;
const actualizar = api.updateNode as jest.Mock;

const CDMX = { coords: { latitude: 19.432608, longitude: -99.133209 } };

function montar(punto: { lat: number; lon: number } | null = null, onChanged = jest.fn()) {
  render(<UbicacionGpsNodo nodeId="n1" punto={punto} onChanged={onChanged} />);
  return onChanged;
}

async function tocar(etiqueta: string) {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(etiqueta));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as any).OS = 'android';
  permisos.mockResolvedValue({ granted: true, canAskAgain: true });
  pedirPermiso.mockResolvedValue({ granted: true });
  posicion.mockResolvedValue(CDMX);
  actualizar.mockResolvedValue({});
});

describe('UbicacionGpsNodo', () => {
  it('sin ubicación guardada lo explica y ofrece usar la del dispositivo', () => {
    montar();
    expect(screen.getByText('Aún no se ha guardado la ubicación GPS de este nodo.')).toBeTruthy();
    expect(screen.getByLabelText('Usar mi ubicación')).toBeTruthy();
    expect(screen.queryByLabelText('Quitar ubicación')).toBeNull();
  });

  it('con permiso concedido toma la posición y la guarda sin tocar las coordenadas UTM', async () => {
    const onChanged = montar();
    await tocar('Usar mi ubicación');
    await waitFor(() => expect(actualizar).toHaveBeenCalledTimes(1));
    expect(actualizar).toHaveBeenCalledWith('n1', { gps_lat: 19.432608, gps_lon: -99.133209 });
    expect(Object.keys(actualizar.mock.calls[0][1])).not.toContain('target_lat');
    expect(await screen.findByText('Ubicación guardada: 19.432608, -99.133209')).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Ubicación guardada');
    expect(screen.getByLabelText('Quitar ubicación')).toBeTruthy();
  });

  it('sin permiso todavía, primero explica y solo pide el permiso al continuar', async () => {
    permisos.mockResolvedValue({ granted: false, canAskAgain: true });
    montar();
    await tocar('Usar mi ubicación');
    expect(screen.getByText('Permiso de ubicación')).toBeTruthy();
    expect(pedirPermiso).not.toHaveBeenCalled();
    await tocar('Continuar');
    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    expect(pedirPermiso).toHaveBeenCalledTimes(1);
  });

  it('cancelar la explicación no pide el permiso', async () => {
    permisos.mockResolvedValue({ granted: false, canAskAgain: true });
    montar();
    await tocar('Usar mi ubicación');
    await tocar('Cancelar');
    expect(screen.queryByText('Permiso de ubicación')).toBeNull();
    expect(pedirPermiso).not.toHaveBeenCalled();
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('permiso rechazado: mensaje en línea, sin bloquear, con acceso a Ajustes', async () => {
    permisos.mockResolvedValue({ granted: false, canAskAgain: true });
    pedirPermiso.mockResolvedValue({ granted: false });
    const abrirAjustes = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    montar();
    await tocar('Usar mi ubicación');
    await tocar('Continuar');
    expect(await screen.findByText('Sin permiso de ubicación. Actívalo en Ajustes para usar tu ubicación.')).toBeTruthy();
    expect(actualizar).not.toHaveBeenCalled();
    await tocar('Abrir ajustes');
    expect(abrirAjustes).toHaveBeenCalled();
    // sigue pudiendo intentarlo de nuevo
    expect(screen.getByLabelText('Usar mi ubicación')).toBeTruthy();
  });

  it('permiso denegado para siempre: avisa sin volver a pedirlo', async () => {
    permisos.mockResolvedValue({ granted: false, canAskAgain: false });
    montar();
    await tocar('Usar mi ubicación');
    expect(screen.getByText(/Sin permiso de ubicación/)).toBeTruthy();
    expect(pedirPermiso).not.toHaveBeenCalled();
  });

  it('GPS apagado: lo dice y no guarda', async () => {
    posicion.mockRejectedValue(Object.assign(new Error('Location services are disabled'), { code: 'E_LOCATION_SERVICES_DISABLED' }));
    montar();
    await tocar('Usar mi ubicación');
    expect(await screen.findByText('El GPS del dispositivo está apagado. Actívalo e inténtalo de nuevo.')).toBeTruthy();
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('una posición fuera de rango no se guarda', async () => {
    posicion.mockResolvedValue({ coords: { latitude: 200, longitude: 10 } });
    montar();
    await tocar('Usar mi ubicación');
    expect(await screen.findByText(/No se pudo obtener la ubicación/)).toBeTruthy();
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('error de red al guardar: toast y sin error en línea; el punto no se da por guardado', async () => {
    actualizar.mockRejectedValue(Object.assign(new Error('Network request failed'), { status: 0 }));
    montar();
    await tocar('Usar mi ubicación');
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('No hay conexión. Revisa tu internet e inténtalo de nuevo.'));
    expect(screen.queryByText(/Ubicación guardada:/)).toBeNull();
  });

  it('error del servidor al guardar: se muestra en línea', async () => {
    actualizar.mockRejectedValue(Object.assign(new Error('La latitud debe estar entre -90 y 90 grados.'), { status: 400 }));
    montar();
    await tocar('Usar mi ubicación');
    expect(await screen.findByText('La latitud debe estar entre -90 y 90 grados.')).toBeTruthy();
  });

  it('muestra la ubicación ya guardada y "Quitar ubicación" la borra', async () => {
    const onChanged = montar({ lat: 19.4, lon: -99.1 });
    expect(screen.getByText('Ubicación guardada: 19.400000, -99.100000')).toBeTruthy();
    await tocar('Quitar ubicación');
    await waitFor(() => expect(actualizar).toHaveBeenCalledWith('n1', { quitar_gps: true }));
    expect(await screen.findByText('Aún no se ha guardado la ubicación GPS de este nodo.')).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('"Abrir en mapas" abre el punto en el navegador o la app de mapas', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    montar({ lat: 19.432608, lon: -99.133209 });
    await tocar('Abrir en mapas');
    expect(abrir).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=19.432608,-99.133209');
  });

  it('en web no pregunta por permisos nativos (lo hace el navegador)', async () => {
    (Platform as any).OS = 'web';
    permisos.mockResolvedValue({ granted: false, canAskAgain: true });
    montar();
    await tocar('Usar mi ubicación');
    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    expect(permisos).not.toHaveBeenCalled();
  });

  it('si el GPS no responde en el tiempo límite, avisa en vez de quedarse cargando', async () => {
    jest.useFakeTimers();
    try {
      posicion.mockReturnValue(new Promise(() => {}));
      montar();
      await tocar('Usar mi ubicación');
      expect(screen.getByText('Obteniendo ubicación…')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(ESPERA_GPS_MS + 1);
      });
      expect(await screen.findByText(/No se pudo obtener la ubicación/)).toBeTruthy();
      expect(actualizar).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
