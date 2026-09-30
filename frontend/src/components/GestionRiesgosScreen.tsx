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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, RiesgoRegistro, Project } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { a11y, t } from '@/src/i18n';

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

  // Modal de edición de % avance (fila existente)
  const [editing, setEditing] = useState<RiesgoRegistro | null>(null);
  const [avanceDraft, setAvanceDraft] = useState('0');
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
      Alert.alert(t('gestionRiesgos.error'), e?.message || t('gestionRiesgos.noSeCargo'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

  function openForm() {
    setEstacionDraft('');
    setDescripcionDraft('');
    setPropuestaDraft('');
    setFormOpen(true);
  }

  async function onSave() {
    const descripcion = descripcionDraft.trim();
    const propuesta = propuestaDraft.trim();
    if (!descripcion) {
      Alert.alert(t('gestionRiesgos.faltaInformacion'), t('gestionRiesgos.faltaRiesgo'));
      return;
    }
    if (!propuesta) {
      Alert.alert(t('gestionRiesgos.faltaInformacion'), t('gestionRiesgos.faltaControl'));
      return;
    }
    try {
      setSaving(true);
      await api.createRiesgoRegistro(projectId, {
        estacion_nombre: estacionDraft.trim() || null,
        descripcion_riesgo: descripcion,
        propuesta_control: propuesta,
        porcentaje_avance: 0,
      });
      setFormOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert(t('gestionRiesgos.noSeGuardo'), e?.message || t('gestionRiesgos.reintentar'));
    } finally {
      setSaving(false);
    }
  }

  function openEditAvance(r: RiesgoRegistro) {
    setEditing(r);
    setAvanceDraft(String(r.porcentaje_avance));
  }

  async function onSaveAvance() {
    if (!editing) return;
    const pct = parseInt(avanceDraft, 10);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      Alert.alert(t('gestionRiesgos.valorInvalido'), t('gestionRiesgos.avanceRango'));
      return;
    }
    try {
      setSavingAvance(true);
      await api.updateRiesgoRegistro(projectId, editing.id, { porcentaje_avance: pct });
      setEditing(null);
      await load();
    } catch (e: any) {
      Alert.alert(t('gestionRiesgos.noSeGuardo'), e?.message || t('gestionRiesgos.reintentar'));
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
      <ScreenHeader title={t('gestionRiesgos.titulo')} backgroundColor={headerColor} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.helpTxt}>{t('gestionRiesgos.ayuda')}</Text>

        {registros.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="warning-outline" size={22} color={colors.textMuted} />
            <Text style={styles.emptyTxt}>{t('gestionRiesgos.vacio')}</Text>
          </View>
        ) : (
          registros.map((r) => (
            <View key={r.id} style={styles.riskCard}>
              <View style={styles.riskHeaderRow}>
                <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                <Text style={styles.riskEstacion} numberOfLines={1}>{r.estacion_nombre || t('gestionRiesgos.sinUbicacion')}</Text>
              </View>

              <Text style={styles.fieldLabelSmall}>{t('gestionRiesgos.descripcionRiesgo')}</Text>
              <Text style={styles.riskTxt}>{r.descripcion_riesgo}</Text>

              <Text style={styles.fieldLabelSmall}>{t('gestionRiesgos.propuestaControl')}</Text>
              <Text style={styles.riskTxt}>{r.propuesta_control}</Text>

              <Pressable accessibilityRole="button" onPress={() => openEditAvance(r)} style={styles.avanceRow}>
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

      <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} hitSlop={8} style={styles.fab} onPress={openForm}>
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>

      {/* Modal: nuevo riesgo */}
      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('gestionRiesgos.registrarRiesgo')}</Text>

            <Text style={styles.fieldLabel}>{t('gestionRiesgos.ubicacionEtiqueta')}</Text>
            <TextInput
              value={estacionDraft}
              onChangeText={setEstacionDraft}
              placeholder={t('gestionRiesgos.ubicacionEjemplo')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>{t('gestionRiesgos.descripcionRiesgo')}</Text>
            <TextInput
              value={descripcionDraft}
              onChangeText={setDescripcionDraft}
              placeholder={t('gestionRiesgos.descripcionEjemplo')}
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline
            />

            <Text style={styles.fieldLabel}>{t('gestionRiesgos.propuestaControl')}</Text>
            <TextInput
              value={propuestaDraft}
              onChangeText={setPropuestaDraft}
              placeholder={t('gestionRiesgos.controlEjemplo')}
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline
            />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={t('gestionRiesgos.cancelar')} variant="secondary" onPress={() => setFormOpen(false)} style={{ flex: 1 }} />
              <Button label={t('gestionRiesgos.guardar')} loading={saving} onPress={onSave} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: editar % avance */}
      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('gestionRiesgos.actualizarAvance')}</Text>
            <Text style={styles.riskTxt} numberOfLines={2}>{editing?.descripcion_riesgo}</Text>

            <Text style={styles.fieldLabel}>{t('gestionRiesgos.porcentajeAvance')}</Text>
            <TextInput
              value={avanceDraft}
              onChangeText={setAvanceDraft}
              keyboardType="number-pad"
              style={styles.input}
            />
            <View style={styles.atajosRow}>
              {AVANCE_ATAJOS.map((v) => (
                <Pressable accessibilityRole="button" key={v} onPress={() => setAvanceDraft(String(v))} style={styles.atajoBtn}>
                  <Text style={styles.atajoTxt}>{v}%</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={t('gestionRiesgos.cancelar')} variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
              <Button label={t('gestionRiesgos.guardar')} loading={savingAvance} onPress={onSaveAvance} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
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
  atajosRow: { flexDirection: 'row', gap: 8, marginTop: spacing.sm },
  atajoBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  atajoTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
});
