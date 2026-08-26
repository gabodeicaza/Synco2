// Provider global de la cola offline de reportes.
// Mismo patron que auth-context.tsx: createContext + XProvider + useX() que
// lanza si se usa fuera del provider. Se monta una sola vez en app/_layout.tsx
// para que este disponible en los 3 grupos de rutas por rol.
import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import {
  QueuedReport, flushQueue, listQueuedReports, removeQueuedReport, subscribeQueueChanges,
} from '@/src/utils/offlineQueue';
import { showToast } from '@/src/utils/toast';

interface OfflineQueueCtx {
  items: QueuedReport[];
  pendingCount: number;
  isOnline: boolean | null;
  isFlushing: boolean;
  refreshQueue: () => Promise<void>;
  flushNow: () => Promise<void>;
  discardItem: (clientId: string) => Promise<void>;
}

const Ctx = createContext<OfflineQueueCtx | null>(null);

const AUTO_FLUSH_INTERVAL_MS = 60_000;

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<QueuedReport[]>([]);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [isFlushing, setIsFlushing] = useState(false);

  const pendingCount = items.filter((i) => i.status === 'pending' || i.status === 'failed').length;
  const pendingCountRef = useRef(pendingCount);
  pendingCountRef.current = pendingCount;

  const refreshQueue = useCallback(async () => {
    try {
      const next = await listQueuedReports();
      setItems(next);
    } catch {
      /* noop: si el archivo esta inaccesible, dejamos el estado tal cual */
    }
  }, []);

  const runFlush = useCallback(async (manual: boolean) => {
    const result = await flushQueue({ manual }).catch(() => null);
    await refreshQueue();
    if (!result) return;
    if (result.synced > 0) {
      showToast(`${result.synced} reporte${result.synced > 1 ? 's' : ''} sincronizado${result.synced > 1 ? 's' : ''}`);
    } else if (manual && result.remaining > 0 && !result.skippedOffline) {
      showToast('No se pudo sincronizar. Revisa tu conexion.');
    }
  }, [refreshQueue]);

  const flushNow = useCallback(async () => {
    setIsFlushing(true);
    try {
      await runFlush(true);
    } finally {
      setIsFlushing(false);
    }
  }, [runFlush]);

  const discardItem = useCallback(async (clientId: string) => {
    await removeQueuedReport(clientId);
    await refreshQueue();
  }, [refreshQueue]);

  // Carga inicial de la cola persistida (por si quedaron reportes de una
  // sesion anterior de la app) + intento de sincronizar de una vez si ya
  // hay red al abrir la app, en vez de esperar el intervalo de 60s.
  useEffect(() => {
    (async () => {
      await refreshQueue();
      runFlush(false);
    })();
  }, [refreshQueue, runFlush]);

  // `enqueueReport`/`removeQueuedReport`/`updateQueuedReport` mutan el
  // archivo desde fuera de React (ej. api.createReport, o un flush corriendo
  // en background). Sin esta suscripcion, un reporte recien encolado nunca
  // se reflejaba aqui: el pill no aparecia y el resto de los disparadores de
  // abajo (NetInfo/AppState/intervalo) nunca se activaban porque dependen de
  // que `pendingCount` ya sea > 0 en el estado de React.
  useEffect(() => subscribeQueueChanges(() => { refreshQueue(); }), [refreshQueue]);

  // Reconexion de red -> intento automatico de sincronizar.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      setIsOnline((prevOnline) => {
        if (prevOnline === false && online && pendingCountRef.current > 0) {
          runFlush(false);
        }
        return online;
      });
    });
    return unsubscribe;
  }, [runFlush]);

  // Vuelta a foreground -> intento automatico (cubre el caso de reconectar
  // con la app en background, donde el listener de arriba no se percibe).
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active' && pendingCountRef.current > 0) {
        runFlush(false);
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [runFlush]);

  // Red de seguridad: reintento periodico mientras haya pendientes. Se activa
  // y desactiva solo (no corre indefinidamente para usuarios siempre conectados).
  useEffect(() => {
    if (pendingCount === 0) return;
    const id = setInterval(() => runFlush(false), AUTO_FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pendingCount, runFlush]);

  const value: OfflineQueueCtx = {
    items, pendingCount, isOnline, isFlushing, refreshQueue, flushNow, discardItem,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOfflineQueue() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOfflineQueue fuera de OfflineQueueProvider');
  return ctx;
}
