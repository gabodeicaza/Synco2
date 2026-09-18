// SynCo v2.0 _ Tab "Mensajes" para Coordinador General y Jefe de Proyecto.
// El Coord General tiene acceso a todos los proyectos, por lo que primero debe
// elegir un proyecto antes de ver los canales. El componente `MensajesView` se
// reutiliza desde la version del Especialista.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  RefreshControl, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Project } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { MensajesView } from '../(spec)/mensajes';

export default function CoordMensajesScreen() {
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<Project[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, counts] = await Promise.all([
        api.listProjects(),
        api.unreadCounts().catch(() => ({} as Record<string, number>)),
      ]);
      setProjects(data);
      setUnread(counts);
      if (data.length === 1) setSelected(data[0].id);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Marca como leidos al entrar a un proyecto y limpia el badge localmente.
  const openProject = useCallback(async (pid: string) => {
    setSelected(pid);
    setUnread((prev) => ({ ...prev, [pid]: 0 }));
    api.markProjectMessagesSeen(pid).catch(() => {});
  }, []);

  // Si hay un proyecto seleccionado, mostramos la pantalla de Mensajes con un
  // header que permite volver al selector.
  if (selected) {
    const proj = projects.find((p) => p.id === selected);
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={[styles.switcher, { paddingTop: insets.top + 8 }]}>
          <Pressable
            onPress={() => { setSelected(null); load(); }}
            hitSlop={10}
            style={styles.switcherBtn}
          >
            <Ionicons name="swap-horizontal" size={16} color="#fff" />
            <Text style={styles.switcherTxt} numberOfLines={1}>
              {proj?.name || 'Proyecto'} _ cambiar
            </Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, marginTop: -insets.top }}>
          <MensajesView projectId={selected} />
        </View>
      </View>
    );
  }

  const totalUnread = Object.values(unread).reduce((a, b) => a + (b || 0), 0);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.blueTop, { height: 140 + insets.top }]} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerIcon}>
          <Ionicons name="chatbubbles" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Mensajes</Text>
          <Text style={styles.headerSubtitle}>
            {totalUnread > 0
              ? `${totalUnread} mensaje${totalUnread === 1 ? '' : 's'} sin leer _ elige un proyecto`
              : 'Elige un proyecto para ver sus canales'}
          </Text>
        </View>
        {totalUnread > 0 && (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeTxt}>{totalUnread > 99 ? '99+' : String(totalUnread)}</Text>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor="#fff"
            colors={[colors.primary]}
          />
        }
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : projects.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={42} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Sin proyectos disponibles</Text>
            <Text style={styles.emptyMsg}>Crea un proyecto desde la pantalla de Inicio para comenzar a usar mensajes.</Text>
          </View>
        ) : (
          projects.map((p) => {
            const count = unread[p.id] || 0;
            return (
              <Pressable
                key={p.id}
                onPress={() => openProject(p.id)}
                style={({ pressed }) => [styles.projCard, pressed && { opacity: 0.85 }]}
              >
                <View style={[styles.projIcon, { backgroundColor: p.color_institucional || p.color_tema || colors.primary }]}>
                  <Ionicons name="business" size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.projSub} numberOfLines={1}>
                    {p.cliente_principal || p.constructora || 'Sin cliente registrado'}
                  </Text>
                </View>
                {count > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeTxt}>{count > 99 ? '99+' : String(count)}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  blueTop: {
    position: 'absolute', left: 0, right: 0, top: 0,
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  headerIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#fff' },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 1 },

  center: { paddingVertical: 40, alignItems: 'center' },
  empty: { alignItems: 'center', padding: spacing.lg, gap: 8 },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  emptyMsg: { fontSize: 12, color: colors.textMuted, textAlign: 'center', maxWidth: 260 },

  projCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    ...shadow.card,
  },
  projIcon: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  projName: { fontSize: 14, fontWeight: '800', color: colors.text },
  projSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  unreadBadge: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: '#E11D48', paddingHorizontal: 7,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadBadgeTxt: { color: '#fff', fontSize: 11, fontWeight: '900' },
  headerBadge: {
    minWidth: 26, height: 26, borderRadius: 13,
    backgroundColor: '#E11D48', paddingHorizontal: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  headerBadgeTxt: { color: '#fff', fontSize: 12, fontWeight: '900' },

  switcher: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md, paddingBottom: 6,
  },
  switcherBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full,
  },
  switcherTxt: { color: '#fff', fontSize: 12, fontWeight: '700', maxWidth: 220 },
});
