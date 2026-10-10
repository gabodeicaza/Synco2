// Módulo "Aspectos Sociales" — dos registros estructurados que el reporte
// semanal imprime con gráficas:
//  · Levantamientos: dictámenes estructurales y fe notarial, requeridos vs
//    realizados por estaciones y por postes (gráficas de dona).
//  · Salvamento arqueológico: fecha de inicio y de liberación por punto de
//    sondeo (estación) o poste (gráfica de barras). Sin fecha de liberación =
//    en curso.
// Las actividades generales, las fotos y la situación social por estación
// salen del sistema de reportes por área; los pendientes de liberación, de
// Pendientes Generales (ámbito "Aspectos sociales"). Captura abierta a
// cualquier rol de escritura; borrar un registro de salvamento: Coordinador/
// Sub-Coordinador o quien lo capturó (el backend aplica el mismo criterio).
// Mismo patrón "un componente hace todo, rutas delgadas por rol" que
// FotosLidarScreen.tsx.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  api, LevantamientoSocial, LevantamientoTipo, Project, SalvamentoArqueologico, SocialAmbito,
} from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { fechaTecleadaOk, FECHA_AYUDA } from '@/src/utils/fecha';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB, ROLE_JEFE } from '@/src/utils/roles';

const TIPOS: { key: LevantamientoTipo; label: string }[] = [
  { key: 'dictamen_estructural', label: 'Dictámenes estructurales' },
  { key: 'fe_notarial', label: 'Fe notarial' },
];
const AMBITOS: { key: SocialAmbito; label: string; plural: string }[] = [
  { key: 'estacion', label: 'Estaciones', plural: 'estaciones' },
  { key: 'poste', label: 'Postes', plural: 'postes' },
];

function fmtFecha(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Tab = 'levantamientos' | 'salvamento';
type LevDraft = { tipo: LevantamientoTipo; ambito: SocialAmbito; total: string; realizados: string };
type SalvDraft = { id: string | null; ambito: SocialAmbito; etiqueta: string; inicio: string; liberacion: string; obs: string };

export default function AspectosSocialesScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEscribir = user?.role !== ROLE_JEFE;
  const puedeBorrarTodo = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [tab, setTab] = useState<Tab>('levantamientos');
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [levs, setLevs] = useState<LevantamientoSocial[]>([]);
  const [salv, setSalv] = useState<SalvamentoArqueologico[]>([]);
  const [levDraft, setLevDraft] = useState<LevDraft | null>(null);
  const [salvDraft, setSalvDraft] = useState<SalvDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, l, s] = await Promise.all([
        api.getProject(projectId), api.listLevantamientosSociales(projectId), api.listSalvamentoArqueologico(projectId),
      ]);
      setProject(proj);
      setLevs(l);
      setSalv(s);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar los aspectos sociales.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const levPorClave = useMemo(() => {
    const m = new Map<string, LevantamientoSocial>();
    for (const l of levs) m.set(`${l.tipo}|${l.ambito}`, l);
    return m;
  }, [levs]);

  function editarLev(tipo: LevantamientoTipo, ambito: SocialAmbito) {
    const l = levPorClave.get(`${tipo}|${ambito}`);
    setLevDraft({ tipo, ambito, total: l ? String(l.total_requerido) : '', realizados: l ? String(l.realizados) : '' });
  }

  async function guardarLev() {
    if (!levDraft) return;
    const total = parseInt(levDraft.total || '0', 10);
    const realizados = parseInt(levDraft.realizados || '0', 10);
    if (!Number.isFinite(total) || !Number.isFinite(realizados) || total < 0 || realizados < 0) {
      Alert.alert('Valores inválidos', 'Usa números enteros mayores o iguales a cero.');
      return;
    }
    if (realizados > total) {
      Alert.alert('Valores inválidos', 'Los realizados no pueden superar el total requerido.');
      return;
    }
    try {
      setSaving(true);
      await api.setLevantamientoSocial(projectId, { tipo: levDraft.tipo, ambito: levDraft.ambito, total_requerido: total, realizados });
      setLevDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function guardarSalv() {
    if (!salvDraft) return;
    if (!salvDraft.etiqueta.trim()) {
      Alert.alert('Falta información', 'Indica el punto o poste (ej. "UNIVERSIDAD PS2" o "S2").');
      return;
    }
    if (!fechaTecleadaOk(salvDraft.inicio) || (salvDraft.liberacion.trim() && !fechaTecleadaOk(salvDraft.liberacion))) {
      Alert.alert('Fecha inválida', FECHA_AYUDA);
      return;
    }
    try {
      setSaving(true);
      if (salvDraft.id) {
        await api.updateSalvamentoArqueologico(projectId, salvDraft.id, {
          etiqueta: salvDraft.etiqueta, fecha_inicio: salvDraft.inicio.trim(), observaciones: salvDraft.obs,
          ...(salvDraft.liberacion.trim() ? { fecha_liberacion: salvDraft.liberacion.trim() } : { quitar_liberacion: true }),
        });
      } else {
        await api.createSalvamentoArqueologico(projectId, {
          ambito: salvDraft.ambito, etiqueta: salvDraft.etiqueta, fecha_inicio: salvDraft.inicio.trim(),
          fecha_liberacion: salvDraft.liberacion.trim() || undefined, observaciones: salvDraft.obs || undefined,
        });
      }
      setSalvDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function borrarSalv(r: SalvamentoArqueologico) {
    const ok = await confirm('Eliminar registro', `¿Eliminar "${r.etiqueta}"?`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deleteSalvamentoArqueologico(projectId, r.id);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
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
          <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Aspectos Sociales</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <View style={styles.tabsRow}>
        {([['levantamientos', 'Levantamientos'], ['salvamento', 'Salvamento arqueológico']] as [Tab, string][]).map(([k, label]) => (
          <Pressable accessibilityRole="button" key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabActive]}>
            <Text style={[styles.tabTxt, tab === k && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        {tab === 'levantamientos' ? (
          TIPOS.map((t) => (
            <View key={t.key} style={{ marginBottom: spacing.lg }}>
              <Text style={styles.sectionTitle}>{t.label}</Text>
              {AMBITOS.map((a) => {
                const l = levPorClave.get(`${t.key}|${a.key}`);
                const pct = l && l.total_requerido ? (l.realizados / l.total_requerido) * 100 : 0;
                return (
                  <Pressable accessibilityRole="button"
                    key={a.key} style={[styles.card, { padding: spacing.md }]}
                    onPress={puedeEscribir ? () => editarLev(t.key, a.key) : undefined}
                  >
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle}>Por {a.plural}</Text>
                      <Text style={styles.pct}>{l ? `${pct.toFixed(0)}%` : '—'}</Text>
                    </View>
                    <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, pct)}%` }]} /></View>
                    <Text style={styles.meta}>
                      {l ? `${l.realizados} de ${l.total_requerido} realizados` : puedeEscribir ? 'Toca para capturar el total requerido y los realizados' : 'Sin captura'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))
        ) : (
          AMBITOS.map((a) => {
            const rows = salv.filter((r) => r.ambito === a.key);
            return (
              <View key={a.key} style={{ marginBottom: spacing.lg }}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Por {a.plural}</Text>
                  {puedeEscribir ? (
                    <Pressable accessibilityRole="button"
                      onPress={() => setSalvDraft({ id: null, ambito: a.key, etiqueta: '', inicio: hoyISO(), liberacion: '', obs: '' })}
                      style={styles.addBtn}
                    >
                      <Ionicons name="add" size={16} color={colors.primary} />
                      <Text style={styles.addBtnTxt}>Nuevo</Text>
                    </Pressable>
                  ) : null}
                </View>
                {rows.length === 0 ? (
                  <View style={[styles.card, styles.empty]}>
                    <Text style={styles.emptyTxt}>Sin registros por {a.plural}.</Text>
                  </View>
                ) : rows.map((r) => {
                  const puedeBorrar = puedeEscribir && (puedeBorrarTodo || r.created_by === user?.id);
                  return (
                    <Pressable accessibilityRole="button"
                      key={r.id} style={[styles.card, styles.row]}
                      onPress={puedeEscribir ? () => setSalvDraft({
                        id: r.id, ambito: r.ambito, etiqueta: r.etiqueta, inicio: r.fecha_inicio,
                        liberacion: r.fecha_liberacion || '', obs: r.observaciones || '',
                      }) : undefined}
                    >
                      <View style={[styles.dot, { backgroundColor: r.fecha_liberacion ? '#16A34A' : '#F59E0B' }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{r.etiqueta}</Text>
                        <Text style={styles.meta}>
                          {fmtFecha(r.fecha_inicio)} → {r.fecha_liberacion ? fmtFecha(r.fecha_liberacion) : 'en curso'}
                        </Text>
                        {r.observaciones ? <Text style={styles.meta} numberOfLines={2}>{r.observaciones}</Text> : null}
                      </View>
                      {puedeBorrar ? (
                        <Pressable accessibilityRole="button" accessibilityLabel="Eliminar" hitSlop={8} onPress={() => borrarSalv(r)}>
                          <Ionicons name="trash-outline" size={18} color={colors.error} />
                        </Pressable>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Modal: contadores de un levantamiento */}
      <Modal visible={!!levDraft} transparent animationType="slide" onRequestClose={() => setLevDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {levDraft ? `${TIPOS.find((t) => t.key === levDraft.tipo)?.label} · ${AMBITOS.find((a) => a.key === levDraft.ambito)?.plural}` : ''}
            </Text>
            <Text style={styles.fieldLabel}>Total requerido</Text>
            <TextInput
              value={levDraft?.total ?? ''} keyboardType="number-pad" style={styles.input}
              onChangeText={(t) => setLevDraft((d) => (d ? { ...d, total: t.replace(/[^0-9]/g, '') } : d))}
              placeholder="99" placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.fieldLabel}>Realizados</Text>
            <TextInput
              value={levDraft?.realizados ?? ''} keyboardType="number-pad" style={styles.input}
              onChangeText={(t) => setLevDraft((d) => (d ? { ...d, realizados: t.replace(/[^0-9]/g, '') } : d))}
              placeholder="49" placeholderTextColor={colors.textMuted}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setLevDraft(null)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={guardarLev} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: registro de salvamento arqueológico */}
      <Modal visible={!!salvDraft} transparent animationType="slide" onRequestClose={() => setSalvDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {salvDraft?.id ? 'Editar' : 'Nuevo'} · salvamento por {AMBITOS.find((a) => a.key === salvDraft?.ambito)?.plural}
            </Text>
            <Text style={styles.fieldLabel}>{salvDraft?.ambito === 'poste' ? 'Poste' : 'Punto de sondeo'}</Text>
            <TextInput
              value={salvDraft?.etiqueta ?? ''} style={styles.input} autoCapitalize="characters"
              onChangeText={(t) => setSalvDraft((d) => (d ? { ...d, etiqueta: t } : d))}
              placeholder={salvDraft?.ambito === 'poste' ? 'S2' : 'UNIVERSIDAD PS2'} placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.fieldLabel}>Fecha de inicio (AAAA-MM-DD)</Text>
            <TextInput
              value={salvDraft?.inicio ?? ''} style={styles.input} autoCapitalize="none"
              onChangeText={(t) => setSalvDraft((d) => (d ? { ...d, inicio: t } : d))}
              placeholder="2026-05-13" placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.fieldLabel}>Fecha de liberación (vacío = en curso)</Text>
            <TextInput
              value={salvDraft?.liberacion ?? ''} style={styles.input} autoCapitalize="none"
              onChangeText={(t) => setSalvDraft((d) => (d ? { ...d, liberacion: t } : d))}
              placeholder="2026-06-02" placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.fieldLabel}>Observaciones</Text>
            <TextInput
              value={salvDraft?.obs ?? ''} style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]} multiline
              onChangeText={(t) => setSalvDraft((d) => (d ? { ...d, obs: t } : d))}
              placeholder="Opcional" placeholderTextColor={colors.textMuted}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setSalvDraft(null)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={guardarSalv} style={{ flex: 1 }} />
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
  tabsRow: { flexDirection: 'row', gap: 8, padding: spacing.md, paddingBottom: 0 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.surface },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  scroll: { padding: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  empty: { alignItems: 'center', padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  pct: { fontSize: 14, fontWeight: '800', color: colors.primary },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden', marginBottom: 6 },
  fill: { height: 8, backgroundColor: '#16A34A' },
  meta: { fontSize: 12, color: colors.textMuted },
  dot: { width: 12, height: 12, borderRadius: 6 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md,
    paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
