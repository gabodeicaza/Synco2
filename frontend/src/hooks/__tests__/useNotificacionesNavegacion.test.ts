import { renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';

const mockPush = jest.fn();
const mockQuitar = jest.fn();
let mockUsuario: any = { id: 'u1', role: 'coordinador_general' };
let mockUltima: any = null;
let mockEscuchador: ((r: any) => void) | null = null;

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/src/auth-context', () => ({ useAuth: () => ({ user: mockUsuario }) }));
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(mockUltima)),
  addNotificationResponseReceivedListener: jest.fn((fn: any) => {
    mockEscuchador = fn;
    return { remove: mockQuitar };
  }),
}));

import { ESPERA_ARRANQUE_MS, useNotificacionesNavegacion } from '../useNotificacionesNavegacion';

const respuesta = (data: any, identifier = 'n1') => ({ notification: { request: { identifier, content: { data } } } });
const vaciar = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockReset();
  mockQuitar.mockClear();
  mockUsuario = { id: 'u1', role: 'coordinador_general' };
  mockUltima = null;
  mockEscuchador = null;
  (Platform as any).OS = 'android';
});
afterEach(() => jest.useRealTimers());

describe('useNotificacionesNavegacion', () => {
  it('con la app abierta, tocar una notificación navega según su tipo', () => {
    renderHook(() => useNotificacionesNavegacion());
    mockEscuchador!(respuesta({ type: 'urgent_announcement', project_id: 'p1' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(coord)/noticias' });
  });

  it('invitación aceptada lleva a las invitaciones del proyecto', () => {
    renderHook(() => useNotificacionesNavegacion());
    mockEscuchador!(respuesta({ type: 'invitation_accepted', project_id: 'p7' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(coord)/projects/[id]/invitations', params: { id: 'p7' } });
  });

  it('un tipo desconocido no navega ni lanza', () => {
    renderHook(() => useNotificacionesNavegacion());
    expect(() => mockEscuchador!(respuesta({ type: 'algo_nuevo' }))).not.toThrow();
    expect(() => mockEscuchador!(respuesta(undefined, 'n2'))).not.toThrow();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('la misma notificación no navega dos veces', () => {
    renderHook(() => useNotificacionesNavegacion());
    mockEscuchador!(respuesta({ type: 'meeting_reminder' }, 'igual'));
    mockEscuchador!(respuesta({ type: 'meeting_reminder' }, 'igual'));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('con la app cerrada navega a la notificación que la abrió, tras una breve espera', async () => {
    mockUltima = respuesta({ type: 'agreement_due', project_id: 'p1' }, 'fria');
    renderHook(() => useNotificacionesNavegacion());
    await vaciar();
    expect(mockPush).not.toHaveBeenCalled();
    jest.advanceTimersByTime(ESPERA_ARRANQUE_MS);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(coord)/projects/[id]/minutas', params: { id: 'p1' } });
  });

  it('si la notificación del arranque ya se atendió en vivo, no se repite', async () => {
    mockUltima = respuesta({ type: 'meeting_reminder' }, 'doble');
    renderHook(() => useNotificacionesNavegacion());
    mockEscuchador!(respuesta({ type: 'meeting_reminder' }, 'doble'));
    await vaciar();
    jest.advanceTimersByTime(ESPERA_ARRANQUE_MS);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('sin usuario no escucha nada', () => {
    mockUsuario = null;
    renderHook(() => useNotificacionesNavegacion());
    expect(mockEscuchador).toBeNull();
  });

  it('en web no hace nada', () => {
    (Platform as any).OS = 'web';
    renderHook(() => useNotificacionesNavegacion());
    expect(mockEscuchador).toBeNull();
  });

  it('al desmontar quita el escuchador y cancela la navegación pendiente', async () => {
    mockUltima = respuesta({ type: 'meeting_reminder' }, 'pend');
    const { unmount } = renderHook(() => useNotificacionesNavegacion());
    await vaciar();
    unmount();
    jest.advanceTimersByTime(ESPERA_ARRANQUE_MS);
    expect(mockQuitar).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('si la navegación falla, no rompe la app', () => {
    mockPush.mockImplementationOnce(() => { throw new Error('ruta inexistente'); });
    renderHook(() => useNotificacionesNavegacion());
    expect(() => mockEscuchador!(respuesta({ type: 'meeting_reminder' }))).not.toThrow();
  });
});
