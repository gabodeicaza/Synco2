// Slide "Croquis General" por Estación — la portada institucional del nodo
// (LocationNode.cover_image), a página completa con el nombre encima.
// Espejo simplificado de `draw_dynamic_cover_page` (backend/server.py).
import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { colors } from '@/src/theme';
import type { LocationNode } from '@/src/api';

export function SlideCroquisEstacion({ node }: { node: LocationNode | null }) {
  if (!node) {
    return (
      <View style={[styles.wrap, styles.empty]}>
        <Text style={styles.emptyTxt}>Estación no encontrada.</Text>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      {node.cover_image ? (
        <Image source={{ uri: node.cover_image }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.placeholder]} />
      )}
      <View style={styles.overlay}>
        <Text style={styles.nombre}>{node.name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.text },
  placeholder: { backgroundColor: colors.border },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.55)', padding: 12 },
  nombre: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
