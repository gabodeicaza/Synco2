// Módulo "Estimaciones" — concentrado de estimaciones de obra y de supervisión
// con las columnas del reporte semanal. La SUMA ACUMULADA no se captura: el
// export la calcula (acumulado de obra ejecutada por número), así nunca queda
// desfasada de las filas. Crear/editar/borrar es de Coordinador y
// Sub-Coordinador (el backend aplica el mismo criterio, ver
// `create_estimacion`); el resto de roles solo consulta. Mismo patrón "un
// componente hace todo, rutas delgadas por rol" que FotosLidarScreen.tsx.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ContratoFin, Estimacion, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';

const CONTRATO_LABEL: Record<ContratoFin, string> = { obra: 'Obra', supervision: 'Supervisión' };

function fmtFecha(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function fmtMoney(v?: string | null): string {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  return Number.isFinite(n) ? `$ ${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : v;
}

type Campo = 'numero' | 'periodo_inicio' | 'periodo_fin' | 'estatus' | 'obra_ejecutada' | 'amortizacion'
  | 'pct_amortizacion_anticipo' | 'total_deducciones' | 'iva' | 'total_neto' | 'fecha_pago';
type Draft = { id: string | null; contrato: ContratoFin } & Record<Campo, string>;

const CAMPOS: { key: Campo; label: string; placeholder: string; numeric?: boolean }[] = [
  { key: 'numero', label: 'No. de estimación', placeholder: '1', numeric: true },
  { key: 'periodo_inicio', label: 'Periodo: inicio (AAAA-MM-DD)', placeholder: '2025-12-08' },
  { key: 'periodo_fin', label: 'Periodo: fin (AAAA-MM-DD)', placeholder: '2025-12-31' },
  { key: 'estatus', label: 'Estatus general', placeholder: 'LIBERADA / NO LIBERADA' },
  { key: 'obra_ejecutada', label: 'Obra ejecutada ($)', placeholder: '5978451.30', numeric: true },
  { key: 'amortizacion', label: 'Amortización ($)', placeholder: '3734140.68', numeric: true },
  { key: 'pct_amortizacion_anticipo', label: '% acumulado amortización del anticipo', placeholder: '0.22', numeric: true },
  { key: 'total_deducciones', label: 'Total deducciones ($)', placeholder: '119569.03', numeric: true },
  { key: 'iva', label: 'IVA 16% ($)', placeholder: '956552.21', numeric: true },
  { key: 'total_neto', label: 'Total neto ($)', placeholder: '2483831.29', numeric: true },
  { key: 'fecha_pago', label: 'Fecha de pago (AAAA-MM-DD o texto)', placeholder: 'Por pagar' },
];

const vacio = (contrato: ContratoFin, numero: number): Draft => ({
  id: null, contrato, numero: String(numero), periodo_inicio: '', periodo_fin: '', estatus: '', obra_ejecutada: '',
  amortizacion: '', pct_amortizacion_anticipo: '', total_deducciones: '', iva: '', total_neto: '', fecha_pago: '',
});

export default function EstimacionesScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEditar = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<Estimacion[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, list] = await Promise.all([api.getProject(projectId), api.listEstimaciones(projectId)]);
      setProject(proj);
      setItems(list);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar las estimaciones.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const porContrato = useMemo(() => (['obra', 'supervision'] as ContratoFin[]).map((c) => ({
    contrato: c, rows: items.filter((i) => (i.contrato || 'obra') === c).sort((a, b) => a.numero - b.numero),
  })), [items]);

  function nuevo(contrato: ContratoFin) {
    const rows = items.filter((i) => i.contrato === contrato);
    setDraft(vacio(contrato, rows.length ? Math.max(...rows.map((r) => r.numero)) + 1 : 1));
  }

  function editar(e: Estimacion) {
    const d = vacio(e.contrato, e.numero);
    for (const c of CAMPOS) if (c.key !== 'numero') d[c.key] = (e[c.key as keyof Estimacion] as string | null) || '';
    setDraft({ ...d, id: e.id });
  }

  async function onSave() {
    if (!draft) return;
    const numero = parseInt(draft.numero, 10);
    if (!Number.isFinite(numero) || numero < 1) {
      Alert.alert('Falta información', 'Indica el número de estimación.');
      return;
    }
    const body: Record<string, any> = { numero };
    for (const c of CAMPOS) if (c.key !== 'numero') body[c.key] = draft[c.key];
    try {
      setSaving(true);
      if (draft.id) await api.updateEstimacion(projectId, draft.id, body as any);
      else await api.createEstimacion(projectId, { ...body, contrato: draft.contrato } as any);
      setDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(e: Estimacion) {
    const ok = await confirm('Eliminar estimación', `¿Eliminar la estimación ${e.numero} de ${CONTRATO_LABEL[e.contrato].toLowerCase()}?`, {
      confirmText: 'Eliminar', destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteEstimacion(projectId, e.id);
      await load();
    } catch (err: any) {
      Alert.alert('No se pudo eliminar', err?.message || 'Intentalo nuevamente.');
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
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Estimaciones</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        {porContrato.map(({ contrato, rows }) => (
          <View key={contrato} style={{ marginBottom: spacing.lg }}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Concentrado · {CONTRATO_LABEL[contrato]}</Text>
              {puedeEditar ? (
                <Pressable onPress={() => nuevo(contrato)} style={styles.addBtn}>
                  <Ionicons name="add" size={16} color={colors.primary} />
                  <Text style={styles.addBtnTxt}>Nueva estimación</Text>
                </Pressable>
              ) : null}
            </View>
            {rows.length === 0 ? (
              <View style={[styles.card, styles.empty]}>
                <Text style={styles.emptyTxt}>Sin estimaciones de {CONTRATO_LABEL[contrato].toLowerCase()}.</Text>
              </View>
            ) : rows.map((e) => (
              <Pressable key={e.id} style={[styles.card, { padding: spacing.md }]} onPress={puedeEditar ? () => editar(e) : undefined}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Estimación {e.numero}</Text>
                  <Text style={styles.estatus}>{e.estatus || '-'}</Text>
                  {puedeEditar ? (
                    <Pressable hitSlop={8} onPress={() => onDelete(e)}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.meta}>
                  {e.periodo_inicio ? `${fmtFecha(e.periodo_inicio)} al ${fmtFecha(e.periodo_fin)}` : 'Sin periodo'}
                </Text>
                <Text style={styles.meta}>Obra ejecutada: {fmtMoney(e.obra_ejecutada)}</Text>
                <Text style={styles.meta}>Total neto: {fmtMoney(e.total_neto)} · Pago: {fmtFecha(e.fecha_pago) || '-'}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '92%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>
                {draft?.id ? 'Editar' : 'Nueva'} estimación · {draft ? CONTRATO_LABEL[draft.contrato] : ''}
              </Text>
              {CAMPOS.map((c) => (
                <View key={c.key}>
                  <Text style={styles.fieldLabel}>{c.label}</Text>
                  <TextInput
                    value={draft ? draft[c.key] : ''}
                    onChangeText={(t) => setDraft((d) => (d ? { ...d, [c.key]: t } : d))}
                    placeholder={c.placeholder}
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    keyboardType={c.numeric ? 'decimal-pad' : 'default'}
                    autoCapitalize="none"
                  />
                </View>
              ))}
              <Text style={styles.hint}>La suma acumulada se calcula sola al exportar.</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label="Cancelar" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
                <Button label="Guardar" loading={saving} onPress={onSave} style={{ flex: 1 }} />
              </View>
            </ScrollView>
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
  empty: { alignItems: 'center', padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  estatus: { fontSize: 11, fontWeight: '800', color: colors.textMuted },
  meta: { fontSize: 12, color: colors.textMuted },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: spacing.sm },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md,
    paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
