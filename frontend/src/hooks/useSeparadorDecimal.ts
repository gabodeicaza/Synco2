// Separador decimal del proyecto para capturar números (A-07). Se consulta una vez
// por proyecto y se recuerda; hasta que llega la respuesta se usa "." (el defecto).
import { useEffect, useState } from 'react';
import { api } from '@/src/api';
import type { SeparadorDecimal } from '@/src/utils/numeros';

const cache = new Map<string, SeparadorDecimal>();

/** Olvida el valor recordado (al cambiar la configuración del proyecto). */
export function olvidarSeparadorDecimal(projectId?: string | null) {
  if (projectId) cache.delete(projectId);
  else cache.clear();
}

export function useSeparadorDecimal(projectId?: string | null): SeparadorDecimal {
  const [sep, setSep] = useState<SeparadorDecimal>(() => (projectId && cache.get(projectId)) || '.');
  useEffect(() => {
    if (!projectId) return;
    const guardado = cache.get(projectId);
    if (guardado) { setSep(guardado); return; }
    let vivo = true;
    api.getProject(projectId)
      .then((p) => {
        const valor: SeparadorDecimal = p?.separador_decimal === ',' ? ',' : '.';
        cache.set(projectId, valor);
        if (vivo) setSep(valor);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [projectId]);
  return sep;
}
