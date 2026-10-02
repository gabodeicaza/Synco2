// Slide "Cierre" — "Gracias" + leyenda del proyecto sobre el color de marca.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { contrastText } from '@/src/theme';

export function SlideCierre({ leyenda, colorTema }: { leyenda: string; colorTema: string }) {
  const textColor = contrastText(colorTema);
  return (
    <View style={[styles.wrap, { backgroundColor: colorTema }]}>
      <Text style={[styles.titulo, { color: textColor }]}>Gracias</Text>
      {leyenda ? <Text style={[styles.leyenda, { color: textColor }]}>{leyenda.toUpperCase()}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  titulo: { fontSize: 30, fontWeight: '800', marginBottom: 12 },
  leyenda: { fontSize: 11, fontWeight: '700', textAlign: 'center', opacity: 0.9 },
});
