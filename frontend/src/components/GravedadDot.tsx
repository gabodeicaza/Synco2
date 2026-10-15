import React from 'react';
import { View } from 'react-native';

export const GRAVEDAD_COLOR: Record<string, string> = { verde: '#16A34A', amarillo: '#EAB308', rojo: '#DC2626' };

/** Punto del semáforo de gravedad del reporte (verde / amarillo / rojo). Sin dato = verde. */
export function GravedadDot({ gravedad, size = 10 }: { gravedad?: string | null; size?: number }) {
  const color = GRAVEDAD_COLOR[gravedad || ''] || GRAVEDAD_COLOR.verde;
  return <View accessibilityLabel={`Gravedad ${gravedad || 'verde'}`} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}
