// Módulo "Forestal y Arbolado" (sistema Multi-Proyecto Modular).
// Formato calcado del reporte "TRATAMIENTO DE ARBOLADO" en Excel que usa la
// obra: tabla de renglones AUTORIZADOS por resolución administrativa
// (editable por Coordinador/Sub-Coord — dato de origen legal, no capturado
// en campo), contadores ejecutado/autorizado, tabla semanal de actividades
// ejecutadas y bitácora de últimos registros. Screen "dueña" de su propio
// header — igual patrón que CatalogoConceptosScreen.tsx — para que las 3
// rutas (coord/subcoord/spec) sean re-exports finos que solo resuelven
// `projectId`.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  api, ForestalRegistro, ForestalResumen, ForestalAutorizadoRow, ForestalSemanal, Project,
} from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';
import { a11y } from '@/src/i18n';

type TipoForestal = 'poda' | 'trasplante' | 'derribo';
const TIPOS: { value: TipoForestal; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'poda', label: 'Poda', icon: 'cut-outline' },
  { value: 'trasplante', label: 'Trasplante', icon: 'move-outline' },
  { value: 'derribo', label: 'Derribo', icon: 'trail-sign-outline' },
];

// Paleta calcada del formato Excel de referencia (no son tokens del theme
// global porque son específicos de este reporte: verde de encabezado de
// tabla, salmón de barra de sección, azul claro de subtotal).
const SHEET = {
  title: '#7A1030',
  green: '#2E7D32',
  greenBg: '#EAF4EA',
  salmon: '#F4B183',
  pink: '#F6D9E6',
  subtotal: '#DCEEFB',
};

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDaysISO(iso: string, days: number): string {
  const d = isoToLocalDate(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

function mondayOfCurrentWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0=dom .. 6=sáb
  const diff = day === 0 ? -6 : 1 - day;
  return toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff));
}

function formatDiaCorto(iso: string): string {
  const d = isoToLocalDate(iso);
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function formatRangoSemana(desde: string, hasta: string): string {
  const d1 = isoToLocalDate(desde);
  const d2 = isoToLocalDate(hasta);
  if (d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()) {
    return `DEL ${d1.getDate()} AL ${d2.getDate()} DE ${MESES[d2.getMonth()].toUpperCase()} DE ${d2.getFullYear()}`;
  }
  return `DEL ${d1.getDate()} DE ${MESES[d1.getMonth()].toUpperCase()} AL ${d2.getDate()} DE ${MESES[d2.getMonth()].toUpperCase()} DE ${d2.getFullYear()}`;
}

export default function ForestalArboladoScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const canEditAutorizado = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [resumen, setResumen] = useState<ForestalResumen | null>(null);
  const [registros, setRegistros] = useState<ForestalRegistro[]>([]);
  const [autorizado, setAutorizado] = useState<ForestalAutorizadoRow[]>([]);

  const [weekStart, setWeekStart] = useState(mondayOfCurrentWeek());
  const [semanal, setSemanal] = useState<ForestalSemanal | null>(null);
  const [semanalLoading, setSemanalLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tipoDraft, setTipoDraft] = useState<TipoForestal>('poda');
  const [estacionDraft, setEstacionDraft] = useState('');
  const [cantidadDraft, setCantidadDraft] = useState('1');
  const [notasDraft, setNotasDraft] = useState('');

  const [rowFormOpen, setRowFormOpen] = useState(false);
  const [rowSaving, setRowSaving] = useState(false);
  const [rowEditing, setRowEditing] = useState<ForestalAutorizadoRow | null>(null);
  const [rowEstacion, setRowEstacion] = useState('');
  const [rowPoda, setRowPoda] = useState('0');
  const [rowTrasplante, setRowTrasplante] = useState('0');
  const [rowDerribo, setRowDerribo] = useState('0');
  const [rowTotal, setRowTotal] = useState('0');

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, res, list, auth] = await Promise.all([
        api.getProject(projectId),
        api.forestalResumen(projectId),
        api.listForestalRegistros(projectId),
        api.listForestalAutorizado(projectId),
      ]);
      setProject(proj);
      setResumen(res);
      setRegistros(list);
      setAutorizado(auth);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el módulo Forestal y Arbolado.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const loadSemanal = useCallback(async () => {
    if (!projectId) return;
    try {
      setSemanalLoading(true);
      const data = await api.forestalSemanal(projectId, weekStart);
      setSemanal(data);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar la semana.');
    } finally {
      setSemanalLoading(false);
    }
  }, [projectId, weekStart]);

  useEffect(() => { loadSemanal(); }, [loadSemanal]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

  const contadores = resumen?.contadores || { poda: 0, trasplante: 0, derribo: 0 };
  const totalAutorizado = useMemo(() => autorizado.reduce((acc, r) => ({
    poda: acc.poda + r.poda,
    trasplante: acc.trasplante + r.trasplante,
    derribo: acc.derribo + r.derribo,
    total_dictaminados: acc.total_dictaminados + r.total_dictaminados,
  }), { poda: 0, trasplante: 0, derribo: 0, total_dictaminados: 0 }), [autorizado]);

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
      await Promise.all([load(), loadSemanal()]);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  function openRowForm(row: ForestalAutorizadoRow | null) {
    setRowEditing(row);
    setRowEstacion(row?.estacion || '');
    setRowPoda(String(row?.poda ?? 0));
    setRowTrasplante(String(row?.trasplante ?? 0));
    setRowDerribo(String(row?.derribo ?? 0));
    setRowTotal(String(row?.total_dictaminados ?? 0));
    setRowFormOpen(true);
  }

  async function onSaveRow() {
    const nombre = rowEstacion.trim();
    if (!nombre) {
      Alert.alert('Falta el nombre', 'Ingresa el nombre de la estación (o "Postes").');
      return;
    }
    const body = {
      estacion: nombre,
      poda: parseInt(rowPoda, 10) || 0,
      trasplante: parseInt(rowTrasplante, 10) || 0,
      derribo: parseInt(rowDerribo, 10) || 0,
      total_dictaminados: parseInt(rowTotal, 10) || 0,
    };
    try {
      setRowSaving(true);
      if (rowEditing) {
        await api.updateForestalAutorizado(projectId, rowEditing.id, body);
      } else {
        await api.createForestalAutorizado(projectId, { ...body, orden: autorizado.length });
      }
      setRowFormOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setRowSaving(false);
    }
  }

  function onDeleteRow() {
    if (!rowEditing) return;
    Alert.alert('Eliminar renglón', `¿Eliminar "${rowEditing.estacion}" del resumen autorizado?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive', onPress: async () => {
          try {
            setRowSaving(true);
            await api.deleteForestalAutorizado(projectId, rowEditing.id);
            setRowFormOpen(false);
            await load();
          } catch (e: any) {
            Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
          } finally {
            setRowSaving(false);
          }
        },
      },
    ]);
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
      <ScreenHeader title="Forestal y Arbolado" backgroundColor={headerColor} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.sheetTitle}>TRATAMIENTO DE ARBOLADO</Text>

        {/* --- Resumen autorizado mediante resolución administrativa --- */}
        <View style={styles.card}>
          <View style={[styles.bar, { backgroundColor: SHEET.salmon }]}>
            <Text style={styles.barTxt} numberOfLines={2}>RESUMEN ARBOLADO AUTORIZADO MEDIANTE RESOLUCIÓN ADMVA.</Text>
          </View>
          <View style={[styles.tableRow, { backgroundColor: SHEET.green }]}>
            <Text style={[styles.tableCell, styles.headTxt, { flex: 1.6 }]}>Estación</Text>
            <Text style={[styles.tableCell, styles.headTxt]}>Poda</Text>
            <Text style={[styles.tableCell, styles.headTxt]}>Trasp.</Text>
            <Text style={[styles.tableCell, styles.headTxt]}>Derr.</Text>
            <Text style={[styles.tableCell, styles.headTxt, { flex: 1.3 }]}>Total árboles</Text>
          </View>
          {autorizado.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="leaf-outline" size={22} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>Sin renglones autorizados capturados.</Text>
            </View>
          ) : (
            autorizado.map((row, idx) => (
              <Pressable accessibilityRole="button"
                key={row.id}
                onPress={() => canEditAutorizado && openRowForm(row)}
                style={[styles.tableRow, idx % 2 === 1 && { backgroundColor: SHEET.greenBg }]}
              >
                <Text style={[styles.tableCell, styles.estacionTxt, { flex: 1.6 }]} numberOfLines={1}>{row.estacion}</Text>
                <Text style={styles.tableCell}>{row.poda}</Text>
                <Text style={styles.tableCell}>{row.trasplante}</Text>
                <Text style={styles.tableCell}>{row.derribo}</Text>
                <Text style={[styles.tableCell, { flex: 1.3 }]}>{row.total_dictaminados}</Text>
              </Pressable>
            ))
          )}
          {autorizado.length > 0 && (
            <View style={[styles.tableRow, styles.totalRow]}>
              <Text style={[styles.tableCell, styles.totalTxt, { flex: 1.6 }]}>TOTAL</Text>
              <Text style={[styles.tableCell, styles.totalTxt]}>{totalAutorizado.poda}</Text>
              <Text style={[styles.tableCell, styles.totalTxt]}>{totalAutorizado.trasplante}</Text>
              <Text style={[styles.tableCell, styles.totalTxt]}>{totalAutorizado.derribo}</Text>
              <Text style={[styles.tableCell, styles.totalTxt, { flex: 1.3 }]}>{totalAutorizado.total_dictaminados}</Text>
            </View>
          )}
          {canEditAutorizado && (
            <Pressable accessibilityRole="button" style={styles.addRowBtn} onPress={() => openRowForm(null)}>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.addRowTxt}>Agregar estación</Text>
            </Pressable>
          )}
        </View>

        {/* --- Contadores ejecutado / autorizado --- */}
        <View style={styles.statsCard}>
          <Ionicons name="leaf" size={36} color={SHEET.green} style={{ alignSelf: 'center', marginBottom: spacing.xs }} />
          <View style={styles.statsRow}>
            {TIPOS.map((t) => (
              <View key={t.value} style={styles.statCard}>
                <Ionicons name={t.icon} size={18} color={colors.primary} />
                <Text style={styles.statLabel}>{t.label}s</Text>
                <Text style={styles.statValue}>
                  {contadores[t.value] || 0} <Text style={styles.statValueMuted}>/ {totalAutorizado[t.value] || 0}</Text>
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* --- Actividades ejecutadas de la semana --- */}
        <View style={styles.card}>
          <View style={[styles.bar, styles.weekBar, { backgroundColor: SHEET.pink }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('semanaAnterior')} hitSlop={8} onPress={() => setWeekStart((w) => addDaysISO(w, -6))}>
              <Ionicons name="chevron-back-circle-outline" size={22} color={SHEET.title} />
            </Pressable>
            <Text style={styles.barTxt} numberOfLines={2}>
              ACTIVIDADES EJECUTADAS SEMANA {semanal ? formatRangoSemana(semanal.desde, semanal.hasta) : ''}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('semanaSiguiente')} hitSlop={8} onPress={() => setWeekStart((w) => addDaysISO(w, 6))}>
              <Ionicons name="chevron-forward-circle-outline" size={22} color={SHEET.title} />
            </Pressable>
          </View>
          <View style={[styles.tableRow, styles.tableHeaderRow]}>
            <Text style={[styles.tableCell, styles.tableHeaderTxt, { flex: 1.8 }]}>Fecha</Text>
            <Text style={[styles.tableCell, styles.tableHeaderTxt]}>Podas</Text>
            <Text style={[styles.tableCell, styles.tableHeaderTxt]}>Trasp.</Text>
            <Text style={[styles.tableCell, styles.tableHeaderTxt]}>Derr.</Text>
            <Text style={[styles.tableCell, styles.tableHeaderTxt]}>Total</Text>
          </View>
          {semanalLoading || !semanal ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <>
              {semanal.dias.map((dia) => (
                <View key={dia.fecha} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 1.8 }]} numberOfLines={1}>{formatDiaCorto(dia.fecha)}</Text>
                  <Text style={styles.tableCell}>{dia.poda}</Text>
                  <Text style={styles.tableCell}>{dia.trasplante}</Text>
                  <Text style={styles.tableCell}>{dia.derribo}</Text>
                  <Text style={styles.tableCell}>{dia.total}</Text>
                </View>
              ))}
              <View style={[styles.tableRow, { backgroundColor: SHEET.subtotal }]}>
                <Text style={[styles.tableCell, styles.totalTxt, { flex: 1.8 }]}>SUBTOTAL</Text>
                <Text style={[styles.tableCell, styles.totalTxt]}>{semanal.subtotal.poda}</Text>
                <Text style={[styles.tableCell, styles.totalTxt]}>{semanal.subtotal.trasplante}</Text>
                <Text style={[styles.tableCell, styles.totalTxt]}>{semanal.subtotal.derribo}</Text>
                <Text style={[styles.tableCell, styles.totalTxt]}>{semanal.subtotal.total}</Text>
              </View>
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

      <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} hitSlop={8} style={styles.fab} onPress={openForm}>
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>

      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Registrar evento forestal</Text>

            <Text style={styles.fieldLabel}>Tipo</Text>
            <View style={styles.segmentRow}>
              {TIPOS.map((t) => (
                <Pressable accessibilityRole="button"
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

      <Modal visible={rowFormOpen} transparent animationType="slide" onRequestClose={() => setRowFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{rowEditing ? 'Editar renglón autorizado' : 'Agregar renglón autorizado'}</Text>

            <Text style={styles.fieldLabel}>Estación (o "Postes")</Text>
            <TextInput
              value={rowEstacion}
              onChangeText={setRowEstacion}
              placeholder="Ej. Estación 1"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Poda autorizada</Text>
            <TextInput value={rowPoda} onChangeText={setRowPoda} keyboardType="number-pad" style={styles.input} />

            <Text style={styles.fieldLabel}>Trasplante autorizado</Text>
            <TextInput value={rowTrasplante} onChangeText={setRowTrasplante} keyboardType="number-pad" style={styles.input} />

            <Text style={styles.fieldLabel}>Derribo autorizado</Text>
            <TextInput value={rowDerribo} onChangeText={setRowDerribo} keyboardType="number-pad" style={styles.input} />

            <Text style={styles.fieldLabel}>Total de árboles dictaminados</Text>
            <TextInput value={rowTotal} onChangeText={setRowTotal} keyboardType="number-pad" style={styles.input} />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              {rowEditing && (
                <Button label="Eliminar" variant="danger" onPress={onDeleteRow} loading={rowSaving} style={{ flex: 1 }} />
              )}
              <Button label="Cancelar" variant="secondary" onPress={() => setRowFormOpen(false)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={rowSaving} onPress={onSaveRow} style={{ flex: 1 }} />
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
  sheetTitle: { fontSize: 16, fontWeight: '800', color: SHEET.title, marginBottom: spacing.sm, letterSpacing: 0.3 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs, marginTop: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.card, marginBottom: spacing.md },
  bar: { paddingVertical: 8, paddingHorizontal: spacing.md },
  weekBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  barTxt: { flex: 1, fontSize: 11, fontWeight: '800', color: SHEET.title, textAlign: 'center', textTransform: 'uppercase' },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13 },
  tableRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHeaderRow: { backgroundColor: colors.bg },
  tableHeaderTxt: { fontWeight: '800', color: colors.textMuted, fontSize: 11 },
  tableCell: { flex: 1, fontSize: 12, color: colors.text, textAlign: 'center' },
  headTxt: { color: '#fff', fontWeight: '800', fontSize: 11 },
  estacionTxt: { textAlign: 'left', fontWeight: '700', color: SHEET.green },
  totalRow: { backgroundColor: colors.bg, borderTopWidth: 2, borderTopColor: SHEET.green, borderBottomWidth: 0 },
  totalTxt: { fontWeight: '800', color: colors.text },
  addRowBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  addRowTxt: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  statsCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.md, padding: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 16, fontWeight: '800', color: colors.text },
  statValueMuted: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' },
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
