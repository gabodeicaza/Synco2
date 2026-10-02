// Módulo "Pruebas de Calidad" — concentrado tabular de las pruebas y
// verificaciones de calidad (concreto, acero, compactación, suministro de
// postes...) con las columnas del reporte semanal: Frente · Localización/Eje ·
// Elemento · Muestra No. · Fecha · Tipo · Observaciones. Mismo patrón "un
// componente hace todo, rutas delgadas por rol" que FotosLidarScreen.tsx.
// Captura abierta a cualquier rol de escritura (la hace el personal de
// calidad en campo); borrar: Coordinador/Sub-Coordinador o quien la capturó
// (el backend aplica el mismo criterio, ver `delete_prueba_calidad`).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, JerarquiaInforme, LocationNode, Project, PruebaCalidad } from '@/src/api';
import { JerarquiaInformePicker, JERARQUIA_DEFAULT } from '@/src/components/JerarquiaInformePicker';
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
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

type Draft = {
  id: string | null;
  node_id: string | null;
  grupo: string;
  frente: string;
  localizacion: string;
  elemento: string;
  muestra_no: string;
  fecha: string;
  tipo: string;
  observaciones: string;
  jerarquia: JerarquiaInforme;
};

const emptyDraft = (): Draft => ({
  id: null, node_id: null, grupo: '', frente: '', localizacion: '', elemento: '',
  muestra_no: '', fecha: hoyISO(), tipo: '', observaciones: '', jerarquia: JERARQUIA_DEFAULT,
});

export default function PruebasCalidadScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEscribir = user?.role !== ROLE_JEFE;
  const puedeBorrarTodo = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<PruebaCalidad[]>([]);
  const [nodes, setNodes] = useState<LocationNode[]>([]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, list, nodeList] = await Promise.all([
        api.getProject(projectId), api.listPruebasCalidad(projectId), api.listNodes(projectId),
      ]);
      setProject(proj);
      setItems(list);
      setNodes(nodeList);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar las pruebas de calidad.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Agrupa por estación/intertramo o, si no hay, por el texto libre `grupo`
  // — igual que el export, que imprime una tabla por cada grupo.
  const grupos = useMemo(() => {
    const nombre = new Map(nodes.map((n) => [n.id, n.name]));
    const out = new Map<string, PruebaCalidad[]>();
    for (const it of items) {
      const titulo = (it.node_id && nombre.get(it.node_id)) || (it.grupo || '').trim() || 'General';
      if (!out.has(titulo)) out.set(titulo, []);
      out.get(titulo)!.push(it);
    }
    return Array.from(out.entries());
  }, [items, nodes]);

  function openEdit(it: PruebaCalidad) {
    setDraft({
      id: it.id, node_id: it.node_id || null, grupo: it.grupo || '', frente: it.frente,
      localizacion: it.localizacion || '', elemento: it.elemento || '', muestra_no: it.muestra_no || '',
      fecha: it.fecha, tipo: it.tipo || '', observaciones: it.observaciones || '',
      jerarquia: it.jerarquia || JERARQUIA_DEFAULT,
    });
  }

  async function onSave() {
    if (!draft) return;
    if (!draft.frente.trim()) {
      Alert.alert('Falta información', 'Indica el frente (ej. "Poste S-2" o "Banqueta adecuación").');
      return;
    }
    if (!fechaTecleadaOk(draft.fecha)) {
      Alert.alert('Fecha inválida', FECHA_AYUDA);
      return;
    }
    const body = {
      node_id: draft.node_id, grupo: draft.grupo, frente: draft.frente, localizacion: draft.localizacion,
      elemento: draft.elemento, muestra_no: draft.muestra_no, fecha: draft.fecha.trim(),
      tipo: draft.tipo, observaciones: draft.observaciones, jerarquia: draft.jerarquia,
    };
    try {
      setSaving(true);
      if (draft.id) await api.updatePruebaCalidad(projectId, draft.id, body);
      else await api.createPruebaCalidad(projectId, body);
      setDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(it: PruebaCalidad) {
    const ok = await confirm('Eliminar prueba', `¿Eliminar la prueba de "${it.frente}" del ${fmtFecha(it.fecha)}?`, {
      confirmText: 'Eliminar', destructive: true,
    });
    if (!ok) return;
    try {
      await api.deletePruebaCalidad(projectId, it.id);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    }
  }

  function field(label: string, key: keyof Draft, placeholder: string, multiline = false) {
    return (
      <>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          value={draft ? (draft[key] as string) : ''}
          onChangeText={(t) => setDraft((d) => (d ? { ...d, [key]: t } : d))}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, multiline && { minHeight: 64, textAlignVertical: 'top' }]}
          multiline={multiline}
          autoCapitalize={key === 'fecha' ? 'none' : 'sentences'}
        />
      </>
    );
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
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Pruebas de Calidad</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Concentrado</Text>
          {puedeEscribir ? (
            <Pressable onPress={() => setDraft(emptyDraft())} style={styles.addBtn}>
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={styles.addBtnTxt}>Nueva prueba</Text>
            </Pressable>
          ) : null}
        </View>

        {grupos.length === 0 ? (
          <View style={[styles.card, styles.empty]}>
            <Ionicons name="flask-outline" size={22} color={colors.textMuted} />
            <Text style={styles.emptyTxt}>
              {puedeEscribir
                ? 'Aún no hay pruebas. Registra cada prueba o verificación con su frente, elemento, tipo y fecha.'
                : 'Aún no hay pruebas de calidad registradas.'}
            </Text>
          </View>
        ) : (
          grupos.map(([titulo, rows]) => (
            <View key={titulo} style={{ marginBottom: spacing.md }}>
              <Text style={styles.groupTitle}>{titulo}</Text>
              {rows.map((it) => {
                const puedeBorrar = puedeEscribir && (puedeBorrarTodo || it.created_by === user?.id);
                return (
                  <Pressable
                    key={it.id} style={[styles.card, { padding: spacing.md }]}
                    onPress={puedeEscribir ? () => openEdit(it) : undefined}
                  >
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle} numberOfLines={2}>{it.frente}</Text>
                      <Text style={styles.fecha}>{fmtFecha(it.fecha)}</Text>
                      {puedeBorrar ? (
                        <Pressable hitSlop={8} onPress={() => onDelete(it)}>
                          <Ionicons name="trash-outline" size={18} color={colors.error} />
                        </Pressable>
                      ) : null}
                    </View>
                    <Text style={styles.meta}>
                      {[it.localizacion, it.elemento, it.tipo].filter(Boolean).join(' · ') || 'Sin detalle'}
                    </Text>
                    <Text style={styles.meta}>Muestra: {it.muestra_no || 'No Aplica'}</Text>
                    {it.observaciones ? <Text style={styles.obs}>{it.observaciones}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '92%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{draft?.id ? 'Editar prueba' : 'Nueva prueba'}</Text>
              <Text style={styles.fieldLabel}>Estación / intertramo</Text>
              <EstacionPicker
                nodes={nodes} value={draft?.node_id ?? null}
                onChange={(id) => setDraft((d) => (d ? { ...d, node_id: id } : d))}
              />
              {draft && !draft.node_id
                ? field('Grupo (si no es una estación)', 'grupo', 'Ej. Suministro Gefsa-Puebla')
                : null}
              {field('Frente', 'frente', 'Ej. Banqueta adecuación Poste S-2')}
              {field('Localización / eje', 'localizacion', 'Ej. E1 - E2')}
              {field('Elemento', 'elemento', 'Ej. banqueta, pila, poste')}
              {field('Muestra No.', 'muestra_no', 'Vacío = No Aplica')}
              {field('Fecha de la prueba (AAAA-MM-DD)', 'fecha', '2026-06-26')}
              {field('Tipo', 'tipo', 'Ej. Concreto normal f\'c=150 kg/cm2')}
              {field('Observaciones', 'observaciones', 'Ej. Se verifica concreto suministrado', true)}
              <JerarquiaInformePicker
                value={draft?.jerarquia}
                onChange={(j) => setDraft((d) => (d ? { ...d, jerarquia: j } : d))}
              />
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
  groupTitle: { fontSize: 12, fontWeight: '800', color: colors.text, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.sm },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  fecha: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  meta: { fontSize: 12, color: colors.textMuted },
  obs: { fontSize: 12, color: colors.text, marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.sm, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md,
    paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
