// Motor genérico de cola offline por archivo — lock de escritura concurrente,
// escritura atómica (.tmp + move) y listeners de cambio para React.
//
// Extraído de offlineQueue.ts (que originalmente tenía esta lógica acoplada
// al shape de un Reporte) para poder reusarlo tal cual en avanceQueue.ts
// (Registrar Avance del Catálogo de Conceptos) sin duplicar la parte
// delicada: lectura-modificación-escritura serializada y auto-sanación de
// items atascados en 'syncing' si la app murió a mitad de un flush.
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { request, ApiError } from '@/src/httpClient';
import { dayjs } from '@/src/utils/tz';

// En web, expo-file-system no tiene implementacion real (su shim solo deja
// documentDirectory/cacheDirectory en null y ni siquiera define
// readAsStringAsync/writeAsStringAsync) -- llamarlo ahi tira TypeError, no un
// error manejable. Para que "Nuevo Reporte" y "Registrar Avance" no truenen
// al exportar la app como PWA, la cola persiste en localStorage cuando
// Platform.OS === 'web' en vez de en un archivo.
const IS_WEB = Platform.OS === 'web';

export type QueueItemStatus = 'pending' | 'syncing' | 'failed';

export interface QueueItem<TPayload = Record<string, any>> {
  client_id: string;
  payload: TPayload;
  created_at: string;
  status: QueueItemStatus;
  attempts: number;
  /** false = error de validacion/permiso real; no reintentar solo. */
  autoRetry: boolean;
  last_error?: string | null;
}

export interface FlushSummary {
  synced: number;
  failed: number;
  remaining: number;
  skippedOffline: boolean;
}

export class OfflineQueueError extends Error {}
export class OfflineQueueFullError extends OfflineQueueError {}

export interface OfflineQueueEngineOptions {
  /** Nombre del archivo dentro de documentDirectory (debe ser único por cola). */
  fileName: string;
  /** Endpoint POST al que se envía cada item pendiente. */
  endpoint: string;
  maxQueueItems?: number;
  maxAutoRetryAttempts?: number;
  /** Prefijo de los logs de __DEV__, para distinguir colas en consola. */
  logTag: string;
  maxQueueItemsErrorMessage?: (max: number) => string;
}

export function createOfflineQueueEngine<TPayload = Record<string, any>>(opts: OfflineQueueEngineOptions) {
  const MAX_QUEUE_ITEMS = opts.maxQueueItems ?? 30;
  const MAX_AUTO_RETRY_ATTEMPTS = opts.maxAutoRetryAttempts ?? 10;
  const QUEUE_DIR = FileSystem.documentDirectory;
  const QUEUE_FILE = `${QUEUE_DIR || ''}${opts.fileName}`;
  const QUEUE_FILE_TMP = `${QUEUE_FILE}.tmp`;
  const WEB_STORAGE_KEY = `synco_web_${opts.fileName}`;

  function log(...args: any[]) {
    if (__DEV__) console.log(`[Dirac][${opts.logTag}]`, ...args);
  }

  // --- Notificacion de cambios ------------------------------------------
  type QueueChangeListener = () => void;
  const queueChangeListeners = new Set<QueueChangeListener>();

  function subscribeQueueChanges(listener: QueueChangeListener): () => void {
    queueChangeListeners.add(listener);
    return () => {
      queueChangeListeners.delete(listener);
    };
  }

  function notifyQueueChanged() {
    queueChangeListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        /* noop */
      }
    });
  }

  /** Id de idempotencia. No hay libreria uuid instalada; timestamp + random es
   * suficiente porque solo se usa para deduplicar reintentos del mismo dispositivo. */
  function generateClientId(): string {
    const ts = Date.now().toString(36);
    const r1 = Math.random().toString(36).slice(2, 10);
    const r2 = Math.random().toString(36).slice(2, 6);
    return `cli_${ts}_${r1}${r2}`;
  }

  async function isLikelyOnline(): Promise<boolean> {
    try {
      const state = await NetInfo.fetch();
      return !!state.isConnected && state.isInternetReachable !== false;
    } catch {
      return true; // fail-open: si NetInfo falla, que decida el fetch real.
    }
  }

  // --- Persistencia -------------------------------------------------------
  // Serializa todo acceso al archivo: `enqueue` y cada paso de `flush`
  // leen-modifican-escriben, y sin esto una captura simultanea a un flush en
  // curso podria perder una escritura.
  let queueLock: Promise<any> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = queueLock.then(fn, fn);
    queueLock = run.then(() => undefined, () => undefined);
    return run;
  }

  // --- Backend web: localStorage (sin expo-file-system) -------------------
  function readQueueWebRaw(): QueueItem<TPayload>[] {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(WEB_STORAGE_KEY);
    } catch {
      // localStorage inaccesible (modo privado, cuota, SSR): tratamos como
      // cola vacia -- ver comentario en isLikelyOnline sobre fail-open.
      return [];
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      const items: QueueItem<TPayload>[] = Array.isArray(parsed?.items) ? parsed.items : [];
      let mutated = false;
      const healed = items.map((it) => {
        if (it.status === 'syncing') {
          mutated = true;
          return { ...it, status: 'pending' as const };
        }
        return it;
      });
      if (mutated) writeQueueWebRaw(healed);
      return healed;
    } catch (e) {
      log('localStorage corrupto, se reinicia la cola', e);
      try {
        window.localStorage.removeItem(WEB_STORAGE_KEY);
      } catch {
        /* noop */
      }
      return [];
    }
  }

  function writeQueueWebRaw(items: QueueItem<TPayload>[]): void {
    try {
      window.localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify({ version: 1, items }));
    } catch (e) {
      throw new OfflineQueueError(
        `No se pudo guardar en localStorage (cuota llena o navegador en modo privado): ${(e as any)?.message || e}`,
      );
    }
  }

  // --- Backend nativo: archivo via expo-file-system ------------------------
  async function readQueueFileRaw(): Promise<QueueItem<TPayload>[]> {
    if (IS_WEB) return readQueueWebRaw();
    if (!QUEUE_DIR) {
      throw new OfflineQueueError('Almacenamiento local no disponible (documentDirectory vacio).');
    }
    const info = await FileSystem.getInfoAsync(QUEUE_FILE);
    if (!info.exists) return [];
    try {
      const text = await FileSystem.readAsStringAsync(QUEUE_FILE, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const parsed = JSON.parse(text);
      const items: QueueItem<TPayload>[] = Array.isArray(parsed?.items) ? parsed.items : [];
      // Auto-sanacion: si la app murio a mitad de un flush anterior, no dejar
      // items atascados en 'syncing' para siempre.
      let mutated = false;
      const healed = items.map((it) => {
        if (it.status === 'syncing') {
          mutated = true;
          return { ...it, status: 'pending' as const };
        }
        return it;
      });
      if (mutated) {
        await writeQueueFileRaw(healed);
        notifyQueueChanged();
      }
      return healed;
    } catch (e) {
      log('archivo corrupto, se aisla y se reinicia la cola', e);
      try {
        await FileSystem.moveAsync({ from: QUEUE_FILE, to: `${QUEUE_FILE}.corrupt-${Date.now()}` });
      } catch {
        /* noop: si ni siquiera se pudo aislar, seguimos con cola vacia igual */
      }
      return [];
    }
  }

  async function writeQueueFileRaw(items: QueueItem<TPayload>[]): Promise<void> {
    if (IS_WEB) return writeQueueWebRaw(items);
    if (!QUEUE_DIR) {
      throw new OfflineQueueError('Almacenamiento local no disponible (documentDirectory vacio).');
    }
    const body = JSON.stringify({ version: 1, items });
    await FileSystem.writeAsStringAsync(QUEUE_FILE_TMP, body, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    // Escritura "atomica": si la app muere entre estas dos lineas, el peor caso
    // es un .tmp huerfano (se sobreescribe la proxima vez), nunca un archivo
    // definitivo truncado a medias.
    try {
      await FileSystem.deleteAsync(QUEUE_FILE, { idempotent: true });
    } catch {
      /* noop */
    }
    await FileSystem.moveAsync({ from: QUEUE_FILE_TMP, to: QUEUE_FILE });
  }

  function listQueued(): Promise<QueueItem<TPayload>[]> {
    return withLock(() => readQueueFileRaw());
  }

  async function getPendingCount(): Promise<number> {
    const items = await listQueued();
    return items.filter((i) => i.status === 'pending' || i.status === 'failed').length;
  }

  async function removeQueued(clientId: string): Promise<void> {
    await withLock(async () => {
      const items = await readQueueFileRaw();
      await writeQueueFileRaw(items.filter((i) => i.client_id !== clientId));
    });
    notifyQueueChanged();
  }

  async function updateQueued(clientId: string, patch: Partial<QueueItem<TPayload>>): Promise<void> {
    await withLock(async () => {
      const items = await readQueueFileRaw();
      const next = items.map((i) => (i.client_id === clientId ? { ...i, ...patch } : i));
      await writeQueueFileRaw(next);
    });
    notifyQueueChanged();
  }

  async function enqueue(payload: TPayload & { client_id?: string }): Promise<QueueItem<TPayload>> {
    const clientId = (payload as any).client_id || generateClientId();
    const finalPayload = { ...payload, client_id: clientId } as TPayload;

    const item = await withLock(async () => {
      const items = await readQueueFileRaw();
      if (items.length >= MAX_QUEUE_ITEMS) {
        const msg = opts.maxQueueItemsErrorMessage
          ? opts.maxQueueItemsErrorMessage(MAX_QUEUE_ITEMS)
          : `Ya hay ${MAX_QUEUE_ITEMS} elementos esperando conexión en este dispositivo. ` +
            'Conéctate y espera a que se sincronicen antes de agregar mas.';
        throw new OfflineQueueFullError(msg);
      }
      const newItem: QueueItem<TPayload> = {
        client_id: clientId,
        payload: finalPayload,
        created_at: dayjs().toISOString(),
        status: 'pending',
        attempts: 0,
        autoRetry: true,
        last_error: null,
      };
      await writeQueueFileRaw([...items, newItem]);
      return newItem;
    });

    notifyQueueChanged();
    log('elemento encolado', clientId);

    // Fire-and-forget: por si `isLikelyOnline()` dio un falso negativo y en
    // realidad si hay red, intentamos enviarlo ya sin bloquear a quien encolo.
    flush({ manual: false }).catch(() => {});

    return item;
  }

  // --- Envio ----------------------------------------------------------------
  let flushPromise: Promise<FlushSummary> | null = null;

  /** Recorre la cola e intenta enviar los items pendientes.
   * Si ya hay un flush en curso, quien llegue tarde recibe el mismo resultado
   * en vez de disparar un segundo loop de red en paralelo. */
  function flush(flushOpts: { manual?: boolean } = {}): Promise<FlushSummary> {
    if (flushPromise) return flushPromise;
    flushPromise = doFlush(flushOpts).finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  }

  async function doFlush({ manual = false }: { manual?: boolean }): Promise<FlushSummary> {
    if (!manual) {
      const online = await isLikelyOnline();
      if (!online) {
        return { synced: 0, failed: 0, remaining: await getPendingCount(), skippedOffline: true };
      }
    }

    const items = await listQueued();
    const candidates = items.filter(
      (i) => i.status === 'pending' || (i.status === 'failed' && (i.autoRetry || manual)),
    );

    let synced = 0;
    let failed = 0;

    // Secuencial, no en paralelo: cada item puede llevar varios MB en fotos y
    // mandarlos todos a la vez saturaria una conexion de obra recien recuperada.
    for (const item of candidates) {
      await updateQueued(item.client_id, { status: 'syncing' });
      try {
        await request('POST', opts.endpoint, item.payload);
        await removeQueued(item.client_id);
        synced++;
        log('elemento sincronizado', item.client_id);
      } catch (e: any) {
        if (!(e instanceof ApiError)) {
          // Error de red crudo (TypeError, timeout, etc.): la conexion cayo a
          // mitad del lote. Revertimos este item y cortamos aqui -- el resto
          // fallaria igual y solo perderiamos tiempo/bateria.
          await updateQueued(item.client_id, { status: 'pending' });
          log('flush detenido por error de red', item.client_id, e?.message);
          break;
        }
        const isServerError = e.status >= 500;
        const attempts = (item.attempts || 0) + 1;
        await updateQueued(item.client_id, {
          status: 'failed',
          attempts,
          autoRetry: isServerError && attempts < MAX_AUTO_RETRY_ATTEMPTS,
          last_error: e.message || `HTTP ${e.status}`,
        });
        failed++;
        log('elemento fallo', item.client_id, e.status, e.message);
        // Error de validacion/permiso real: no bloquea el resto del lote.
      }
    }

    return { synced, failed, remaining: await getPendingCount(), skippedOffline: false };
  }

  return {
    subscribeQueueChanges,
    generateClientId,
    isLikelyOnline,
    listQueued,
    getPendingCount,
    removeQueued,
    enqueue,
    flush,
  };
}
