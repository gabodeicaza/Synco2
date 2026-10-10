// Fuerza de Trabajo — vista de solo lectura (derivada de los reportes de
// campo), accesible para Especialista desde el menu de Inicio.
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { WorkforceTracker } from '@/src/components/WorkforceTracker';
import { FuerzaTrabajoCapturaRapida } from '@/src/components/FuerzaTrabajoCapturaRapida';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { t } from '@/src/i18n';

export default function FuerzaDeTrabajoScreen() {
  const insets = useSafeAreaInsets();
  const [capturaAbierta, setCapturaAbierta] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const { user } = useAuth();
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || (user?.project_ids || [])[0] || '';

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Fuerza de Trabajo" fallbackHref="/(spec)" />

      {!pid ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.error} />
          <Text style={styles.errorText}>Proyecto no especificado</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]}>
          <Pressable
            accessibilityRole="button" accessibilityLabel={t('fuerzaTrabajo.capturaRapida')}
            onPress={() => setCapturaAbierta(true)} style={styles.capturaBtn}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.textInverse} />
            <Text style={styles.capturaBtnTxt}>{t('fuerzaTrabajo.capturaRapida')}</Text>
          </Pressable>
          <WorkforceTracker key={recarga} projectId={pid} />
        </ScrollView>
      )}
      <FuerzaTrabajoCapturaRapida
        projectId={pid}
        visible={capturaAbierta}
        onClose={() => setCapturaAbierta(false)}
        onSaved={() => setRecarga((n) => n + 1)}
      />
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
  capturaBtn: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16,
  },
  capturaBtnTxt: { color: colors.textInverse, fontWeight: '800', fontSize: 14 },
});
