// Cola offline de registros de módulos personalizados (Creador de módulos).
// -----------------------------------------------------------------------------
// Capturar en obra suele ser SIN señal. Si el registro no puede enviarse, se
// guarda aquí (fotos ya embebidas en base64) y se reintenta solo; el backend
// (`POST /custom-records/sync`) es idempotente por `client_id`, así que un
// reintento tras perder la respuesta nunca duplica el registro. Mismo motor
// que offlineQueue.ts / avanceQueue.ts (ver offlineQueueEngine.ts).
import { createOfflineQueueEngine, OfflineQueueError, OfflineQueueFullError, QueueItem, FlushSummary } from './offlineQueueEngine';

export type QueuedCustomRecord = QueueItem<Record<string, any>>;
export type { FlushSummary };
export { OfflineQueueError, OfflineQueueFullError };

const engine = createOfflineQueueEngine<Record<string, any>>({
  fileName: 'synco_offline_custom_records_queue.json',
  endpoint: '/custom-records/sync',
  maxQueueItems: 100,
  maxAutoRetryAttempts: 10,
  logTag: 'customRecordQueue',
  maxQueueItemsErrorMessage: (max) =>
    `Ya hay ${max} registros esperando conexion en este dispositivo. ` +
    'Conectate y espera a que se sincronicen antes de capturar mas.',
});

export const subscribeCustomQueueChanges = engine.subscribeQueueChanges;
export const generateCustomClientId = engine.generateClientId;
export const isCustomLikelyOnline = engine.isLikelyOnline;
export const listQueuedCustomRecords = engine.listQueued;
export const getCustomPendingCount = engine.getPendingCount;
export const removeQueuedCustomRecord = engine.removeQueued;

export async function enqueueCustomRecord(payload: Record<string, any>): Promise<QueuedCustomRecord> {
  return engine.enqueue(payload);
}

export function flushCustomQueue(opts: { manual?: boolean } = {}): Promise<FlushSummary> {
  return engine.flush(opts);
}
