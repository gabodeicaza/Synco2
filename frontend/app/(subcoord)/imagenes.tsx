// Hub de Imágenes — Sub-Coordinador, desde el menú hamburguesa (ver src/components/ImagenesHubScreen.tsx).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@/src/theme';
import { ImagenesHubScreen } from '@/src/components/ImagenesHubScreen';

export default function ImagenesRoute() {
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';
  if (!pid) {
    return (
      <View style={styles.box}>
        <Text style={styles.txt}>Proyecto no especificado</Text>
      </View>
    );
  }
  return <ImagenesHubScreen projectId={pid} />;
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.lg },
  txt: { color: colors.error, fontSize: 14, fontWeight: '600' },
});
