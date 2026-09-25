import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/components/Button';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { FormField } from '@/src/components/FormField';
import { InlineError } from '@/src/components/InlineError';
import { api, ApiError, Area } from '@/src/api';
import { useEnvio } from '@/src/hooks/useEnvio';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { esNombreRepetido } from '@/src/utils/nombres';
import { esErrorDeRed } from '@/src/utils/errores';
import { showToast } from '@/src/utils/toast';
import { colors, radius, spacing, shadow } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { a11y, t } from '@/src/i18n';

const PALETTE = [
  '#0EA5E9', '#22C55E', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#0F172A',
];

export default function AreasScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';

  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PALETTE[0]);
  const { guardando, ejecutar } = useEnvio();
  const form = useFormErrors<'nombre'>();
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const items = await api.listAreas(pid);
      setAreas(items || []);
    } catch (e: any) {
      setError(e?.message || t('areas.errorCargar'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openCreate() {
    setNewName('');
    setNewColor(PALETTE[areas.length % PALETTE.length]);
    form.limpiarTodo();
    setShowCreate(true);
  }

  function validarNombre(): string | null {
    const name = newName.trim();
    if (!name) return t('areas.nombreObligatorio');
    if (esNombreRepetido(name, areas.map((a) => a.name))) return t('areas.nombreDuplicado');
    return null;
  }

  async function onCreate() {
    await ejecutar(async () => {
      const problema = validarNombre();
      if (form.ponerTodos({ nombre: problema ?? undefined })) return;
      try {
        await api.createArea(pid, { project_id: pid, name: newName.trim(), color: newColor });
      } catch (e: any) {
        if (e instanceof ApiError && e.status === 409) form.poner('nombre', t('areas.nombreDuplicado'));
        else form.errorDeGuardado(e, t('areas.noSePudoCrear'));
        return;
      }
      setNewName('');
      form.limpiarTodo();
      setShowCreate(false);
      await load();
    });
  }

  async function onDelete(area: Area) {
    const ok = await confirm(
      t('areas.eliminarTitulo'),
      t('areas.eliminarPregunta', { nombre: area.name }),
      { confirmText: t('areas.eliminar'), destructive: true },
    );
    if (!ok) return;
    setErrorAccion(null);
    try { await api.deleteArea(area.id); await load(); }
    catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setErrorAccion(e?.message || t('areas.noSePudoEliminar'));
    }
  }

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <ScreenHeader
        title={t('areas.titulo')}
        subtitle={areas.length === 1 ? t('areas.cuantasUna') : t('areas.cuantas', { n: areas.length })}
        fallbackHref={{ pathname: '/(coord)/projects/[id]', params: { id: pid } }}
        safeArea={false}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 110 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        <InlineError message={errorAccion} style={{ marginBottom: spacing.sm }} />
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : areas.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="color-palette-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>{t('areas.vacioTitulo')}</Text>
            <Text style={styles.emptyMsg}>{t('areas.vacioMensaje')}</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {areas.map((a) => (
              <View key={a.id} style={styles.card}>
                <View style={[styles.dot, { backgroundColor: a.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{a.name}</Text>
                  <Text style={styles.cardId}>{a.color.toUpperCase()}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} onPress={() => onDelete(a)} hitSlop={8} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable accessibilityRole="button" style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={openCreate}>
        <Ionicons name="add" size={26} color={colors.textInverse} />
        <Text style={styles.fabText}>{t('areas.nueva')}</Text>
      </Pressable>

      <Modal visible={showCreate} animationType="slide" transparent onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + spacing.md }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('areas.nueva')}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={() => setShowCreate(false)} hitSlop={8}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
              </View>

              <FormField
                label={t('areas.nombreDisciplina')}
                value={newName}
                onChangeText={form.alCambiar<string>('nombre', setNewName)}
                error={form.errores.nombre}
                placeholder={t('areas.nombrePlaceholder')}
                autoCapitalize="words"
                autoFocus
                editable={!guardando}
                obligatorio
                returnKeyType="done"
                onSubmitEditing={onCreate}
                style={{ marginTop: 0 }}
              />

              <Text style={[styles.label, { marginTop: spacing.md }]}>{t('areas.colorIdentificacion')}</Text>
              <View style={styles.swatchRow}>
                {PALETTE.map((c) => (
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('elegirColor')} accessibilityState={{ selected: newColor === c }} hitSlop={8}
                    key={c}
                    onPress={() => setNewColor(c)}
                    style={[styles.swatch, { backgroundColor: c }, newColor === c && styles.swatchOn]}
                  >
                    {newColor === c ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
                  </Pressable>
                ))}
              </View>

              <InlineError message={form.errorGeneral} style={{ marginTop: spacing.md }} />

              <View style={{ height: spacing.md }} />
              <Button label={t('areas.crear')} onPress={onCreate} loading={guardando} fullWidth />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, gap: spacing.md },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md },
  errorText: { color: colors.error, fontSize: 13, flex: 1, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: spacing.xl + 12, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 8 },
  emptyMsg: { fontSize: 13, color: colors.textMuted, textAlign: 'center', maxWidth: 320, lineHeight: 19 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  dot: { width: 36, height: 36, borderRadius: radius.md },
  cardName: { fontSize: 15, fontWeight: '800', color: colors.text },
  cardId: { fontSize: 11, color: colors.textMuted, fontWeight: '700', marginTop: 2 },
  deleteBtn: { padding: 8 },
  fab: { position: 'absolute', right: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.full, ...shadow.card },
  fabText: { color: colors.textInverse, fontWeight: '800', fontSize: 14 },

  modalBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: spacing.md },
  modalTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginBottom: 6 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.text, transform: [{ scale: 1.08 }] },
});
