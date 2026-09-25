/**
 * AnnouncementsHubScreen — pantalla de nivel raíz (tab "Noticias") multi-proyecto.
 * -----------------------------------------------------------------------------
 * Mismo patrón que MinutasHubScreen.tsx:
 *   - Si el usuario tiene 1 solo proyecto, carga sus noticias directamente.
 *   - Si tiene >1, muestra un selector horizontal de proyectos y renderiza
 *     AnnouncementsView con el proyecto seleccionado.
 * Delega toda la lógica de noticias a AnnouncementsView para no duplicar código.
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing } from '@/src/theme';
import { t } from '@/src/i18n';
import { useProyectoActivo } from '@/src/proyecto-activo-context';
import AnnouncementsView from '@/src/components/AnnouncementsView';

export default function AnnouncementsHubScreen() {
  const insets = useSafeAreaInsets();
  // P-05: el proyecto activo es el mismo para Mensajes, Minutas, Noticias y Calendario.
  const { proyectoId, proyectos: projects, cargando: loading, setProyectoId: setSelected, recargar } = useProyectoActivo();
  const selected = proyectoId || '';
  const error: string | null = null;

  useFocusEffect(useCallback(() => { void recargar(); }, [recargar]));

  if (loading && projects.length === 0) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!loading && projects.length === 0) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 24 }]}>
        <Ionicons name="newspaper-outline" size={44} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Sin proyectos asignados</Text>
        <Text style={styles.emptySub}>
          {error || 'Cuando tengas proyectos, aquí verás y publicarás noticias.'}
        </Text>
      </View>
    );
  }

  const showSelector = projects.length > 1;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="dark-content" />
      {showSelector && (
        <View style={[styles.selectorWrap, { paddingTop: insets.top + spacing.xs }]}>
          <Text style={styles.selectorLabel}>{t('proyectoActivo.proyecto')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selectorRow}
          >
            {projects.map((p) => {
              const active = p.id === selected;
              return (
                <Pressable accessibilityRole="button"
                  key={p.id}
                  onPress={() => setSelected(p.id)}
                  style={[styles.projChip, active && styles.projChipActive]}
                >
                  <Ionicons
                    name="briefcase"
                    size={12}
                    color={active ? '#fff' : colors.primary}
                  />
                  <Text
                    style={[styles.projChipTxt, active && { color: '#fff' }]}
                    numberOfLines={1}
                  >
                    {p.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {selected ? (
        <AnnouncementsView
          key={selected}
          pid={selected}
          embedded
          headerTitle="Noticias"
          headerSubtitle={
            projects.length > 1
              ? projects.find((p) => p.id === selected)?.name || 'Anuncios del proyecto'
              : 'Anuncios visibles para todo el proyecto'
          }
          topPadding={showSelector ? 0 : insets.top}
        />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.bg,
    gap: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 4 },
  emptySub: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  selectorWrap: {
    paddingBottom: spacing.xs,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectorLabel: {
    fontSize: 10, fontWeight: '800', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.4,
    paddingHorizontal: spacing.md, marginBottom: 4,
  },
  selectorRow: { gap: 6, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  projChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  projChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  projChipTxt: { fontSize: 12, fontWeight: '700', color: colors.text, maxWidth: 140 },
});
