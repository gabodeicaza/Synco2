/**
 * shareWithAutoRecover _ envuelve `expo-sharing` para evitar el bug conocido
 * en Android donde `Sharing.shareAsync()` NUNCA resuelve si el usuario cierra
 * el share sheet con el boton "Atras" sin elegir una app destino.
 *
 * Estrategia:
 *   1. Se dispara `Sharing.shareAsync(...)`.
 *   2. En paralelo, se instala un listener de `AppState`. Cuando la app pasa
 *      de "background/inactive" a "active" (usuario volvio tras el share sheet),
 *      resolvemos manualmente si la promesa original aun no ha completado.
 *   3. Safety timeout (60s) _ si por alguna razon NADA ocurre (dispositivos
 *      exoticos, race conditions), forzamos la resolucion para no dejar
 *      spinners atorados.
 *
 * Uso: reemplaza `Sharing.shareAsync(...)` por `shareWithAutoRecover(uri, opts)`.
 */
import { AppState, AppStateStatus } from 'react-native';
import * as Sharing from 'expo-sharing';

const SAFETY_TIMEOUT_MS = 60_000; // 60s tope duro
const MIN_ACTIVE_DELAY_MS = 400;  // ignora el "active" inicial del tap

export async function shareWithAutoRecover(
  fileUri: string,
  options?: Sharing.SharingOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const startedAt = Date.now();

    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      try { sub.remove(); } catch { /* noop */ }
      if (safety) clearTimeout(safety);
      if (err) reject(err);
      else resolve();
    };

    // 1) Listener de AppState: cuando app vuelve a "active" tras haber ido
    //    a background (share sheet abierto), resolvemos.
    let wentToBackground = false;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        wentToBackground = true;
        return;
      }
      if (next === 'active' && wentToBackground) {
        // Pequeno delay para que el share sheet termine su animacion de cierre
        // antes de que el UI reaccione (evita spinners parpadeando).
        setTimeout(() => finish(), 250);
      }
    });

    // 2) Safety timeout _ nunca dejamos la promesa colgada mas de 60s.
    const safety = setTimeout(() => {
      finish(); // no error: preferimos resolver silenciosamente
    }, SAFETY_TIMEOUT_MS);

    // 3) Dispara la operacion real.
    Sharing.shareAsync(fileUri, options)
      .then(() => {
        // Si resuelve muy rapido (< 400ms) y NUNCA fuimos a background,
        // probablemente la plataforma aborto silenciosamente. Igual resolvemos.
        const elapsed = Date.now() - startedAt;
        if (!wentToBackground && elapsed < MIN_ACTIVE_DELAY_MS) {
          // dale una ventana pequena por si AppState llega tardio
          setTimeout(() => finish(), 300);
        } else {
          finish();
        }
      })
      .catch((e) => finish(e));
  });
}
