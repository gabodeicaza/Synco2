// Slide "Portada" — título + fecha sobre el color de marca del proyecto.
// Espejo simplificado (sin el patrón institucional del membrete) de la
// portada que arma el motor PPTX en el backend (Fase 5).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { contrastText } from '@/src/theme';

export function SlidePortada({ titulo, fecha, colorTema }: { titulo: string; fecha: string; colorTema: string }) {
  const textColor = contrastText(colorTema);
  return (
    <View style={[styles.wrap, { backgroundColor: colorTema }]}>
      <Text style={[styles.titulo, { color: textColor }]}>{titulo}</Text>
      <Text style={[styles.fecha, { color: textColor }]}>{fecha}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  titulo: { fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: 0.5, marginBottom: 10 },
  fecha: { fontSize: 14, fontWeight: '600', opacity: 0.9 },
});
