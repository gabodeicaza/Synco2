// Módulo "Pendientes Generales" — pendientes o requerimientos generales de
// obra, de supervisión y de aspectos sociales (liberaciones de postes y
// predios) que el reporte semanal imprime como lista. Solo los
// VIGENTES se imprimen: al resolverse, el pendiente se marca como resuelto y
// deja de salir en el reporte (sin borrarse). Captura abierta a cualquier rol
// de escritura; borrar es de Coordinador/Sub-Coordinador (el backend aplica el
// mismo criterio, ver `delete_pendiente_general`).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, PendienteAmbito, PendienteGeneral, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB, ROLE_JEFE } from '@/src/utils/roles';

const CONTRATO_LABEL: Record<PendienteAmbito, string> = {
  obra: 'Obra', supervision: 'Supervisión', sociales: 'Aspectos sociales', seguridad: 'Seguridad e higiene (administrativos)',
};
const AMBITOS: PendienteAmbito[] = ['obra', 'supervision', 'sociales', 'seguridad'];

type Draft = { id: string | null; contrato: PendienteAmbito; titulo: string; descripcion: string };

export default function PendientesGeneralesScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEscribir = user?.role !== ROLE_JEFE;
  const puedeBorrar = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<PendienteGeneral[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, list] = await Promise.all([api.getProject(projectId), api.listPendientesGenerales(projectId)]);
      setProject(proj);
      setItems(list);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar los pendientes.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const porContrato = useMemo(() => AMBITOS.map((c) => ({
    contrato: c, rows: items.filter((i) => (i.contrato || 'obra') === c),
  })), [items]);

  async function onSave() {
    if (!draft) return;
    if (!draft.titulo.trim()) {
      Alert.alert('Falta información', 'Escribe el título del pendiente.');
      return;
    }
    try {
      setSaving(true);
      if (draft.id) await api.updatePendienteGeneral(projectId, draft.id, { titulo: draft.titulo, descripcion: draft.descripcion });
      else await api.createPendienteGeneral(projectId, {
        contrato: draft.contrato, titulo: draft.titulo, descripcion: draft.descripcion, orden: items.length,
      });
      setDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleResuelto(it: PendienteGeneral) {
    try {
      await api.updatePendienteGeneral(projectId, it.id, { resuelto: !it.resuelto });
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo actualizar', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function onDelete(it: PendienteGeneral) {
    const ok = await confirm('Eliminar pendiente', `¿Eliminar "${it.titulo}"?`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deletePendienteGeneral(projectId, it.id);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Pendientes Generales</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        {porContrato.map(({ contrato, rows }) => (
          <View key={contrato} style={{ marginBottom: spacing.lg }}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{CONTRATO_LABEL[contrato]}</Text>
              {puedeEscribir ? (
                <Pressable accessibilityRole="button" onPress={() => setDraft({ id: null, contrato, titulo: '', descripcion: '' })} style={styles.addBtn}>
                  <Ionicons name="add" size={16} color={colors.primary} />
                  <Text style={styles.addBtnTxt}>Nuevo pendiente</Text>
                </Pressable>
              ) : null}
            </View>
            {rows.length === 0 ? (
              <View style={[styles.card, styles.empty]}>
                <Text style={styles.emptyTxt}>Sin pendientes de {CONTRATO_LABEL[contrato].toLowerCase()}.</Text>
              </View>
            ) : rows.map((it) => (
              <Pressable accessibilityRole="button" accessibilityLabel="Marcar como resuelto"
                key={it.id} style={[styles.card, styles.row, it.resuelto && { opacity: 0.55 }]}
                onPress={puedeEscribir ? () => setDraft({ id: it.id, contrato: it.contrato, titulo: it.titulo, descripcion: it.descripcion || '' }) : undefined}
              >
                {puedeEscribir ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Marcar como resuelto" hitSlop={8} onPress={() => toggleResuelto(it)}>
                    <Ionicons
                      name={it.resuelto ? 'checkbox' : 'square-outline'} size={22}
                      color={it.resuelto ? colors.primary : colors.textMuted}
                    />
                  </Pressable>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, it.resuelto && { textDecorationLine: 'line-through' }]}>{it.titulo}</Text>
                  {it.descripcion ? <Text style={styles.meta} numberOfLines={4}>{it.descripcion}</Text> : null}
                  {it.resuelto ? <Text style={styles.meta}>Resuelto — ya no se imprime en el reporte</Text> : null}
                </View>
                {puedeBorrar ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Eliminar" hitSlop={8} onPress={() => onDelete(it)}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                ) : null}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {draft?.id ? 'Editar' : 'Nuevo'} pendiente · {draft ? CONTRATO_LABEL[draft.contrato] : ''}
            </Text>
            <Text style={styles.fieldLabel}>Título</Text>
            <TextInput
              value={draft?.titulo ?? ''}
              onChangeText={(t) => setDraft((d) => (d ? { ...d, titulo: t } : d))}
              placeholder="Ej. Control de Avance (Programa de Red de Actividades)"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>Descripción</Text>
            <TextInput
              value={draft?.descripcion ?? ''}
              onChangeText={(t) => setDraft((d) => (d ? { ...d, descripcion: t } : d))}
              placeholder="Qué falta y quién debe atenderlo"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={onSave} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleBar: { fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  scroll: { padding: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  empty: { alignItems: 'center', padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md,
    paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
