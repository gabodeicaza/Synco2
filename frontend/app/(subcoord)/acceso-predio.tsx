// Acceso al Predio / Situacion Social — Sub-coordinador. Mismo componente
// reusable que usa el Coordinador (AccesoPredioManager); solo cambia el
// wrapper de ruta/header para no depender del layout de tabs de (coord).
import React from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/src/theme';
import { AccesoPredioManager } from '@/src/components/AccesoPredioManager';
import { ScreenHeader } from '@/src/components/ScreenHeader';

export default function AccesoPredioScreen() {
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Acceso al Predio" fallbackHref="/(subcoord)" />

      {!pid ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.error} />
          <Text style={styles.errorText}>Proyecto no especificado</Text>
        </View>
      ) : (
        <AccesoPredioManager projectId={pid} />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg,
    padding: 10, borderRadius: 10, marginHorizontal: spacing.lg, marginTop: spacing.md,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 13, fontWeight: '600' },
});
