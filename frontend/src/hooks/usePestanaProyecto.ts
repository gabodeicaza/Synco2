// Pestaña activa (Reportes / Operación / Configuración) recordada POR PROYECTO (P-04).
// Al abrir un proyecto se restaura la última; si no hay o el valor guardado no es válido, 'reportes'.
// El almacenamiento puede fallar: nunca rompe, solo no recuerda.
import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '@/src/utils/storage';
import { clavePestanaProyecto, PestanaProyecto, pestanaValida } from '@/src/utils/proyectoActivo';

export function usePestanaProyecto(pid: string): [PestanaProyecto, (tab: PestanaProyecto) => void] {
  const [pestana, setPestanaState] = useState<PestanaProyecto>('reportes');
  // Si la persona toca una pestaña antes de que llegue la guardada, manda lo que tocó.
  const elegida = useRef(false);

  useEffect(() => {
    elegida.current = false;
    setPestanaState('reportes');
    if (!pid) return;
    let vigente = true;
    Promise.resolve(storage.getItem<string>(clavePestanaProyecto(pid), ''))
      .then((guardada) => { if (vigente && !elegida.current) setPestanaState(pestanaValida(guardada)); })
      .catch(() => {});
    return () => { vigente = false; };
  }, [pid]);

  const setPestana = useCallback((tab: PestanaProyecto) => {
    elegida.current = true;
    setPestanaState(tab);
    if (pid) Promise.resolve(storage.setItem(clavePestanaProyecto(pid), tab)).catch(() => {});
  }, [pid]);

  return [pestana, setPestana];
}
