// Slide "Avance Gráfico" — reusa PlanoMarkerOverlay.tsx en modo lectura
// (sin onTap) para mostrar el plano con sus marcadores vigentes. La
// exportación PPTX (Fase 5) usa en cambio el snapshot horneado con Pillow
// (`_bake_plano_snapshot`, backend/server.py) para producir una imagen
// plana embebible.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, Image as RNImage } from 'react-native';
import { colors, spacing } from '@/src/theme';
import { PlanoMarkerOverlay } from '@/src/components/PlanoMarkerOverlay';
import type { PlanoAvance } from '@/src/api';

export function SlideAvanceGrafico({ plano }: { plano: PlanoAvance | null }) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
  const maxW = winWidth - spacing.md * 2;
  const maxH = winHeight * 0.55;

  useEffect(() => {
    if (!plano?.imagen) { setImgSize(null); return; }
    RNImage.getSize(
      plano.imagen,
      (w, h) => {
        const ratio = Math.min(maxW / w, maxH / h, 1);
        setImgSize({ width: w * ratio, height: h * ratio });
      },
      () => setImgSize({ width: maxW, height: maxW * 0.75 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano?.imagen]);

  if (!plano) {
    return (
      <View style={[styles.wrap, styles.empty]}>
        <Text style={styles.emptyTxt}>Plano no encontrado.</Text>
      </View>
    );
  }
  return (
    <View style={[styles.wrap, styles.empty]}>
      <Text style={styles.titulo}>{plano.nombre}</Text>
      {imgSize ? (
        <PlanoMarkerOverlay imageUri={plano.imagen || ''} markers={plano.markers} width={imgSize.width} height={imgSize.height} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  titulo: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
});
