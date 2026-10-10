// Avisos que se muestran al terminar de vaciar la cola sin conexión (reportes + avances).
// Lógica pura: el contexto solo decide CUÁNDO mostrarlos.
import { t } from '@/src/i18n';
import type { FlushSummary } from '@/src/utils/offlineQueueEngine';

export function mensajesDeFlush(
  reportes: FlushSummary | null,
  avances: FlushSummary | null,
  manual: boolean,
): string[] {
  const mensajes: string[] = [];

  if (reportes && reportes.synced > 0) {
    mensajes.push(
      reportes.synced === 1
        ? t('colaSinConexion.reportesSincronizadosUno')
        : t('colaSinConexion.reportesSincronizadosVarios', { n: reportes.synced }),
    );
  }
  if (avances && avances.synced > 0) {
    mensajes.push(
      avances.synced === 1
        ? t('colaSinConexion.avancesSincronizadosUno')
        : t('colaSinConexion.avancesSincronizadosVarios', { n: avances.synced }),
    );
  }

  // Un pendiente que el servidor rechazó (error 4xx) no se reintenta solo: hay que avisar
  // aunque el flush haya sido automático, o el usuario no sabría que su captura no llegó.
  const conError = (reportes?.failed ?? 0) + (avances?.failed ?? 0);
  if (conError > 0) {
    mensajes.push(t('colaSinConexion.conErrores', { n: conError }));
  } else if (manual) {
    const quedan = [reportes, avances].some((r) => r && r.remaining > 0 && !r.skippedOffline);
    if (quedan) mensajes.push(t('colaSinConexion.sinSincronizar'));
  }
  return mensajes;
}
