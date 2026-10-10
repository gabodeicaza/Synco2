import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BannerSinConexion } from '../BannerSinConexion';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/src/httpClient', () => ({ BASE: 'https://api.test/api' }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(), refresh: jest.fn(), configure: jest.fn() },
}));

import NetInfo from '@react-native-community/netinfo';

let emitir: (s: { isConnected: boolean; isInternetReachable: boolean | null }) => void = () => {};
const refresh = NetInfo.refresh as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (NetInfo.addEventListener as jest.Mock).mockImplementation((cb: typeof emitir) => { emitir = cb; return jest.fn(); });
});

describe('BannerSinConexion (X-07)', () => {
  it('está oculto mientras hay conexión', () => {
    render(<BannerSinConexion />);
    act(() => emitir({ isConnected: true, isInternetReachable: true }));
    expect(screen.queryByText('Sin conexión')).toBeNull();
    expect(screen.queryByLabelText('Reintentar')).toBeNull();
  });

  it('aparece sin conexión, avisa que lo capturado se guarda en el dispositivo y anuncia el cambio', () => {
    render(<BannerSinConexion />);
    act(() => emitir({ isConnected: false, isInternetReachable: false }));
    expect(screen.getByText('Sin conexión')).toBeTruthy();
    expect(screen.getByText('No hay conexión con el servidor. Lo capturado se guardará en tu dispositivo.')).toBeTruthy();
    // El contenedor es un aviso en vivo (no "accessible", para no agrupar el botón Reintentar).
    const aviso = screen.UNSAFE_getByProps({ accessibilityRole: 'alert' });
    expect(aviso.props.accessibilityLiveRegion).toBe('polite');
  });

  it('también aparece si hay red pero el servidor no responde (isInternetReachable = false)', () => {
    render(<BannerSinConexion />);
    act(() => emitir({ isConnected: true, isInternetReachable: false }));
    expect(screen.getByText('Sin conexión')).toBeTruthy();
  });

  it('"Reintentar" es un botón accesible que vuelve a sondear y oculta el banner al recuperar la conexión', async () => {
    refresh.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    render(<BannerSinConexion />);
    act(() => emitir({ isConnected: false, isInternetReachable: false }));

    const boton = screen.getByRole('button', { name: 'Reintentar' });
    fireEvent.press(boton);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Sin conexión')).toBeNull());
  });

  it('si el reintento sigue sin conexión, el banner se queda y se puede volver a intentar', async () => {
    refresh.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    render(<BannerSinConexion />);
    act(() => emitir({ isConnected: false, isInternetReachable: false }));

    fireEvent.press(screen.getByLabelText('Reintentar'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Reintentar').props.accessibilityState?.busy).toBeFalsy());
    expect(screen.getByText('Sin conexión')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Reintentar'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it('mientras reintenta el botón queda deshabilitado y ocupado', async () => {
    let terminar!: (v: unknown) => void;
    refresh.mockReturnValue(new Promise((r) => { terminar = r; }));
    render(<BannerSinConexion />);
    act(() => emitir({ isConnected: false, isInternetReachable: false }));

    fireEvent.press(screen.getByLabelText('Reintentar'));
    await waitFor(() => {
      const estado = screen.getByLabelText('Reintentar').props.accessibilityState;
      expect(estado).toEqual(expect.objectContaining({ disabled: true, busy: true }));
    });
    await act(async () => { terminar({ isConnected: true, isInternetReachable: true }); });
    await waitFor(() => expect(screen.queryByText('Sin conexión')).toBeNull());
  });

  it('si el sondeo lanza un error, el banner se queda como estaba', async () => {
    refresh.mockRejectedValue(new Error('timeout'));
    render(<BannerSinConexion />);
    act(() => emitir({ isConnected: false, isInternetReachable: false }));
    fireEvent.press(screen.getByLabelText('Reintentar'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Reintentar').props.accessibilityState?.busy).toBeFalsy());
    expect(screen.getByText('Sin conexión')).toBeTruthy();
  });
});
