// Preview de Presentación — alcanzable via router.push desde
// PresentacionScreen.tsx, sin tab visible.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@/src/theme';
import PresentacionPreview from '@/src/components/PresentacionPreview';

export default function PresentacionPreviewRoute() {
  const { project_id, presentacion_id } = useLocalSearchParams<{ project_id: string; presentacion_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';
  const presId = (Array.isArray(presentacion_id) ? presentacion_id[0] : presentacion_id) || '';

  if (!pid || !presId) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>Presentación no especificada</Text>
      </View>
    );
  }
  return <PresentacionPreview projectId={pid} presentacionId={presId} />;
}

const styles = StyleSheet.create({
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.lg },
  errorText: { color: colors.error, fontSize: 14, fontWeight: '600' },
});
