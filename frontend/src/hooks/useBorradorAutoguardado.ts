// Autoguardado del formulario "Nuevo reporte" como borrador (ver utils/borradores.ts).
//
// Se guarda (1) cuando el usuario deja de capturar unos segundos, (2) al instante si
// la app pasa a segundo plano —que es justo cuando Android puede matarla— y (3) a
// petición con `guardarAhora` (salir del formulario, botón "Guardar borrador").
// El formulario sigue siendo el dueño del estado: el hook solo recibe una foto
// (`snapshot`) de lo capturado en cada render.
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import {
  Borrador, BorradorDatos, datosConContenido, eliminarBorrador, guardarBorrador, nuevoIdBorrador,
} from '@/src/utils/borradores';

export interface BorradorSnapshot {
  projectId: string;
  nodeId: string;
  ubicacion: string[];
  datos: BorradorDatos;
}

export type ResultadoGuardado = 'ok' | 'vacio' | 'error';

export const ESPERA_AUTOGUARDADO_MS = 2000;

export function useBorradorAutoguardado(userId: string, snapshot: BorradorSnapshot | null, activo: boolean) {
  const snapRef = useRef<BorradorSnapshot | null>(snapshot);
  const userRef = useRef(userId);
  const idRef = useRef<string | null>(null);
  const enviadoRef = useRef(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  snapRef.current = snapshot;
  userRef.current = userId;

  const guardarAhora = useCallback(async (): Promise<ResultadoGuardado> => {
    const snap = snapRef.current;
    const uid = userRef.current;
    if (!uid || !snap || enviadoRef.current || !datosConContenido(snap.datos)) return 'vacio';
    if (!idRef.current) idRef.current = nuevoIdBorrador();
    const b: Borrador = {
      id: idRef.current,
      projectId: snap.projectId,
      nodeId: snap.nodeId,
      ubicacion: snap.ubicacion,
      titulo: snap.datos.nombre.trim(),
      fotos: snap.datos.images.length,
      actualizado: Date.now(),
      datos: snap.datos,
    };
    return (await guardarBorrador(uid, b)) ? 'ok' : 'error';
  }, []);

  // Al dejar de capturar. Se reprograma en cada render: solo corre tras una pausa real.
  useEffect(() => {
    if (!activo) return;
    temporizador.current = setTimeout(() => { guardarAhora(); }, ESPERA_AUTOGUARDADO_MS);
    return () => { if (temporizador.current) clearTimeout(temporizador.current); };
  });

  // Al irse a segundo plano: sin esperar la pausa.
  useEffect(() => {
    if (!activo) return;
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado !== 'active') guardarAhora();
    });
    return () => sub.remove();
  }, [activo, guardarAhora]);

  /** Retoma un borrador existente: los siguientes guardados lo actualizan en vez de crear otro. */
  const adoptar = useCallback((id: string | null) => {
    idRef.current = id;
    enviadoRef.current = false;
  }, []);

  /** Termina con el formulario actual (se reinició o se cerró): lo siguiente que se capture es otro borrador. */
  const soltar = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    idRef.current = null;
    enviadoRef.current = false;
    snapRef.current = null;
  }, []);

  /** El reporte ya se envió: el borrador sobra y nada debe volver a crearlo. */
  const marcarEnviado = useCallback(async () => {
    if (temporizador.current) clearTimeout(temporizador.current);
    enviadoRef.current = true;
    const id = idRef.current;
    idRef.current = null; // para que el aviso de "eliminado" no lo tome por un descarte externo
    if (id) await eliminarBorrador(userRef.current, id);
  }, []);

  /** Descarta a propósito el borrador de este formulario (sin enviarlo). */
  const descartar = useCallback(async () => {
    if (temporizador.current) clearTimeout(temporizador.current);
    const id = idRef.current;
    soltar();
    if (id) await eliminarBorrador(userRef.current, id);
  }, [soltar]);

  return { guardarAhora, adoptar, soltar, marcarEnviado, descartar, idActual: () => idRef.current };
}
