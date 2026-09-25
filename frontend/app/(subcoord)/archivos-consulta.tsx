// Archivos de consulta — vista de solo lectura para Sub-coordinador.
// Muestra los mismos documentos que el Coordinador General comparte desde
// el detalle del proyecto, como base de consulta para el equipo en campo.
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/src/theme';
import { ReferenceFilesList } from '@/src/components/ReferenceFilesList';
import { ScreenHeader } from '@/src/components/ScreenHeader';

export default function ArchivosConsultaScreen() {
  const insets = useSafeAreaInsets();
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Archivos de consulta" fallbackHref="/(subcoord)" />

      {!pid ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.error} />
          <Text style={styles.errorText}>Proyecto no especificado</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}>
          <ReferenceFilesList projectId={pid} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg,
    padding: 10, borderRadius: 10, marginHorizontal: spacing.lg, marginTop: spacing.md,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 13, fontWeight: '600' },
});
