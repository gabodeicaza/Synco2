// Cola offline de captura de reportes ("Nuevo Reporte").
// -----------------------------------------------------------------------------
// Los especialistas capturan reportes en obra, donde a menudo no hay senal.
// Si `api.createReport` no puede llegar al backend, el payload (JSON puro,
// fotos ya embebidas en base64) se persiste aqui y se reintenta solo hasta
// confirmar el envio, sin duplicar el reporte cuando vuelve la conexion.
//
// Persistencia en ARCHIVO via expo-file-system (no AsyncStorage): un reporte
// con 1-2 fotos puede pesar varios MB en base64, y AsyncStorage en Android
// tiene un techo practico de ~6MB total.
//
// La mecanica de archivo/lock/reintentos vive en offlineQueueEngine.ts
// (motor generico, reusado también por avanceQueue.ts) — este archivo es un
// wrapper delgado que solo fija el nombre de archivo y el endpoint, y
// preserva los nombres de export originales para no tocar a quien ya
// importa de aqui (api.ts, offline-queue-context.tsx, OfflineQueueDetailModal.tsx).
import { createOfflineQueueEngine, OfflineQueueError, OfflineQueueFullError, QueueItem, FlushSummary } from './offlineQueueEngine';

export type QueuedReportStatus = QueueItem['status'];
export type QueuedReport = QueueItem<Record<string, any>>;
export type { FlushSummary };
export { OfflineQueueError, OfflineQueueFullError };

const engine = createOfflineQueueEngine<Record<string, any>>({
  fileName: 'synco_offline_reports_queue.json',
  endpoint: '/reports',
  maxQueueItems: 30,
  maxAutoRetryAttempts: 10,
  logTag: 'offlineQueue',
  maxQueueItemsErrorMessage: (max) =>
    `Ya hay ${max} reportes esperando conexión en este dispositivo. ` +
    'Conéctate y espera a que se sincronicen antes de capturar mas.',
});

export const subscribeQueueChanges = engine.subscribeQueueChanges;
export const generateClientId = engine.generateClientId;
export const isLikelyOnline = engine.isLikelyOnline;
export const listQueuedReports = engine.listQueued;
export const getPendingCount = engine.getPendingCount;
export const removeQueuedReport = engine.removeQueued;

export async function enqueueReport(payload: Record<string, any>): Promise<QueuedReport> {
  return engine.enqueue(payload);
}

export function flushQueue(opts: { manual?: boolean } = {}): Promise<FlushSummary> {
  return engine.flush(opts);
}
