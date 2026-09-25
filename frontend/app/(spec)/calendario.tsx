// SynCo v2.0 _ Tab "Calendario" (Especialista)
// Vista universal: usa UniversalCalendar (mismo componente para todos los roles).
import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import UniversalCalendar from '@/src/components/UniversalCalendar';
import { useProyectoActivo } from '@/src/proyecto-activo-context';
import { colors, radius, spacing } from '@/src/theme';

export default function CalendarioScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  // P-05: mismo proyecto activo que Minutas y Noticias (con respaldo al primero del usuario).
  const { proyectoId } = useProyectoActivo();
  const projectId = proyectoId || (user?.project_ids || [])[0] || '';
  const isCoord = user?.role === 'coordinador_general';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.blueTop, { height: 160 + insets.top }]} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerIcon}>
          <Ionicons name="calendar" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Calendario</Text>
          <Text style={styles.headerSubtitle}>Eventos del proyecto</Text>
        </View>
      </View>

      <UniversalCalendar projectId={projectId} userId={user?.id} isCoord={isCoord} />
    </View>
  );
}

const styles = StyleSheet.create({
  blueTop: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  headerIcon: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 1 },
});
