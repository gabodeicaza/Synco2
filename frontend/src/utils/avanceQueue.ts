// Cola offline de Registro de Avance (Catálogo de Conceptos).
// -----------------------------------------------------------------------------
// "Registrar avance" es de uso diario en campo (alta frecuencia), igual que
// los reportes — por eso reusa el mismo motor genérico de offlineQueue.ts en
// vez de reinventar el lock/escritura atómica/listeners. Ver offlineQueueEngine.ts.
import { createOfflineQueueEngine, OfflineQueueError, OfflineQueueFullError, QueueItem, FlushSummary } from './offlineQueueEngine';

export type QueuedAvance = QueueItem<Record<string, any>>;
export type { FlushSummary };
export { OfflineQueueError, OfflineQueueFullError };

const engine = createOfflineQueueEngine<Record<string, any>>({
  fileName: 'synco_offline_avances_queue.json',
  endpoint: '/avances',
  maxQueueItems: 60,
  maxAutoRetryAttempts: 10,
  logTag: 'avanceQueue',
  maxQueueItemsErrorMessage: (max) =>
    `Ya hay ${max} registros de avance esperando conexion en este dispositivo. ` +
    'Conectate y espera a que se sincronicen antes de capturar mas.',
});

export const subscribeAvanceQueueChanges = engine.subscribeQueueChanges;
export const generateAvanceClientId = engine.generateClientId;
export const isAvanceLikelyOnline = engine.isLikelyOnline;
export const listQueuedAvances = engine.listQueued;
export const getAvancePendingCount = engine.getPendingCount;
export const removeQueuedAvance = engine.removeQueued;

export async function enqueueAvance(payload: Record<string, any>): Promise<QueuedAvance> {
  return engine.enqueue(payload);
}

export function flushAvanceQueue(opts: { manual?: boolean } = {}): Promise<FlushSummary> {
  return engine.flush(opts);
}
