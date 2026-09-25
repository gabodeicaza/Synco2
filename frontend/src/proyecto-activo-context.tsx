// Proyecto activo compartido (P-05): Mensajes, Minutas, Noticias y Calendario del Coordinador leen y
// escriben el MISMO proyecto, así que cambiarlo en una pantalla se refleja en las demás. Se recuerda el
// último elegido por usuario; si ya no existe, se usa el primero. Especialista y Subcoordinador solo ven
// los proyectos de su `project_ids`.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, Project } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { storage } from '@/src/utils/storage';
import { claveProyectoActivo, proyectosDelUsuario, resolverProyectoActivo } from '@/src/utils/proyectoActivo';

interface Ctx {
  proyectoId: string | null;
  proyecto: Project | null;
  proyectos: Project[];
  cargando: boolean;
  setProyectoId: (id: string) => void;
  recargar: () => Promise<void>;
}

const ProyectoActivoCtx = createContext<Ctx | null>(null);

export function ProyectoActivoProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const uid = user?.id || null;
  const [proyectos, setProyectos] = useState<Project[]>([]);
  const [proyectoId, setProyectoIdState] = useState<string | null>(null);
  const [recargando, setCargando] = useState(false);
  const [cargado, setCargado] = useState(false);
  // Hasta la primera respuesta se considera "cargando" (así las pantallas no parpadean con "sin proyectos").
  const cargando = recargando || (!!user && !cargado);
  const actual = useRef<string | null>(null);
  actual.current = proyectoId;

  const cargar = useCallback(async () => {
    if (!user) {
      setProyectos([]);
      setProyectoIdState(null);
      return;
    }
    setCargando(true);
    try {
      const lista = proyectosDelUsuario(await api.listProjects(), user);
      let recordado: string | null = actual.current;
      if (!recordado) {
        try {
          recordado = await storage.getItem<string>(claveProyectoActivo(user.id), '');
        } catch {
          recordado = null; // el almacenamiento puede fallar: se usa el primer proyecto
        }
      }
      setProyectos(lista);
      setProyectoIdState(resolverProyectoActivo(recordado, lista));
    } catch {
      // Sin red o sin permiso: se conserva lo que había; las pantallas muestran su propio estado vacío.
    } finally {
      setCargando(false);
      setCargado(true);
    }
  }, [user]);

  useEffect(() => {
    actual.current = null;
    setProyectoIdState(null);
    setCargado(false);
    void cargar();
    // Recarga solo al cambiar de usuario (login/logout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const setProyectoId = useCallback((id: string) => {
    if (!proyectos.some((p) => p.id === id)) return;
    setProyectoIdState(id);
    if (uid) Promise.resolve(storage.setItem(claveProyectoActivo(uid), id)).catch(() => {});
  }, [proyectos, uid]);

  const valor = useMemo<Ctx>(() => ({
    proyectoId,
    proyecto: proyectos.find((p) => p.id === proyectoId) ?? null,
    proyectos,
    cargando,
    setProyectoId,
    recargar: cargar,
  }), [proyectoId, proyectos, cargando, setProyectoId, cargar]);

  return <ProyectoActivoCtx.Provider value={valor}>{children}</ProyectoActivoCtx.Provider>;
}

export function useProyectoActivo(): Ctx {
  const ctx = useContext(ProyectoActivoCtx);
  if (!ctx) throw new Error('useProyectoActivo debe usarse dentro de ProyectoActivoProvider');
  return ctx;
}
