import React from 'react';
import { AppState } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(), fetch: jest.fn() },
}));
jest.mock('@/src/utils/offlineQueue', () => ({
  flushQueue: jest.fn(),
  listQueuedReports: jest.fn(),
  removeQueuedReport: jest.fn(),
  subscribeQueueChanges: jest.fn(),
}));
jest.mock('@/src/utils/avanceQueue', () => ({
  flushAvanceQueue: jest.fn(),
  listQueuedAvances: jest.fn(),
  removeQueuedAvance: jest.fn(),
  subscribeAvanceQueueChanges: jest.fn(),
}));
jest.mock('@/src/utils/toast', () => ({ showToast: jest.fn() }));

import NetInfo from '@react-native-community/netinfo';
import { flushQueue, listQueuedReports, removeQueuedReport, subscribeQueueChanges } from '@/src/utils/offlineQueue';
import {
  flushAvanceQueue, listQueuedAvances, removeQueuedAvance, subscribeAvanceQueueChanges,
} from '@/src/utils/avanceQueue';
import { showToast } from '@/src/utils/toast';
import { OfflineQueueProvider, useOfflineQueue } from '@/src/offline-queue-context';

const flushReportes = flushQueue as jest.Mock;
const flushAvances = flushAvanceQueue as jest.Mock;
const listarReportes = listQueuedReports as jest.Mock;
const listarAvances = listQueuedAvances as jest.Mock;

const vacio = { synced: 0, failed: 0, remaining: 0, skippedOffline: false };
const item = (client_id: string, created_at: string, extra: Record<string, unknown> = {}) => ({
  client_id, created_at, status: 'pending', attempts: 0, autoRetry: true, last_error: null, payload: {}, ...extra,
});

let alCambiarReportes: () => void = () => {};
let alCambiarAvances: () => void = () => {};
let alCambiarRed: (s: { isConnected: boolean; isInternetReachable: boolean | null }) => void = () => {};
let alCambiarApp: (s: string) => void = () => {};

const wrapper = ({ children }: { children: React.ReactNode }) => <OfflineQueueProvider>{children}</OfflineQueueProvider>;

async function montar() {
  const r = renderHook(() => useOfflineQueue(), { wrapper });
  await waitFor(() => expect(flushAvances).toHaveBeenCalled());
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  flushReportes.mockResolvedValue(vacio);
  flushAvances.mockResolvedValue(vacio);
  listarReportes.mockResolvedValue([]);
  listarAvances.mockResolvedValue([]);
  (subscribeQueueChanges as jest.Mock).mockImplementation((cb: () => void) => { alCambiarReportes = cb; return jest.fn(); });
  (subscribeAvanceQueueChanges as jest.Mock).mockImplementation((cb: () => void) => { alCambiarAvances = cb; return jest.fn(); });
  (NetInfo.addEventListener as jest.Mock).mockImplementation((cb: typeof alCambiarRed) => { alCambiarRed = cb; return jest.fn(); });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (s: string) => void) => {
    alCambiarApp = cb;
    return { remove: jest.fn() };
  }) as any);
});

describe('OfflineQueueProvider: reportes y avances', () => {
  it('al abrir la app intenta vaciar las DOS colas', async () => {
    await montar();
    expect(flushReportes).toHaveBeenCalledWith({ manual: false });
    expect(flushAvances).toHaveBeenCalledWith({ manual: false });
  });

  it('expone el conteo total y por tipo, y los junta ordenados del más antiguo al más nuevo', async () => {
    listarReportes.mockResolvedValue([item('r1', '2026-09-24T10:00:00Z', { payload: { title: 'Reporte A' } })]);
    listarAvances.mockResolvedValue([
      item('a1', '2026-09-24T09:00:00Z'),
      item('a2', '2026-09-24T11:00:00Z', { status: 'failed' }),
      item('a3', '2026-09-24T12:00:00Z', { status: 'syncing' }),
    ]);
    const { result } = await montar();
    await waitFor(() => expect(result.current.pendingCount).toBe(3));
    expect(result.current.pendingReports).toBe(1);
    expect(result.current.pendingAvances).toBe(2); // 'syncing' no cuenta como por enviar
    expect(result.current.pendientes.map((p) => `${p.tipo}:${p.item.client_id}`)).toEqual([
      'avance:a1', 'reporte:r1', 'avance:a2', 'avance:a3',
    ]);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.avances).toHaveLength(3);
  });

  it('un avance encolado desde fuera de React aparece al instante (suscripción de la cola de avances)', async () => {
    const { result } = await montar();
    expect(result.current.pendingCount).toBe(0);
    listarAvances.mockResolvedValue([item('a1', '2026-09-24T09:00:00Z')]);
    await act(async () => { alCambiarAvances(); });
    await waitFor(() => expect(result.current.pendingAvances).toBe(1));
    expect(result.current.pendingCount).toBe(1);
  });

  it('un reporte encolado desde fuera de React también aparece', async () => {
    const { result } = await montar();
    listarReportes.mockResolvedValue([item('r1', '2026-09-24T09:00:00Z')]);
    await act(async () => { alCambiarReportes(); });
    await waitFor(() => expect(result.current.pendingReports).toBe(1));
  });

  it('si el archivo de una cola falla, la otra se actualiza igual', async () => {
    listarReportes.mockRejectedValue(new Error('archivo inaccesible'));
    listarAvances.mockResolvedValue([item('a1', '2026-09-24T09:00:00Z')]);
    const { result } = await montar();
    await waitFor(() => expect(result.current.pendingAvances).toBe(1));
    expect(result.current.pendingReports).toBe(0);
  });

  it('al reconectar con pendientes vacía las dos colas', async () => {
    listarAvances.mockResolvedValue([item('a1', '2026-09-24T09:00:00Z')]);
    const { result } = await montar();
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    flushReportes.mockClear();
    flushAvances.mockClear();

    await act(async () => { alCambiarRed({ isConnected: false, isInternetReachable: false }); });
    expect(flushAvances).not.toHaveBeenCalled();
    await act(async () => { alCambiarRed({ isConnected: true, isInternetReachable: true }); });

    await waitFor(() => expect(flushAvances).toHaveBeenCalledWith({ manual: false }));
    expect(flushReportes).toHaveBeenCalledWith({ manual: false });
  });

  it('al volver a primer plano con pendientes vacía las dos colas; sin pendientes no hace nada', async () => {
    const sinPendientes = await montar();
    flushReportes.mockClear();
    flushAvances.mockClear();
    await act(async () => { alCambiarApp('active'); });
    expect(flushAvances).not.toHaveBeenCalled();
    sinPendientes.unmount();

    listarReportes.mockResolvedValue([item('r1', '2026-09-24T09:00:00Z')]);
    const { result } = await montar();
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    flushReportes.mockClear();
    flushAvances.mockClear();
    await act(async () => { alCambiarApp('active'); });
    await waitFor(() => expect(flushReportes).toHaveBeenCalledWith({ manual: false }));
    expect(flushAvances).toHaveBeenCalledWith({ manual: false });
  });

  it('"Reintentar ahora" hace un flush manual de las dos colas y marca que está enviando', async () => {
    const { result } = await montar();
    flushReportes.mockClear();
    flushAvances.mockClear();
    let terminar!: () => void;
    flushReportes.mockReturnValueOnce(new Promise((r) => { terminar = () => r(vacio); }));

    let promesa!: Promise<void>;
    act(() => { promesa = result.current.flushNow(); });
    await waitFor(() => expect(result.current.isFlushing).toBe(true));
    await act(async () => { terminar(); await promesa; });

    expect(flushReportes).toHaveBeenCalledWith({ manual: true });
    expect(flushAvances).toHaveBeenCalledWith({ manual: true });
    expect(result.current.isFlushing).toBe(false);
  });

  it('descartar un item usa la cola que le corresponde', async () => {
    const { result } = await montar();
    await act(async () => { await result.current.discardItem('a1', 'avance'); });
    expect(removeQueuedAvance).toHaveBeenCalledWith('a1');
    expect(removeQueuedReport).not.toHaveBeenCalled();

    await act(async () => { await result.current.discardItem('r1'); });
    expect(removeQueuedReport).toHaveBeenCalledWith('r1');
  });

  it('avisa con un toast lo sincronizado y lo que el servidor rechazó', async () => {
    flushAvances.mockResolvedValue({ synced: 2, failed: 1, remaining: 1, skippedOffline: false });
    await montar();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('2 registros de avance sincronizados'));
    expect(showToast).toHaveBeenCalledWith('No se pudieron enviar 1 pendientes: revisa el detalle.');
  });
});
