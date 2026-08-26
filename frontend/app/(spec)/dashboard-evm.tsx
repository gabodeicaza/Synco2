// Dashboard EVM (Valor Ganado) — alcanzable via router.push (menú
// hamburguesa), sin tab visible. Ver src/components/DashboardEVM.tsx.
// NOTA: se llama "dashboard-evm" (no "dashboard") por consistencia con
// (subcoord), donde ese nombre ya está tomado por el dashboard principal
// del rol.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@/src/theme';
import DashboardEVM from '@/src/components/DashboardEVM';

export default function DashboardEvmRoute() {
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';

  if (!pid) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>Proyecto no especificado</Text>
      </View>
    );
  }
  return <DashboardEVM projectId={pid} />;
}

const styles = StyleSheet.create({
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.lg },
  errorText: { color: colors.error, fontSize: 14, fontWeight: '600' },
});
