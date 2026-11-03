// Módulo "Resumen del periodo" — avance físico y financiero, desviación, semáforo y
// mensajes clave que abren los informes diario / semanal / mensual (sección
// "Resumen ejecutivo"). Hay UN resumen por (informe, fecha de corte). El estatus se
// calcula de la desviación salvo que se elija a mano. Captura de Coordinador y
// Sub-Coordinador; el resto solo consulta (el backend aplica el mismo criterio).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, Project, ResumenJerarquia, ResumenPeriodo, ResumenSemaforo } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { confirm } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';
import { hoyProyecto } from '@/src/utils/fechas';
import { showToast } from '@/src/utils/toast';
import {
  desviacion, estatusEfectivo, formatoDesviacion, parsePorcentaje, SEMAFORO_ETIQUETA,
} from '@/src/utils/resumenPeriodo';

const JERARQUIAS: { id: ResumenJerarquia; label: string }[] = [
  { id: 'diario', label: 'Diario' }, { id: 'semanal', label: 'Semanal' }, { id: 'mensual', label: 'Mensual' },
];
const SEMAFORO_COLOR: Record<ResumenSemaforo, string> = { verde: '#2E9E5B', ambar: '#E0A100', rojo: '#D64545' };
const MAX_MENSAJES = 5;

const aTexto = (n: number | null | undefined) => (n == null ? '' : String(n));

export default function ResumenPeriodoScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEscribir = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [lista, setLista] = useState<ResumenPeriodo[]>([]);
  const [saving, setSaving] = useState(false);

  const [jerarquia, setJerarquia] = useState<ResumenJerarquia>('semanal');
  const [fecha, setFecha] = useState(hoyProyecto());
  const [fisico, setFisico] = useState('');
  const [programado, setProgramado] = useState('');
  const [financiero, setFinanciero] = useState('');
  const [estimado, setEstimado] = useState('');
  const [estatus, setEstatus] = useState<ResumenSemaforo | null>(null);
  const [mensajes, setMensajes] = useState<string[]>(['', '', '']);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const cargar = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, items] = await Promise.all([api.getProject(projectId), api.listResumenesPeriodo(projectId)]);
      setProject(proj);
      setLista(items);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el resumen del periodo.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  const existente = useMemo(
    () => lista.find((r) => r.jerarquia === jerarquia && r.fecha_corte === fecha.trim()) || null,
    [lista, jerarquia, fecha],
  );

  // Al cambiar de informe / fecha se carga el resumen que ya exista (o se limpia el formulario).
  useEffect(() => {
    setFisico(aTexto(existente?.avance_fisico));
    setProgramado(aTexto(existente?.programado));
    setFinanciero(aTexto(existente?.avance_financiero));
    setEstimado(existente?.estimado || '');
    setEstatus(existente?.estatus || null);
    const msgs = existente?.mensajes?.length ? [...existente.mensajes] : [];
    while (msgs.length < 3) msgs.push('');
    setMensajes(msgs);
  }, [existente]);

  const fisicoN = parsePorcentaje(fisico);
  const programadoN = parsePorcentaje(programado);
  const efectivo = estatusEfectivo(estatus, fisicoN ?? null, programadoN ?? null);
  const dev = desviacion(fisicoN ?? null, programadoN ?? null);

  async function onGuardar() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha.trim())) {
      Alert.alert('Fecha', 'Escribe la fecha de corte como AAAA-MM-DD.');
      return;
    }
    const financieroN = parsePorcentaje(financiero);
    if (fisicoN === undefined || programadoN === undefined || financieroN === undefined) {
      Alert.alert('Porcentajes', 'Los avances deben ser números entre 0 y 100.');
      return;
    }
    try {
      setSaving(true);
      await api.upsertResumenPeriodo(projectId, {
        jerarquia, fecha_corte: fecha.trim(), avance_fisico: fisicoN, programado: programadoN,
        avance_financiero: financieroN, estimado: estimado.trim() || null, estatus,
        mensajes: mensajes.map((m) => m.trim()).filter(Boolean), fuente: existente?.fuente || 'manual',
      });
      showToast('Resumen guardado');
      await cargar();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function onEliminar() {
    if (!existente) return;
    const ok = await confirm('Eliminar resumen', '¿Eliminar este resumen? El informe saldrá sin la sección.', { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deleteResumenPeriodo(projectId, existente.id);
      await cargar();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Inténtalo nuevamente.');
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  const campo = (label: string, value: string, set: (v: string) => void, placeholder: string, teclado: 'default' | 'decimal-pad' = 'decimal-pad') => (
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={set} placeholder={placeholder} placeholderTextColor={colors.textMuted}
        keyboardType={teclado} editable={puedeEscribir} style={styles.input} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Resumen del periodo" backgroundColor={headerColor} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>
            Abre el informe con el avance, el semáforo y los mensajes clave. Hay un resumen por informe y fecha de corte
            (el día, o el último día de la semana o del mes).
          </Text>

          <View style={styles.tabs}>
            {JERARQUIAS.map((j) => (
              <Pressable key={j.id} accessibilityRole="button" onPress={() => setJerarquia(j.id)}
                style={[styles.tab, jerarquia === j.id && { backgroundColor: headerColor }]}>
                <Text style={[styles.tabTxt, jerarquia === j.id && { color: headerTextColor }]}>{j.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.card}>
            {campo('Fecha de corte (AAAA-MM-DD)', fecha, setFecha, '2026-11-02', 'default')}
            {existente ? <Text style={styles.meta}>Ya hay un resumen para este informe: se actualiza al guardar.</Text> : null}

            <View style={styles.row}>
              {campo('Avance físico %', fisico, setFisico, '42.5')}
              {campo('Programado %', programado, setProgramado, '45')}
            </View>
            <View style={styles.row}>
              {campo('Avance financiero %', financiero, setFinanciero, '40')}
              {campo('Monto estimado', estimado, setEstimado, '$4,000,000.00', 'default')}
            </View>

            <Text style={styles.label}>Estatus general</Text>
            <View style={styles.row}>
              <Pressable accessibilityRole="button" disabled={!puedeEscribir} onPress={() => setEstatus(null)}
                style={[styles.chip, estatus === null && styles.chipOn]}>
                <Text style={[styles.chipTxt, estatus === null && { color: '#fff' }]}>Automático</Text>
              </Pressable>
              {(Object.keys(SEMAFORO_ETIQUETA) as ResumenSemaforo[]).map((s) => (
                <Pressable key={s} accessibilityRole="button" disabled={!puedeEscribir} onPress={() => setEstatus(s)}
                  style={[styles.chip, { borderColor: SEMAFORO_COLOR[s] }, estatus === s && { backgroundColor: SEMAFORO_COLOR[s] }]}>
                  <Text style={[styles.chipTxt, { color: estatus === s ? '#fff' : SEMAFORO_COLOR[s] }]}>{SEMAFORO_ETIQUETA[s]}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.preview}>
              <View style={[styles.dot, { backgroundColor: efectivo ? SEMAFORO_COLOR[efectivo] : colors.border }]} />
              <Text style={styles.previewTxt}>
                {efectivo ? SEMAFORO_ETIQUETA[efectivo] : 'Sin estatus'} · Desviación {formatoDesviacion(dev)}
                {estatus === null && efectivo ? ' (calculado)' : ''}
              </Text>
            </View>

            <Text style={[styles.label, { marginTop: spacing.md }]}>Mensajes clave del periodo</Text>
            {mensajes.map((m, i) => (
              <TextInput key={i} value={m} multiline editable={puedeEscribir}
                onChangeText={(v) => setMensajes((arr) => arr.map((x, k) => (k === i ? v : x)))}
                placeholder={['Logro o avance más relevante', 'Principal desviación y su causa', 'Decisión o acción que se requiere del cliente'][i] || 'Mensaje'}
                placeholderTextColor={colors.textMuted} maxLength={300} style={[styles.input, { marginBottom: spacing.xs, minHeight: 44 }]} />
            ))}
            {puedeEscribir && mensajes.length < MAX_MENSAJES ? (
              <Pressable accessibilityRole="button" onPress={() => setMensajes((a) => [...a, ''])} style={styles.addBtn}>
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={styles.addBtnTxt}>Agregar mensaje</Text>
              </Pressable>
            ) : null}

            {puedeEscribir ? (
              <View style={[styles.row, { marginTop: spacing.md }]}>
                {existente ? <Button label="Eliminar" variant="secondary" onPress={onEliminar} style={{ flex: 1 }} /> : null}
                <Button label="Guardar" loading={saving} onPress={onGuardar} style={{ flex: 1 }} />
              </View>
            ) : <Text style={styles.meta}>Solo Coordinador y Sub-Coordinador capturan el resumen.</Text>}
          </View>

          <Text style={styles.sectionTitle}>Resúmenes capturados</Text>
          {lista.length === 0 ? (
            <View style={[styles.card, { alignItems: 'center' }]}><Text style={styles.meta}>Aún no hay resúmenes.</Text></View>
          ) : lista.map((r) => (
            <Pressable key={r.id} accessibilityRole="button" onPress={() => { setJerarquia(r.jerarquia); setFecha(r.fecha_corte); }}
              style={[styles.card, styles.row, { alignItems: 'center' }]}>
              <View style={[styles.dot, { backgroundColor: r.estatus_efectivo ? SEMAFORO_COLOR[r.estatus_efectivo] : colors.border }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{JERARQUIAS.find((j) => j.id === r.jerarquia)?.label} · {r.fecha_corte}</Text>
                <Text style={styles.meta}>
                  Físico {r.avance_fisico ?? '—'}% · Programado {r.programado ?? '—'}% · {formatoDesviacion(r.desviacion)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.md },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabTxt: { fontSize: 13, fontWeight: '800', color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, padding: spacing.md, marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '800', color: colors.text },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm },
  previewTxt: { fontSize: 12, color: colors.text, fontWeight: '600' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  addBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
});
