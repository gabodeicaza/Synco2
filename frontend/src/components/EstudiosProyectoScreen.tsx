// Módulo piloto "Estudios y Proyecto Ejecutivo" (sistema Multi-Proyecto
// Modular). Panel superior: barras horizontales de avance por actividad
// general (SIGG, Trabajo de campo, Anexos... — libres, no un catálogo
// fijo). Panel inferior: bitácora de viñetas por disciplina (Mecánica de
// Suelos, Topografía, Hidrológico, Instalaciones). Screen "dueña" de su
// propio header — igual patrón que ForestalArboladoScreen.tsx.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  api, EstudioActividad, EstudioBitacoraEntry, EstudioDisciplina, ESTUDIO_DISCIPLINA_LABEL, Project,
} from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { ScreenHeader } from '@/src/components/ScreenHeader';

const DISCIPLINAS: EstudioDisciplina[] = ['mecanica_suelos', 'topografia', 'hidrologico', 'instalaciones'];

export default function EstudiosProyectoScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [actividades, setActividades] = useState<EstudioActividad[]>([]);
  const [bitacora, setBitacora] = useState<EstudioBitacoraEntry[]>([]);
  const [disciplinaTab, setDisciplinaTab] = useState<EstudioDisciplina>('mecanica_suelos');

  // Modal: nueva actividad
  const [actFormOpen, setActFormOpen] = useState(false);
  const [actNombreDraft, setActNombreDraft] = useState('');
  const [savingAct, setSavingAct] = useState(false);

  // Modal: editar % avance de actividad
  const [editingAct, setEditingAct] = useState<EstudioActividad | null>(null);
  const [avanceDraft, setAvanceDraft] = useState('0');
  const [savingAvance, setSavingAvance] = useState(false);

  // Modal: nueva entrada de bitácora
  const [bitFormOpen, setBitFormOpen] = useState(false);
  const [bitTextoDraft, setBitTextoDraft] = useState('');
  const [savingBit, setSavingBit] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, acts, bit] = await Promise.all([
        api.getProject(projectId),
        api.listEstudiosActividades(projectId),
        api.listEstudiosBitacora(projectId),
      ]);
      setProject(proj);
      setActividades(acts);
      setBitacora(bit);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el módulo Estudios y Proyecto Ejecutivo.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

  const bitacoraFiltrada = useMemo(
    () => bitacora.filter((b) => b.disciplina === disciplinaTab),
    [bitacora, disciplinaTab],
  );

  async function onSaveActividad() {
    const nombre = actNombreDraft.trim();
    if (!nombre) {
      Alert.alert('Falta información', 'Indica el nombre de la actividad.');
      return;
    }
    try {
      setSavingAct(true);
      await api.createEstudioActividad(projectId, { nombre, porcentaje_avance: 0 });
      setActFormOpen(false);
      setActNombreDraft('');
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSavingAct(false);
    }
  }

  function openEditAvance(a: EstudioActividad) {
    setEditingAct(a);
    setAvanceDraft(String(a.porcentaje_avance));
  }

  async function onSaveAvance() {
    if (!editingAct) return;
    const pct = parseInt(avanceDraft, 10);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      Alert.alert('Valor inválido', 'El avance debe ser un número entre 0 y 100.');
      return;
    }
    try {
      setSavingAvance(true);
      await api.updateEstudioActividad(projectId, editingAct.id, { porcentaje_avance: pct });
      setEditingAct(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSavingAvance(false);
    }
  }

  async function onSaveBitacora() {
    const texto = bitTextoDraft.trim();
    if (!texto) {
      Alert.alert('Falta información', 'Escribe la nota de bitácora.');
      return;
    }
    try {
      setSavingBit(true);
      await api.createEstudioBitacora(projectId, { disciplina: disciplinaTab, texto });
      setBitFormOpen(false);
      setBitTextoDraft('');
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSavingBit(false);
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
      <ScreenHeader title="Estudios y Proyecto Ejecutivo" backgroundColor={headerColor} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        {/* === Panel superior: avance por actividad === */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Avance de actividades</Text>
          <Pressable accessibilityRole="button" onPress={() => setActFormOpen(true)} style={styles.addBtn}>
            <Ionicons name="add" size={16} color={colors.primary} />
            <Text style={styles.addBtnTxt}>Agregar</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          {actividades.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="bar-chart-outline" size={22} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>Aún no hay actividades registradas.</Text>
            </View>
          ) : (
            actividades.map((a, idx) => (
              <Pressable accessibilityRole="button"
                key={a.id}
                onPress={() => openEditAvance(a)}
                style={[styles.actRow, idx > 0 && styles.rowBorder]}
              >
                <Text style={styles.actNombre} numberOfLines={1}>{a.nombre}</Text>
                <View style={styles.avanceBarTrack}>
                  <View style={[styles.avanceBarFill, { width: `${a.porcentaje_avance}%` }]} />
                </View>
                <Text style={styles.avancePct}>{a.porcentaje_avance}%</Text>
              </Pressable>
            ))
          )}
        </View>

        {/* === Panel inferior: bitácora por disciplina === */}
        <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Bitácora por disciplina</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
          <View style={styles.tabsRow}>
            {DISCIPLINAS.map((d) => (
              <Pressable accessibilityRole="button"
                key={d}
                onPress={() => setDisciplinaTab(d)}
                style={[styles.tabBtn, disciplinaTab === d && styles.tabBtnActive]}
              >
                <Text style={[styles.tabTxt, disciplinaTab === d && styles.tabTxtActive]}>
                  {ESTUDIO_DISCIPLINA_LABEL[d]}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.bitacoraCount}>{bitacoraFiltrada.length} nota{bitacoraFiltrada.length === 1 ? '' : 's'}</Text>
          <Pressable accessibilityRole="button" onPress={() => setBitFormOpen(true)} style={styles.addBtn}>
            <Ionicons name="add" size={16} color={colors.primary} />
            <Text style={styles.addBtnTxt}>Agregar nota</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          {bitacoraFiltrada.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTxt}>Sin notas de {ESTUDIO_DISCIPLINA_LABEL[disciplinaTab]}.</Text>
            </View>
          ) : (
            bitacoraFiltrada.map((b, idx) => (
              <View key={b.id} style={[styles.bitRow, idx > 0 && styles.rowBorder]}>
                <Ionicons name="ellipse" size={6} color={colors.primary} style={{ marginTop: 6 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bitTxt}>{b.texto}</Text>
                  <Text style={styles.bitSub}>{b.fecha} · {b.captured_by_name}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Modal: nueva actividad */}
      <Modal visible={actFormOpen} transparent animationType="slide" onRequestClose={() => setActFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nueva actividad</Text>
            <Text style={styles.fieldLabel}>Nombre</Text>
            <TextInput
              value={actNombreDraft}
              onChangeText={setActNombreDraft}
              placeholder="Ej. SIGG, Trabajo de campo, Anexos..."
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setActFormOpen(false)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={savingAct} onPress={onSaveActividad} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: editar % avance de actividad */}
      <Modal visible={!!editingAct} transparent animationType="fade" onRequestClose={() => setEditingAct(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingAct?.nombre}</Text>
            <Text style={styles.fieldLabel}>% de avance</Text>
            <TextInput
              value={avanceDraft}
              onChangeText={setAvanceDraft}
              keyboardType="number-pad"
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setEditingAct(null)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={savingAvance} onPress={onSaveAvance} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: nueva nota de bitácora */}
      <Modal visible={bitFormOpen} transparent animationType="slide" onRequestClose={() => setBitFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nueva nota · {ESTUDIO_DISCIPLINA_LABEL[disciplinaTab]}</Text>
            <Text style={styles.fieldLabel}>Nota de bitácora</Text>
            <TextInput
              value={bitTextoDraft}
              onChangeText={setBitTextoDraft}
              placeholder="Describe la actividad realizada, hallazgo u observación..."
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setBitFormOpen(false)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={savingBit} onPress={onSaveBitacora} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.md },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13 },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  actNombre: { fontSize: 13, fontWeight: '700', color: colors.text, width: 110 },
  avanceBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: 'hidden' },
  avanceBarFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  avancePct: { fontSize: 12, fontWeight: '800', color: colors.text, minWidth: 36, textAlign: 'right' },
  tabsRow: { flexDirection: 'row', gap: 8 },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  tabTxtActive: { color: '#fff' },
  bitacoraCount: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  bitRow: { flexDirection: 'row', gap: 10, padding: spacing.md },
  bitTxt: { fontSize: 13, color: colors.textBody },
  bitSub: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
