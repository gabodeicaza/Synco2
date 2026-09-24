// Errores de un formulario: uno por campo (junto al campo), más un error general y
// un toast para fallas de red. Un error se borra en cuanto el usuario corrige el
// campo (K-09). Ningún formulario debe fallar en silencio ni depender de Alert.alert.
import { useCallback, useState } from 'react';
import { t } from '@/src/i18n';
import { esErrorDeRed } from '@/src/utils/errores';
import { showToast } from '@/src/utils/toast';

export type ErroresPorCampo<K extends string> = Partial<Record<K, string>>;

export function useFormErrors<K extends string = string>() {
  const [errores, setErrores] = useState<ErroresPorCampo<K>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const poner = useCallback((campo: K, mensaje: string) => {
    setErrores((prev) => ({ ...prev, [campo]: mensaje }));
  }, []);

  const limpiar = useCallback((campo: K) => {
    setErrores((prev) => {
      if (!prev[campo]) return prev;
      const { [campo]: _quitado, ...resto } = prev;
      return resto as ErroresPorCampo<K>;
    });
    setErrorGeneral(null);
  }, []);

  const limpiarTodo = useCallback(() => {
    setErrores({});
    setErrorGeneral(null);
  }, []);

  /** Sustituye todos los errores por los de una validación completa. Devuelve si hubo alguno. */
  const ponerTodos = useCallback((nuevos: ErroresPorCampo<K>): boolean => {
    const limpios = Object.fromEntries(
      Object.entries(nuevos).filter(([, v]) => typeof v === 'string' && v),
    ) as ErroresPorCampo<K>;
    setErrores(limpios);
    setErrorGeneral(null);
    return Object.keys(limpios).length > 0;
  }, []);

  /** Envuelve el `onChangeText` de un campo para borrar su error al corregirlo. */
  const alCambiar = useCallback(
    <V,>(campo: K, setter: (valor: V) => void) =>
      (valor: V) => {
        limpiar(campo);
        setter(valor);
      },
    [limpiar],
  );

  /** Falla al guardar: la red da un toast; cualquier otra cosa, un error general en línea. */
  const errorDeGuardado = useCallback((e: unknown, respaldo?: string) => {
    if (esErrorDeRed(e)) {
      showToast(t('red.errorDeRed'));
      return;
    }
    const mensaje = (e as any)?.message;
    setErrorGeneral(typeof mensaje === 'string' && mensaje ? mensaje : respaldo ?? t('formulario.noSePudoGuardar'));
  }, []);

  return { errores, errorGeneral, poner, limpiar, limpiarTodo, ponerTodos, alCambiar, errorDeGuardado, setErrorGeneral };
}
