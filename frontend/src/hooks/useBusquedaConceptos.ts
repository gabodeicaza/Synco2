// Búsqueda de conceptos de Registrar avance (A-10).
// - Con la búsqueda vacía muestra la lista por defecto (primeros conceptos del catálogo).
// - `query` es la ÚNICA fuente de verdad: lo que se ve en el cuadro es lo que se busca.
// - Cada petición lleva un número de secuencia; una respuesta tardía de una búsqueda
//   anterior se descarta, así "1.1." nunca deja resultados de "1." ni queda cargando.
// - Un fallo no se traga: queda en `error` con opción de reintentar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ConceptoSearchResult } from '@/src/api';

export const RETRASO_BUSQUEDA_MS = 300;
export const LIMITE_LISTA_POR_DEFECTO = 50;

export interface EstadoBusqueda {
  query: string;
  setQuery: (q: string) => void;
  /** Texto realmente buscado (sin espacios en los extremos). */
  buscado: string;
  results: ConceptoSearchResult[];
  cargando: boolean;
  error: string | null;
  reintentar: () => void;
  limpiar: () => void;
}

export function useBusquedaConceptos(projectId: string, mensajeError: string): EstadoBusqueda {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConceptoSearchResult[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const secuencia = useRef(0);
  const mensajeRef = useRef(mensajeError);
  mensajeRef.current = mensajeError;

  const buscado = query.trim();

  useEffect(() => {
    const mia = ++secuencia.current;
    setCargando(true);
    setError(null);
    const esperar = buscado ? RETRASO_BUSQUEDA_MS : 0;
    const temporizador = setTimeout(async () => {
      try {
        const r = await api.searchConceptos(
          projectId,
          buscado ? { q: buscado } : { limit: LIMITE_LISTA_POR_DEFECTO },
        );
        if (mia !== secuencia.current) return;
        setResults(r);
      } catch (e: any) {
        if (mia !== secuencia.current) return;
        setResults([]);
        setError(e?.message || mensajeRef.current);
      } finally {
        if (mia === secuencia.current) setCargando(false);
      }
    }, esperar);
    return () => {
      clearTimeout(temporizador);
      // Invalida la petición en vuelo: su respuesta ya no debe pintarse.
      if (mia === secuencia.current) secuencia.current += 1;
    };
  }, [buscado, projectId, intento]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);
  const limpiar = useCallback(() => setQuery(''), []);

  return { query, setQuery, buscado, results, cargando, error, reintentar, limpiar };
}
