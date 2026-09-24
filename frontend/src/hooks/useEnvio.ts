// Envío de formularios sin dobles envíos ni capturas perdidas (K-08).
//
// `useEnvio`: candado síncrono (un useRef, no solo estado) para que Enter-Enter o dos
// toques seguidos no manden el mismo guardado dos veces antes de que React repinte.
//
// `useColaDeEnvios`: para capturas rápidas (varios ítems seguidos). Cada captura se
// toma como copia al enviar, el formulario puede limpiarse enseguida y los guardados
// corren uno tras otro en orden, sin perder ninguno. Si uno falla, `alFallar` recibe
// la captura para restaurarla o avisar al usuario.
import { useCallback, useRef, useState } from 'react';

export function useEnvio() {
  const enCurso = useRef(false);
  const [guardando, setGuardando] = useState(false);

  /** Ejecuta `tarea` si no hay otra en curso. Devuelve `undefined` si se ignoró por estar ocupado. */
  const ejecutar = useCallback(async <R,>(tarea: () => Promise<R>): Promise<R | undefined> => {
    if (enCurso.current) return undefined;
    enCurso.current = true;
    setGuardando(true);
    try {
      return await tarea();
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  }, []);

  return { guardando, ejecutar };
}

export function useColaDeEnvios<T>(
  guardar: (captura: T) => Promise<void>,
  alFallar: (captura: T, error: unknown) => void,
) {
  const cola = useRef<Promise<void>>(Promise.resolve());
  const pendientes = useRef(0);
  const [cuenta, setCuenta] = useState(0);
  const guardarRef = useRef(guardar);
  const fallarRef = useRef(alFallar);
  guardarRef.current = guardar;
  fallarRef.current = alFallar;

  const encolar = useCallback((captura: T): Promise<void> => {
    pendientes.current += 1;
    setCuenta(pendientes.current);
    const siguiente = cola.current.then(async () => {
      try {
        await guardarRef.current(captura);
      } catch (e) {
        fallarRef.current(captura, e);
      } finally {
        pendientes.current -= 1;
        setCuenta(pendientes.current);
      }
    });
    cola.current = siguiente;
    return siguiente;
  }, []);

  return { encolar, pendientes: cuenta };
}
