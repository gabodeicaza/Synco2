// Slide "Mapa/Croquis General" — primera imagen de Datos Generales del
// proyecto (api.getGeneralDataImages), a página completa. No guarda datos
// propios en la sección — se calcula en vivo, ver PresentacionPreview.tsx.
import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { colors } from '@/src/theme';

export function SlideMapaGeneral({ images }: { images: string[] }) {
  const first = images?.[0];
  if (!first) {
    return (
      <View style={[styles.wrap, styles.empty]}>
        <Text style={styles.emptyTxt}>Sin imagen de mapa general configurada en Datos Generales.</Text>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <Image source={{ uri: first }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
