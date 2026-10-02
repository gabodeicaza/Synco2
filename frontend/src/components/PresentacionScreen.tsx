// Presentación (Informe de Actividades semanal) — lista de presentaciones +
// editor de secciones. Mismo patrón "un componente hace todo" que
// EstudiosProyectoScreen.tsx/PlanoAvanceScreen.tsx. Crear/borrar/reordenar
// secciones es exclusivo de Coordinador/Sub-Coordinador; editar el
// CONTENIDO de una sección "informacion_particular" (texto de actividades y
// fotos) lo puede hacer cualquier rol de escritura (Especialista incluido).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  api, InformacionParticularBloque, InformacionParticularFoto, LocationNode, PlanoAvance,
  Presentacion, PresentacionSeccion, PresentacionSeccionTipo, Project, ReporteSemanaItem,
} from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_JEFE, ROLE_SUB } from '@/src/utils/roles';

const TIPO_ICON: Record<PresentacionSeccionTipo, keyof typeof Ionicons.glyphMap> = {
  portada: 'bookmark-outline',
  mapa_general: 'map-outline',
  divisor: 'flag-outline',
  financiero: 'cash-outline',
  seguimiento_estudios: 'analytics-outline',
  croquis_estacion: 'business-outline',
  informacion_particular: 'images-outline',
  avance_grafico: 'construct-outline',
  reportes_semana: 'newspaper-outline',
  cierre: 'checkmark-done-outline',
  ambiental: 'leaf-outline',
  social: 'people-outline',
  seguridad: 'shield-checkmark-outline',
  proyecto: 'document-text-outline',
  calidad: 'ribbon-outline',
  pendientes: 'alert-circle-outline',
};

const TIPO_LABEL: Record<PresentacionSeccionTipo, string> = {
  portada: 'Portada',
  mapa_general: 'Mapa General',
  divisor: 'Divisor de sección',
  financiero: 'Financiero',
  seguimiento_estudios: 'Seguimiento a Estudios y Análisis',
  croquis_estacion: 'Croquis General (Estación)',
  informacion_particular: 'Información Particular',
  avance_grafico: 'Avance Gráfico (Plano)',
  reportes_semana: 'Reportes de la semana',
  cierre: 'Cierre (Gracias)',
  ambiental: 'Ambiental (automático)',
  social: 'Social / Impacto urbano (automático)',
  seguridad: 'Seguridad (automático)',
  proyecto: 'Estudios y proyecto ejecutivo (automático)',
  calidad: 'Calidad (automático)',
  pendientes: 'Pendientes generales (automático)',
};

const TIPO_ORDEN_PICKER: PresentacionSeccionTipo[] = [
  'portada', 'mapa_general', 'divisor', 'financiero',
  'seguimiento_estudios', 'croquis_estacion', 'informacion_particular', 'avance_grafico',
  'reportes_semana', 'proyecto', 'calidad', 'pendientes', 'ambiental', 'social', 'seguridad', 'cierre',
];

/** "4 – 10 sep" a partir de la fecha del informe (fecha − 6 días .. fecha). */
function weekRangeLabel(fechaIso: string): string {
  const [y, m, d] = fechaIso.split('-').map((v) => parseInt(v, 10));
  const end = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const f = (dt: Date) => dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${f(start)} – ${f(end)}`;
}

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function PresentacionScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const canEditEstructura = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [lista, setLista] = useState<Presentacion[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Presentacion | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [fechaDraft, setFechaDraft] = useState(todayIso());
  const [tituloDraft, setTituloDraft] = useState('INFORME DE ACTIVIDADES');
  const [creating, setCreating] = useState(false);
  const [plantillaSemanal, setPlantillaSemanal] = useState(true);

  // Selector de reportes de la semana (sección 'reportes_semana')
  const [reportesSeccion, setReportesSeccion] = useState<PresentacionSeccion | null>(null);
  const [reportesSemana, setReportesSemana] = useState<ReporteSemanaItem[]>([]);
  const [reportesSel, setReportesSel] = useState<string[]>([]);
  const [reportesLoading, setReportesLoading] = useState(false);
  const [savingReportes, setSavingReportes] = useState(false);

  const [tipoPickerOpen, setTipoPickerOpen] = useState(false);
  const [configTipo, setConfigTipo] = useState<PresentacionSeccionTipo | null>(null);
  const [configTitulo, setConfigTitulo] = useState('');
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [planos, setPlanos] = useState<PlanoAvance[]>([]);
  const [savingSeccion, setSavingSeccion] = useState(false);

  const [bloquesSeccion, setBloquesSeccion] = useState<PresentacionSeccion | null>(null);
  const [bloquesDraft, setBloquesDraft] = useState<InformacionParticularBloque[]>([]);
  const [savingBloques, setSavingBloques] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const loadList = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, items] = await Promise.all([api.getProject(projectId), api.listPresentaciones(projectId)]);
      setProject(proj);
      setLista(items);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar Presentación.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = useCallback(async (presId: string) => {
    try {
      setDetailLoading(true);
      const doc = await api.getPresentacion(projectId, presId);
      setDetail(doc);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar la presentación.');
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const secciones = useMemo(
    () => [...(detail?.secciones || [])].sort((a, b) => a.orden - b.orden),
    [detail],
  );

  async function onCreatePresentacion() {
    if (!fechaDraft.trim()) {
      Alert.alert('Falta información', 'Indica la fecha del reporte (YYYY-MM-DD).');
      return;
    }
    try {
      setCreating(true);
      const created = await api.createPresentacion(projectId, {
        fecha: fechaDraft.trim(), titulo: tituloDraft.trim() || undefined,
        plantilla: plantillaSemanal ? 'semanal' : undefined,
      });
      setNewOpen(false);
      await loadList();
      setSelectedId(created.id);
    } catch (e: any) {
      Alert.alert('No se pudo crear', e?.message || 'Intentalo nuevamente.');
    } finally {
      setCreating(false);
    }
  }

  async function onDeletePresentacion(p: Presentacion) {
    const ok = await confirm('Eliminar presentación', `¿Eliminar "${p.titulo}" (${p.fecha})?`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deletePresentacion(projectId, p.id);
      await loadList();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    }
  }

  function nextOrden(): number {
    return secciones.length ? Math.max(...secciones.map((s) => s.orden)) + 1 : 0;
  }

  async function onPickTipo(tipo: PresentacionSeccionTipo) {
    setTipoPickerOpen(false);
    if (tipo === 'divisor') {
      setConfigTipo('divisor');
      setConfigTitulo('');
      return;
    }
    if (tipo === 'croquis_estacion') {
      if (!nodes.length) {
        try { setNodes(await api.listNodes(projectId)); } catch { /* noop */ }
      }
      setConfigTipo('croquis_estacion');
      return;
    }
    if (tipo === 'avance_grafico') {
      if (!planos.length) {
        try { setPlanos(await api.listPlanosAvance(projectId)); } catch { /* noop */ }
      }
      setConfigTipo('avance_grafico');
      return;
    }
    if (tipo === 'reportes_semana') {
      if (!detail) return;
      try {
        const created = await api.addPresentacionSeccion(projectId, detail.id, { tipo, orden: nextOrden() });
        await loadDetail(detail.id);
        await openReportesSelector(created);
      } catch (e: any) {
        Alert.alert('No se pudo agregar', e?.message || 'Intentalo nuevamente.');
      }
      return;
    }
    // Tipos sin configuración adicional: se agregan directo.
    await createSeccion({ tipo });
  }

  async function createSeccion(body: { tipo: PresentacionSeccionTipo; titulo?: string; node_id?: string; plano_id?: string }) {
    if (!detail) return;
    try {
      setSavingSeccion(true);
      await api.addPresentacionSeccion(projectId, detail.id, { ...body, orden: nextOrden() });
      setConfigTipo(null);
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert('No se pudo agregar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSavingSeccion(false);
    }
  }

  async function onMoveSeccion(seccion: PresentacionSeccion, dir: -1 | 1) {
    if (!detail) return;
    const idx = secciones.findIndex((s) => s.id === seccion.id);
    const other = secciones[idx + dir];
    if (!other) return;
    try {
      await Promise.all([
        api.updatePresentacionSeccion(projectId, detail.id, seccion.id, { orden: other.orden }),
        api.updatePresentacionSeccion(projectId, detail.id, other.id, { orden: seccion.orden }),
      ]);
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert('No se pudo reordenar', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function onDeleteSeccion(seccion: PresentacionSeccion) {
    if (!detail) return;
    const ok = await confirm('Eliminar sección', `¿Eliminar "${TIPO_LABEL[seccion.tipo]}"?`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deletePresentacionSeccion(projectId, detail.id, seccion.id);
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function openReportesSelector(seccion: PresentacionSeccion) {
    if (!detail) return;
    setReportesSeccion(seccion);
    setReportesSel([...(seccion.report_ids || [])]);
    setReportesLoading(true);
    try {
      setReportesSemana(await api.listReportesSemanaPresentacion(projectId, detail.id));
    } catch (e: any) {
      setReportesSemana([]);
      Alert.alert('Error', e?.message || 'No se pudieron cargar los reportes de la semana.');
    } finally {
      setReportesLoading(false);
    }
  }

  function toggleReporte(id: string) {
    setReportesSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function saveReportes() {
    if (!detail || !reportesSeccion) return;
    try {
      setSavingReportes(true);
      // Solo ids que siguen en la ventana semanal (los demás ya no aplican).
      const vigentes = new Set(reportesSemana.map((r) => r.id));
      await api.updatePresentacionSeccion(projectId, detail.id, reportesSeccion.id, {
        report_ids: reportesSel.filter((id) => vigentes.has(id)),
      });
      setReportesSeccion(null);
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSavingReportes(false);
    }
  }

  function openBloquesEditor(seccion: PresentacionSeccion) {
    setBloquesSeccion(seccion);
    setBloquesDraft((seccion.bloques || []).map((b) => ({ ...b, actividades: [...b.actividades], fotos: [...b.fotos] })));
  }

  function addBloque() {
    setBloquesDraft((cur) => [...cur, { titulo: '', node_id: null, actividades: [], fotos: [] }]);
  }

  function updateBloque(idx: number, patch: Partial<InformacionParticularBloque>) {
    setBloquesDraft((cur) => cur.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }

  function removeBloque(idx: number) {
    setBloquesDraft((cur) => cur.filter((_, i) => i !== idx));
  }

  async function addFotoToBloque(idx: number) {
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { Alert.alert('Sin permiso', 'No hay permiso para acceder a la galería.'); return; }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.5,
      });
      if (result.canceled || !result.assets?.[0]?.base64) return;
      const asset = result.assets[0];
      const mime = asset.mimeType || 'image/jpeg';
      const photo = `data:${mime};base64,${asset.base64}`;
      const nueva: InformacionParticularFoto = { photo, caption: '', destacado: false, destacado_label: null };
      setBloquesDraft((cur) => cur.map((b, i) => (i === idx ? { ...b, fotos: [...b.fotos, nueva] } : b)));
    } catch (e: any) {
      Alert.alert('No se pudo agregar la foto', e?.message || 'Intentalo nuevamente.');
    }
  }

  function updateFoto(bIdx: number, fIdx: number, patch: Partial<InformacionParticularFoto>) {
    setBloquesDraft((cur) => cur.map((b, i) => {
      if (i !== bIdx) return b;
      return { ...b, fotos: b.fotos.map((f, j) => (j === fIdx ? { ...f, ...patch } : f)) };
    }));
  }

  function removeFoto(bIdx: number, fIdx: number) {
    setBloquesDraft((cur) => cur.map((b, i) => (i === bIdx ? { ...b, fotos: b.fotos.filter((_, j) => j !== fIdx) } : b)));
  }

  async function onSaveBloques() {
    if (!detail || !bloquesSeccion) return;
    const limpio = bloquesDraft.map((b) => ({ ...b, titulo: b.titulo.trim() || 'Sin título' }));
    try {
      setSavingBloques(true);
      await api.updateInformacionParticular(projectId, detail.id, bloquesSeccion.id, limpio);
      setBloquesSeccion(null);
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSavingBloques(false);
    }
  }

  // Navegación al preview según rol — PresentacionScreen es un componente
  // compartido entre (coord)/(subcoord)/(spec) (mismo patrón que
  // EstudiosProyectoScreen.tsx), y cada grupo de rutas espera un param
  // distinto (`id` en coord, `project_id` en subcoord/spec).
  function goToPreview() {
    if (!detail) return;
    if (user?.role === ROLE_COORD || user?.role === ROLE_JEFE) {
      router.push({ pathname: '/(coord)/projects/[id]/presentacion-preview' as any, params: { id: projectId, presentacion_id: detail.id } });
    } else if (user?.role === ROLE_SUB) {
      router.push({ pathname: '/(subcoord)/presentacion-preview' as any, params: { project_id: projectId, presentacion_id: detail.id } });
    } else {
      router.push({ pathname: '/(spec)/presentacion-preview' as any, params: { project_id: projectId, presentacion_id: detail.id } });
    }
  }

  function seccionSubtitle(s: PresentacionSeccion): string {
    if (s.tipo === 'divisor') return s.titulo || 'Sin título';
    if (s.tipo === 'croquis_estacion') return nodes.find((n) => n.id === s.node_id)?.name || s.node_id || 'Estación no cargada';
    if (s.tipo === 'avance_grafico') return planos.find((p) => p.id === s.plano_id)?.nombre || s.plano_id || 'Plano no cargado';
    if (['ambiental', 'social', 'seguridad', 'proyecto', 'calidad', 'pendientes'].includes(s.tipo)) {
      return 'Se llena solo con los módulos de la semana';
    }
    if (s.tipo === 'reportes_semana') {
      const n = (s.report_ids || []).length;
      return n ? `${n} reporte${n === 1 ? '' : 's'} elegido${n === 1 ? '' : 's'}` : 'Sin reportes elegidos — toca para elegir';
    }
    if (s.tipo === 'informacion_particular') return `${(s.bloques || []).length} bloque${(s.bloques || []).length === 1 ? '' : 's'}`;
    return 'Se arma en vivo al previsualizar/exportar';
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  // ======================= Vista de EDITOR de una presentación =======================
  if (selectedId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
          <View style={styles.headerTopRow}>
            <Pressable onPress={() => setSelectedId(null)} hitSlop={10} style={styles.iconBtn}>
              <Ionicons name="chevron-back" size={22} color={headerTextColor} />
            </Pressable>
            <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>{detail?.titulo || 'Presentación'}</Text>
            <Pressable hitSlop={10} style={styles.iconBtn} onPress={goToPreview}>
              <Ionicons name="eye-outline" size={20} color={headerTextColor} />
            </Pressable>
          </View>
        </View>

        {detailLoading || !detail ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Secciones</Text>
              {canEditEstructura ? (
                <Pressable onPress={() => setTipoPickerOpen(true)} style={styles.addBtn}>
                  <Ionicons name="add" size={16} color={colors.primary} />
                  <Text style={styles.addBtnTxt}>Agregar</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.card}>
              {secciones.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="albums-outline" size={22} color={colors.textMuted} />
                  <Text style={styles.emptyTxt}>Aún no hay secciones.</Text>
                </View>
              ) : (
                secciones.map((s, idx) => (
                  <View key={s.id} style={[styles.seccionRow, idx > 0 && styles.rowBorder]}>
                    <Ionicons name={TIPO_ICON[s.tipo]} size={20} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.seccionTitulo} numberOfLines={1}>{TIPO_LABEL[s.tipo]}</Text>
                      <Text style={styles.seccionSub} numberOfLines={1}>{seccionSubtitle(s)}</Text>
                    </View>
                    {s.tipo === 'reportes_semana' && canEditEstructura ? (
                      <Pressable onPress={() => openReportesSelector(s)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
                        <Ionicons name="checkbox-outline" size={18} color={colors.primary} />
                      </Pressable>
                    ) : null}
                    {s.tipo === 'informacion_particular' ? (
                      <Pressable onPress={() => openBloquesEditor(s)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
                        <Ionicons name="create-outline" size={18} color={colors.primary} />
                      </Pressable>
                    ) : null}
                    {canEditEstructura ? (
                      <>
                        <Pressable onPress={() => onMoveSeccion(s, -1)} hitSlop={8} disabled={idx === 0} style={{ paddingHorizontal: 2, opacity: idx === 0 ? 0.3 : 1 }}>
                          <Ionicons name="chevron-up" size={18} color={colors.textMuted} />
                        </Pressable>
                        <Pressable onPress={() => onMoveSeccion(s, 1)} hitSlop={8} disabled={idx === secciones.length - 1} style={{ paddingHorizontal: 2, opacity: idx === secciones.length - 1 ? 0.3 : 1 }}>
                          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                        </Pressable>
                        <Pressable onPress={() => onDeleteSeccion(s)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
                          <Ionicons name="trash-outline" size={18} color={colors.error} />
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        )}

        {/* Modal: elegir tipo de sección */}
        <Modal visible={tipoPickerOpen} transparent animationType="slide" onRequestClose={() => setTipoPickerOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setTipoPickerOpen(false)}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>Agregar sección</Text>
              {TIPO_ORDEN_PICKER.map((t) => (
                <Pressable key={t} onPress={() => onPickTipo(t)} style={styles.tipoOption}>
                  <Ionicons name={TIPO_ICON[t]} size={18} color={colors.primary} />
                  <Text style={styles.tipoOptionTxt}>{TIPO_LABEL[t]}</Text>
                </Pressable>
              ))}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: elegir los reportes de la semana que se destacan */}
        <Modal visible={!!reportesSeccion} transparent animationType="slide" onRequestClose={() => setReportesSeccion(null)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { maxHeight: '85%' }]}>
              <Text style={styles.modalTitle}>Reportes de la semana</Text>
              <Text style={styles.seccionSub}>
                Elige los que quieres destacar en el informe ({detail ? weekRangeLabel(detail.fecha) : ''}).
              </Text>
              {reportesLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
              ) : reportesSemana.length === 0 ? (
                <Text style={[styles.emptyTxt, { paddingVertical: spacing.lg }]}>No hay reportes capturados en esa semana.</Text>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', gap: spacing.md, marginVertical: spacing.sm }}>
                    <Pressable onPress={() => setReportesSel(reportesSemana.map((r) => r.id))}><Text style={styles.addBtnTxt}>Seleccionar todos</Text></Pressable>
                    <Pressable onPress={() => setReportesSel([])}><Text style={styles.addBtnTxt}>Ninguno</Text></Pressable>
                    <Text style={[styles.seccionSub, { marginLeft: 'auto' }]}>{reportesSel.length} de {reportesSemana.length}</Text>
                  </View>
                  <ScrollView>
                    {reportesSemana.map((r) => {
                      const on = reportesSel.includes(r.id);
                      return (
                        <Pressable key={r.id} onPress={() => toggleReporte(r.id)} style={styles.tipoOption}>
                          <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textMuted} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.tipoOptionTxt} numberOfLines={2}>{r.titulo}</Text>
                            <Text style={styles.seccionSub} numberOfLines={1}>
                              {[r.ubicacion, r.fecha ? r.fecha.slice(0, 10) : '', `${r.n_fotos} foto${r.n_fotos === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </>
              )}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label="Cancelar" variant="secondary" onPress={() => setReportesSeccion(null)} style={{ flex: 1 }} />
                <Button label="Guardar" loading={savingReportes} onPress={saveReportes} style={{ flex: 1 }} />
              </View>
            </View>
          </View>
        </Modal>

        {/* Modal: config de "divisor" (título) */}
        <Modal visible={configTipo === 'divisor'} transparent animationType="slide" onRequestClose={() => setConfigTipo(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Divisor de sección</Text>
              <Text style={styles.fieldLabel}>Título</Text>
              <TextInput
                value={configTitulo} onChangeText={setConfigTitulo}
                placeholder="Ej. FINANCIERO, ESTUDIOS Y ANÁLISIS, AVANCE DE OBRA"
                placeholderTextColor={colors.textMuted} style={styles.input} autoFocus
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label="Cancelar" variant="secondary" onPress={() => setConfigTipo(null)} style={{ flex: 1 }} />
                <Button label="Agregar" loading={savingSeccion} onPress={() => createSeccion({ tipo: 'divisor', titulo: configTitulo })} style={{ flex: 1 }} />
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Modal: config de "croquis_estacion" (elegir nodo) */}
        <Modal visible={configTipo === 'croquis_estacion'} transparent animationType="slide" onRequestClose={() => setConfigTipo(null)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { maxHeight: '70%' }]}>
              <Text style={styles.modalTitle}>Elegir Estación</Text>
              <ScrollView>
                {nodes.map((n) => (
                  <Pressable key={n.id} onPress={() => createSeccion({ tipo: 'croquis_estacion', node_id: n.id })} style={styles.tipoOption}>
                    <Text style={[styles.tipoOptionTxt, { marginLeft: n.depth * 12 }]}>{n.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Button label="Cancelar" variant="secondary" onPress={() => setConfigTipo(null)} style={{ marginTop: spacing.sm }} />
            </View>
          </View>
        </Modal>

        {/* Modal: config de "avance_grafico" (elegir plano) */}
        <Modal visible={configTipo === 'avance_grafico'} transparent animationType="slide" onRequestClose={() => setConfigTipo(null)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { maxHeight: '70%' }]}>
              <Text style={styles.modalTitle}>Elegir Plano</Text>
              {planos.length === 0 ? <Text style={styles.emptyTxt}>No hay planos de avance creados todavía.</Text> : null}
              <ScrollView>
                {planos.map((p) => (
                  <Pressable key={p.id} onPress={() => createSeccion({ tipo: 'avance_grafico', plano_id: p.id })} style={styles.tipoOption}>
                    <Text style={styles.tipoOptionTxt}>{p.nombre}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Button label="Cancelar" variant="secondary" onPress={() => setConfigTipo(null)} style={{ marginTop: spacing.sm }} />
            </View>
          </View>
        </Modal>

        {/* Modal: editor de bloques de "informacion_particular" */}
        <Modal visible={!!bloquesSeccion} animationType="slide" onRequestClose={() => setBloquesSeccion(null)}>
          <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
            <View style={[styles.headerWrap, { backgroundColor: headerColor }]}>
              <View style={styles.headerTopRow}>
                <Pressable onPress={() => setBloquesSeccion(null)} hitSlop={10} style={styles.iconBtn}>
                  <Ionicons name="close" size={22} color={headerTextColor} />
                </Pressable>
                <Text style={[styles.titleBar, { color: headerTextColor }]}>Información Particular</Text>
                <View style={{ width: 32 }} />
              </View>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
              {bloquesDraft.map((b, bIdx) => (
                <View key={bIdx} style={styles.bloqueEditCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm }}>
                    <TextInput
                      value={b.titulo} onChangeText={(v) => updateBloque(bIdx, { titulo: v })}
                      placeholder="Título (ej. Estación 3. Perisur, Intertramo E1-E2)"
                      placeholderTextColor={colors.textMuted} style={[styles.input, { flex: 1 }]}
                    />
                    <Pressable onPress={() => removeBloque(bIdx)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  </View>
                  <Text style={styles.fieldLabel}>Ligar a Estación (opcional — jala Acceso al Predio/Situación Social)</Text>
                  <Pressable
                    onPress={async () => { if (!nodes.length) { try { setNodes(await api.listNodes(projectId)); } catch { /* noop */ } } }}
                    style={styles.linkNodeBtn}
                  >
                    <Text style={styles.linkNodeTxt}>{b.node_id ? (nodes.find((n) => n.id === b.node_id)?.name || b.node_id) : 'Sin ligar'}</Text>
                  </Pressable>
                  {nodes.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable onPress={() => updateBloque(bIdx, { node_id: null })} style={[styles.chip, !b.node_id && styles.chipActive]}>
                          <Text style={[styles.chipTxt, !b.node_id && styles.chipTxtActive]}>Sin ligar</Text>
                        </Pressable>
                        {nodes.map((n) => (
                          <Pressable key={n.id} onPress={() => updateBloque(bIdx, { node_id: n.id })} style={[styles.chip, b.node_id === n.id && styles.chipActive]}>
                            <Text style={[styles.chipTxt, b.node_id === n.id && styles.chipTxtActive]} numberOfLines={1}>{n.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  ) : null}
                  <Text style={styles.fieldLabel}>Actividades (una por línea)</Text>
                  <TextInput
                    value={b.actividades.join('\n')}
                    onChangeText={(v) => updateBloque(bIdx, { actividades: v.split('\n') })}
                    multiline
                    placeholder={'Ej.\nContinua el habilitado de acero de refuerzo\nColado de zapatas'}
                    placeholderTextColor={colors.textMuted}
                    style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                  />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
                    <Text style={styles.fieldLabel}>Fotos ({b.fotos.length})</Text>
                    <Pressable onPress={() => addFotoToBloque(bIdx)} style={styles.addBtn}>
                      <Ionicons name="add" size={16} color={colors.primary} />
                      <Text style={styles.addBtnTxt}>Agregar foto</Text>
                    </Pressable>
                  </View>
                  {b.fotos.map((f, fIdx) => (
                    <View key={fIdx} style={styles.fotoEditRow}>
                      <Text style={styles.fotoEditIdx}>{fIdx + 1}.</Text>
                      <TextInput
                        value={f.caption} onChangeText={(v) => updateFoto(bIdx, fIdx, { caption: v })}
                        placeholder="Pie de foto" placeholderTextColor={colors.textMuted}
                        style={[styles.input, { flex: 1 }]}
                      />
                      <Pressable onPress={() => updateFoto(bIdx, fIdx, { destacado: !f.destacado })} style={{ paddingHorizontal: 6 }}>
                        <Ionicons name={f.destacado ? 'star' : 'star-outline'} size={18} color={f.destacado ? '#D97706' : colors.textMuted} />
                      </Pressable>
                      <Pressable onPress={() => removeFoto(bIdx, fIdx)} hitSlop={8}>
                        <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                      </Pressable>
                    </View>
                  ))}
                  {b.fotos.some((f) => f.destacado) ? (
                    <TextInput
                      value={b.fotos.find((f) => f.destacado)?.destacado_label || ''}
                      onChangeText={(v) => {
                        const idx = b.fotos.findIndex((f) => f.destacado);
                        if (idx >= 0) updateFoto(bIdx, idx, { destacado_label: v });
                      }}
                      placeholder='Etiqueta del destacado (ej. "Problemática social")'
                      placeholderTextColor={colors.textMuted}
                      style={[styles.input, { marginTop: spacing.xs }]}
                    />
                  ) : null}
                </View>
              ))}
              <Button label="+ Agregar bloque" variant="secondary" onPress={addBloque} style={{ marginTop: spacing.sm }} />
              <Button label="Guardar" loading={savingBloques} onPress={onSaveBloques} style={{ marginTop: spacing.md }} />
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  // ======================= Vista de LISTA de presentaciones =======================
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Presentación</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Informes semanales</Text>
          {canEditEstructura ? (
            <Pressable onPress={() => setNewOpen(true)} style={styles.addBtn}>
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={styles.addBtnTxt}>Nueva</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          {lista.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="easel-outline" size={22} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>Aún no hay presentaciones.</Text>
            </View>
          ) : (
            lista.map((p, idx) => (
              <View key={p.id} style={[styles.seccionRow, idx > 0 && styles.rowBorder]}>
                <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => setSelectedId(p.id)}>
                  <Ionicons name="easel-outline" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.seccionTitulo} numberOfLines={1}>{p.titulo}</Text>
                    <Text style={styles.seccionSub}>{p.fecha}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
                {canEditEstructura ? (
                  <Pressable hitSlop={8} onPress={() => onDeletePresentacion(p)} style={{ paddingLeft: spacing.sm }}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={newOpen} transparent animationType="slide" onRequestClose={() => setNewOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nueva Presentación</Text>
            <Text style={styles.fieldLabel}>Fecha (YYYY-MM-DD)</Text>
            <TextInput value={fechaDraft} onChangeText={setFechaDraft} style={styles.input} placeholder="2026-09-10" placeholderTextColor={colors.textMuted} />
            <Text style={styles.fieldLabel}>Título</Text>
            <TextInput value={tituloDraft} onChangeText={setTituloDraft} style={styles.input} />
            <Pressable onPress={() => setPlantillaSemanal((v) => !v)} style={[styles.tipoOption, { borderTopWidth: 0, marginTop: spacing.sm }]}>
              <Ionicons name={plantillaSemanal ? 'checkbox' : 'square-outline'} size={22} color={plantillaSemanal ? colors.primary : colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tipoOptionTxt}>Precargar estructura del informe semanal</Text>
                <Text style={styles.seccionSub}>Portada, mapa, Financiero, Estudios, Avance de obra, reportes de la semana, Pendientes, Estudios, Calidad, Ambiental, Social, Seguridad y cierre.</Text>
              </View>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setNewOpen(false)} style={{ flex: 1 }} />
              <Button label="Crear" loading={creating} onPress={onCreatePresentacion} style={{ flex: 1 }} />
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
  titleBar: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  scroll: { padding: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.md },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  seccionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md },
  seccionTitulo: { fontSize: 13, fontWeight: '700', color: colors.text },
  seccionSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  tipoOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  tipoOptionTxt: { fontSize: 13, fontWeight: '700', color: colors.text },
  bloqueEditCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  linkNodeBtn: { paddingVertical: 4 },
  linkNodeTxt: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, maxWidth: 140 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 11, fontWeight: '700', color: colors.text },
  chipTxtActive: { color: '#fff' },
  fotoEditRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  fotoEditIdx: { fontSize: 11, color: colors.textMuted, width: 16 },
});
