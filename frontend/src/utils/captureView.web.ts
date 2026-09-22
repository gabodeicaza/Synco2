// react-native-view-shot's captureRef() siempre llama a findNodeHandle()
// de React Native antes de delegar a su propia implementación web
// (html2canvas) — y react-native-web hace que findNodeHandle() lance un
// error a propósito en vez de devolver el nodo del DOM, así que captureRef()
// nunca puede tener éxito en el navegador (por eso "Guardar" fallaba en
// silencio/con alerta después de dibujar círculos o flechas). Se llama a
// html2canvas directamente sobre el nodo del DOM, sin pasar por ese wrapper.
import html2canvas from 'html2canvas';
import type { RefObject } from 'react';
import type { View } from 'react-native';

export async function captureViewAsDataUri(ref: RefObject<View | null>, quality: number): Promise<string> {
  const node = ref.current as unknown as HTMLElement | null;
  if (!node) throw new Error('captureViewAsDataUri: ref.current es null');
  const canvas = await html2canvas(node, { backgroundColor: null });
  return canvas.toDataURL('image/jpeg', quality);
}
