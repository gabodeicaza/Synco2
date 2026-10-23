// Aviso de Inicio: "Tu reporte diario está listo, revísalo". Aparece cuando el corte de las 19:00 ya
// generó el informe del ingeniero y éste aún no lo confirma; al tocarlo abre la pantalla de revisión.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { usePollingConFoco } from '@/src/hooks/usePollingConFoco';

const POLL_MS = 60000;

export function InformeDiarioBanner({ projectId, basePath }: { projectId: string; basePath: '/(spec)' | '/(subcoord)' }) {
  const [pendientes, setPendientes] = useState(0);

  const cargar = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await api.informeDiarioPendientes(projectId);
      setPendientes(r.length);
    } catch {
      // Un fallo de red no debe estorbar a Inicio: el aviso simplemente no se muestra.
    }
  }, [projectId]);

  useEffect(() => { cargar(); }, [cargar]);
  usePollingConFoco(cargar, POLL_MS, !!projectId);

  if (!pendientes) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Tu reporte diario está listo, revísalo"
      onPress={() => router.push(`${basePath}/informe-diario` as any)}
      style={styles.box}
    >
      <Ionicons name="document-text" size={22} color="#92400E" />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Tu reporte diario está listo</Text>
        <Text style={styles.sub}>Revísalo y confírmalo{pendientes > 1 ? ` (${pendientes} pendientes)` : ''}.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#92400E" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm,
    padding: spacing.md, backgroundColor: '#FEF3C7', borderColor: '#F59E0B', borderWidth: 1, borderRadius: radius.md,
  },
  title: { color: '#92400E', fontWeight: '800', fontSize: 14 },
  sub: { color: '#92400E', fontSize: 12, marginTop: 2 },
});
