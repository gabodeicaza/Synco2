// Módulo piloto "Forestal y Arbolado" (sistema Multi-Proyecto Modular).
// Dashboard con tabla resumen por estación (podas/trasplantes/derribos) y
// contadores de ejecución, más un formulario simple para registrar un nuevo
// evento. Screen "dueña" de su propio header — igual patrón que
// CatalogoConceptosScreen.tsx — para que las 3 rutas (coord/subcoord/spec)
// sean re-exports finos que solo resuelven `projectId`.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ForestalRegistro, ForestalResumen, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';

type TipoForestal = 'poda' | 'trasplante' | 'derribo';
const TIPOS: { value: TipoForestal; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'poda', label: 'Poda', icon: 'cut-outline' },
  { value: 'trasplante', label: 'Trasplante', icon: 'move-outline' },
  { value: 'derribo', label: 'Derribo', icon: 'trail-sign-outline' },
];

export default function ForestalArboladoScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [resumen, setResumen] = useState<ForestalResumen | null>(null);
  const [registros, setRegistros] = useState<ForestalRegistro[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tipoDraft, setTipoDraft] = useState<TipoForestal>('poda');
  const [estacionDraft, setEstacionDraft] = useState('');
  const [cantidadDraft, setCantidadDraft] = useState('1');
  const [notasDraft, setNotasDraft] = useState('');

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, res, list] = await Promise.all([
        api.getProject(projectId),
        api.forestalResumen(projectId),
        api.listForestalRegistros(projectId),
      ]);
      setProject(proj);
      setResumen(res);
      setRegistros(list);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el módulo Forestal y Arbolado.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  function openForm() {
    setTipoDraft('poda');
    setEstacionDraft('');
    setCantidadDraft('1');
    setNotasDraft('');
    setFormOpen(true);
  }

  async function onSave() {
    const cantidad = parseInt(cantidadDraft, 10);
    if (!cantidad || cantidad < 1) {
      Alert.alert('Cantidad inválida', 'Ingresa un número entero mayor o igual a 1.');
      return;
    }
    try {
      setSaving(true);
      await api.createForestalRegistro(projectId, {
        tipo: tipoDraft,
        estacion_nombre: estacionDraft.trim() || null,
        cantidad,
        notas: notasDraft.trim() || null,
      });
      setFormOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
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

  const contadores = resumen?.contadores || { poda: 0, trasplante: 0, derribo: 0 };
  const tabla = resumen?.tabla || [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Forestal y Arbolado</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.statsRow}>
          {TIPOS.map((t) => (
            <View key={t.value} style={styles.statCard}>
              <Ionicons name={t.icon} size={20} color={colors.primary} />
              <Text style={styles.statValue}>{contadores[t.value] || 0}</Text>
              <Text style={styles.statLabel}>{t.label}s</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Resumen por estación</Text>
        <View style={styles.card}>
          {tabla.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="leaf-outline" size={22} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>Aún no hay registros forestales.</Text>
            </View>
          ) : (
            <>
              <View style={[styles.tableRow, styles.tableHeaderRow]}>
                <Text style={[styles.tableCell, styles.tableHeaderTxt, { flex: 2 }]}>Estación</Text>
                <Text style={[styles.tableCell, styles.tableHeaderTxt]}>Podas</Text>
                <Text style={[styles.tableCell, styles.tableHeaderTxt]}>Trasp.</Text>
                <Text style={[styles.tableCell, styles.tableHeaderTxt]}>Derr.</Text>
              </View>
              {tabla.map((row) => (
                <View key={row.estacion} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2, fontWeight: '600' }]} numberOfLines={1}>{row.estacion}</Text>
                  <Text style={styles.tableCell}>{row.poda}</Text>
                  <Text style={styles.tableCell}>{row.trasplante}</Text>
                  <Text style={styles.tableCell}>{row.derribo}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>Últimos registros</Text>
        <View style={styles.card}>
          {registros.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTxt}>Sin actividad reciente.</Text>
            </View>
          ) : (
            registros.slice(0, 20).map((r, idx) => (
              <View key={r.id} style={[styles.regRow, idx > 0 && styles.rowBorder]}>
                <Ionicons name={TIPOS.find((t) => t.value === r.tipo)?.icon || 'leaf-outline'} size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.regTitle}>
                    {TIPOS.find((t) => t.value === r.tipo)?.label} · {r.cantidad} · {r.estacion_nombre || 'Sin estación'}
                  </Text>
                  <Text style={styles.regSub}>{r.fecha} · {r.captured_by_name}</Text>
                  {!!r.notas && <Text style={styles.regNotas} numberOfLines={2}>{r.notas}</Text>}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Pressable style={styles.fab} onPress={openForm}>
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>

      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Registrar evento forestal</Text>

            <Text style={styles.fieldLabel}>Tipo</Text>
            <View style={styles.segmentRow}>
              {TIPOS.map((t) => (
                <Pressable
                  key={t.value}
                  onPress={() => setTipoDraft(t.value)}
                  style={[styles.segmentBtn, tipoDraft === t.value && styles.segmentBtnActive]}
                >
                  <Ionicons name={t.icon} size={16} color={tipoDraft === t.value ? '#fff' : colors.text} />
                  <Text style={[styles.segmentTxt, tipoDraft === t.value && styles.segmentTxtActive]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Estación / ubicación</Text>
            <TextInput
              value={estacionDraft}
              onChangeText={setEstacionDraft}
              placeholder="Ej. Estación 5+200"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Cantidad</Text>
            <TextInput
              value={cantidadDraft}
              onChangeText={setCantidadDraft}
              keyboardType="number-pad"
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Notas (opcional)</Text>
            <TextInput
              value={notasDraft}
              onChangeText={setNotasDraft}
              placeholder="Observaciones..."
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline
            />

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

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleBar: { fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  scroll: { padding: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCard: {
    flex: 1, alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, ...shadow.card,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs, marginTop: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.md },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13 },
  tableRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: spacing.md },
  tableHeaderRow: { borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHeaderTxt: { fontWeight: '800', color: colors.textMuted, fontSize: 12 },
  tableCell: { flex: 1, fontSize: 13, color: colors.text },
  regRow: { flexDirection: 'row', gap: 10, padding: spacing.md, alignItems: 'flex-start' },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  regTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  regSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  regNotas: { fontSize: 12, color: colors.textBody, marginTop: 4 },
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
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  segmentBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  segmentTxtActive: { color: '#fff' },
});
