// Slide "Divisor" — título de sección centrado sobre el color de marca
// (ej. "FINANCIERO", "ESTUDIOS Y ANÁLISIS", "AVANCE DE OBRA"). Espejo
// simplificado de `draw_area_cover_page` (backend/server.py), generalizado
// a cualquier título libre, no solo nombres de Área.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { contrastText } from '@/src/theme';

export function SlideDivisor({ titulo, colorTema }: { titulo: string; colorTema: string }) {
  const textColor = contrastText(colorTema);
  return (
    <View style={[styles.wrap, { backgroundColor: colorTema }]}>
      <Text style={[styles.titulo, { color: textColor }]}>{(titulo || '').toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  titulo: { fontSize: 30, fontWeight: '800', textAlign: 'center', letterSpacing: 1 },
});
