// SynCo v2.0 _ Tab "Calendario" (Coordinador General)
// Vista universal con selector de proyecto cuando el coordinador maneja varios.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import { api, Project } from '@/src/api';
import UniversalCalendar from '@/src/components/UniversalCalendar';
import { colors, radius, spacing } from '@/src/theme';

export default function CalendarioCoordScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
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

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.blueTop, { height: 150 + insets.top }]} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerIcon}>
          <Ionicons name="calendar" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Calendario</Text>
          <Text style={styles.headerSubtitle}>Eventos del proyecto</Text>
        </View>
      </View>

      {projects.length > 1 ? (
        <View style={styles.selectorWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selector}
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
                    name={active ? 'folder' : 'folder-outline'}
                    size={12}
                    color={active ? '#fff' : 'rgba(255,255,255,0.85)'}
                  />
                  <Text style={[styles.projTxt, active && styles.projTxtActive]} numberOfLines={1}>
                    {p.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={16} color={colors.error} />
          <Text style={styles.errorTxt}>{error}</Text>
        </View>
      ) : !selected ? (
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Aun no tienes proyectos</Text>
          <Text style={styles.emptyMsg}>Crea un proyecto para comenzar a programar eventos.</Text>
        </View>
      ) : (
        <UniversalCalendar projectId={selected} userId={user?.id} isCoord />
      )}
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

  selectorWrap: {
    height: 36, marginBottom: spacing.xs,
  },
  selector: { paddingHorizontal: spacing.md, alignItems: 'center', gap: 6 },
  projChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    marginRight: 6,
    height: 28,
  },
  projChipActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  projTxt: {
    fontSize: 11.5, fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    maxWidth: 140,
  },
  projTxtActive: { color: colors.primary },

  center: { padding: spacing.xl, alignItems: 'center' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    margin: spacing.md, padding: 10,
    backgroundColor: colors.errorBg, borderRadius: radius.md,
  },
  errorTxt: { color: colors.error, fontSize: 12, fontWeight: '700', flex: 1 },
  empty: {
    margin: spacing.md, padding: spacing.lg, alignItems: 'center', gap: 6,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 4 },
  emptyMsg: { fontSize: 12, color: colors.textBody, textAlign: 'center' },
});
