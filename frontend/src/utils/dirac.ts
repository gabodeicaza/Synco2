// ¿Este proyecto es el del contrato de Dirac (Cablebús)? El servidor lo decide
// (GET /projects/{pid}/dirac → { aplica }); aquí solo se cachea la respuesta para
// no repetir la consulta en cada pantalla/menú. Si falla, se asume que NO aplica.
import { useEffect, useState } from 'react';
import { router, useSegments } from 'expo-router';
import { api } from '@/src/api';

const cache = new Map<string, Promise<boolean>>();

export function esProyectoDirac(pid?: string | null): Promise<boolean> {
  if (!pid) return Promise.resolve(false);
  let p = cache.get(pid);
  if (!p) {
    p = api.diracProyecto(pid).then((r) => !!r?.aplica).catch(() => false);
    cache.set(pid, p);
  }
  return p;
}

/** true solo cuando ya se confirmó que el proyecto es el de Dirac. */
export function useEsDirac(pid?: string | null): boolean {
  const [es, setEs] = useState(false);
  useEffect(() => {
    let vivo = true;
    setEs(false);
    esProyectoDirac(pid).then((v) => { if (vivo) setEs(v); });
    return () => { vivo = false; };
  }, [pid]);
  return es;
}

/** Olvida la respuesta cacheada (tras conectar o desconectar un proyecto). */
export function olvidarDirac(pid?: string | null): void {
  if (pid) cache.delete(pid);
}

/** En un proyecto de Dirac, las pantallas de captura/consulta de avance propias se sustituyen por
 *  el avance de Dirac (misma ruta del rol, pantalla `dirac`). */
export function useRedirigirADirac(pid?: string | null): void {
  const seg = useSegments();
  const grupo = String(seg[0] || '');
  useEffect(() => {
    let vivo = true;
    esProyectoDirac(pid).then((es) => {
      if (vivo && es && grupo.startsWith('(')) {
        router.replace({ pathname: `/${grupo}/dirac` as any, params: { project_id: pid as string, id: pid as string } });
      }
    });
    return () => { vivo = false; };
  }, [pid, grupo]);
}
