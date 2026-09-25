// Polling que corre SOLO mientras la pantalla está enfocada y la app está activa (G-07).
// Las pestañas inactivas siguen montadas (congeladas) pero no deben consultar al servidor.
// Al recuperar el foco o volver de segundo plano refresca una vez y reanuda el intervalo.
// La primera ejecución NO refresca: la pantalla ya hace su carga inicial.
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

export function usePollingConFoco(tarea: () => void, intervaloMs: number, activo = true) {
  const enfocada = useIsFocused();
  const tareaRef = useRef(tarea);
  tareaRef.current = tarea;
  const yaArranco = useRef(false);

  useEffect(() => {
    if (!activo || !enfocada) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const detener = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const iniciar = () => {
      if (!timer) timer = setInterval(() => tareaRef.current(), intervaloMs);
    };

    if (yaArranco.current) tareaRef.current();
    yaArranco.current = true;
    if (AppState.currentState === 'active' || AppState.currentState == null) iniciar();

    const sub = AppState.addEventListener('change', (estado: AppStateStatus) => {
      if (estado === 'active') {
        tareaRef.current();
        iniciar();
      } else {
        detener();
      }
    });
    return () => {
      detener();
      sub.remove();
    };
  }, [activo, enfocada, intervaloMs]);
}
