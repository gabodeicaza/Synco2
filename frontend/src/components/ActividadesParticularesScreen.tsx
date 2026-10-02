// Módulo "Actividades particulares" — lo que la supervisión hizo en cada
// estación/intertramo, ordenado por CATEGORÍA y SUBCATEGORÍA (las
// "ACTIVIDADES DESGLOSADAS" del reporte semanal integral). El catálogo de
// categorías es EDITABLE (Coordinador/Sub-Coordinador): crear, renombrar,
// cambiar subcategorías, borrar (si no tiene actividades) o cargar las
// sugeridas del reporte de referencia. Cada actividad es una viñeta: estación +
// categoría + subcategoría + texto + fecha. Captura abierta a cualquier rol de
// escritura; borrar: Coordinador/Sub-Coordinador o quien la capturó.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ActPartCategoria, ActPartRegistro, LocationNode, Project } from '@/src/api';
import { EstacionPicker } from '@/src/components/EstacionPicker';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { fechaTecleadaOk, FECHA_AYUDA } from '@/src/utils/fecha';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB, ROLE_JEFE } from '@/src/utils/roles';

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtFecha(iso?: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || '';
}

type Draft = { id: string | null; node_id: string | null; categoria_id: string | null; subcategoria: string; texto: string; fecha: string };
type CatDraft = { id: string | null; nombre: string; subs: string }; // subs: una por renglón

export default function ActividadesParticularesScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEscribir = user?.role !== ROLE_JEFE;
  const puedeCatalogo = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [cats, setCats] = useState<ActPartCategoria[]>([]);
  const [regs, setRegs] = useState<ActPartRegistro[]>([]);
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [catDraft, setCatDraft] = useState<CatDraft | null>(null);
  const [verCats, setVerCats] = useState(false);
  const [saving, setSaving] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, c, r, n] = await Promise.all([
        api.getProject(projectId), api.listActPartCatalogo(projectId), api.listActPart(projectId), api.listNodes(projectId),
      ]);
      setProject(proj); setCats(c); setRegs(r); setNodes(n);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar las actividades particulares.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const nombreNodo = useMemo(() => new Map(nodes.map((n) => [n.id, n.name])), [nodes]);
  const porNodo = useMemo(() => {
    const out = new Map<string, ActPartRegistro[]>();
    for (const r of regs) {
      const k = nombreNodo.get(r.node_id) || 'Sin ubicación';
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(r);
    }
    return Array.from(out.entries());
  }, [regs, nombreNodo]);

  const catSel = cats.find((c) => c.id === draft?.categoria_id) || null;

  async function onSave() {
    if (!draft) return;
    if (!draft.node_id) { Alert.alert('Falta información', 'Elige la estación o intertramo.'); return; }
    if (!draft.categoria_id) { Alert.alert('Falta información', 'Elige la categoría.'); return; }
    if (!draft.texto.trim()) { Alert.alert('Falta información', 'Escribe la actividad realizada.'); return; }
    if (!fechaTecleadaOk(draft.fecha)) { Alert.alert('Fecha inválida', FECHA_AYUDA); return; }
    const body = {
      node_id: draft.node_id, categoria_id: draft.categoria_id, subcategoria: draft.subcategoria.trim() || null,
      texto: draft.texto.trim(), fecha: draft.fecha.trim(),
    };
    try {
      setSaving(true);
      if (draft.id) await api.updateActPart(projectId, draft.id, body);
      else await api.createActPart(projectId, body);
      setDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(r: ActPartRegistro) {
    const ok = await confirm('Eliminar actividad', '¿Eliminar esta actividad?', { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try { await api.deleteActPart(projectId, r.id); await load(); }
    catch (e: any) { Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.'); }
  }

  async function onSaveCat() {
    if (!catDraft) return;
    const nombre = catDraft.nombre.trim();
    if (!nombre) { Alert.alert('Falta información', 'Escribe el nombre de la categoría.'); return; }
    const subcategorias = catDraft.subs.split('\n').map((s) => s.trim()).filter(Boolean);
    try {
      setSaving(true);
      if (catDraft.id) await api.updateActPartCategoria(projectId, catDraft.id, { nombre, subcategorias });
      else await api.createActPartCategoria(projectId, { nombre, subcategorias });
      setCatDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteCat(c: ActPartCategoria) {
    const ok = await confirm('Eliminar categoría', `¿Eliminar "${c.nombre}"?`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try { await api.deleteActPartCategoria(projectId, c.id); setCatDraft(null); await load(); }
    catch (e: any) { Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.'); }
  }

  async function onSugeridas() {
    try {
      const r = await api.cargarActPartSugeridas(projectId);
      Alert.alert('Listo', r.agregadas ? `Se agregaron ${r.agregadas} categorías sugeridas.` : 'Ya tienes todas las categorías sugeridas.');
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo cargar', e?.message || 'Intentalo nuevamente.');
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Actividades particulares</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        {puedeCatalogo ? (
          <View style={{ marginBottom: spacing.lg }}>
            <Pressable style={styles.sectionHeaderRow} onPress={() => setVerCats((v) => !v)}>
              <Text style={styles.sectionTitle}>Categorías ({cats.length})</Text>
              <Ionicons name={verCats ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </Pressable>
            {verCats ? (
              <>
                {cats.length === 0 ? (
                  <View style={[styles.card, styles.empty]}>
                    <Text style={styles.emptyTxt}>Aún no hay categorías. Carga las sugeridas del reporte semanal o crea las tuyas.</Text>
                  </View>
                ) : cats.map((c) => (
                  <Pressable key={c.id} style={[styles.card, { padding: spacing.md }]}
                    onPress={() => setCatDraft({ id: c.id, nombre: c.nombre, subs: c.subcategorias.join('\n') })}>
                    <Text style={styles.cardTitle}>{c.nombre}</Text>
                    <Text style={styles.meta}>{c.subcategorias.length ? c.subcategorias.join(' · ') : 'Sin subcategorías'}</Text>
                  </Pressable>
                ))}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button label="Cargar sugeridas" variant="secondary" onPress={onSugeridas} style={{ flex: 1 }} />
                  <Button label="Nueva categoría" onPress={() => setCatDraft({ id: null, nombre: '', subs: '' })} style={{ flex: 1 }} />
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Actividades</Text>
          {puedeEscribir ? (
            <Pressable
              onPress={() => (cats.length === 0
                ? Alert.alert('Sin categorías', 'El Coordinador o Sub-Coordinador debe definir las categorías primero.')
                : setDraft({ id: null, node_id: null, categoria_id: null, subcategoria: '', texto: '', fecha: hoyISO() }))}
              style={styles.addBtn}
            >
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={styles.addBtnTxt}>Nueva actividad</Text>
            </Pressable>
          ) : null}
        </View>

        {porNodo.length === 0 ? (
          <View style={[styles.card, styles.empty]}>
            <Text style={styles.emptyTxt}>Aún no hay actividades registradas.</Text>
          </View>
        ) : porNodo.map(([titulo, rows]) => (
          <View key={titulo} style={{ marginBottom: spacing.md }}>
            <Text style={styles.groupTitle}>{titulo}</Text>
            {rows.map((r) => {
              const puedeBorrar = puedeEscribir && (puedeCatalogo || r.created_by === user?.id);
              return (
                <Pressable key={r.id} style={[styles.card, styles.row]}
                  onPress={puedeEscribir ? () => setDraft({
                    id: r.id, node_id: r.node_id, categoria_id: r.categoria_id, subcategoria: r.subcategoria || '', texto: r.texto, fecha: r.fecha,
                  }) : undefined}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fecha}>{fmtFecha(r.fecha)} · {r.categoria_nombre}{r.subcategoria ? ` › ${r.subcategoria}` : ''}</Text>
                    <Text style={styles.desc}>{r.texto}</Text>
                  </View>
                  {puedeBorrar ? (
                    <Pressable hitSlop={8} onPress={() => onDelete(r)}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '92%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{draft?.id ? 'Editar actividad' : 'Nueva actividad'}</Text>
              <Text style={styles.fieldLabel}>Estación / intertramo</Text>
              <EstacionPicker nodes={nodes} value={draft?.node_id ?? null}
                onChange={(id) => setDraft((d) => (d ? { ...d, node_id: id } : d))} />
              <Text style={styles.fieldLabel}>Categoría</Text>
              <View style={styles.chips}>
                {cats.map((c) => (
                  <Pressable key={c.id} onPress={() => setDraft((d) => (d ? { ...d, categoria_id: c.id, subcategoria: '' } : d))}
                    style={[styles.chip, draft?.categoria_id === c.id && styles.chipOn]}>
                    <Text style={[styles.chipTxt, draft?.categoria_id === c.id && { color: '#fff' }]}>{c.nombre}</Text>
                  </Pressable>
                ))}
              </View>
              {catSel && catSel.subcategorias.length ? (
                <>
                  <Text style={styles.fieldLabel}>Subcategoría</Text>
                  <View style={styles.chips}>
                    {catSel.subcategorias.map((s) => (
                      <Pressable key={s} onPress={() => setDraft((d) => (d ? { ...d, subcategoria: d.subcategoria === s ? '' : s } : d))}
                        style={[styles.chip, draft?.subcategoria === s && styles.chipOn]}>
                        <Text style={[styles.chipTxt, draft?.subcategoria === s && { color: '#fff' }]}>{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}
              <Text style={styles.fieldLabel}>Actividad realizada</Text>
              <TextInput value={draft?.texto || ''} multiline placeholderTextColor={colors.textMuted}
                onChangeText={(t) => setDraft((d) => (d ? { ...d, texto: t } : d))}
                placeholder="Ej. Se concluyó la revisión del Estudio de Mecánica de Suelos del intertramo E1-E2"
                style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]} />
              <Text style={styles.fieldLabel}>Fecha (AAAA-MM-DD o DD/MM/AAAA)</Text>
              <TextInput value={draft?.fecha || ''} autoCapitalize="none" placeholderTextColor={colors.textMuted}
                onChangeText={(t) => setDraft((d) => (d ? { ...d, fecha: t } : d))} placeholder="2026-09-23" style={styles.input} />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label="Cancelar" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
                <Button label="Guardar" loading={saving} onPress={onSave} style={{ flex: 1 }} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!catDraft} transparent animationType="slide" onRequestClose={() => setCatDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{catDraft?.id ? 'Editar categoría' : 'Nueva categoría'}</Text>
            <Text style={styles.fieldLabel}>Nombre</Text>
            <TextInput value={catDraft?.nombre || ''} placeholderTextColor={colors.textMuted}
              onChangeText={(t) => setCatDraft((d) => (d ? { ...d, nombre: t } : d))}
              placeholder="ESTUDIOS Y ANÁLISIS" style={styles.input} />
            <Text style={styles.fieldLabel}>Subcategorías (una por renglón)</Text>
            <TextInput value={catDraft?.subs || ''} multiline placeholderTextColor={colors.textMuted}
              onChangeText={(t) => setCatDraft((d) => (d ? { ...d, subs: t } : d))}
              placeholder={'Mecánica de Suelos\nTopografía'} style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              {catDraft?.id ? (
                <Button label="Eliminar" variant="secondary" onPress={() => { const c = cats.find((x) => x.id === catDraft.id); if (c) onDeleteCat(c); }} style={{ flex: 1 }} />
              ) : null}
              <Button label="Cancelar" variant="secondary" onPress={() => setCatDraft(null)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={onSaveCat} style={{ flex: 1 }} />
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
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  groupTitle: { fontSize: 12, fontWeight: '800', color: colors.text, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  empty: { alignItems: 'center', padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  fecha: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  desc: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md,
    paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
