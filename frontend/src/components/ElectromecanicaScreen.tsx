// Módulo "Electromecánica" — estado vigente del Sistema Electromecánico que el
// informe semanal imprime (tabla de documentos, gráfica de avance por
// componente × etapa, avance general, pilonas y observaciones):
//  · Avance (%) de Estaciones, Pilonas, Cable, Garage y Cabinas en
//    fabricación / suministro / montaje.
//  · Avance general: vacío = promedio de lo capturado.
//  · Pilonas suministradas vs total y nota del patio de almacenamiento.
//  · Documentación y actividades con su estatus, y observaciones libres.
// Un solo documento por proyecto: se edita todo y se guarda de una vez.
// Mismo patrón "un componente hace todo, rutas delgadas por rol" que
// AspectosSocialesScreen.tsx.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ElectromecEstatus, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { useAuth } from '@/src/auth-context';
import { ROLE_JEFE } from '@/src/utils/roles';

const COMPONENTES: { key: string; label: string }[] = [
  { key: 'estaciones', label: 'Estaciones' },
  { key: 'pilonas', label: 'Pilonas (Ejes)' },
  { key: 'cable', label: 'Cable Portador-Tractor' },
  { key: 'garage', label: 'Garage' },
  { key: 'cabinas', label: 'Cabinas' },
];
const ETAPAS: { key: string; label: string }[] = [
  { key: 'fabricacion', label: 'Fabricación' },
  { key: 'suministro', label: 'Suministro' },
  { key: 'montaje', label: 'Montaje' },
];
const ESTATUS: { key: ElectromecEstatus; label: string; color: string }[] = [
  { key: 'recibido', label: 'Recibido', color: '#16A34A' },
  { key: 'en_revision', label: 'En revisión', color: '#F59E0B' },
  { key: 'pendiente', label: 'Pendiente', color: '#DC2626' },
  { key: 'emitido', label: 'Emitido', color: '#2563EB' },
];

type DocDraft = { id: string | null; titulo: string; estatus: ElectromecEstatus | null; nota: string };
type ObsDraft = { id: string | null; titulo: string; texto: string };

const numTxt = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

/** "" → null; número válido → número; otro → NaN (el llamador avisa). */
function parseNum(txt: string): number | null {
  const t = txt.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export default function ElectromecanicaScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEscribir = user?.role !== ROLE_JEFE;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [avance, setAvance] = useState<Record<string, Record<string, string>>>({});
  const [general, setGeneral] = useState('');
  const [calculado, setCalculado] = useState<number | null>(null);
  const [pilTotal, setPilTotal] = useState('');
  const [pilSum, setPilSum] = useState('');
  const [patio, setPatio] = useState('');
  const [docs, setDocs] = useState<DocDraft[]>([]);
  const [obs, setObs] = useState<ObsDraft[]>([]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, d] = await Promise.all([api.getProject(projectId), api.getElectromecanica(projectId)]);
      setProject(proj);
      const av: Record<string, Record<string, string>> = {};
      COMPONENTES.forEach((c) => {
        av[c.key] = {};
        ETAPAS.forEach((e) => { av[c.key][e.key] = numTxt(d.avance?.[c.key]?.[e.key]); });
      });
      setAvance(av);
      setGeneral(numTxt(d.avance_general));
      setCalculado(d.avance_general_calculado ?? null);
      setPilTotal(numTxt(d.pilonas_total));
      setPilSum(numTxt(d.pilonas_suministradas));
      setPatio(d.patio_nota || '');
      setDocs((d.documentos || []).map((x) => ({ id: x.id || null, titulo: x.titulo, estatus: x.estatus || null, nota: x.nota || '' })));
      setObs((d.observaciones || []).map((x) => ({ id: x.id || null, titulo: x.titulo || '', texto: x.texto })));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar Electromecánica.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function guardar() {
    const av: Record<string, Record<string, number | null>> = {};
    for (const c of COMPONENTES) {
      av[c.key] = {};
      for (const e of ETAPAS) {
        const n = parseNum(avance[c.key]?.[e.key] ?? '');
        if (n !== null && (Number.isNaN(n) || n < 0 || n > 100)) {
          Alert.alert('Valor inválido', `${c.label} · ${e.label}: usa un porcentaje entre 0 y 100.`);
          return;
        }
        av[c.key][e.key] = n;
      }
    }
    const gen = parseNum(general);
    if (gen !== null && (Number.isNaN(gen) || gen < 0 || gen > 100)) {
      Alert.alert('Valor inválido', 'El avance general debe estar entre 0 y 100.');
      return;
    }
    const total = parseNum(pilTotal);
    const sum = parseNum(pilSum);
    if ([total, sum].some((n) => n !== null && (Number.isNaN(n as number) || (n as number) < 0 || !Number.isInteger(n as number)))) {
      Alert.alert('Valor inválido', 'Las pilonas deben ser números enteros mayores o iguales a cero.');
      return;
    }
    if (total !== null && sum !== null && sum > total) {
      Alert.alert('Valor inválido', 'Las pilonas suministradas no pueden superar el total.');
      return;
    }
    try {
      setSaving(true);
      const out = await api.setElectromecanica(projectId, {
        avance: av,
        avance_general: gen,
        pilonas_total: total,
        pilonas_suministradas: sum,
        patio_nota: patio.trim() || null,
        documentos: docs.filter((d) => d.titulo.trim()).map((d) => ({
          id: d.id, titulo: d.titulo.trim(), estatus: d.estatus, nota: d.nota.trim() || null,
        })),
        observaciones: obs.filter((o) => o.texto.trim()).map((o) => ({
          id: o.id, titulo: o.titulo.trim() || null, texto: o.texto.trim(),
        })),
      });
      setCalculado(out.avance_general_calculado ?? null);
      Alert.alert('Guardado', 'Electromecánica actualizada.');
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]}>Sistema Electromecánico</Text>
          <View style={styles.iconBtn} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Avance por componente (%)</Text>
        <View style={styles.card}>
          <View style={styles.gridRow}>
            <Text style={[styles.gridLabel, { flex: 1.6 }]} />
            {ETAPAS.map((e) => <Text key={e.key} style={styles.gridHead}>{e.label}</Text>)}
          </View>
          {COMPONENTES.map((c) => (
            <View key={c.key} style={styles.gridRow}>
              <Text style={[styles.gridLabel, { flex: 1.6 }]}>{c.label}</Text>
              {ETAPAS.map((e) => (
                <TextInput
                  key={e.key}
                  value={avance[c.key]?.[e.key] ?? ''}
                  onChangeText={(t) => setAvance((cur) => ({ ...cur, [c.key]: { ...(cur[c.key] || {}), [e.key]: t } }))}
                  editable={puedeEscribir}
                  keyboardType="decimal-pad"
                  placeholder="—"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.gridInput]}
                />
              ))}
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Avance general del sistema</Text>
        <View style={styles.card}>
          <TextInput
            value={general} onChangeText={setGeneral} editable={puedeEscribir} keyboardType="decimal-pad"
            placeholder={calculado !== null ? `Automático: ${calculado}%` : 'Sin datos'} placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          <Text style={styles.hint}>Déjalo vacío para usar el promedio de lo capturado arriba{calculado !== null ? ` (${calculado}%)` : ''}.</Text>
        </View>

        <Text style={styles.sectionTitle}>Pilonas y patio de almacenamiento</Text>
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Total de pilonas</Text>
              <TextInput value={pilTotal} onChangeText={setPilTotal} editable={puedeEscribir} keyboardType="number-pad" style={styles.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Suministradas</Text>
              <TextInput value={pilSum} onChangeText={setPilSum} editable={puedeEscribir} keyboardType="number-pad" style={styles.input} />
            </View>
          </View>
          <Text style={styles.fieldLabel}>Nota del patio (ej. pilonas en almacén)</Text>
          <TextInput value={patio} onChangeText={setPatio} editable={puedeEscribir} multiline style={[styles.input, { minHeight: 60 }]} />
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Documentación y actividades</Text>
          {puedeEscribir ? (
            <Pressable accessibilityRole="button" onPress={() => setDocs((c) => [...c, { id: null, titulo: '', estatus: null, nota: '' }])} style={styles.addBtn}>
              <Ionicons name="add" size={16} color={colors.primary} /><Text style={styles.addBtnTxt}>Agregar</Text>
            </Pressable>
          ) : null}
        </View>
        {docs.length === 0 ? <View style={[styles.card, styles.empty]}><Text style={styles.emptyTxt}>Sin documentos.</Text></View> : null}
        {docs.map((d, i) => (
          <View key={i} style={[styles.card, { padding: spacing.md }]}>
            <TextInput
              value={d.titulo} onChangeText={(t) => setDocs((c) => c.map((x, j) => (j === i ? { ...x, titulo: t } : x)))}
              editable={puedeEscribir} placeholder="Documento o actividad" placeholderTextColor={colors.textMuted} style={styles.input}
            />
            <View style={styles.chips}>
              {ESTATUS.map((s) => {
                const on = d.estatus === s.key;
                return (
                  <Pressable accessibilityRole="button"
                    key={s.key} disabled={!puedeEscribir}
                    onPress={() => setDocs((c) => c.map((x, j) => (j === i ? { ...x, estatus: on ? null : s.key } : x)))}
                    style={[styles.chip, on && { backgroundColor: s.color, borderColor: s.color }]}
                  >
                    <Text style={[styles.chipTxt, on && { color: '#fff' }]}>{s.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={d.nota} onChangeText={(t) => setDocs((c) => c.map((x, j) => (j === i ? { ...x, nota: t } : x)))}
              editable={puedeEscribir} placeholder="Observación (opcional)" placeholderTextColor={colors.textMuted} style={[styles.input, { marginTop: spacing.xs }]}
            />
            {puedeEscribir ? (
              <Pressable accessibilityRole="button" onPress={() => setDocs((c) => c.filter((_, j) => j !== i))} style={styles.removeBtn}>
                <Ionicons name="trash-outline" size={16} color={colors.error} /><Text style={styles.removeTxt}>Quitar</Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Observaciones</Text>
          {puedeEscribir ? (
            <Pressable accessibilityRole="button" onPress={() => setObs((c) => [...c, { id: null, titulo: '', texto: '' }])} style={styles.addBtn}>
              <Ionicons name="add" size={16} color={colors.primary} /><Text style={styles.addBtnTxt}>Agregar</Text>
            </Pressable>
          ) : null}
        </View>
        {obs.length === 0 ? <View style={[styles.card, styles.empty]}><Text style={styles.emptyTxt}>Sin observaciones.</Text></View> : null}
        {obs.map((o, i) => (
          <View key={i} style={[styles.card, { padding: spacing.md }]}>
            <TextInput
              value={o.titulo} onChangeText={(t) => setObs((c) => c.map((x, j) => (j === i ? { ...x, titulo: t } : x)))}
              editable={puedeEscribir} placeholder="Título (opcional)" placeholderTextColor={colors.textMuted} style={styles.input}
            />
            <TextInput
              value={o.texto} onChangeText={(t) => setObs((c) => c.map((x, j) => (j === i ? { ...x, texto: t } : x)))}
              editable={puedeEscribir} multiline placeholder="Observación" placeholderTextColor={colors.textMuted}
              style={[styles.input, { marginTop: spacing.xs, minHeight: 60 }]}
            />
            {puedeEscribir ? (
              <Pressable accessibilityRole="button" onPress={() => setObs((c) => c.filter((_, j) => j !== i))} style={styles.removeBtn}>
                <Ionicons name="trash-outline" size={16} color={colors.error} /><Text style={styles.removeTxt}>Quitar</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </ScrollView>

      {puedeEscribir ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Button label="Guardar" loading={saving} onPress={guardar} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleBar: { fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  scroll: { padding: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs, marginTop: spacing.md },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.md },
  addBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.sm, padding: spacing.md },
  empty: { alignItems: 'center' },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  gridRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  gridLabel: { fontSize: 12, fontWeight: '700', color: colors.text },
  gridHead: { flex: 1, fontSize: 10, fontWeight: '800', color: colors.textMuted, textAlign: 'center', textTransform: 'uppercase' },
  gridInput: { flex: 1, textAlign: 'center', paddingHorizontal: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  chipTxt: { fontSize: 11, fontWeight: '700', color: colors.text },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: spacing.xs },
  removeTxt: { fontSize: 12, fontWeight: '700', color: colors.error },
  footer: { padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
