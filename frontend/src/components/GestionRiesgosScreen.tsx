// Módulo piloto "Gestión de Riesgos" (sistema Multi-Proyecto Modular).
// Matriz interactiva: Estación/Poste, Descripción del Riesgo, Propuesta de
// Control y % de Avance — a diferencia de Forestal/Seguridad (eventos
// discretos), aquí las filas persisten y su % de avance se actualiza in
// situ (PATCH) según se ejecuta la propuesta de control. Screen "dueña" de
// su propio header — igual patrón que ForestalArboladoScreen.tsx — para que
// las 3 rutas (coord/subcoord/spec) sean re-exports finos.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, RiesgoRegistro, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';

const AVANCE_ATAJOS = [0, 25, 50, 75, 100];

function avanceColor(pct: number): string {
  if (pct >= 100) return colors.success;
  if (pct >= 50) return colors.primary;
  return colors.warning;
}

export default function GestionRiesgosScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [registros, setRegistros] = useState<RiesgoRegistro[]>([]);

  // Modal de nuevo riesgo
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [estacionDraft, setEstacionDraft] = useState('');
  const [descripcionDraft, setDescripcionDraft] = useState('');
  const [propuestaDraft, setPropuestaDraft] = useState('');
  const [numerarDraft, setNumerarDraft] = useState(true);

  // Modal de edición de una fila existente (texto, % de avance y numeración)
  const [editing, setEditing] = useState<RiesgoRegistro | null>(null);
  const [avanceDraft, setAvanceDraft] = useState('0');
  const [estacionEdit, setEstacionEdit] = useState('');
  const [descripcionEdit, setDescripcionEdit] = useState('');
  const [propuestaEdit, setPropuestaEdit] = useState('');
  const [numerarEdit, setNumerarEdit] = useState(true);
  const [savingAvance, setSavingAvance] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, list] = await Promise.all([
        api.getProject(projectId),
        api.listRiesgosRegistros(projectId),
      ]);
      setProject(proj);
      setRegistros(list);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el módulo Gestión de Riesgos.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  function openForm() {
    setEstacionDraft('');
    setDescripcionDraft('');
    setPropuestaDraft('');
    setNumerarDraft(true);
    setFormOpen(true);
  }

  async function onSave() {
    const descripcion = descripcionDraft.trim();
    const propuesta = propuestaDraft.trim();
    if (!descripcion) {
      Alert.alert('Falta información', 'Describe el riesgo identificado.');
      return;
    }
    if (!propuesta) {
      Alert.alert('Falta información', 'Indica la propuesta de control.');
      return;
    }
    try {
      setSaving(true);
      await api.createRiesgoRegistro(projectId, {
        estacion_nombre: estacionDraft.trim() || null,
        descripcion_riesgo: descripcion,
        propuesta_control: propuesta,
        porcentaje_avance: 0,
        numerar: numerarDraft,
      });
      setFormOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  function openEditAvance(r: RiesgoRegistro) {
    setEditing(r);
    setAvanceDraft(String(r.porcentaje_avance));
    setEstacionEdit(r.estacion_nombre || '');
    setDescripcionEdit(r.descripcion_riesgo);
    setPropuestaEdit(r.propuesta_control);
    setNumerarEdit(r.numerar !== false);
  }

  async function onSaveAvance() {
    if (!editing) return;
    const pct = parseInt(avanceDraft, 10);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      Alert.alert('Valor inválido', 'El avance debe ser un número entre 0 y 100.');
      return;
    }
    if (!descripcionEdit.trim() || !propuestaEdit.trim()) {
      Alert.alert('Falta información', 'El riesgo y su propuesta de control no pueden quedar vacíos.');
      return;
    }
    try {
      setSavingAvance(true);
      await api.updateRiesgoRegistro(projectId, editing.id, {
        porcentaje_avance: pct,
        estacion_nombre: estacionEdit.trim() || null,
        descripcion_riesgo: descripcionEdit.trim(),
        propuesta_control: propuestaEdit.trim(),
        numerar: numerarEdit,
      });
      setEditing(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSavingAvance(false);
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
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Gestión de Riesgos</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.helpTxt}>
          Toca un riesgo para actualizar su % de avance conforme se ejecuta su propuesta de control, o para
          corregir su texto. El mapa impreso numera los riesgos de cada estación (1, 2, 3…).
        </Text>

        {registros.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="warning-outline" size={22} color={colors.textMuted} />
            <Text style={styles.emptyTxt}>Aún no hay riesgos registrados.</Text>
          </View>
        ) : (
          registros.map((r) => (
            <View key={r.id} style={styles.riskCard}>
              <View style={styles.riskHeaderRow}>
                <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                <Text style={styles.riskEstacion} numberOfLines={1}>{r.estacion_nombre || 'Sin estación/poste'}</Text>
              </View>

              <Text style={styles.fieldLabelSmall}>Descripción del riesgo</Text>
              <Text style={styles.riskTxt}>{r.descripcion_riesgo}</Text>

              <Text style={styles.fieldLabelSmall}>Propuesta de control</Text>
              <Text style={styles.riskTxt}>{r.propuesta_control}</Text>

              <Pressable onPress={() => openEditAvance(r)} style={styles.avanceRow}>
                <View style={styles.avanceBarTrack}>
                  <View style={[styles.avanceBarFill, { width: `${r.porcentaje_avance}%`, backgroundColor: avanceColor(r.porcentaje_avance) }]} />
                </View>
                <Text style={[styles.avancePct, { color: avanceColor(r.porcentaje_avance) }]}>{r.porcentaje_avance}%</Text>
                <Ionicons name="create-outline" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Pressable style={styles.fab} onPress={openForm}>
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>

      {/* Modal: nuevo riesgo */}
      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Registrar riesgo</Text>

            <Text style={styles.fieldLabel}>Estación / poste</Text>
            <TextInput
              value={estacionDraft}
              onChangeText={setEstacionDraft}
              placeholder="Ej. Poste 12, Estación 3+400"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Descripción del riesgo</Text>
            <TextInput
              value={descripcionDraft}
              onChangeText={setDescripcionDraft}
              placeholder="Ej. Talud inestable por lluvias recientes"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline
            />

            <Text style={styles.fieldLabel}>Propuesta de control</Text>
            <TextInput
              value={propuestaDraft}
              onChangeText={setPropuestaDraft}
              placeholder="Ej. Colocar malla de contención y señalización"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline
            />

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Numerar en el mapa impreso</Text>
                <Text style={styles.switchHint}>Apágalo en filas que solo citan números de otros riesgos (ej. "Poste 2. Riesgos 1 y 2").</Text>
              </View>
              <Switch value={numerarDraft} onValueChange={setNumerarDraft} />
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setFormOpen(false)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={onSave} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: editar un riesgo (avance, texto y numeración) */}
      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <ScrollView style={[styles.modalCard, { maxHeight: '92%' }]} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Editar riesgo</Text>

            <Text style={styles.fieldLabel}>Estación / poste</Text>
            <TextInput value={estacionEdit} onChangeText={setEstacionEdit} style={styles.input} placeholderTextColor={colors.textMuted} />

            <Text style={styles.fieldLabel}>Descripción del riesgo</Text>
            <TextInput
              value={descripcionEdit} onChangeText={setDescripcionEdit} multiline
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
            />

            <Text style={styles.fieldLabel}>Propuesta de control</Text>
            <TextInput
              value={propuestaEdit} onChangeText={setPropuestaEdit} multiline
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
            />

            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { flex: 1 }]}>Numerar en el mapa impreso</Text>
              <Switch value={numerarEdit} onValueChange={setNumerarEdit} />
            </View>

            <Text style={styles.fieldLabel}>% de avance</Text>
            <TextInput
              value={avanceDraft}
              onChangeText={setAvanceDraft}
              keyboardType="number-pad"
              style={styles.input}
            />
            <View style={styles.atajosRow}>
              {AVANCE_ATAJOS.map((v) => (
                <Pressable key={v} onPress={() => setAvanceDraft(String(v))} style={styles.atajoBtn}>
                  <Text style={styles.atajoTxt}>{v}%</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={savingAvance} onPress={onSaveAvance} style={{ flex: 1 }} />
            </View>
          </ScrollView>
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
  helpTxt: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.md, lineHeight: 17 },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13 },
  riskCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    ...shadow.card, padding: spacing.md, marginBottom: spacing.sm,
  },
  riskHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  riskEstacion: { fontSize: 13, fontWeight: '800', color: colors.text, flex: 1 },
  fieldLabelSmall: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: spacing.xs },
  riskTxt: { fontSize: 13, color: colors.textBody, marginTop: 2 },
  avanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.sm },
  avanceBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: 'hidden' },
  avanceBarFill: { height: 8, borderRadius: 4 },
  avancePct: { fontSize: 13, fontWeight: '800', minWidth: 40, textAlign: 'right' },
  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadow.lg,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  switchLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  switchHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  atajosRow: { flexDirection: 'row', gap: 8, marginTop: spacing.sm },
  atajoBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  atajoTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
});
