// SynCo v2.0 _ Tab "Calendario" (Sub-coordinador)
// Vista universal: usa UniversalCalendar (mismo componente para todos los roles).
import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import UniversalCalendar from '@/src/components/UniversalCalendar';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useProyectoActivo } from '@/src/proyecto-activo-context';
import { colors } from '@/src/theme';

export default function CalendarioSubcoordScreen() {
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

      <ScreenHeader title="Calendario" subtitle="Eventos del proyecto" backgroundColor={colors.primary} fallbackHref="/(subcoord)" />

      <UniversalCalendar projectId={projectId} userId={user?.id} isCoord={isCoord} />
    </View>
  );
}

const styles = StyleSheet.create({
  blueTop: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.primary },
});
