// Bandeja de solicitudes "Olvidé mi contraseña" (ver login.tsx > Olvidé mi
// contraseña) para que el Coordinador General las resuelva sin tener que
// ubicar primero al usuario en Equipo/Invitaciones de un proyecto puntual.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, PasswordResetRequest } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { roleLabel } from '@/src/utils/roles';
import { confirm } from '@/src/utils/confirm';
import { ScreenHeader } from '@/src/components/ScreenHeader';

export default function PasswordResetRequestsScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<PasswordResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ id: string; name: string; temp_password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listPasswordResetRequests();
      setItems(data);
    } catch (e: any) {
      Alert.alert('No se pudo cargar', e?.message || 'Inténtalo nuevamente.');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function onResolve(req: PasswordResetRequest) {
    if (busyId) return;
    const ok = await confirm(
      'Restablecer contraseña',
      `Se generará una contraseña temporal nueva para ${req.name}. La contraseña anterior dejará de funcionar. ¿Continuar?`,
    );
    if (!ok) return;
    setBusyId(req.id);
    try {
      const res = await api.resolvePasswordResetRequest(req.id);
      setResolved({ id: req.id, name: res.user_name, temp_password: res.temp_password });
      setItems((prev) => prev.filter((it) => it.id !== req.id));
    } catch (e: any) {
      Alert.alert('No se pudo restablecer', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setBusyId(null);
    }
  }

  async function onDismiss(req: PasswordResetRequest) {
    if (busyId) return;
    const ok = await confirm('Descartar solicitud', `¿Descartar la solicitud de ${req.name} sin generar contraseña?`);
    if (!ok) return;
    setBusyId(req.id);
    try {
      await api.dismissPasswordResetRequest(req.id);
      setItems((prev) => prev.filter((it) => it.id !== req.id));
    } catch (e: any) {
      Alert.alert('No se pudo descartar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Solicitudes de contraseña" fallbackHref="/(coord)" />

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {resolved ? (
            <View style={styles.tokenCard}>
              <Text style={styles.tokenCardTitle}>Contraseña generada para {resolved.name}</Text>
              <Text style={styles.tokenCardSub}>Compártesela por WhatsApp o en persona. Solo se muestra una vez.</Text>
              <View style={styles.tokenBox}>
                <Text style={styles.tokenLabel}>CONTRASEÑA TEMPORAL</Text>
                <Text selectable style={styles.tokenValueText}>{resolved.temp_password}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setResolved(null)} style={styles.tokenDismiss}>
                <Text style={styles.tokenDismissText}>Entendido</Text>
              </Pressable>
            </View>
          ) : null}

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>No hay solicitudes pendientes</Text>
            </View>
          ) : (
            items.map((req) => (
              <View key={req.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(req.name?.[0] || '?').toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{req.name}</Text>
                    <Text style={styles.cardEmail}>{req.email}</Text>
                    <Text style={styles.cardRole}>{roleLabel(req.role)}</Text>
                  </View>
                </View>
                <View style={styles.cardActions}>
                  <Pressable accessibilityRole="button"
                    onPress={() => onDismiss(req)}
                    style={({ pressed }) => [styles.actionBtn, styles.actionBtnGhost, pressed && { opacity: 0.85 }]}
                    disabled={busyId === req.id}
                  >
                    <Text style={styles.actionBtnGhostText}>Descartar</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button"
                    onPress={() => onResolve(req)}
                    style={({ pressed }) => [styles.actionBtn, styles.actionBtnPrimary, pressed && { opacity: 0.85 }]}
                    disabled={busyId === req.id}
                  >
                    {busyId === req.id ? (
                      <ActivityIndicator size="small" color={colors.textInverse} />
                    ) : (
                      <>
                        <Ionicons name="key-outline" size={14} color={colors.textInverse} />
                        <Text style={styles.actionBtnPrimaryText}>Restablecer</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 48 },
  emptyText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.textInverse, fontWeight: '900', fontSize: 16 },
  cardName: { fontSize: 14, fontWeight: '800', color: colors.text },
  cardEmail: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  cardRole: { fontSize: 11, color: colors.primary, fontWeight: '700', marginTop: 2 },

  cardActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.md },
  actionBtnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  actionBtnGhostText: { color: colors.textBody, fontWeight: '700', fontSize: 13 },
  actionBtnPrimary: { backgroundColor: colors.primary },
  actionBtnPrimaryText: { color: colors.textInverse, fontWeight: '700', fontSize: 13 },

  tokenCard: { backgroundColor: colors.primaryLight, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.primary, gap: 4 },
  tokenCardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  tokenCardSub: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  tokenBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  tokenLabel: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 1, marginBottom: 4 },
  tokenValueText: { fontSize: 22, fontWeight: '900', color: colors.text, letterSpacing: 2 },
  tokenDismiss: { alignSelf: 'flex-end', marginTop: 10, paddingVertical: 6, paddingHorizontal: 12 },
  tokenDismissText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});
