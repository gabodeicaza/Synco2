// Fuerza de Trabajo — vista de solo lectura (derivada de los reportes de
// campo), accesible para Coordinador General. Antes vivia embebida siempre
// expandida en la pestaña Operación de index.tsx (rompia la presentacion
// compacta de tile que usan los demas modulos); ahora es su propia pantalla,
// igual que ya la tenian Sub-Coordinador y Especialista (ver
// (subcoord)/fuerza-de-trabajo.tsx y (spec)/fuerza-de-trabajo.tsx).
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/src/theme';
import { WorkforceTracker } from '@/src/components/WorkforceTracker';
import { ScreenHeader } from '@/src/components/ScreenHeader';

export default function FuerzaDeTrabajoRoute() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Fuerza de Trabajo"
        fallbackHref={{ pathname: '/(coord)/projects/[id]', params: { id: pid } }}
        safeArea={false}
      />

      {!pid ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.error} />
          <Text style={styles.errorText}>Proyecto no especificado</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]}>
          <WorkforceTracker projectId={pid} />
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
