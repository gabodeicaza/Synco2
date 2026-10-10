// Tests de COMPORTAMIENTO (no de tipos) sobre la API pública de
// offlineQueue.ts y avanceQueue.ts — ambas construidas sobre el motor
// compartido offlineQueueEngine.ts. El objetivo es probar que extraer el
// motor desde offlineQueue.ts (que ya usaban los reportes en producción) NO
// cambió el comportamiento observable: persistencia, orden de flush, lock,
// escritura atómica, auto-sanación, backoff y aislamiento entre colas.
//
// Mocks: expo-file-system/legacy (sistema de archivos falso en memoria,
// controlable para simular crashes), @react-native-community/netinfo
// (control de "hay señal"), @/src/httpClient (control de éxito/fallo de red
// sin tocar la red real).

// --- Mocks ------------------------------------------------------------------
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
    writeAsStringAsync: jest.fn(async (path: string, content: string) => {
      store.set(path, content);
    }),
    deleteAsync: jest.fn(async (path: string, opts?: { idempotent?: boolean }) => {
      if (!store.has(path) && !opts?.idempotent) throw new Error(`ENOENT: ${path}`);
      store.delete(path);
    }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      if (!store.has(from)) throw new Error(`ENOENT move from: ${from}`);
      store.set(to, store.get(from) as string);
      store.delete(from);
    }),
    copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      if (!store.has(from)) throw new Error(`ENOENT copy from: ${from}`);
      store.set(to, store.get(from) as string);
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
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { __esModule: true, ApiError, request: jest.fn() };
});

import * as FS from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { request as httpRequest, ApiError } from '@/src/httpClient';
import {
  enqueueReport, flushQueue, listQueuedReports, removeQueuedReport,
  subscribeQueueChanges, getPendingCount,
} from '@/src/utils/offlineQueue';
import { enqueueAvance, flushAvanceQueue, listQueuedAvances } from '@/src/utils/avanceQueue';

const fsStore = (FS as any).__store as Map<string, string>;
const requestMock = httpRequest as jest.Mock;
const netInfoFetch = NetInfo.fetch as jest.Mock;

const REPORTS_QUEUE_PATH = 'file:///fake-doc/synco_offline_reports_queue.json';
const REPORTS_QUEUE_TMP_PATH = `${REPORTS_QUEUE_PATH}.tmp`;

// `enqueueReport`/`enqueueAvance` disparan un flush en segundo plano SIN
// esperarlo ("fire-and-forget" — ya existia asi en el offlineQueue.ts
// original, no es algo que haya cambiado la extraccion). Ese flush ocupa
// `flushPromise` durante unos microtasks; si el test llama a `flushQueue()`
// explicitamente justo despues de encolar, puede "engancharse" al flush
// automatico (que corre offline y no hace nada) en vez de al que el test
// quiere controlar. Este helper deja que ese flush en segundo plano se
// asiente antes de continuar, para que las aserciones no dependan de una
// carrera de microtasks.
async function drainBackgroundFlush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  fsStore.clear();
  (FS.getInfoAsync as jest.Mock).mockClear();
  (FS.readAsStringAsync as jest.Mock).mockClear();
  (FS.writeAsStringAsync as jest.Mock).mockClear();
  (FS.deleteAsync as jest.Mock).mockClear();
  (FS.moveAsync as jest.Mock).mockClear();
  netInfoFetch.mockReset();
  netInfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
  requestMock.mockReset();
});

// ============================================================================
// 1. Persistencia entre "reinicios" (releer del storage, sin cache en memoria)
// ============================================================================
test('enqueueReport persiste y sobrevive una relectura ("reinicio" de la app)', async () => {
  const item = await enqueueReport({ title: 'Reporte A' });
  expect(item.status).toBe('pending');

  // No hay cache en JS: esta lectura viene 100% del "disco" falso.
  const reread = await listQueuedReports();
  expect(reread).toHaveLength(1);
  expect(reread[0].client_id).toBe(item.client_id);
  expect(reread[0].payload.title).toBe('Reporte A');
});

// ============================================================================
// 2. flushQueue procesa secuencialmente, no en paralelo
// ============================================================================
test('flushQueue procesa los items secuencialmente, en el orden en que se encolaron', async () => {
  await enqueueReport({ n: 1 });
  await enqueueReport({ n: 2 });
  await enqueueReport({ n: 3 });
  await drainBackgroundFlush();

  let concurrent = 0;
  let maxConcurrent = 0;
  const order: number[] = [];
  requestMock.mockImplementation(async (_method: string, _path: string, payload: any) => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 10));
    order.push(payload.n);
    concurrent--;
    return { ok: true };
  });
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });

  const summary = await flushQueue({ manual: true });

  expect(summary.synced).toBe(3);
  expect(maxConcurrent).toBe(1); // nunca 2 en vuelo al mismo tiempo
  expect(order).toEqual([1, 2, 3]); // mismo orden de encolado
});

test('un error de red crudo (no ApiError) detiene el resto del lote, igual que antes', async () => {
  await enqueueReport({ n: 1 });
  await enqueueReport({ n: 2 });
  await drainBackgroundFlush();

  requestMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });

  const summary = await flushQueue({ manual: true });
  expect(summary.synced).toBe(0);
  expect(requestMock).toHaveBeenCalledTimes(1); // el 2do item ni se intento

  const items = await listQueuedReports();
  expect(items).toHaveLength(2);
  expect(items[0].status).toBe('pending'); // se revierte, no queda en 'syncing'
});

// ============================================================================
// 3. El lock impide dos flush concurrentes
// ============================================================================
test('dos llamadas paralelas a flushQueue comparten el mismo flush en curso (no duplican envios)', async () => {
  await enqueueReport({ n: 1 });
  await enqueueReport({ n: 2 });
  await drainBackgroundFlush();

  let callCount = 0;
  requestMock.mockImplementation(async () => {
    callCount++;
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true };
  });
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });

  const p1 = flushQueue({ manual: true });
  const p2 = flushQueue({ manual: true });
  expect(p1).toBe(p2); // literalmente la misma promesa

  const [s1, s2] = await Promise.all([p1, p2]);
  expect(s1).toBe(s2);
  expect(callCount).toBe(2); // los 2 reportes se mandaron 1 vez cada uno, no 4
});

test('el lock de escritura serializa dos enqueue concurrentes sin perder ninguno', async () => {
  // Sin el lock, dos enqueue "a la vez" leerian el mismo estado inicial y el
  // segundo sobreescribiria al primero (lost update). Con el lock, ambos
  // deben quedar persistidos.
  await Promise.all([enqueueReport({ n: 'x' }), enqueueReport({ n: 'y' })]);
  const items = await listQueuedReports();
  expect(items).toHaveLength(2);
  expect(items.map((i) => i.payload.n).sort()).toEqual(['x', 'y']);
});

// ============================================================================
// 4. Escritura atómica .tmp + move: crash a medio guardado
// ============================================================================
// OJO: el patron real es write-tmp -> deleteAsync(FINAL) -> moveAsync(TMP,FINAL)
// (ver offlineQueueEngine.ts, identico al offlineQueue.ts original). Eso
// significa que la garantia real NO es "el archivo final nunca se pierde":
// si el crash cae justo entre el delete y el move, el archivo final
// desaparece (ventana pre-existente, no introducida por la extraccion). Lo
// que SI garantiza el patron es que el archivo final, si existe, nunca queda
// a medio escribir/corrupto (nunca es JSON truncado o mezclado) -- eso es lo
// que este test verifica.
test('un crash entre delete y move nunca deja JSON corrupto en el archivo final (aunque puede perder el ultimo write)', async () => {
  await enqueueReport({ n: 'inicial' });
  await drainBackgroundFlush();

  (FS.moveAsync as jest.Mock).mockImplementationOnce(async () => {
    throw new Error('simulated crash entre delete y move');
  });

  await expect(enqueueReport({ n: 'se_pierde_en_el_crash' })).rejects.toThrow();

  // Si el archivo final sobrevivio (no siempre lo hara, ver nota arriba),
  // debe ser JSON valido -- nunca truncado/mezclado.
  const rawFinal = fsStore.get(REPORTS_QUEUE_PATH);
  if (rawFinal !== undefined) {
    expect(() => JSON.parse(rawFinal)).not.toThrow();
  }
  // El .tmp con la escritura no confirmada queda huerfano (esperado: lo
  // sanea la proxima escritura exitosa, ver el test de la seccion 7).
  expect(fsStore.has(REPORTS_QUEUE_TMP_PATH)).toBe(true);
});

// ============================================================================
// 5. Auto-sanación de 'syncing' -> 'pending' al leer
// ============================================================================
test('un item que quedo en syncing (muerte previa a mitad de flush) se sana a pending al leer', async () => {
  const raw = JSON.stringify({
    version: 1,
    items: [{
      client_id: 'cli_atascado', payload: { n: 1 }, created_at: new Date().toISOString(),
      status: 'syncing', attempts: 0, autoRetry: true, last_error: null,
    }],
  });
  fsStore.set(REPORTS_QUEUE_PATH, raw);

  const listener = jest.fn();
  const unsub = subscribeQueueChanges(listener);

  const items = await listQueuedReports();
  expect(items).toHaveLength(1);
  expect(items[0].status).toBe('pending'); // sanado
  expect(listener).toHaveBeenCalled(); // la sanacion notifica el cambio

  // Y quedo persistido, no solo corregido en memoria.
  const rereadRaw = fsStore.get(REPORTS_QUEUE_PATH)!;
  expect(JSON.parse(rereadRaw).items[0].status).toBe('pending');

  unsub();
});

// ============================================================================
// 6. Backoff por attempts/autoRetry
// ============================================================================
test('error de servidor (5xx): failed con autoRetry=true si attempts < 10', async () => {
  await enqueueReport({ n: 1 });
  await drainBackgroundFlush();
  requestMock.mockRejectedValue(new ApiError(503, 'Service Unavailable'));
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });

  const summary = await flushQueue({ manual: true });
  expect(summary.failed).toBe(1);

  const items = await listQueuedReports();
  expect(items[0].status).toBe('failed');
  expect(items[0].attempts).toBe(1);
  expect(items[0].autoRetry).toBe(true);
  expect(items[0].last_error).toContain('Service Unavailable');
});

test('error de cliente (4xx): failed con autoRetry=false de inmediato (no reintenta solo)', async () => {
  await enqueueReport({ n: 1 });
  await drainBackgroundFlush();
  requestMock.mockRejectedValue(new ApiError(422, 'Unprocessable'));
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });

  await flushQueue({ manual: true });
  const items = await listQueuedReports();
  expect(items[0].status).toBe('failed');
  expect(items[0].autoRetry).toBe(false);
});

test('autoRetry se apaga exactamente al llegar a MAX_AUTO_RETRY_ATTEMPTS (10), y ahi deja de reintentar solo', async () => {
  await enqueueReport({ n: 1 });
  await drainBackgroundFlush();
  requestMock.mockRejectedValue(new ApiError(500, 'boom'));
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });

  let items = await listQueuedReports();
  for (let i = 0; i < 10; i++) {
    // manual:true fuerza el reintento aunque autoRetry ya sea false, para
    // poder llevar el contador hasta 10 de forma determinista.
    await flushQueue({ manual: true });
  }
  items = await listQueuedReports();
  expect(items[0].attempts).toBe(10);
  expect(items[0].autoRetry).toBe(false); // 10 < 10 es false

  // Con autoRetry=false, un flush AUTOMATICO (no manual) ya no debe tocarlo.
  requestMock.mockClear();
  const summary = await flushQueue({ manual: false });
  expect(requestMock).not.toHaveBeenCalled();
  expect(summary.synced).toBe(0);
  expect(summary.failed).toBe(0);
});

// ============================================================================
// 7. Sanación de un .tmp huérfano
// ============================================================================
test('un .tmp huerfano de un crash previo es invisible para la lectura y no bloquea la proxima escritura', async () => {
  fsStore.set(REPORTS_QUEUE_TMP_PATH, JSON.stringify({
    version: 1,
    items: [{ client_id: 'huerfano', payload: {}, created_at: '', status: 'pending', attempts: 0, autoRetry: true, last_error: null }],
  }));
  // No existe el archivo FINAL -> el huerfano no debe aparecer en la lectura.
  const before = await listQueuedReports();
  expect(before).toHaveLength(0);

  // La proxima escritura real funciona normalmente (sobreescribe el .tmp sin tronar).
  const item = await enqueueReport({ n: 'nuevo' });
  const after = await listQueuedReports();
  expect(after.map((i) => i.client_id)).toEqual([item.client_id]);
  expect(after.find((i) => i.client_id === 'huerfano')).toBeUndefined();
});

// ============================================================================
// 8. subscribeQueueChanges dispara en los mismos momentos
// ============================================================================
test('subscribeQueueChanges notifica en enqueue/remove/sync y deja de notificar tras desuscribirse', async () => {
  const listener = jest.fn();
  const unsub = subscribeQueueChanges(listener);

  await enqueueReport({ n: 1 });
  expect(listener).toHaveBeenCalledTimes(1);

  const item2 = await enqueueReport({ n: 2 });
  expect(listener).toHaveBeenCalledTimes(2);

  await removeQueuedReport(item2.client_id);
  expect(listener).toHaveBeenCalledTimes(3);

  requestMock.mockResolvedValue({ ok: true });
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  await flushQueue({ manual: true }); // 1 item restante: 'syncing' (notify) + remove tras exito (notify)
  expect(listener.mock.calls.length).toBeGreaterThanOrEqual(5);

  unsub();
  listener.mockClear();
  await enqueueReport({ n: 3 });
  expect(listener).not.toHaveBeenCalled();
});

// ============================================================================
// 9. getPendingCount y removeQueuedReport
// ============================================================================
test('getPendingCount cuenta pending+failed; removeQueuedReport quita solo el item indicado', async () => {
  const a = await enqueueReport({ n: 'a' });
  const b = await enqueueReport({ n: 'b' });
  expect(await getPendingCount()).toBe(2);

  await removeQueuedReport(a.client_id);
  const remaining = await listQueuedReports();
  expect(remaining).toHaveLength(1);
  expect(remaining[0].client_id).toBe(b.client_id);
  expect(await getPendingCount()).toBe(1);
});

// ============================================================================
// 10. Cola mixta: reportes + avances no se bloquean entre si
// ============================================================================
test('cola mixta: 2 reportes + 2 avances; un fallo en avances no bloquea reportes ni viceversa', async () => {
  await enqueueReport({ n: 'r1' });
  await enqueueReport({ n: 'r2' });
  await enqueueAvance({ concepto_id: 'c1' });
  await enqueueAvance({ concepto_id: 'c2' });
  await drainBackgroundFlush();

  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  requestMock.mockImplementation(async (_method: string, path: string) => {
    if (path === '/avances') throw new ApiError(500, 'avances caidos');
    return { ok: true }; // /reports funciona bien
  });

  const [reportSummary, avanceSummary] = await Promise.all([
    flushQueue({ manual: true }),
    flushAvanceQueue({ manual: true }),
  ]);

  expect(reportSummary.synced).toBe(2);
  expect(reportSummary.failed).toBe(0);
  expect(avanceSummary.synced).toBe(0);
  expect(avanceSummary.failed).toBe(2);

  const reportsLeft = await listQueuedReports();
  expect(reportsLeft).toHaveLength(0); // ambos reportes salieron de la cola

  const avancesLeft = await listQueuedAvances();
  expect(avancesLeft).toHaveLength(2); // los avances no se perdieron, solo quedaron 'failed'
  expect(avancesLeft.every((a) => a.status === 'failed')).toBe(true);
});

// ============================================================================
// 11. Avances encolados: idempotencia y política de errores (T-05d)
// ============================================================================
const AVANCES_QUEUE_PATH = 'file:///fake-doc/synco_offline_avances_queue.json';

test('un avance encolado viaja con su client_id y, una vez enviado, un segundo flush no lo reenvía', async () => {
  const item = await enqueueAvance({ concepto_id: 'c1', cantidad_ejecutada: '5' });
  await drainBackgroundFlush();
  expect(item.payload.client_id).toBe(item.client_id);

  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  requestMock.mockResolvedValue({ ok: true });

  const primero = await flushAvanceQueue({ manual: true });
  const segundo = await flushAvanceQueue({ manual: true });

  expect(primero.synced).toBe(1);
  expect(segundo.synced).toBe(0);
  const enviados = requestMock.mock.calls.filter((c) => c[1] === '/avances');
  expect(enviados).toHaveLength(1);
  expect(enviados[0][2]).toEqual(expect.objectContaining({ concepto_id: 'c1', client_id: item.client_id }));
  expect(await listQueuedAvances()).toHaveLength(0);
});

test('un avance guardado antes de existir el client_id en el payload se sigue enviando tal cual', async () => {
  fsStore.set(AVANCES_QUEUE_PATH, JSON.stringify({
    version: 1,
    items: [{
      client_id: 'cli_viejo', payload: { concepto_id: 'c9', cantidad_ejecutada: '2' },
      created_at: '2026-08-01T10:00:00.000Z', status: 'pending', attempts: 0, autoRetry: true, last_error: null,
    }],
  }));
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  requestMock.mockResolvedValue({ ok: true });

  const r = await flushAvanceQueue({ manual: true });

  expect(r.synced).toBe(1);
  expect(requestMock).toHaveBeenCalledWith('POST', '/avances', { concepto_id: 'c9', cantidad_ejecutada: '2' });
  expect(await listQueuedAvances()).toHaveLength(0);
});

test('un avance que el servidor rechaza (4xx) queda como failed sin reintento automático y con su motivo', async () => {
  const item = await enqueueAvance({ concepto_id: 'c1' });
  await drainBackgroundFlush();
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  requestMock.mockRejectedValue(new ApiError(400, 'La cantidad debe ser mayor que cero.'));

  const r = await flushAvanceQueue({ manual: true });

  expect(r.failed).toBe(1);
  const [guardado] = await listQueuedAvances();
  expect(guardado.client_id).toBe(item.client_id);
  expect(guardado.status).toBe('failed');
  expect(guardado.autoRetry).toBe(false);
  expect(guardado.last_error).toBe('La cantidad debe ser mayor que cero.');

  // Un flush automático posterior no lo vuelve a intentar.
  requestMock.mockClear();
  await flushAvanceQueue({ manual: false });
  expect(requestMock).not.toHaveBeenCalled();
});

test('un error de red conserva el avance como pending y corta el lote', async () => {
  await enqueueAvance({ concepto_id: 'c1' });
  await enqueueAvance({ concepto_id: 'c2' });
  await drainBackgroundFlush();
  netInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  requestMock.mockRejectedValue(new TypeError('Network request failed'));

  const r = await flushAvanceQueue({ manual: true });

  expect(r.synced).toBe(0);
  expect(requestMock).toHaveBeenCalledTimes(1); // no insiste con el resto
  const guardados = await listQueuedAvances();
  expect(guardados).toHaveLength(2);
  expect(guardados.every((a) => a.status === 'pending')).toBe(true);
});
