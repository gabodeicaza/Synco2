// Dirac _ Administración de Eventos (Coordinador General).
// El alta y la edición usan el formulario común EventoForm (mismo que el Calendario).
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Area, ProjectEvent, User } from '@/src/api';
import { EventoForm } from '@/src/components/EventoForm';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { formatEventTime } from '@/src/utils/events';
import { dayjs, CDMX_TZ } from '@/src/utils/tz';

export default function CoordEventsScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';

  const [items, setItems] = useState<ProjectEvent[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [formAbierto, setFormAbierto] = useState(false);
  const [editando, setEditando] = useState<ProjectEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const [data, mbs, ars] = await Promise.all([
        api.listEvents(pid, tab, 500),
        members.length ? Promise.resolve(members) : api.listProjectMembers(pid).catch(() => [] as User[]),
        areas.length ? Promise.resolve(areas) : api.listAreas(pid).catch(() => [] as Area[]),
      ]);
      setItems(data);
      if (!members.length) setMembers(mbs);
      if (!areas.length) setAreas(ars);
    } catch (e: any) {
      setError(e?.message || 'Error al cargar');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pid, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => { load(false); }, [load]));

  function newEvent() {
    setEditando(null);
    setFormAbierto(true);
  }

  function editEvent(e: ProjectEvent) {
    setEditando(e);
    setFormAbierto(true);
  }

  async function onDelete(e: ProjectEvent) {
    const ok = await confirm('Eliminar evento', `?Eliminar "${e.title}"?`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deleteEvent(e.id);
      await load(true);
    } catch (er: any) {
      setError(er?.message || 'No se pudo eliminar');
    }
  }

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Calendario"
        subtitle="Eventos visibles para todo el proyecto"
        fallbackHref={{ pathname: '/(coord)/projects/[id]', params: { id: pid } }}
        safeArea={false}
        right={(
          <Pressable accessibilityRole="button" onPress={newEvent} style={styles.newBtn}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.newBtnTxt}>Nuevo</Text>
          </Pressable>
        )}
      />

      <View style={styles.tabsRow}>
        {(['upcoming', 'past'] as const).map((k) => (
          <Pressable accessibilityRole="button"
            key={k}
            onPress={() => { setTab(k); }}
            style={[styles.tabBtn, tab === k && styles.tabBtnActive]}
          >
            <Text style={[styles.tabTxt, tab === k && styles.tabTxtActive]}>
              {k === 'upcoming' ? 'Proximos' : 'Pasados'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="calendar-outline" size={26} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>
              {tab === 'upcoming' ? 'Sin eventos programados' : 'Sin eventos pasados'}
            </Text>
            <Text style={styles.emptyMsg}>
              Programa actividades clave del proyecto. Todos los miembros podran verlas en su tab &ldquo;Calendario&rdquo;.
            </Text>
            {tab === 'upcoming' ? (
              <Pressable accessibilityRole="button" style={styles.emptyBtn} onPress={newEvent}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.emptyBtnTxt}>Crear primer evento</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          items.map((e) => (
            <View key={e.id} style={styles.card}>
              <View style={styles.dateBlock}>
                <Text style={styles.dateDay}>{dayjs.utc(e.start_at).tz(CDMX_TZ).format('D')}</Text>
                <Text style={styles.dateMonth}>
                  {dayjs.utc(e.start_at).tz(CDMX_TZ).format('MMM').toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cardTitle} numberOfLines={2}>{e.title}</Text>
                <View style={styles.metaRow}>
                  <Ionicons name="time-outline" size={12} color={colors.primary} />
                  <Text style={styles.metaTxtPrimary}>{formatEventTime(e)}</Text>
                </View>
                {e.location ? (
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                    <Text style={styles.metaTxt} numberOfLines={1}>{e.location}</Text>
                  </View>
                ) : null}
                {e.description ? (
                  <Text style={styles.descTxt} numberOfLines={3}>{e.description}</Text>
                ) : null}
                {(e.attendee_names && e.attendee_names.length > 0) ? (
                  <View style={styles.attendeesWrap}>
                    {e.attendee_names.slice(0, 4).map((n, i) => (
                      <View key={i} style={styles.attendeeChip}>
                        <Ionicons name="person" size={9} color={colors.primary} />
                        <Text style={styles.attendeeChipTxt} numberOfLines={1}>{n}</Text>
                      </View>
                    ))}
                    {e.attendee_names.length > 4 ? (
                      <Text style={styles.attendeeMoreTxt}>+{e.attendee_names.length - 4} más</Text>
                    ) : null}
                  </View>
                ) : null}
                <View style={styles.actionsRow}>
                  <Pressable accessibilityRole="button" onPress={() => editEvent(e)} style={[styles.actBtn]}>
                    <Ionicons name="create-outline" size={14} color={colors.primary} />
                    <Text style={styles.actBtnTxt}>Editar</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => onDelete(e)} style={[styles.actBtn, styles.actBtnDanger]}>
                    <Ionicons name="trash-outline" size={14} color={colors.error} />
                    <Text style={styles.actBtnTxtDanger}>Eliminar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <EventoForm
        visible={formAbierto}
        evento={editando}
        projectId={pid}
        members={members}
        areas={areas}
        onClose={() => setFormAbierto(false)}
        onSaved={() => { setFormAbierto(false); load(true); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full,
  },
  newBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },

  tabsRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  tabBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  tabTxtActive: { color: '#fff' },

  scroll: { paddingHorizontal: spacing.md, gap: spacing.sm },
  center: { padding: spacing.xl, alignItems: 'center' },

  card: {
    flexDirection: 'row', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.sm + 2, alignItems: 'flex-start',
    borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  dateBlock: {
    width: 56, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryLight, borderRadius: radius.md,
    paddingVertical: 8,
  },
  dateDay: { fontSize: 22, fontWeight: '800', color: colors.primary, lineHeight: 24 },
  dateMonth: { fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 0.6 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaTxt: { fontSize: 12, color: colors.textBody, flex: 1 },
  metaTxtPrimary: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  descTxt: { fontSize: 12, color: colors.textBody, marginTop: 6, lineHeight: 17 },
  actionsRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  actBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
  },
  actBtnTxt: { fontSize: 11, fontWeight: '800', color: colors.primary },
  actBtnDanger: { backgroundColor: colors.errorBg },
  actBtnTxtDanger: { fontSize: 11, fontWeight: '800', color: colors.error },

  attendeesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6, alignItems: 'center' },
  attendeeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.primaryLight, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.full,
  },
  attendeeChipTxt: { fontSize: 10, color: colors.primary, fontWeight: '700', maxWidth: 100 },
  attendeeMoreTxt: { fontSize: 10, color: colors.textMuted, fontWeight: '700' },

  empty: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyMsg: { fontSize: 12, color: colors.textBody, textAlign: 'center', lineHeight: 18 },
  emptyBtn: {
    marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md,
  },
  emptyBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md,
  },
  errorText: { color: colors.error, fontSize: 12, fontWeight: '700', flex: 1 },
});
