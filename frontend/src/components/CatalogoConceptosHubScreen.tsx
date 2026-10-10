// Hub de "Catálogo de Conceptos" — reemplaza el acordeón de 3 sub-opciones
// que antes vivía directo dentro del menú hamburguesa (HeaderMenu.tsx),
// mismo motivo que el hub de Módulos: con el resto de items del menú, el
// acordeón desplegado ahí mismo se sentía apretado. Ahora el menú solo
// ofrece un botón "Catálogo de Conceptos" que trae aquí, a una pantalla
// completa — mismo patrón visual que ModulosHubScreen.tsx.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, Project } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { ScreenHeader } from '@/src/components/ScreenHeader';

const ITEMS: { icon: keyof typeof Ionicons.glyphMap; label: string; subtitle: string; screen: string }[] = [
  { icon: 'create-outline', label: 'Registrar avance', subtitle: 'Captura de uso diario', screen: 'registrar-avance' },
  { icon: 'list-outline', label: 'Catálogo de conceptos', subtitle: 'Consulta y administración', screen: 'catalogo-conceptos' },
  { icon: 'bar-chart-outline', label: 'Visualizar avance', subtitle: 'Reporte por periodo', screen: 'visualizar-avance' },
];

export default function CatalogoConceptosHubScreen({
  basePath, projectId,
}: {
  basePath: '/(subcoord)' | '/(spec)';
  projectId: string;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      setLoading(true);
      setProject(await api.getProject(projectId));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el proyecto.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Catálogo de Conceptos" backgroundColor={headerColor} fallbackHref={basePath} />

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          {ITEMS.map((it) => (
            <Pressable accessibilityRole="button"
              key={it.screen}
              style={styles.card}
              onPress={() => router.push({ pathname: `${basePath}/${it.screen}` as any, params: { project_id: projectId } })}
            >
              <View style={[styles.cardIcon, { backgroundColor: headerColor }]}>
                <Ionicons name={it.icon} size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{it.label}</Text>
                <Text style={styles.cardSubtitle} numberOfLines={2}>{it.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.md, gap: spacing.sm },
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
