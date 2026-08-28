// Módulo piloto "Seguridad e Higiene" (sistema Multi-Proyecto Modular).
// Dos secciones: ficha de reporte de accidentes (foto, descripción, acciones
// tomadas) y checklist de acciones preventivas/correctivas. Screen "dueña"
// de su propio header — mismo patrón que CatalogoConceptosScreen.tsx.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, SeguridadReporte, SeguridadChecklist, SeguridadChecklistItem, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';

type Tab = 'reportes' | 'checklist';
type Severidad = 'leve' | 'moderado' | 'grave';
const SEVERIDADES: { value: Severidad; label: string; color: string }[] = [
  { value: 'leve', label: 'Leve', color: colors.success },
  { value: 'moderado', label: 'Moderado', color: colors.warning },
  { value: 'grave', label: 'Grave', color: colors.error },
];

export default function SeguridadHigieneScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('reportes');
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [reportes, setReportes] = useState<SeguridadReporte[]>([]);
  const [checklists, setChecklists] = useState<SeguridadChecklist[]>([]);

  // === Reporte de accidente ===
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [descripcionDraft, setDescripcionDraft] = useState('');
  const [accionesDraft, setAccionesDraft] = useState('');
  const [severidadDraft, setSeveridadDraft] = useState<Severidad>('leve');
  const [fotoDraft, setFotoDraft] = useState<string | null>(null);

  // === Checklist ===
  const [checklistDraft, setChecklistDraft] = useState<SeguridadChecklistItem[]>([]);
  const [itemDraft, setItemDraft] = useState('');
  const [tipoItemDraft, setTipoItemDraft] = useState<'preventiva' | 'correctiva'>('preventiva');
  const [checklistSaving, setChecklistSaving] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, reps, checks] = await Promise.all([
        api.getProject(projectId),
        api.listSeguridadReportes(projectId),
        api.listSeguridadChecklist(projectId),
      ]);
      setProject(proj);
      setReportes(reps);
      setChecklists(checks);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el módulo Seguridad e Higiene.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  function openForm() {
    setDescripcionDraft('');
    setAccionesDraft('');
    setSeveridadDraft('leve');
    setFotoDraft(null);
    setFormOpen(true);
  }

  async function onPickFoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permiso requerido', 'Habilita el acceso a fotos para adjuntar evidencia.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.5,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];
    const mime = asset.mimeType || 'image/jpeg';
    setFotoDraft(`data:${mime};base64,${asset.base64}`);
  }

  async function onSaveReporte() {
    if (!descripcionDraft.trim()) {
      Alert.alert('Descripción requerida', 'Describe brevemente el incidente.');
      return;
    }
    try {
      setSaving(true);
      await api.createSeguridadReporte(projectId, {
        descripcion: descripcionDraft.trim(),
        acciones_tomadas: accionesDraft.trim() || null,
        severidad: severidadDraft,
        images: fotoDraft ? [fotoDraft] : [],
      });
      setFormOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  function addChecklistItem() {
    const t = itemDraft.trim();
    if (!t) return;
    setChecklistDraft((arr) => [...arr, { item: t, tipo: tipoItemDraft, cumplido: false, notas: null }]);
    setItemDraft('');
  }

  function toggleChecklistItem(idx: number) {
    setChecklistDraft((arr) => arr.map((it, i) => (i === idx ? { ...it, cumplido: !it.cumplido } : it)));
  }

  function removeChecklistItem(idx: number) {
    setChecklistDraft((arr) => arr.filter((_, i) => i !== idx));
  }

  async function onSaveChecklist() {
    if (checklistDraft.length === 0) {
      Alert.alert('Checklist vacío', 'Agrega al menos un elemento antes de guardar.');
      return;
    }
    try {
      setChecklistSaving(true);
      await api.createSeguridadChecklist(projectId, { items: checklistDraft });
      setChecklistDraft([]);
      await load();
      Alert.alert('Guardado', 'El checklist del día se guardó correctamente.');
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setChecklistSaving(false);
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
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Seguridad e Higiene</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.tabRow}>
          <Pressable onPress={() => setTab('reportes')} style={[styles.tabBtn, tab === 'reportes' && styles.tabBtnActive]}>
            <Text style={[styles.tabTxt, { color: tab === 'reportes' ? headerColor : headerTextColor }]}>Reportes</Text>
          </Pressable>
          <Pressable onPress={() => setTab('checklist')} style={[styles.tabBtn, tab === 'checklist' && styles.tabBtnActive]}>
            <Text style={[styles.tabTxt, { color: tab === 'checklist' ? headerColor : headerTextColor }]}>Checklist</Text>
          </Pressable>
        </View>
      </View>

      {tab === 'reportes' ? (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.card}>
            {reportes.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="shield-checkmark-outline" size={22} color={colors.textMuted} />
                <Text style={styles.emptyTxt}>Aún no hay reportes de accidentes.</Text>
              </View>
            ) : (
              reportes.map((r, idx) => {
                const sev = SEVERIDADES.find((s) => s.value === r.severidad) || SEVERIDADES[0];
                const foto = r.images?.[0];
                return (
                  <View key={r.id} style={[styles.repRow, idx > 0 && styles.rowBorder]}>
                    {foto ? (
                      <Image source={{ uri: foto }} style={styles.repThumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.repThumb, styles.repThumbPlaceholder]}>
                        <Ionicons name="image-outline" size={20} color={colors.textMuted} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={styles.repHeaderRow}>
                        <View style={[styles.badge, { backgroundColor: sev.color + '22' }]}>
                          <Text style={[styles.badgeTxt, { color: sev.color }]}>{sev.label}</Text>
                        </View>
                        <Text style={styles.repDate}>{r.fecha}</Text>
                      </View>
                      <Text style={styles.repDesc} numberOfLines={3}>{r.descripcion}</Text>
                      {!!r.acciones_tomadas && (
                        <Text style={styles.repAcciones} numberOfLines={2}>Acciones: {r.acciones_tomadas}</Text>
                      )}
                      <Text style={styles.repAutor}>{r.captured_by_name}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.sectionTitle}>Checklist de hoy</Text>
          <View style={styles.card}>
            {checklistDraft.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTxt}>Agrega elementos preventivos o correctivos.</Text>
              </View>
            ) : (
              checklistDraft.map((it, idx) => (
                <View key={idx} style={[styles.checkRow, idx > 0 && styles.rowBorder]}>
                  <Switch
                    value={it.cumplido}
                    onValueChange={() => toggleChecklistItem(idx)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.checkTxt, it.cumplido && styles.checkTxtDone]}>{it.item}</Text>
                    <Text style={styles.checkTipo}>{it.tipo === 'preventiva' ? 'Preventiva' : 'Correctiva'}</Text>
                  </View>
                  <Pressable hitSlop={8} onPress={() => removeChecklistItem(idx)}>
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))
            )}
          </View>

          <View style={styles.addItemRow}>
            <Pressable
              onPress={() => setTipoItemDraft(tipoItemDraft === 'preventiva' ? 'correctiva' : 'preventiva')}
              style={styles.tipoToggle}
            >
              <Text style={styles.tipoToggleTxt}>{tipoItemDraft === 'preventiva' ? 'Preventiva' : 'Correctiva'}</Text>
              <Ionicons name="swap-horizontal-outline" size={14} color={colors.primary} />
            </Pressable>
            <TextInput
              value={itemDraft}
              onChangeText={setItemDraft}
              placeholder="Nueva acción..."
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { flex: 1 }]}
              onSubmitEditing={addChecklistItem}
            />
            <Pressable style={styles.addBtn} onPress={addChecklistItem}>
              <Ionicons name="add" size={20} color="#fff" />
            </Pressable>
          </View>

          <Button
            label="Guardar checklist del día"
            loading={checklistSaving}
            onPress={onSaveChecklist}
            style={{ marginTop: spacing.md }}
          />

          {checklists.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Checklists anteriores</Text>
              <View style={styles.card}>
                {checklists.slice(0, 10).map((c, idx) => (
                  <View key={c.id} style={[styles.repRow, idx > 0 && styles.rowBorder]}>
                    <Ionicons name="checkbox-outline" size={18} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.repDesc}>{c.fecha} · {c.items.length} elemento(s)</Text>
                      <Text style={styles.repAutor}>{c.captured_by_name}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}

      {tab === 'reportes' && (
        <Pressable style={styles.fab} onPress={openForm}>
          <Ionicons name="add" size={26} color="#fff" />
        </Pressable>
      )}

      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <ScrollView style={styles.modalCard} contentContainerStyle={{ paddingBottom: spacing.lg }}>
            <Text style={styles.modalTitle}>Reportar accidente</Text>

            <Text style={styles.fieldLabel}>Severidad</Text>
            <View style={styles.segmentRow}>
              {SEVERIDADES.map((s) => (
                <Pressable
                  key={s.value}
                  onPress={() => setSeveridadDraft(s.value)}
                  style={[styles.segmentBtn, severidadDraft === s.value && { backgroundColor: s.color, borderColor: s.color }]}
                >
                  <Text style={[styles.segmentTxt, severidadDraft === s.value && styles.segmentTxtActive]}>{s.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Descripción</Text>
            <TextInput
              value={descripcionDraft}
              onChangeText={setDescripcionDraft}
              placeholder="¿Qué sucedió?"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline
            />

            <Text style={styles.fieldLabel}>Acciones tomadas (opcional)</Text>
            <TextInput
              value={accionesDraft}
              onChangeText={setAccionesDraft}
              placeholder="¿Qué se hizo al respecto?"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              multiline
            />

            <Text style={styles.fieldLabel}>Foto (opcional)</Text>
            <Pressable style={styles.fotoPicker} onPress={onPickFoto}>
              {fotoDraft ? (
                <Image source={{ uri: fotoDraft }} style={styles.fotoPreview} contentFit="cover" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={22} color={colors.textMuted} />
                  <Text style={styles.fotoPickerTxt}>Adjuntar foto</Text>
                </>
              )}
            </Pressable>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setFormOpen(false)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={onSaveReporte} style={{ flex: 1 }} />
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
  tabRow: { flexDirection: 'row', gap: 8, marginTop: spacing.sm },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  tabBtnActive: { backgroundColor: '#fff' },
  tabTxt: { fontSize: 13, fontWeight: '700' },
  scroll: { padding: spacing.md },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.md },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  repRow: { flexDirection: 'row', gap: 10, padding: spacing.md },
  repThumb: { width: 48, height: 48, borderRadius: radius.sm },
  repThumbPlaceholder: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  repHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  badgeTxt: { fontSize: 11, fontWeight: '800' },
  repDate: { fontSize: 11, color: colors.textMuted },
  repDesc: { fontSize: 13, color: colors.text, fontWeight: '600' },
  repAcciones: { fontSize: 12, color: colors.textBody, marginTop: 2 },
  repAutor: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md },
  checkTxt: { fontSize: 13, fontWeight: '600', color: colors.text },
  checkTxtDone: { textDecorationLine: 'line-through', color: colors.textMuted },
  checkTipo: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  addItemRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  tipoToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tipoToggleTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  addBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadow.lg,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '85%' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  segmentTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  segmentTxtActive: { color: '#fff' },
  fotoPicker: {
    height: 120, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, overflow: 'hidden', gap: 6,
  },
  fotoPickerTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  fotoPreview: { width: '100%', height: '100%' },
});
