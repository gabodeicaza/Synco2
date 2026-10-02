// Módulo "Indicadores de Seguridad" — el "Cumplimiento seguridad e higiene" del
// reporte semanal. Los porcentajes los calcula la supervisión de seguridad y
// aquí solo se capturan:
//  · Campo: % de cumplimiento en campo por corte (el reporte muestra el último
//    como "actual" y el anterior). Los DÍAS SIN ACCIDENTES se calculan solos
//    del registro de accidentes (no reinician los accidentes leves); el campo
//    opcional "días sin accidentes" los fija a mano.
//  · Documental: % mensual y % por semana en Seguridad / Protección civil /
//    Higiene y salud.
//  · PIPC (Estudio de Riesgo, obra y demolición): puntos de los 4 pasos por
//    estación — Elaboración vale hasta 70 puntos y los otros tres suman hasta
//    30 — y las notas de avance.
// Capturar el mismo corte, mes, semana o estación REEMPLAZA lo anterior. Los
// pendientes administrativos se capturan en Pendientes Generales (ámbito
// "Seguridad e higiene"). Captura abierta a cualquier rol de escritura.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, Project, SeguridadCategoria, SeguridadIndicador } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth-context';
import { ROLE_JEFE } from '@/src/utils/roles';

const CATEGORIAS: { key: SeguridadCategoria; label: string }[] = [
  { key: 'seguridad', label: 'Seguridad' },
  { key: 'proteccion_civil', label: 'Protección civil' },
  { key: 'higiene_salud', label: 'Higiene y salud' },
];
const PASOS = ['Elaboración (máx. 70)', 'Captura digital', 'Obtención de folio', 'Registro'];

function fmtFecha(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Tab = 'campo' | 'documental' | 'pipc';
type Campo = { key: string; label: string; placeholder: string; numeric?: boolean; multiline?: boolean };
// Un modal genérico: una lista de campos de texto y cómo guardarlos.
type Form = { titulo: string; campos: Campo[]; valores: Record<string, string>; guardar: (v: Record<string, string>) => Promise<void> };

const num = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));

export default function IndicadoresSeguridadScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEscribir = user?.role !== ROLE_JEFE;

  const [tab, setTab] = useState<Tab>('campo');
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<SeguridadIndicador[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, list] = await Promise.all([api.getProject(projectId), api.listSeguridadIndicadores(projectId)]);
      setProject(proj);
      setItems(list);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar los indicadores.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const de = (tipo: SeguridadIndicador['tipo']) => items.filter((i) => i.tipo === tipo);
  const campo = useMemo(() => de('campo').sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')), [items]);
  const mensual = useMemo(() => de('doc_mensual').sort((a, b) => (b.mes || '').localeCompare(a.mes || '')), [items]);
  const semanas = useMemo(() => {
    const m = new Map<string, Partial<Record<SeguridadCategoria, SeguridadIndicador>>>();
    for (const i of de('doc_semanal')) {
      if (!i.semana || !i.categoria) continue;
      m.set(i.semana, { ...(m.get(i.semana) || {}), [i.categoria]: i });
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);
  const pipc = useMemo(() => de('pipc').sort((a, b) => (a.orden || 0) - (b.orden || 0)), [items]);
  const nota = de('nota_pipc')[0];

  async function enviar(fn: () => Promise<unknown>) {
    try {
      setSaving(true);
      await fn();
      setForm(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function borrar(i: SeguridadIndicador, que: string) {
    const ok = await confirm('Eliminar', `¿Eliminar ${que}?`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deleteSeguridadIndicador(projectId, i.id);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    }
  }

  // ---- formularios -------------------------------------------------------
  function formCampo(i?: SeguridadIndicador) {
    setForm({
      titulo: i ? 'Editar cumplimiento en campo' : 'Nuevo cumplimiento en campo',
      campos: [
        { key: 'fecha', label: 'Fecha del corte (AAAA-MM-DD)', placeholder: '2026-06-27' },
        { key: 'porcentaje', label: '% de cumplimiento en campo', placeholder: '42', numeric: true },
        { key: 'dias', label: 'Días sin accidentes (vacío = se calcula solo)', placeholder: '9', numeric: true },
      ],
      valores: { fecha: i?.fecha || hoyISO(), porcentaje: i?.porcentaje != null ? String(i.porcentaje) : '', dias: i?.dias_sin_accidentes != null ? String(i.dias_sin_accidentes) : '' },
      guardar: (v) => enviar(() => api.setSeguridadIndicador(projectId, {
        tipo: 'campo', fecha: v.fecha.trim(), porcentaje: num(v.porcentaje), dias_sin_accidentes: num(v.dias) ?? null,
      })),
    });
  }

  function formMensual(i?: SeguridadIndicador) {
    setForm({
      titulo: i ? 'Editar cumplimiento documental mensual' : 'Nuevo cumplimiento documental mensual',
      campos: [
        { key: 'mes', label: 'Mes (AAAA-MM)', placeholder: '2026-05' },
        { key: 'porcentaje', label: '% de cumplimiento documental', placeholder: '67.37', numeric: true },
      ],
      valores: { mes: i?.mes || hoyISO().slice(0, 7), porcentaje: i?.porcentaje != null ? String(i.porcentaje) : '' },
      guardar: (v) => enviar(() => api.setSeguridadIndicador(projectId, { tipo: 'doc_mensual', mes: v.mes.trim(), porcentaje: num(v.porcentaje) })),
    });
  }

  function formSemana(semana?: string, vals?: Partial<Record<SeguridadCategoria, SeguridadIndicador>>) {
    const valores: Record<string, string> = { semana: semana || hoyISO() };
    for (const c of CATEGORIAS) valores[c.key] = vals?.[c.key]?.porcentaje != null ? String(vals[c.key]!.porcentaje) : '';
    setForm({
      titulo: semana ? 'Editar cumplimiento por semana' : 'Nuevo cumplimiento por semana',
      campos: [
        { key: 'semana', label: 'Cualquier fecha de la semana (AAAA-MM-DD)', placeholder: '2026-06-22' },
        ...CATEGORIAS.map((c) => ({ key: c.key, label: `% ${c.label}`, placeholder: '65', numeric: true })),
      ],
      valores,
      guardar: (v) => enviar(async () => {
        for (const c of CATEGORIAS) {
          if (v[c.key].trim() === '') continue;
          await api.setSeguridadIndicador(projectId, { tipo: 'doc_semanal', semana: v.semana.trim(), categoria: c.key, porcentaje: num(v[c.key]) });
        }
      }),
    });
  }

  function formPipc(i?: SeguridadIndicador) {
    const valores: Record<string, string> = { etiqueta: i?.etiqueta || '', orden: String(i?.orden ?? pipc.length + 1) };
    PASOS.forEach((_, k) => { valores[`p${k}`] = i?.puntos?.[k] != null ? String(i.puntos[k]) : '0'; });
    setForm({
      titulo: i ? `Editar PIPC · ${i.etiqueta}` : 'Nueva estación del PIPC',
      campos: [
        { key: 'etiqueta', label: 'Estación (ej. E1)', placeholder: 'E1' },
        { key: 'orden', label: 'Orden', placeholder: '1', numeric: true },
        ...PASOS.map((p, k) => ({ key: `p${k}`, label: `Puntos · ${p}`, placeholder: '0', numeric: true })),
      ],
      valores,
      guardar: (v) => enviar(() => api.setSeguridadIndicador(projectId, {
        tipo: 'pipc', etiqueta: v.etiqueta.trim(), orden: parseInt(v.orden || '0', 10) || 0,
        puntos: PASOS.map((_, k) => num(v[`p${k}`]) ?? 0),
      })),
    });
  }

  function formNota() {
    setForm({
      titulo: 'Notas de avance del PIPC',
      campos: [{ key: 'texto', label: 'Una nota por línea', placeholder: 'La supervisión externa recibe los Estudios de Riesgo…', multiline: true }],
      valores: { texto: nota?.texto || '' },
      guardar: (v) => enviar(() => api.setSeguridadIndicador(projectId, { tipo: 'nota_pipc', texto: v.texto })),
    });
  }

  const totalPipc = (p?: number[]) => Math.min((p || []).reduce((a, b) => a + b, 0), 100);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const nuevo = (onPress: () => void, label: string) => (puedeEscribir ? (
    <Pressable onPress={onPress} style={styles.addBtn}>
      <Ionicons name="add" size={16} color={colors.primary} />
      <Text style={styles.addBtnTxt}>{label}</Text>
    </Pressable>
  ) : null);

  const papelera = (i: SeguridadIndicador, que: string) => (puedeEscribir ? (
    <Pressable hitSlop={8} onPress={() => borrar(i, que)}>
      <Ionicons name="trash-outline" size={18} color={colors.error} />
    </Pressable>
  ) : null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Indicadores de Seguridad</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <View style={styles.tabsRow}>
        {([['campo', 'Campo'], ['documental', 'Documental'], ['pipc', 'PIPC']] as [Tab, string][]).map(([k, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabActive]}>
            <Text style={[styles.tabTxt, tab === k && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        {tab === 'campo' ? (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Cumplimiento en campo</Text>
              {nuevo(() => formCampo(), 'Nuevo corte')}
            </View>
            <Text style={styles.hint}>El reporte usa el último corte como "actual" y el anterior como comparativo.</Text>
            {campo.length === 0 ? <View style={[styles.card, styles.empty]}><Text style={styles.emptyTxt}>Sin cortes capturados.</Text></View> : campo.map((i, k) => (
              <Pressable key={i.id} style={[styles.card, styles.row]} onPress={puedeEscribir ? () => formCampo(i) : undefined}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{fmtFecha(i.fecha)} · {i.porcentaje}%{k === 0 ? '  (actual)' : k === 1 ? '  (anterior)' : ''}</Text>
                  {i.dias_sin_accidentes != null ? <Text style={styles.meta}>Días sin accidentes fijados a mano: {i.dias_sin_accidentes}</Text> : null}
                </View>
                {papelera(i, 'este corte')}
              </Pressable>
            ))}
          </>
        ) : null}

        {tab === 'documental' ? (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Porcentaje mensual</Text>
              {nuevo(() => formMensual(), 'Nuevo mes')}
            </View>
            {mensual.length === 0 ? <View style={[styles.card, styles.empty]}><Text style={styles.emptyTxt}>Sin meses capturados.</Text></View> : mensual.map((i) => (
              <Pressable key={i.id} style={[styles.card, styles.row]} onPress={puedeEscribir ? () => formMensual(i) : undefined}>
                <Text style={[styles.cardTitle, { flex: 1 }]}>{i.mes} · {i.porcentaje}%</Text>
                {papelera(i, 'este mes')}
              </Pressable>
            ))}
            <View style={[styles.sectionHeaderRow, { marginTop: spacing.lg }]}>
              <Text style={styles.sectionTitle}>Por semana y área</Text>
              {nuevo(() => formSemana(), 'Nueva semana')}
            </View>
            {semanas.length === 0 ? <View style={[styles.card, styles.empty]}><Text style={styles.emptyTxt}>Sin semanas capturadas.</Text></View> : semanas.map(([semana, vals]) => (
              <Pressable key={semana} style={[styles.card, { padding: spacing.md }]} onPress={puedeEscribir ? () => formSemana(semana, vals) : undefined}>
                <Text style={styles.cardTitle}>Semana del {fmtFecha(semana)}</Text>
                {CATEGORIAS.map((c) => (
                  <Text key={c.key} style={styles.meta}>{c.label}: {vals[c.key]?.porcentaje != null ? `${vals[c.key]!.porcentaje}%` : '—'}</Text>
                ))}
              </Pressable>
            ))}
          </>
        ) : null}

        {tab === 'pipc' ? (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Cumplimiento del PIPC por estación</Text>
              {nuevo(() => formPipc(), 'Nueva estación')}
            </View>
            <Text style={styles.hint}>Puntos por paso: Elaboración hasta 70; captura digital, folio y registro suman hasta 30. El total por estación es la suma.</Text>
            {pipc.length === 0 ? <View style={[styles.card, styles.empty]}><Text style={styles.emptyTxt}>Sin estaciones capturadas.</Text></View> : pipc.map((i) => (
              <Pressable key={i.id} style={[styles.card, styles.row]} onPress={puedeEscribir ? () => formPipc(i) : undefined}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{i.etiqueta} · {totalPipc(i.puntos)}%</Text>
                  <Text style={styles.meta}>{(i.puntos || []).join(' · ')}</Text>
                </View>
                {papelera(i, `la estación ${i.etiqueta}`)}
              </Pressable>
            ))}
            <View style={[styles.sectionHeaderRow, { marginTop: spacing.lg }]}>
              <Text style={styles.sectionTitle}>Notas de avance</Text>
              {puedeEscribir ? (
                <Pressable onPress={formNota} style={styles.addBtn}>
                  <Ionicons name="create-outline" size={16} color={colors.primary} />
                  <Text style={styles.addBtnTxt}>Editar</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={[styles.card, { padding: spacing.md }]}>
              <Text style={nota?.texto ? styles.cardTitle : styles.emptyTxt}>{nota?.texto || 'Sin notas.'}</Text>
            </View>
          </>
        ) : null}
      </ScrollView>

      <Modal visible={!!form} transparent animationType="slide" onRequestClose={() => setForm(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '92%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{form?.titulo}</Text>
              {form?.campos.map((c) => (
                <View key={c.key}>
                  <Text style={styles.fieldLabel}>{c.label}</Text>
                  <TextInput
                    value={form.valores[c.key] ?? ''}
                    onChangeText={(t) => setForm((f) => (f ? { ...f, valores: { ...f.valores, [c.key]: t } } : f))}
                    placeholder={c.placeholder} placeholderTextColor={colors.textMuted}
                    keyboardType={c.numeric ? 'decimal-pad' : 'default'} autoCapitalize="none"
                    multiline={c.multiline}
                    style={[styles.input, c.multiline && { minHeight: 110, textAlignVertical: 'top' }]}
                  />
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label="Cancelar" variant="secondary" onPress={() => setForm(null)} style={{ flex: 1 }} />
                <Button label="Guardar" loading={saving} onPress={() => form?.guardar(form.valores)} style={{ flex: 1 }} />
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
  tabsRow: { flexDirection: 'row', gap: 8, padding: spacing.md, paddingBottom: 0 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.surface },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  scroll: { padding: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  hint: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.sm },
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
