// Módulo creado con el Creador de módulos — alcanzable vía router.push desde el
// hub de Módulos, sin tab visible. Ver src/components/customModules/CustomModuleScreen.tsx.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@/src/theme';
import CustomModuleScreen from '@/src/components/customModules/CustomModuleScreen';

export default function ModuloPersonalizadoRoute() {
  const { project_id, mid } = useLocalSearchParams<{ project_id: string; mid: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';
  const moduloId = (Array.isArray(mid) ? mid[0] : mid) || '';

  if (!pid || !moduloId) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>Módulo no especificado</Text>
      </View>
    );
  }
  return <CustomModuleScreen projectId={pid} moduloId={moduloId} />;
}

const styles = StyleSheet.create({
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.lg },
  errorText: { color: colors.error, fontSize: 14, fontWeight: '600' },
});
