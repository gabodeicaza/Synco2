// Hub de módulos activos del proyecto — alcanzable vía router.push (menú
// hamburguesa), sin tab visible. No confundir con
// (coord)/projects/[id]/modulos.tsx (esa es la pantalla de CONFIGURACIÓN
// donde el Coordinador prende/apaga módulos; esta solo navega a los que ya
// están prendidos). Ver src/components/ModulosHubScreen.tsx.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@/src/theme';
import ModulosHubScreen from '@/src/components/ModulosHubScreen';

export default function ModulosHubRoute() {
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';

  if (!pid) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>Proyecto no especificado</Text>
      </View>
    );
  }
  return <ModulosHubScreen projectId={pid} basePath="/(subcoord)" />;
}

const styles = StyleSheet.create({
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.lg },
  errorText: { color: colors.error, fontSize: 14, fontWeight: '600' },
});
