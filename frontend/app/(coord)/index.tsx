import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth-context';
import { api, Project } from '@/src/api';
import { colors, radius, spacing, shadow } from '@/src/theme';
import { roleLabel } from '@/src/utils/roles';
import { Button } from '@/src/components/Button';
import { MyMeetingsPanel, MyMeetingItem } from '@/src/components/MyMeetingsPanel';

export default function CoordHome() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myMeetings, setMyMeetings] = useState<MyMeetingItem[]>([]);
  const [myMeetingsLoading, setMyMeetingsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(null);
      const items = await api.listProjects();
      setProjects(items || []);

      // "Mis reuniones" agrega por todos los proyectos del coordinador — a
      // diferencia de Especialista/Sub-coordinador (un solo proyecto), aquí
      // no hay un projectId único al que atarse.
      setMyMeetingsLoading(true);
      try {
        const perProject = await Promise.all(
          (items || []).map((p) =>
            api.listEvents(p.id, 'upcoming', 5, true)
              .then((evs) => evs.map((e) => ({ ...e, project_name: p.name })))
              .catch(() => [] as MyMeetingItem[])
          )
        );
        const merged = perProject.flat().sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''));
        setMyMeetings(merged.slice(0, 8));
      } finally {
        setMyMeetingsLoading(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Error al cargar proyectos');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Hola, {user?.name?.split(' ')[0] || 'Coordinador'}</Text>
          <Text style={styles.role}>{roleLabel(user?.role)}</Text>
        </View>
        <Pressable onPress={() => router.push('/(coord)/profile')} hitSlop={8} style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.name?.[0] || 'C').toUpperCase()}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {/* MyMeetingsPanel trae su propio paddingHorizontal (mismo criterio que
            en Especialista/Sub-coordinador) — se compensa el padding del
            ScrollView de esta pantalla para no duplicarlo. */}
        <View style={{ marginHorizontal: -spacing.lg }}>
          <MyMeetingsPanel items={myMeetings} loading={myMeetingsLoading} />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Mis proyectos</Text>
          <Text style={styles.sectionCount}>{projects.length}</Text>
        </View>

        {loading ? (
          <View style={styles.centerBlock}><ActivityIndicator color={colors.primary} /></View>
        ) : error ? (
          <View style={styles.errorBlock}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : projects.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Aun no has creado proyectos</Text>
            <Text style={styles.emptyMsg}>
              Crea tu primer proyecto para comenzar a configurar su arbol de nodos, areas e invitaciones.
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
          </View>
        )}
      </ScrollView>

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => router.push('/(coord)/projects/new')}
      >
        <Ionicons name="add" size={28} color={colors.textInverse} />
        <Text style={styles.fabText}>Nuevo proyecto</Text>
      </Pressable>
    </View>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/(coord)/projects/[id]', params: { id: project.id } })}
      style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.99 }], opacity: 0.95 }]}
    >
      <View style={styles.cardIcon}>
        <Ionicons name="briefcase" size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>{project.name}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {project.constructora} _ {project.contract_number}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md,
  },
  greeting: { fontSize: 22, fontWeight: '900', color: colors.text },
  role: { fontSize: 12, color: colors.textMuted, fontWeight: '700', marginTop: 2 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.textInverse, fontWeight: '800', fontSize: 16 },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.textBody, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionCount: { fontSize: 13, fontWeight: '800', color: colors.textMuted },
  centerBlock: { alignItems: 'center', paddingVertical: spacing.xl },
  errorBlock: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md,
    backgroundColor: colors.errorBg, borderRadius: radius.md,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 13, fontWeight: '600' },
  emptyBlock: { alignItems: 'center', paddingVertical: spacing.xl, gap: 8, paddingHorizontal: spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 8 },
  emptyMsg: { fontSize: 13, color: colors.textMuted, textAlign: 'center', maxWidth: 320, lineHeight: 19 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  cardMeta: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  fab: {
    position: 'absolute', right: spacing.lg,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: radius.full, ...shadow.card,
  },
  fabText: { color: colors.textInverse, fontWeight: '800', fontSize: 14 },
});
