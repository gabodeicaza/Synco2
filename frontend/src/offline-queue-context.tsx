// Provider global de la cola offline (reportes + registros de avance).
// Mismo patron que auth-context.tsx: createContext + XProvider + useX() que
// lanza si se usa fuera del provider. Se monta una sola vez en app/_layout.tsx
// para que este disponible en los 3 grupos de rutas por rol.
//
// Las dos colas (reportes y avances) comparten el mismo motor de archivo pero son
// archivos distintos: este contexto las vacia AMBAS al reconectar, al volver a primer
// plano y por intervalo, y expone el conteo total y por tipo. (Antes solo se vaciaba la de
// reportes y los avances encolados sin conexion nunca se enviaban.)
import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import {
  QueuedReport, flushQueue, listQueuedReports, removeQueuedReport, subscribeQueueChanges,
} from '@/src/utils/offlineQueue';
import {
  QueuedAvance, flushAvanceQueue, listQueuedAvances, removeQueuedAvance, subscribeAvanceQueueChanges,
} from '@/src/utils/avanceQueue';
import { mensajesDeFlush } from '@/src/utils/resumenFlushCola';
import { showToast } from '@/src/utils/toast';

export type TipoPendiente = 'reporte' | 'avance';

export interface Pendiente {
  tipo: TipoPendiente;
  item: QueuedReport | QueuedAvance;
}

interface OfflineQueueCtx {
  /** Reportes en cola (compatibilidad con quien ya los usaba). */
  items: QueuedReport[];
  avances: QueuedAvance[];
  /** Reportes y avances juntos, del mas antiguo al mas nuevo. */
  pendientes: Pendiente[];
  pendingCount: number;
  pendingReports: number;
  pendingAvances: number;
  isOnline: boolean | null;
  isFlushing: boolean;
  refreshQueue: () => Promise<void>;
  flushNow: () => Promise<void>;
  discardItem: (clientId: string, tipo?: TipoPendiente) => Promise<void>;
}

const Ctx = createContext<OfflineQueueCtx | null>(null);

const AUTO_FLUSH_INTERVAL_MS = 60_000;

const porEnviar = (i: { status: string }) => i.status === 'pending' || i.status === 'failed';

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<QueuedReport[]>([]);
  const [avances, setAvances] = useState<QueuedAvance[]>([]);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [isFlushing, setIsFlushing] = useState(false);

  const pendingReports = items.filter(porEnviar).length;
  const pendingAvances = avances.filter(porEnviar).length;
  const pendingCount = pendingReports + pendingAvances;
  const pendingCountRef = useRef(pendingCount);
  pendingCountRef.current = pendingCount;

  const pendientes: Pendiente[] = [
    ...items.map((item): Pendiente => ({ tipo: 'reporte', item })),
    ...avances.map((item): Pendiente => ({ tipo: 'avance', item })),
  ].sort((a, b) => String(a.item.created_at).localeCompare(String(b.item.created_at)));

  const refreshQueue = useCallback(async () => {
    // Cada cola se lee por separado: si el archivo de una esta inaccesible, la otra se
    // actualiza igual y la fallida se deja tal cual.
    const [reportes, registros] = await Promise.all([
      listQueuedReports().catch(() => null),
      listQueuedAvances().catch(() => null),
    ]);
    if (reportes) setItems(reportes);
    if (registros) setAvances(registros);
  }, []);

  const runFlush = useCallback(async (manual: boolean) => {
    // Primero reportes y luego avances, en secuencia: cada item puede llevar varios MB de
    // fotos y mandar las dos colas a la vez saturaria una conexion recien recuperada.
    const reportes = await flushQueue({ manual }).catch(() => null);
    const registros = await flushAvanceQueue({ manual }).catch(() => null);
    await refreshQueue();
    mensajesDeFlush(reportes, registros, manual).forEach((m) => showToast(m));
  }, [refreshQueue]);

  const flushNow = useCallback(async () => {
    setIsFlushing(true);
    try {
      await runFlush(true);
    } finally {
      setIsFlushing(false);
    }
  }, [runFlush]);

  const discardItem = useCallback(async (clientId: string, tipo: TipoPendiente = 'reporte') => {
    if (tipo === 'avance') await removeQueuedAvance(clientId);
    else await removeQueuedReport(clientId);
    await refreshQueue();
  }, [refreshQueue]);

  // Carga inicial de la cola persistida (por si quedaron pendientes de una
  // sesion anterior de la app) + intento de sincronizar de una vez si ya
  // hay red al abrir la app, en vez de esperar el intervalo de 60s.
  useEffect(() => {
    (async () => {
      await refreshQueue();
      runFlush(false);
    })();
  }, [refreshQueue, runFlush]);

  // `enqueueReport`/`enqueueAvance`/`remove*` mutan el archivo desde fuera de React (ej.
  // api.createReport / api.createAvance, o un flush corriendo en background). Sin esta
  // suscripcion, un pendiente recien encolado nunca se reflejaba aqui: el pill no aparecia
  // y el resto de los disparadores de abajo (NetInfo/AppState/intervalo) nunca se activaban
  // porque dependen de que `pendingCount` ya sea > 0 en el estado de React.
  useEffect(() => {
    const salirReportes = subscribeQueueChanges(() => { refreshQueue(); });
    const salirAvances = subscribeAvanceQueueChanges(() => { refreshQueue(); });
    return () => {
      salirReportes();
      salirAvances();
    };
  }, [refreshQueue]);

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
    items, avances, pendientes, pendingCount, pendingReports, pendingAvances,
    isOnline, isFlushing, refreshQueue, flushNow, discardItem,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOfflineQueue() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOfflineQueue fuera de OfflineQueueProvider');
  return ctx;
}
