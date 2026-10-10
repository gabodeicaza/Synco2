// Un solo modal a la vez por pantalla (K-06). Cada pantalla declara sus claves de modal y
// abre con `abrir(clave)`: al abrir uno, el anterior se cierra en el mismo paso (no quedan
// dos modales apilados). `cerrar()` cierra el actual; `cerrar(clave)` solo si es ese.
import { useCallback, useMemo, useState } from 'react';

export interface ModalUnico<K extends string> {
  /** Clave del modal abierto, o null si no hay ninguno. */
  abierto: K | null;
  /** Abre `clave` y cierra el que estuviera abierto. */
  abrir: (clave: K) => void;
  /** Cierra el modal abierto; con `clave`, solo si es ese (evita cerrar uno recién abierto). */
  cerrar: (clave?: K) => void;
  /** ¿Está abierto este modal? */
  esta: (clave: K) => boolean;
  /** Bandera lista para `visible` y una función para asignarla (compatible con `useState<boolean>`). */
  visible: (clave: K) => boolean;
  ponerVisible: (clave: K) => (valor: boolean) => void;
}

export function useModalUnico<K extends string>(inicial: K | null = null): ModalUnico<K> {
  const [abierto, setAbierto] = useState<K | null>(inicial);

  const abrir = useCallback((clave: K) => setAbierto(clave), []);
  const cerrar = useCallback((clave?: K) => {
    setAbierto((actual) => (clave === undefined || actual === clave ? null : actual));
  }, []);
  const esta = useCallback((clave: K) => abierto === clave, [abierto]);
  const ponerVisible = useCallback(
    (clave: K) => (valor: boolean) => {
      if (valor) setAbierto(clave);
      else setAbierto((actual) => (actual === clave ? null : actual));
    },
    [],
  );

  return useMemo(
    () => ({ abierto, abrir, cerrar, esta, visible: esta, ponerVisible }),
    [abierto, abrir, cerrar, esta, ponerVisible],
  );
}
