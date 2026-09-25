// Dirac · Tab "Mensajes" para Coordinador General y Jefe de Proyecto.
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

import { api } from '@/src/api';
import { useProyectoActivo } from '@/src/proyecto-activo-context';
import { t } from '@/src/i18n';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { MensajesView } from '../(spec)/mensajes';

export default function CoordMensajesScreen() {
  const insets = useSafeAreaInsets();
  // P-05: el proyecto activo es el mismo para Mensajes, Minutas, Noticias y Calendario.
  const { proyectoId: selected, proyectos: projects, cargando, setProyectoId, recargar } = useProyectoActivo();
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [eligiendo, setEligiendo] = useState(false);
  const [cargandoConteos, setCargandoConteos] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loading = cargando || cargandoConteos;

  const load = useCallback(async () => {
    try {
      const counts = await api.unreadCounts().catch(() => ({} as Record<string, number>));
      setUnread(counts);
    } catch {
      // silent
    } finally {
      setCargandoConteos(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Marca como leidos al entrar a un proyecto y limpia el badge localmente.
  const openProject = useCallback(async (pid: string) => {
    setProyectoId(pid);
    setEligiendo(false);
    setUnread((prev) => ({ ...prev, [pid]: 0 }));
    api.markProjectMessagesSeen(pid).catch(() => {});
  }, [setProyectoId]);

  // Al abrir la pantalla con un proyecto activo se entra directo a sus mensajes (y se marcan como leídos).
  useEffect(() => {
    if (!selected || eligiendo) return;
    setUnread((prev) => (prev[selected] ? { ...prev, [selected]: 0 } : prev));
    api.markProjectMessagesSeen(selected).catch(() => {});
  }, [selected, eligiendo]);

  // Si hay un proyecto activo, mostramos la pantalla de Mensajes con un
  // header que permite volver al selector.
  if (selected && !eligiendo) {
    const proj = projects.find((p) => p.id === selected);
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={[styles.switcher, { paddingTop: insets.top + 8 }]}>
          <Pressable accessibilityRole="button"
            onPress={() => { setEligiendo(true); load(); }}
            hitSlop={10}
            style={styles.switcherBtn}
            accessibilityLabel={t('proyectoActivo.cambiar')}
          >
            <Ionicons name="swap-horizontal" size={16} color="#fff" />
            <Text style={styles.switcherTxt} numberOfLines={1}>
              {proj?.name || t('proyectoActivo.proyecto')} · {t('proyectoActivo.cambiar').toLowerCase()}
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
              ? `${totalUnread} mensaje${totalUnread === 1 ? '' : 's'} sin leer · elige un proyecto`
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
            onRefresh={() => { setRefreshing(true); void recargar(); load(); }}
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
              <Pressable accessibilityRole="button"
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
