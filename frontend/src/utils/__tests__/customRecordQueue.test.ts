// Cola offline de registros de módulos personalizados: persiste sin señal, se
// vacía por /custom-records/sync al volver la conexión (en orden, con el mismo
// client_id para que el backend sea idempotente) y no pierde un registro si el
// servidor falla o se cae la red a medio envío. Mismos mocks que offlineQueue.test.ts.
jest.mock('expo-file-system/legacy', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    documentDirectory: 'file:///fake-doc/',
    EncodingType: { UTF8: 'utf8' },
    getInfoAsync: jest.fn(async (path: string) => ({ exists: store.has(path) })),
    readAsStringAsync: jest.fn(async (path: string) => {
      if (!store.has(path)) throw new Error(`ENOENT: ${path}`);
      return store.get(path) as string;
    }),
    writeAsStringAsync: jest.fn(async (path: string, content: string) => { store.set(path, content); }),
    deleteAsync: jest.fn(async (path: string) => { store.delete(path); }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      store.set(to, store.get(from) as string);
      store.delete(from);
    }),
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: false, isInternetReachable: false })) },
}));

jest.mock('@/src/httpClient', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  }
  return { __esModule: true, ApiError, request: jest.fn() };
});

import * as FS from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { request as httpRequest, ApiError } from '@/src/httpClient';
import {
  enqueueCustomRecord, flushCustomQueue, getCustomPendingCount, listQueuedCustomRecords, removeQueuedCustomRecord,
} from '@/src/utils/customRecordQueue';

const fsStore = (FS as any).__store as Map<string, string>;
const requestMock = httpRequest as jest.Mock;
const netInfoFetch = NetInfo.fetch as jest.Mock;
const drain = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

const payload = (n: number) => ({
  op: 'create', project_id: 'p1', module_id: 'm1', fecha: '2026-06-24', valores: { desc: `Registro ${n}` }, etiqueta: `Mod: ${n}`,
});

beforeEach(() => {
  fsStore.clear();
  netInfoFetch.mockReset();
  netInfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
  requestMock.mockReset();
});

test('un registro sin señal se guarda en el dispositivo y sobrevive a un reinicio', async () => {
  const q = await enqueueCustomRecord(payload(1));
  await drain();
  expect(q.status).toBe('pending');
  expect(q.payload.client_id).toMatch(/^cli_/);
  const releido = await listQueuedCustomRecords();
  expect(releido).toHaveLength(1);
  expect(releido[0].payload.valores.desc).toBe('Registro 1');
  expect(requestMock).not.toHaveBeenCalled(); // sin señal no se intenta
  expect(await getCustomPendingCount()).toBe(1);
});

test('al volver la señal se envía por /custom-records/sync, en orden, con su client_id', async () => {
  const a = await enqueueCustomRecord(payload(1));
  const b = await enqueueCustomRecord(payload(2));
  await drain();
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  requestMock.mockResolvedValue({ id: 'srv' });
  const res = await flushCustomQueue();
  expect(res).toMatchObject({ synced: 2, failed: 0, remaining: 0 });
  const llamadas = requestMock.mock.calls;
  expect(llamadas.map((c) => c[1])).toEqual(['/custom-records/sync', '/custom-records/sync']);
  expect(llamadas.map((c) => c[2].client_id)).toEqual([a.client_id, b.client_id]);
  expect(llamadas[0][0]).toBe('POST');
  expect(await listQueuedCustomRecords()).toHaveLength(0);
});

test('si la red cae a mitad del envío el registro NO se pierde y se reintenta con el mismo client_id', async () => {
  const q = await enqueueCustomRecord(payload(1));
  await drain();
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  requestMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  const r1 = await flushCustomQueue();
  expect(r1).toMatchObject({ synced: 0, remaining: 1 });
  expect((await listQueuedCustomRecords())[0].status).toBe('pending');
  requestMock.mockResolvedValue({ id: 'srv' });
  await flushCustomQueue();
  expect(requestMock.mock.calls[1][2].client_id).toBe(q.client_id); // idempotencia en el backend
  expect(await listQueuedCustomRecords()).toHaveLength(0);
});

test('un error de validación (400) queda como fallido sin reintento automático y se puede descartar', async () => {
  const q = await enqueueCustomRecord(payload(1));
  await drain();
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  requestMock.mockRejectedValue(new ApiError(400, 'Falta llenar «Descripción»'));
  const r = await flushCustomQueue();
  expect(r.failed).toBe(1);
  const [item] = await listQueuedCustomRecords();
  expect(item.status).toBe('failed');
  expect(item.autoRetry).toBe(false);
  expect(item.last_error).toContain('Falta llenar');
  await removeQueuedCustomRecord(q.client_id);
  expect(await listQueuedCustomRecords()).toHaveLength(0);
});
