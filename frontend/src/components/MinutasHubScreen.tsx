/**
 * MinutasHubScreen _ pantalla de nivel raiz (tab "Minutas") multi-proyecto.
 * -----------------------------------------------------------------------------
 * Se usa como tab en los layouts de Coord, Sub-Coord y Especialista.
 *   _ Si el usuario tiene 1 solo proyecto _ carga sus minutas directamente.
 *   _ Si tiene >1 _ muestra un selector horizontal de proyectos y renderiza
 *     MinutasView con el proyecto seleccionado.
 * Delega toda la logica de minutas a `MinutasView` para no duplicar codigo.
 */
import React, { useCallback, useEffect, useState } from 'react';
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

import { api, Project } from '@/src/api';
import { colors, spacing } from '@/src/theme';
import MinutasView from '@/src/components/MinutasView';

export default function MinutasHubScreen() {
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const items = await api.listProjects();
      setProjects(items || []);
      if (items && items.length > 0) {
        setSelected((cur) => (cur && items.find((p) => p.id === cur) ? cur : items[0].id));
      } else {
        setSelected('');
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar proyectos');
    } finally {
      setLoading(false);
    }
  }, []);

  // [PERF 2026-08-07] Antes se disparaba `load()` tanto en `useEffect` como en
  // `useFocusEffect`; ambos corren en el montaje inicial y duplicaban la
  // llamada a listProjects justo cuando el usuario entra al hub. Basta con
  // useFocusEffect: cubre el montaje (primer foco) y los re-focos posteriores.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Loading inicial
  if (loading && projects.length === 0) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Sin proyectos
  if (!loading && projects.length === 0) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 24 }]}>
        <Ionicons name="clipboard-outline" size={44} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>Sin proyectos asignados</Text>
        <Text style={styles.emptySub}>
          {error || 'Cuando tengas proyectos, aqui veras las minutas y acuerdos.'}
        </Text>
      </View>
    );
  }

  // Selector cuando hay mas de un proyecto
  const showSelector = projects.length > 1;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="dark-content" />
      {showSelector && (
        <View style={[styles.selectorWrap, { paddingTop: insets.top + spacing.xs }]}>
          <Text style={styles.selectorLabel}>Proyecto</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selectorRow}
          >
            {projects.map((p) => {
              const active = p.id === selected;
              return (
                <Pressable
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
        <MinutasView
          key={selected}
          pid={selected}
          embedded
          headerTitle="Hub de Minutas"
          headerSubtitle={
            projects.length > 1
              ? projects.find((p) => p.id === selected)?.name || 'Acuerdos del proyecto'
              : 'Acuerdos y seguimiento de obra'
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
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  emptySub: {
    marginTop: 4,
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: 13,
  },
  selectorWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectorLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    marginBottom: 6,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  selectorRow: {
    gap: 6,
    paddingBottom: 8,
  },
  projChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    maxWidth: 240,
  },
  projChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  projChipTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    maxWidth: 200,
  },
});
