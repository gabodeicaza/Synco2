// Hub de módulos — reemplaza la lista plana que antes vivía directo dentro
// del menú hamburguesa (HeaderMenu.tsx): con varios módulos encendidos a la
// vez esa lista rompía el layout del dropdown. Ahora el menú solo ofrece un
// botón "Módulos" que trae aquí, a una pantalla completa con espacio propio
// — misma fuente de datos (`modulosActivos`, sistema Multi-Proyecto Modular)
// que ya usan la pestaña Operación de Coordinador General y la pantalla de
// Configuración > Módulos.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { modulosActivos } from '@/src/utils/modulos';
import { a11y } from '@/src/i18n';

export default function ModulosHubScreen({
  projectId, basePath,
}: {
  projectId: string;
  basePath: '/(subcoord)' | '/(spec)';
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      setLoading(true);
      const p = await api.getProject(projectId);
      setProject(p);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el proyecto.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const activos = modulosActivos(project?.modulos || null);
  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')} onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Módulos</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          {activos.length === 0 ? (
            <Text style={styles.empty}>Tu Coordinador General aún no ha activado ningún módulo para este proyecto.</Text>
          ) : (
            activos.map((m) => (
              <Pressable accessibilityRole="button"
                key={m.key}
                style={styles.card}
                onPress={() => router.push({ pathname: `${basePath}/${m.screen}` as any, params: { project_id: projectId } })}
              >
                <View style={styles.cardIcon}>
                  <Ionicons name={m.icon} size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{m.label}</Text>
                  <Text style={styles.cardSubtitle} numberOfLines={2}>{m.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleBar: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.md, gap: spacing.sm },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontStyle: 'italic' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.card,
  },
  cardIcon: {
    width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  cardSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
