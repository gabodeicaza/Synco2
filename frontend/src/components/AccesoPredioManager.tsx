// Acceso al Predio / Situacion Social - edicion masiva por nodo. Antes
// mostraba SIEMPRE los subtramos (nodos a profundidad 1), sin excepcion.
// Ahora el Coordinador/Sub-Coordinador puede elegir explicitamente que
// nodos participan (a cualquier profundidad, no solo Subtramo) via el
// selector de arbol; el backend resuelve el default historico
// (`acceso_predio_efectivo`, ver _acceso_predio_efectivo en server.py) para
// que los proyectos existentes no pierdan lo que ya tenían configurado.
// Estos campos se muestran en la pagina de resumen exportada (PDF/PPT).
// Reusado por la ruta de Coordinador (tab Configuracion) y por el menu
// hamburguesa de Sub-Coordinador via HeaderMenu (Especialista no tiene
// acceso: el backend solo permite escribir estos campos a esos dos roles).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert, TextInput, Modal, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, LocationNode, PosteEstatus } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';

type AccesoValue = 'Con acceso' | 'Sin acceso' | null;
type TipoNodo = 'estacion' | 'intertramo';
type PosteCampo = 'pilas' | 'cabezal' | 'fuste' | 'poste';

// Columnas de la tabla "Actividad en Postes" del resumen impreso Intertramo
// (ver draw_intertramo_summary_page/`_slide` en server.py) — cada hijo
// DIRECTO de un nodo tipo "intertramo" es un "Poste" con 4 estatus propios.
const POSTE_CAMPOS: { campo: PosteCampo; label: string }[] = [
  { campo: 'pilas', label: 'Pilas' },
  { campo: 'cabezal', label: 'Cabezal' },
  { campo: 'fuste', label: 'Fuste' },
  { campo: 'poste', label: 'Poste' },
];

const ESTATUS_OPTIONS: { value: PosteEstatus; label: string }[] = [
  { value: 'sin_iniciar', label: 'Sin iniciar' },
  { value: 'en_proceso', label: 'En proceso' },
  { value: 'concluido', label: 'Concluido' },
];

const ESTATUS_LABEL: Record<PosteEstatus, string> = {
  sin_iniciar: 'Sin iniciar', en_proceso: 'En proceso', concluido: 'Concluido',
};

const ESTATUS_COLOR: Record<PosteEstatus, string> = {
  sin_iniciar: '#DC2626', en_proceso: '#D97706', concluido: '#16A34A',
};

function nodePathNames(nodeId: string, byId: Record<string, LocationNode>): string[] {
  const names: string[] = [];
  let current: LocationNode | undefined = byId[nodeId];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    names.unshift(current.name);
    seen.add(current.id);
    current = current.parent_id ? byId[current.parent_id] : undefined;
  }
  return names;
}

// Orden de árbol real (padre seguido de sus hijos, en `order`) — no el
// orden plano por profundidad que devuelve la API, que mezcla ramas.
function nodesEnOrdenDeArbol(nodes: LocationNode[]): LocationNode[] {
  const byParent: Record<string, LocationNode[]> = {};
  nodes.forEach((n) => {
    const key = n.parent_id || '__root__';
    (byParent[key] = byParent[key] || []).push(n);
  });
  Object.values(byParent).forEach((list) => list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)));
  const out: LocationNode[] = [];
  function walk(parentKey: string) {
    (byParent[parentKey] || []).forEach((n) => {
      out.push(n);
      walk(n.id);
    });
  }
  walk('__root__');
  return out;
}

export function AccesoPredioManager({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(true);
  const [allNodes, setAllNodes] = useState<LocationNode[]>([]);
  const [accesoBusy, setAccesoBusy] = useState<Record<string, boolean>>({});
  const [situDrafts, setSituDrafts] = useState<Record<string, string>>({});
  const [situBusy, setSituBusy] = useState<Record<string, boolean>>({});
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [habilitadoBusy, setHabilitadoBusy] = useState<Record<string, boolean>>({});
  const [tipoBusy, setTipoBusy] = useState<Record<string, boolean>>({});
  const [ubicacionDrafts, setUbicacionDrafts] = useState<Record<string, string>>({});
  const [ubicacionBusy, setUbicacionBusy] = useState<Record<string, boolean>>({});
  const [estatusBusy, setEstatusBusy] = useState<Record<string, boolean>>({});
  const [estatusPicker, setEstatusPicker] = useState<{ childId: string; campo: PosteCampo; label: string } | null>(null);

  const byId = useMemo(() => {
    const m: Record<string, LocationNode> = {};
    allNodes.forEach((n) => { m[n.id] = n; });
    return m;
  }, [allNodes]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const nodes = await api.listNodes(projectId);
      setAllNodes(nodes || []);
      const drafts: Record<string, string> = {};
      const ubicDrafts: Record<string, string> = {};
      (nodes || []).forEach((n) => {
        drafts[n.id] = n.situacion_social || '';
        ubicDrafts[n.id] = n.ubicacion || '';
      });
      setSituDrafts(drafts);
      setUbicacionDrafts(ubicDrafts);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el arbol de nodos');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const nodosHabilitados = useMemo(
    () => nodesEnOrdenDeArbol(allNodes).filter((n) => n.acceso_predio_efectivo),
    [allNodes],
  );

  async function setAcceso(nodeId: string, value: AccesoValue) {
    if (accesoBusy[nodeId]) return;
    setAccesoBusy((b) => ({ ...b, [nodeId]: true }));
    try {
      const updated = await api.updateNode(nodeId, { acceso_predio: value });
      setAllNodes((list) => list.map((s) => (s.id === nodeId ? { ...s, acceso_predio: updated.acceso_predio } : s)));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo actualizar el acceso al predio');
    } finally {
      setAccesoBusy((b) => ({ ...b, [nodeId]: false }));
    }
  }

  async function saveSituacion(nodeId: string) {
    if (situBusy[nodeId]) return;
    setSituBusy((b) => ({ ...b, [nodeId]: true }));
    try {
      const draft = (situDrafts[nodeId] || '').trim();
      const updated = await api.updateNode(nodeId, { situacion_social: draft || null });
      setAllNodes((list) => list.map((s) => (s.id === nodeId ? { ...s, situacion_social: updated.situacion_social } : s)));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo guardar la situacion social');
    } finally {
      setSituBusy((b) => ({ ...b, [nodeId]: false }));
    }
  }

  async function toggleHabilitado(node: LocationNode) {
    if (habilitadoBusy[node.id]) return;
    const nuevoValor = !node.acceso_predio_efectivo;
    setHabilitadoBusy((b) => ({ ...b, [node.id]: true }));
    try {
      await api.updateNode(node.id, { acceso_predio_habilitado: nuevoValor });
      setAllNodes((list) => list.map((n) => (
        n.id === node.id ? { ...n, acceso_predio_habilitado: nuevoValor, acceso_predio_efectivo: nuevoValor } : n
      )));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo actualizar');
    } finally {
      setHabilitadoBusy((b) => ({ ...b, [node.id]: false }));
    }
  }

  // Define qué formato usa el resumen impreso de este nodo — ver
  // draw_subtramo_summary_page (Estación) vs draw_intertramo_summary_page
  // (Intertramo, con la tabla "Actividad en Postes") en server.py.
  async function setTipoNodo(node: LocationNode, tipo: TipoNodo) {
    if (tipoBusy[node.id] || (node.tipo_nodo || 'estacion') === tipo) return;
    setTipoBusy((b) => ({ ...b, [node.id]: true }));
    try {
      const updated = await api.updateNode(node.id, { tipo_nodo: tipo });
      setAllNodes((list) => list.map((n) => (n.id === node.id ? { ...n, tipo_nodo: updated.tipo_nodo } : n)));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cambiar el tipo de resumen');
    } finally {
      setTipoBusy((b) => ({ ...b, [node.id]: false }));
    }
  }

  async function saveUbicacion(childId: string) {
    if (ubicacionBusy[childId]) return;
    setUbicacionBusy((b) => ({ ...b, [childId]: true }));
    try {
      const draft = (ubicacionDrafts[childId] || '').trim();
      const updated = await api.updateNode(childId, { ubicacion: draft });
      setAllNodes((list) => list.map((n) => (n.id === childId ? { ...n, ubicacion: updated.ubicacion } : n)));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo guardar la ubicación');
    } finally {
      setUbicacionBusy((b) => ({ ...b, [childId]: false }));
    }
  }

  // Estatus de una celda (Pilas/Cabezal/Fuste/Poste) de un hijo de nodo
  // Intertramo — columnas de la tabla "Actividad en Postes" impresa.
  async function setEstatusPoste(childId: string, campo: PosteCampo, value: PosteEstatus) {
    const busyKey = `${childId}:${campo}`;
    if (estatusBusy[busyKey]) return;
    setEstatusBusy((b) => ({ ...b, [busyKey]: true }));
    try {
      const field = `estatus_${campo}` as const;
      const updated = await api.updateNode(childId, { [field]: value });
      setAllNodes((list) => list.map((n) => (n.id === childId ? { ...n, [field]: (updated as any)[field] } : n)));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo actualizar el estatus');
    } finally {
      setEstatusBusy((b) => ({ ...b, [busyKey]: false }));
    }
  }

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.help}>
          Estatus de acceso y situacion social de cada nodo habilitado. Se muestran en la pagina de resumen exportada (PDF/PPT).
        </Text>

        <Pressable onPress={() => setSelectorOpen(true)} style={styles.configRow}>
          <Ionicons name="options-outline" size={18} color={colors.primary} />
          <Text style={styles.configRowTxt}>Elegir que nodos tienen Acceso al Predio</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        {nodosHabilitados.length === 0 ? (
          <Text style={styles.empty}>Ningun nodo esta habilitado para Acceso al Predio todavia.</Text>
        ) : (
          nodosHabilitados.map((s) => {
            const acceso = (s.acceso_predio as AccesoValue) || null;
            const dirty = (situDrafts[s.id] || '') !== (s.situacion_social || '');
            const path = nodePathNames(s.id, byId);
            const breadcrumb = path.slice(0, -1).join(' › ') || 'Raiz';
            return (
              <View key={s.id} style={styles.card}>
                <Text style={styles.tramoLabel} numberOfLines={1}>{breadcrumb}</Text>
                <Text style={styles.subtramoName} numberOfLines={2}>{s.name}</Text>

                <Text style={styles.fieldLabel}>Formato del resumen impreso</Text>
                <View style={styles.tipoRow}>
                  {(['estacion', 'intertramo'] as TipoNodo[]).map((tipo) => {
                    const activo = (s.tipo_nodo || 'estacion') === tipo;
                    return (
                      <Pressable
                        key={tipo}
                        onPress={() => setTipoNodo(s, tipo)}
                        disabled={!!tipoBusy[s.id]}
                        style={[styles.tipoBtn, activo && styles.tipoBtnActive]}
                      >
                        <Text style={[styles.tipoTxt, activo && styles.tipoTxtActive]}>
                          {tipo === 'estacion' ? 'Estación' : 'Intertramo'}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {tipoBusy[s.id] ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                </View>

                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => setAcceso(s.id, acceso === 'Con acceso' ? null : 'Con acceso')}
                    disabled={!!accesoBusy[s.id]}
                    style={[styles.toggleBtn, acceso === 'Con acceso' && styles.toggleBtnOnGreen]}
                  >
                    <Ionicons name="checkmark-circle-outline" size={18} color={acceso === 'Con acceso' ? '#fff' : colors.textBody} />
                    <Text style={[styles.toggleTxt, acceso === 'Con acceso' && styles.toggleTxtOn]}>Con acceso</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setAcceso(s.id, acceso === 'Sin acceso' ? null : 'Sin acceso')}
                    disabled={!!accesoBusy[s.id]}
                    style={[styles.toggleBtn, acceso === 'Sin acceso' && styles.toggleBtnOnRed]}
                  >
                    <Ionicons name="close-circle-outline" size={18} color={acceso === 'Sin acceso' ? '#fff' : colors.textBody} />
                    <Text style={[styles.toggleTxt, acceso === 'Sin acceso' && styles.toggleTxtOn]}>Sin acceso</Text>
                  </Pressable>
                  {accesoBusy[s.id] ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                </View>

                <Text style={styles.fieldLabel}>Situacion Social - Liberacion Fisica del Predio</Text>
                <TextInput
                  value={situDrafts[s.id] || ''}
                  onChangeText={(t) => setSituDrafts((d) => ({ ...d, [s.id]: t }))}
                  placeholder={'Una linea por punto, ej.:\nPredio liberado en su totalidad\nPendiente firma de convenio'}
                  placeholderTextColor={colors.textMuted}
                  style={styles.situInput}
                  multiline
                  editable={!situBusy[s.id]}
                />
                {dirty ? (
                  <Pressable
                    onPress={() => saveSituacion(s.id)}
                    disabled={!!situBusy[s.id]}
                    style={styles.saveBtn}
                  >
                    {situBusy[s.id] ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="save-outline" size={16} color="#fff" />
                        <Text style={styles.saveBtnTxt}>Guardar</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}

                {(s.tipo_nodo || 'estacion') === 'intertramo' ? (
                  <View style={styles.postesBlock}>
                    <Text style={styles.fieldLabel}>Actividad en Postes</Text>
                    <Text style={styles.postesHelp}>
                      Un renglón por cada hijo directo de este nodo (Poste). Se imprime tal cual en el resumen exportado.
                    </Text>
                    {allNodes
                      .filter((n) => n.parent_id === s.id)
                      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
                      .map((child) => {
                        const ubicDirty = (ubicacionDrafts[child.id] || '') !== (child.ubicacion || '');
                        return (
                          <View key={child.id} style={styles.posteCard}>
                            <Text style={styles.posteName} numberOfLines={1}>{child.name}</Text>
                            <View style={styles.posteUbicRow}>
                              <TextInput
                                value={ubicacionDrafts[child.id] || ''}
                                onChangeText={(t) => setUbicacionDrafts((d) => ({ ...d, [child.id]: t }))}
                                placeholder="Ubicación (ej. Yobain)"
                                placeholderTextColor={colors.textMuted}
                                style={styles.posteUbicInput}
                                editable={!ubicacionBusy[child.id]}
                              />
                              {ubicDirty ? (
                                <Pressable
                                  onPress={() => saveUbicacion(child.id)}
                                  disabled={!!ubicacionBusy[child.id]}
                                  style={styles.posteUbicSaveBtn}
                                >
                                  {ubicacionBusy[child.id] ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                  ) : (
                                    <Ionicons name="save-outline" size={14} color="#fff" />
                                  )}
                                </Pressable>
                              ) : null}
                            </View>
                            <View style={styles.posteCamposRow}>
                              {POSTE_CAMPOS.map(({ campo, label }) => {
                                const field = `estatus_${campo}` as const;
                                const value = (child[field] as PosteEstatus) || 'sin_iniciar';
                                const busyKey = `${child.id}:${campo}`;
                                return (
                                  <Pressable
                                    key={campo}
                                    onPress={() => setEstatusPicker({ childId: child.id, campo, label })}
                                    disabled={!!estatusBusy[busyKey]}
                                    style={styles.posteCampoBtn}
                                  >
                                    <Text style={styles.posteCampoLabel}>{label}</Text>
                                    <View style={styles.posteCampoValueRow}>
                                      <View style={[styles.posteCampoDot, { backgroundColor: ESTATUS_COLOR[value] }]} />
                                      <Text style={styles.posteCampoValue} numberOfLines={1}>{ESTATUS_LABEL[value]}</Text>
                                      {estatusBusy[busyKey] ? (
                                        <ActivityIndicator size="small" color={colors.primary} />
                                      ) : (
                                        <Ionicons name="chevron-down" size={13} color={colors.textMuted} />
                                      )}
                                    </View>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        );
                      })}
                    {allNodes.filter((n) => n.parent_id === s.id).length === 0 ? (
                      <Text style={styles.postesEmpty}>Este nodo todavía no tiene hijos (Postes) en el árbol.</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={!!estatusPicker} transparent animationType="fade" onRequestClose={() => setEstatusPicker(null)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setEstatusPicker(null)}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>{estatusPicker?.label}</Text>
            {ESTATUS_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={styles.pickerOption}
                onPress={() => {
                  if (estatusPicker) setEstatusPoste(estatusPicker.childId, estatusPicker.campo, opt.value);
                  setEstatusPicker(null);
                }}
              >
                <View style={[styles.posteCampoDot, { backgroundColor: ESTATUS_COLOR[opt.value] }]} />
                <Text style={styles.pickerOptionTxt}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={selectorOpen} animationType="slide" onRequestClose={() => setSelectorOpen(false)}>
        <View style={styles.selectorFlex}>
          <View style={styles.selectorHeader}>
            <Text style={styles.selectorTitle}>Nodos con Acceso al Predio</Text>
            <Pressable onPress={() => setSelectorOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <Text style={styles.selectorHelp}>
            Activa los nodos que deben mostrar estatus de acceso y situacion social. Por defecto solo los Subtramos vienen activados.
          </Text>
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: 4 }}>
            {nodesEnOrdenDeArbol(allNodes).map((n) => {
              const efectivo = !!n.acceso_predio_efectivo;
              return (
                <View key={n.id} style={[styles.selectorRow, { paddingLeft: 12 + n.depth * 18 }]}>
                  <Ionicons name={n.is_leaf ? 'location-outline' : 'git-network-outline'} size={15} color={colors.textMuted} />
                  <Text style={styles.selectorRowTxt} numberOfLines={1}>{n.name}</Text>
                  {habilitadoBusy[n.id] ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Switch
                      value={efectivo}
                      onValueChange={() => toggleHabilitado(n)}
                      trackColor={{ false: colors.border, true: colors.primary }}
                    />
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, paddingBottom: 60, gap: spacing.md },
  help: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  configRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primaryLight,
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
  },
  configRowTxt: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.primary },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontStyle: 'italic' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.card, gap: 10 },
  tramoLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  subtramoName: { fontSize: 16, fontWeight: '800', color: colors.text },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  toggleBtnOnGreen: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
  toggleBtnOnRed: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  toggleTxt: { fontSize: 13, fontWeight: '700', color: colors.textBody },
  toggleTxtOn: { color: '#fff' },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 4 },

  tipoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  tipoBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  tipoBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tipoTxt: { fontSize: 13, fontWeight: '700', color: colors.textBody },
  tipoTxtActive: { color: '#fff' },

  postesBlock: { marginTop: 6, gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  postesHelp: { fontSize: 11, color: colors.textMuted },
  postesEmpty: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  posteCard: {
    backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: 10, gap: 8,
  },
  posteName: { fontSize: 14, fontWeight: '800', color: colors.text },
  posteUbicRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  posteUbicInput: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: colors.text, backgroundColor: colors.surface,
  },
  posteUbicSaveBtn: {
    alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
    borderRadius: radius.sm, backgroundColor: colors.primary,
  },
  posteCamposRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  posteCampoBtn: {
    flexGrow: 1, minWidth: '47%', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.surface, gap: 3,
  },
  posteCampoLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  posteCampoValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  posteCampoDot: { width: 8, height: 8, borderRadius: 4 },
  posteCampoValue: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  pickerCard: { width: '100%', maxWidth: 320, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  pickerTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 6 },
  pickerOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 6 },
  pickerOptionTxt: { fontSize: 14, fontWeight: '600', color: colors.textBody },
  situInput: {
    minHeight: 72, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text,
    backgroundColor: colors.bg, textAlignVertical: 'top',
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.md, backgroundColor: colors.primary,
  },
  saveBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  selectorFlex: { flex: 1, backgroundColor: colors.bg },
  selectorHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  selectorTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  selectorHelp: { fontSize: 12, color: colors.textMuted, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  selectorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
    paddingRight: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  selectorRowTxt: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '600' },
});
