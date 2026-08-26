// Actividades Generales — alcanzable via router.push (menu hamburguesa),
// sin tab visible. Ver src/components/ActividadesGeneralesScreen.tsx.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@/src/theme';
import { ActividadesGeneralesScreen } from '@/src/components/ActividadesGeneralesScreen';
import { NivelActividad } from '@/src/api';

export default function ActividadesGeneralesRoute() {
  const { project_id, nivel } = useLocalSearchParams<{ project_id: string; nivel?: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';
  const nivelParam = (Array.isArray(nivel) ? nivel[0] : nivel) as NivelActividad | undefined;

  if (!pid) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>Proyecto no especificado</Text>
      </View>
    );
  }
  return <ActividadesGeneralesScreen projectId={pid} initialNivel={nivelParam} />;
}

const styles = StyleSheet.create({
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.lg },
  errorText: { color: colors.error, fontSize: 14, fontWeight: '600' },
});
