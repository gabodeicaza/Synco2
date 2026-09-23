// Conectividad: NetInfo sondea GET {API}/health (no HEAD /, que devolvía 503 de
// forma intermitente). El banner "Sin conexión" y la cola offline usan ese
// mismo resultado, así que "en línea" significa "el servidor de Dirac responde".
import { useCallback, useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { BASE } from '@/src/httpClient';

export function urlPing(base: string = BASE): string {
  return `${base.replace(/\/+$/, '')}/health`;
}

/** El ping cuenta como éxito solo con 200 y {"ok": true}. */
export async function respuestaHealthOk(res: Pick<Response, 'status' | 'json'>): Promise<boolean> {
  if (res.status !== 200) return false;
  try {
    const cuerpo = await res.json();
    return cuerpo?.ok === true;
  } catch {
    return false;
  }
}

export function estaEnLinea(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  return !!state.isConnected && state.isInternetReachable !== false;
}

/** Llamar una sola vez al arrancar la app (app/_layout.tsx). */
export function configurarPing(): void {
  NetInfo.configure({
    reachabilityUrl: urlPing(),
    reachabilityMethod: 'GET',
    reachabilityTest: respuestaHealthOk,
    reachabilityRequestTimeout: 8 * 1000,
    // Sin esto Android/iOS solo miran si hay red, no si responde nuestro servidor.
    useNativeReachability: false,
  });
}

export function useConectividad() {
  const [enLinea, setEnLinea] = useState(true);
  const [reintentando, setReintentando] = useState(false);

  useEffect(() => {
    const cancelar = NetInfo.addEventListener((s) => setEnLinea(estaEnLinea(s)));
    return () => cancelar();
  }, []);

  const reintentar = useCallback(async () => {
    setReintentando(true);
    try {
      setEnLinea(estaEnLinea(await NetInfo.refresh()));
    } catch {
      /* se queda como estaba */
    } finally {
      setReintentando(false);
    }
  }, []);

  return { enLinea, reintentando, reintentar };
}
