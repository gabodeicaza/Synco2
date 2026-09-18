// Hub de "Catálogo de Conceptos" — alcanzable via router.push (menu
// hamburguesa), sin tab visible. No confundir con catalogo-conceptos.tsx
// (esa es una de las 3 pantallas destino). Ver
// src/components/CatalogoConceptosHubScreen.tsx.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@/src/theme';
import CatalogoConceptosHubScreen from '@/src/components/CatalogoConceptosHubScreen';

export default function CatalogoConceptosHubRoute() {
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';

  if (!pid) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>Proyecto no especificado</Text>
      </View>
    );
  }
  return <CatalogoConceptosHubScreen projectId={pid} basePath="/(spec)" />;
}

const styles = StyleSheet.create({
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.lg },
  errorText: { color: colors.error, fontSize: 14, fontWeight: '600' },
});
