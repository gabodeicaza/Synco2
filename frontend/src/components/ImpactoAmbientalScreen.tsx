// Módulo piloto "Impacto Ambiental" (sistema Multi-Proyecto Modular). Vista
// de auditoría comparativa a dos columnas: Cumplimientos (verde) vs.
// Incumplimientos/Observaciones (rojo). Screen "dueña" de su propio
// header — igual patrón que ForestalArboladoScreen.tsx.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, AmbientalAuditoriaItem, JerarquiaInforme, Project } from '@/src/api';
import { JerarquiaInformePicker, JERARQUIA_DEFAULT } from '@/src/components/JerarquiaInformePicker';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { ScreenHeader } from '@/src/components/ScreenHeader';

type Tipo = 'cumplimiento' | 'incumplimiento';

export default function ImpactoAmbientalScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<AmbientalAuditoriaItem[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [tipoDraft, setTipoDraft] = useState<Tipo>('cumplimiento');
  const [descripcionDraft, setDescripcionDraft] = useState('');
  const [notasDraft, setNotasDraft] = useState('');
  const [jerarquiaDraft, setJerarquiaDraft] = useState<JerarquiaInforme>(JERARQUIA_DEFAULT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, list] = await Promise.all([
        api.getProject(projectId),
        api.listAmbientalAuditoria(projectId),
      ]);
      setProject(proj);
      setItems(list);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el módulo Impacto Ambiental.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

  const cumplimientos = useMemo(() => items.filter((i) => i.tipo === 'cumplimiento'), [items]);
  const incumplimientos = useMemo(() => items.filter((i) => i.tipo === 'incumplimiento'), [items]);

  function openForm(tipo: Tipo) {
    setTipoDraft(tipo);
    setDescripcionDraft('');
    setNotasDraft('');
    setJerarquiaDraft(JERARQUIA_DEFAULT);
    setFormOpen(true);
  }

  async function onSave() {
    const descripcion = descripcionDraft.trim();
    if (!descripcion) {
      Alert.alert('Falta información', 'Describe el hallazgo de la auditoría.');
      return;
    }
    try {
      setSaving(true);
      await api.createAmbientalAuditoria(projectId, {
        tipo: tipoDraft,
        descripcion,
        notas: notasDraft.trim() || null,
        jerarquia: jerarquiaDraft,
      });
      setFormOpen(false);
      setJerarquiaDraft(JERARQUIA_DEFAULT);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
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
      <ScreenHeader title="Impacto Ambiental" backgroundColor={headerColor} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.columnsRow}>
          {/* === Columna: Cumplimientos === */}
          <View style={styles.column}>
            <View style={[styles.columnHeader, styles.columnHeaderGood]}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={[styles.columnTitle, { color: colors.success }]}>Cumplimientos</Text>
            </View>
            {cumplimientos.length === 0 ? (
              <Text style={styles.emptyTxt}>Sin registros.</Text>
            ) : (
              cumplimientos.map((i) => <AuditCard key={i.id} item={i} good />)
            )}
            <Pressable accessibilityRole="button" onPress={() => openForm('cumplimiento')} style={[styles.addBtn, styles.addBtnGood]}>
              <Ionicons name="add" size={16} color={colors.success} />
              <Text style={[styles.addBtnTxt, { color: colors.success }]}>Agregar</Text>
            </Pressable>
          </View>

          {/* === Columna: Incumplimientos / Observaciones === */}
          <View style={styles.column}>
            <View style={[styles.columnHeader, styles.columnHeaderBad]}>
              <Ionicons name="close-circle" size={18} color={colors.error} />
              <Text style={[styles.columnTitle, { color: colors.error }]}>Incumplimientos / Observaciones</Text>
            </View>
            {incumplimientos.length === 0 ? (
              <Text style={styles.emptyTxt}>Sin registros.</Text>
            ) : (
              incumplimientos.map((i) => <AuditCard key={i.id} item={i} good={false} />)
            )}
            <Pressable accessibilityRole="button" onPress={() => openForm('incumplimiento')} style={[styles.addBtn, styles.addBtnBad]}>
              <Ionicons name="add" size={16} color={colors.error} />
              <Text style={[styles.addBtnTxt, { color: colors.error }]}>Agregar</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {tipoDraft === 'cumplimiento' ? 'Nuevo cumplimiento' : 'Nuevo incumplimiento / observación'}
            </Text>

            <Text style={styles.fieldLabel}>Descripción</Text>
            <TextInput
              value={descripcionDraft}
              onChangeText={setDescripcionDraft}
              placeholder="Describe el hallazgo de la auditoría..."
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              multiline
            />

            <Text style={styles.fieldLabel}>Notas (opcional)</Text>
            <TextInput
              value={notasDraft}
              onChangeText={setNotasDraft}
              placeholder="Observaciones adicionales..."
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              multiline
            />

            <JerarquiaInformePicker value={jerarquiaDraft} onChange={setJerarquiaDraft} />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setFormOpen(false)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={onSave} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function AuditCard({ item, good }: { item: AmbientalAuditoriaItem; good: boolean }) {
  return (
    <View style={[styles.auditCard, good ? styles.auditCardGood : styles.auditCardBad]}>
      <Text style={styles.auditDesc}>{item.descripcion}</Text>
      {!!item.notas && <Text style={styles.auditNotas}>{item.notas}</Text>}
      <Text style={styles.auditSub}>{item.fecha} · {item.captured_by_name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.md },
  columnsRow: { flexDirection: 'row', gap: spacing.sm },
  column: { flex: 1, gap: spacing.xs },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.sm, borderRadius: radius.md, marginBottom: spacing.xs },
  columnHeaderGood: { backgroundColor: colors.successBg },
  columnHeaderBad: { backgroundColor: colors.errorBg },
  columnTitle: { fontSize: 12, fontWeight: '800', flexShrink: 1 },
  emptyTxt: { color: colors.textMuted, fontSize: 12, paddingVertical: spacing.sm },
  auditCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, padding: spacing.sm,
    marginBottom: spacing.xs, ...shadow.card,
  },
  auditCardGood: { borderColor: colors.success },
  auditCardBad: { borderColor: colors.error },
  auditDesc: { fontSize: 12, color: colors.text, fontWeight: '600' },
  auditNotas: { fontSize: 11, color: colors.textBody, marginTop: 4 },
  auditSub: { fontSize: 10, color: colors.textMuted, marginTop: 4 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', marginTop: 2,
  },
  addBtnGood: { borderColor: colors.success },
  addBtnBad: { borderColor: colors.error },
  addBtnTxt: { fontSize: 12, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
