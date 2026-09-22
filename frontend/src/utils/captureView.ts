// Aplana una View (imagen + overlay dibujado) en un JPEG data-uri.
// En nativo simplemente delega a react-native-view-shot. Ver
// captureView.web.ts para por qué la versión web necesita un camino
// distinto.
import { captureRef } from 'react-native-view-shot';
import type { RefObject } from 'react';
import type { View } from 'react-native';

export async function captureViewAsDataUri(ref: RefObject<View | null>, quality: number): Promise<string> {
  return captureRef(ref, { format: 'jpg', quality, result: 'data-uri' });
}
