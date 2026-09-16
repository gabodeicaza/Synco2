// Panel de Metas Diarias Globales (SynCo v2 _ Sprint 2).
// - Coordinador general y Sub-coordinador pueden crear / marcar / borrar metas.
// - Especialistas en modo lectura.
// - Persistencia via API /api/projects/{pid}/daily_goals.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, DailyGoal } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { confirm } from '@/src/utils/confirm';

export function DailyGoalsPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canWrite = user?.role === 'coordinador_general' || user?.role === 'sub_coordinador';

  const [goals, setGoals] = useState<DailyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setError(null);
      const list = await api.listDailyGoals(projectId);
      setGoals(list || []);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar las metas');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function onAdd() {
    const t = text.trim();
    if (!t) return;
    if (!canWrite) return;
    try {
      setBusy(true);
      const g = await api.createDailyGoal(projectId, t);
      setGoals((prev) => [g, ...prev]);
      setText('');
    } catch (e: any) {
      Alert.alert('No se pudo agregar', e?.message || 'Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(g: DailyGoal) {
    if (!canWrite) return;
    try {
      setTogglingId(g.id);
      const updated = await api.updateDailyGoal(projectId, g.id, { is_completed: !g.is_completed });
      setGoals((prev) => prev.map((x) => (x.id === g.id ? updated : x)));
    } catch (e: any) {
      Alert.alert('No se pudo actualizar', e?.message || 'Intenta de nuevo.');
    } finally {
      setTogglingId(null);
    }
  }

  async function onDelete(g: DailyGoal) {
    if (!canWrite) return;
    const ok = await confirm('Eliminar meta', `?Quitar "${g.text}"?`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deleteDailyGoal(projectId, g.id);
      setGoals((prev) => prev.filter((x) => x.id !== g.id));
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intenta de nuevo.');
    }
  }

  const done = goals.filter((g) => g.is_completed).length;
  const total = goals.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <Ionicons name="checkmark-done" size={16} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Metas del dia</Text>
          <Text style={styles.subtitle}>
            {total === 0 ? 'Aun no hay metas registradas' : `${done}/${total} completadas _ ${pct}%`}
          </Text>
        </View>
        {!canWrite ? (
          <View style={styles.readOnlyBadge}>
            <Ionicons name="eye-outline" size={11} color={colors.textMuted} />
            <Text style={styles.readOnlyBadgeTxt}>Solo lectura</Text>
          </View>
        ) : null}
      </View>

      {/* Barra de progreso */}
      {total > 0 ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.errBox}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
          <Text style={styles.errTxt}>{error}</Text>
          <Pressable onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryTxt}>Reintentar</Text>
          </Pressable>
        </View>
      ) : goals.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="flag-outline" size={20} color={colors.textMuted} />
          <Text style={styles.emptyTxt}>
            {canWrite
              ? 'Agrega la primera meta del dia para tu equipo.'
              : 'Aun no se han publicado metas para hoy.'}
          </Text>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          {goals.map((g) => {
            const isLoading = togglingId === g.id;
            return (
              <Pressable
                key={g.id}
                onPress={() => onToggle(g)}
                disabled={!canWrite || isLoading}
                style={({ pressed }) => [
                  styles.itemRow,
                  pressed && canWrite && { opacity: 0.85 },
                ]}
              >
                <View style={[styles.checkbox, g.is_completed && styles.checkboxOn]}>
                  {isLoading ? (
                    <ActivityIndicator size="small" color={g.is_completed ? '#fff' : colors.primary} />
                  ) : g.is_completed ? (
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  ) : null}
                </View>
                <Text
                  style={[styles.itemTxt, g.is_completed && styles.itemTxtDone]}
                  numberOfLines={3}
                >
                  {g.text}
                </Text>
                {canWrite ? (
                  <Pressable
                    onPress={() => onDelete(g)}
                    hitSlop={8}
                    style={styles.delBtn}
                  >
                    <Ionicons name="close" size={16} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {canWrite ? (
        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Nueva meta del dia_"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            editable={!busy}
            onSubmitEditing={onAdd}
            returnKeyType="done"
            maxLength={140}
          />
          <Pressable
            onPress={onAdd}
            disabled={busy || !text.trim()}
            style={({ pressed }) => [
              styles.addBtn,
              (busy || !text.trim()) && { opacity: 0.5 },
              pressed && { opacity: 0.85 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="add" size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadow.card,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerIcon: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontWeight: '600' },

  readOnlyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full,
  },
  readOnlyBadgeTxt: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.4 },

  progressTrack: {
    height: 6, backgroundColor: colors.primaryLight, borderRadius: 3, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: colors.primary, borderRadius: 3,
  },

  center: { padding: spacing.md, alignItems: 'center' },
  errBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: spacing.sm,
  },
  errTxt: { color: colors.textBody, fontSize: 12, flex: 1 },
  retryBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: colors.primary, borderRadius: radius.sm,
  },
  retryTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },

  emptyBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8,
  },
  emptyTxt: { fontSize: 12, color: colors.textMuted, flex: 1, lineHeight: 18 },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  itemTxt: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '600' },
  itemTxtDone: { color: colors.textMuted, textDecorationLine: 'line-through', fontWeight: '500' },
  delBtn: {
    width: 28, height: 28, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
  },

  inputRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.text,
    minHeight: 42,
  },
  addBtn: {
    width: 42, height: 42, borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
});
