// Presentación (Informe de Actividades semanal) — lista de presentaciones +
// editor de secciones. Mismo patrón "un componente hace todo" que
// EstudiosProyectoScreen.tsx/PlanoAvanceScreen.tsx. Crear/borrar/reordenar
// secciones es exclusivo de Coordinador/Sub-Coordinador; editar el
// CONTENIDO de una sección "informacion_particular" (texto de actividades y
// fotos) lo puede hacer cualquier rol de escritura (Especialista incluido).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, Image,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { pickPhotoDataUrl } from '@/src/utils/photoPicker';
import {
  api, FotoSemanaItem, InformacionParticularBloque, InformacionParticularFoto, LocationNode, PlanoAvance,
  Presentacion, PresentacionPlantilla, PresentacionSeccion, PresentacionSeccionTipo, Project, ReporteSemanaItem, PeriodoFinanciero,
} from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { confirm } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_JEFE, ROLE_SUB } from '@/src/utils/roles';
import { requestMediaLibraryPermission } from '@/src/utils/permissions';
import { t, a11y  } from '@/src/i18n';
import { hoyProyecto } from '@/src/utils/fechas';
import { PeriodoFinancieroSelector } from '@/src/components/PeriodoFinancieroSelector';
import { PERIODO_FINANCIERO_DEFECTO, periodoDePresentacion } from '@/src/utils/finanzas';
import { showToast } from '@/src/utils/toast';
import { TIPO_ICON, TIPO_LABEL, TIPO_ORDEN_PICKER } from '@/src/components/presentacion/tiposSeccion';
import { PresentacionPlantillasModal } from '@/src/components/presentacion/PresentacionPlantillasModal';


/** "4 – 10 sep" a partir de la fecha del informe (fecha − 6 días .. fecha). */
function weekRangeLabel(fechaIso: string): string {
  const [y, m, d] = fechaIso.split('-').map((v) => parseInt(v, 10));
  const end = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const f = (dt: Date) => dt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${f(start)} – ${f(end)}`;
}

// Hoy en la zona del proyecto (CDMX por defecto), no el día UTC.
function todayIso(): string {
  return hoyProyecto();
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
  const [periodoDraft, setPeriodoDraft] = useState<PeriodoFinanciero>(PERIODO_FINANCIERO_DEFECTO);
  const [guardandoPeriodo, setGuardandoPeriodo] = useState(false);
  const [creating, setCreating] = useState(false);
  const [plantillas, setPlantillas] = useState<PresentacionPlantilla[]>([]);
  const [plantillaSel, setPlantillaSel] = useState<string>('semanal'); // '' = presentación vacía
  const [plantillasOpen, setPlantillasOpen] = useState(false);

  const cargarPlantillas = useCallback(async () => {
    try {
      const items = await api.listPresentacionPlantillas();
      setPlantillas(items);
      setPlantillaSel((sel) => (sel === '' || items.some((p) => p.id === sel) ? sel : 'semanal'));
    } catch {
      // sin lista, el selector solo ofrece "vacía"; la creación sigue funcionando
    }
  }, []);

  useEffect(() => { if (newOpen) cargarPlantillas(); }, [newOpen, cargarPlantillas]);

  // Selector de reportes de la semana (sección 'reportes_semana')
  const [reportesSeccion, setReportesSeccion] = useState<PresentacionSeccion | null>(null);
  const [reportesSemana, setReportesSemana] = useState<ReporteSemanaItem[]>([]);
  const [reportesSel, setReportesSel] = useState<string[]>([]);
  const [reportesLoading, setReportesLoading] = useState(false);
  const [savingReportes, setSavingReportes] = useState(false);

  const [tipoPickerOpen, setTipoPickerOpen] = useState(false);
  const [insertarDespuesDe, setInsertarDespuesDe] = useState<string | null>(null);
  const [revision, setRevision] = useState<{ nivel: 'error' | 'aviso'; seccion: string; mensaje: string }[] | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [configTipo, setConfigTipo] = useState<PresentacionSeccionTipo | null>(null);
  const [configTitulo, setConfigTitulo] = useState('');
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [planos, setPlanos] = useState<PlanoAvance[]>([]);
  const [savingSeccion, setSavingSeccion] = useState(false);

  const [bloquesSeccion, setBloquesSeccion] = useState<PresentacionSeccion | null>(null);
  const [bloquesDraft, setBloquesDraft] = useState<InformacionParticularBloque[]>([]);
  // Selector de fotos de la semana (para el bloque `fotosBloque`).
  const [fotosBloque, setFotosBloque] = useState<number | null>(null);
  const [fotosSemana, setFotosSemana] = useState<FotoSemanaItem[]>([]);
  const [fotosCargando, setFotosCargando] = useState(false);
  const [fotosSoloNodo, setFotosSoloNodo] = useState(true);
  const [fotosSel, setFotosSel] = useState<string[]>([]);
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
      Alert.alert(t('presentacion.error'), e?.message || 'No se pudo cargar Presentación.');
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
      Alert.alert(t('presentacion.error'), e?.message || 'No se pudo cargar la presentación.');
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
      Alert.alert(t('presentacion.faltaInformacion'), t('presentacion.indicaLaFechaDelReporte'));
      return;
    }
    try {
      setCreating(true);
      const created = await api.createPresentacion(projectId, {
        fecha: fechaDraft.trim(), titulo: tituloDraft.trim() || undefined,
        plantilla: plantillaSel || undefined,
        periodo_financiero: periodoDraft,
      });
      setNewOpen(false);
      await loadList();
      setSelectedId(created.id);
    } catch (e: any) {
      Alert.alert(t('presentacion.noSePudoCrear'), e?.message || 'Inténtalo nuevamente.');
    } finally {
      setCreating(false);
    }
  }

  async function onCambiarPeriodo(periodo: PeriodoFinanciero) {
    if (!detail || guardandoPeriodo || periodoDePresentacion(detail.periodo_financiero) === periodo) return;
    const anterior = detail;
    setDetail({ ...detail, periodo_financiero: periodo });
    try {
      setGuardandoPeriodo(true);
      await api.updatePresentacion(projectId, detail.id, { periodo_financiero: periodo });
    } catch (e: any) {
      setDetail(anterior);
      showToast(e?.message || 'No se pudo cambiar el periodo.');
    } finally {
      setGuardandoPeriodo(false);
    }
  }

  async function onDeletePresentacion(p: Presentacion) {
    const ok = await confirm(t('presentacion.eliminarPresentacion'), t('presentacion.eliminarPresentacionPregunta', { titulo: p.titulo, fecha: p.fecha }), { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deletePresentacion(projectId, p.id);
      await loadList();
    } catch (e: any) {
      Alert.alert(t('presentacion.noSePudoEliminar'), e?.message || 'Inténtalo nuevamente.');
    }
  }

  function nextOrden(): number {
    return secciones.length ? Math.max(...secciones.map((s) => s.orden)) + 1 : 0;
  }

  /** Orden de la sección nueva: al final, o justo después de `insertarDespuesDe`
   *  (las siguientes se recorren un lugar para hacerle espacio). */
  async function ordenParaNueva(): Promise<number> {
    const idx = insertarDespuesDe ? secciones.findIndex((x) => x.id === insertarDespuesDe) : -1;
    setInsertarDespuesDe(null);
    if (idx < 0 || idx === secciones.length - 1 || !detail) return nextOrden();
    const nuevo = secciones[idx].orden + 1;
    await Promise.all(secciones.slice(idx + 1).filter((x) => x.orden >= nuevo).map((x) =>
      api.updatePresentacionSeccion(projectId, detail.id, x.id, { orden: x.orden + 1 })));
    return nuevo;
  }

  async function onPickTipo(tipo: PresentacionSeccionTipo) {
    setTipoPickerOpen(false);
    if (tipo === 'divisor') {
      setConfigTipo('divisor');
      setConfigTitulo('');
      return;
    }
    if (tipo === 'lamina_imagenes') {
      setConfigTipo('lamina_imagenes');
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
        const created = await api.addPresentacionSeccion(projectId, detail.id, { tipo, orden: await ordenParaNueva() });
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
      await api.addPresentacionSeccion(projectId, detail.id, { ...body, orden: await ordenParaNueva() });
      setConfigTipo(null);
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert(t('presentacion.noSePudoAgregar'), e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSavingSeccion(false);
    }
  }

  async function onCopiarAnterior(conFotos: boolean) {
    if (!detail) return;
    try {
      const r = await api.copiarSemanaAnteriorPresentacion(projectId, detail.id, conFotos);
      await loadDetail(detail.id);
      Alert.alert('Copiado', r.bloques || r.laminas
        ? `Desde la presentación del ${r.desde}: textos de ${r.bloques} estación(es) y ${r.laminas} lámina(s) libre(s). Revísalos y actualiza lo que cambió.`
        : `No había nada nuevo que copiar desde la presentación del ${r.desde}.`);
    } catch (e: any) {
      Alert.alert('No se pudo copiar', e?.message || 'Inténtalo nuevamente.');
    }
  }

  async function onRevisar() {
    if (!detail) return;
    try {
      setRevisando(true);
      const r = await api.revisionPresentacion(projectId, detail.id);
      setRevision(r.items);
    } catch (e: any) {
      Alert.alert('No se pudo revisar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setRevisando(false);
    }
  }

  async function onAgregarEstaciones() {
    if (!detail) return;
    try {
      const r = await api.agregarEstacionesPresentacion(projectId, detail.id);
      await loadDetail(detail.id);
      Alert.alert('Estaciones', r.agregadas
        ? `Se agregaron ${r.agregadas} lámina${r.agregadas === 1 ? '' : 's'} (portada con render e información particular) después de "Avance de obra".`
        : 'Ya están todas las estaciones e intertramos con su portada e información.');
    } catch (e: any) {
      Alert.alert('No se pudieron agregar', e?.message || 'Inténtalo nuevamente.');
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
      Alert.alert(t('presentacion.noSePudoReordenar'), e?.message || 'Inténtalo nuevamente.');
    }
  }

  async function onDeleteSeccion(seccion: PresentacionSeccion) {
    if (!detail) return;
    const ok = await confirm(t('presentacion.eliminarSeccion'), t('presentacion.eliminarSeccionPregunta', { nombre: TIPO_LABEL[seccion.tipo] }), { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deletePresentacionSeccion(projectId, detail.id, seccion.id);
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert(t('presentacion.noSePudoEliminar'), e?.message || 'Inténtalo nuevamente.');
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

  const claveFoto = (f: { report_id?: string | null; index?: number | null }) => `${f.report_id}:${f.index}`;

  async function cargarFotosSemana(idx: number, soloNodo: boolean) {
    if (!detail) return;
    try {
      setFotosCargando(true);
      const nodeId = soloNodo ? bloquesDraft[idx]?.node_id : null;
      setFotosSemana(await api.listFotosSemanaPresentacion(projectId, detail.id, nodeId));
    } catch (e: any) {
      Alert.alert(t('presentacion.noSePudoAgregarLa'), e?.message || 'Inténtalo nuevamente.');
    } finally {
      setFotosCargando(false);
    }
  }

  function abrirFotosSemana(idx: number) {
    const soloNodo = !!bloquesDraft[idx]?.node_id;
    setFotosSoloNodo(soloNodo);
    setFotosSel([]);
    setFotosBloque(idx);
    cargarFotosSemana(idx, soloNodo);
  }

  function agregarFotosSeleccionadas() {
    if (fotosBloque === null) return;
    const elegidas = fotosSemana.filter((f) => fotosSel.includes(claveFoto(f)));
    setBloquesDraft((cur) => cur.map((b, i) => {
      if (i !== fotosBloque) return b;
      const ya = new Set(b.fotos.map(claveFoto));
      const nuevas: InformacionParticularFoto[] = elegidas.filter((f) => !ya.has(claveFoto(f))).map((f) => ({
        report_id: f.report_id, index: f.index, thumb: f.thumb, caption: f.caption || '', destacado: false, destacado_label: null,
      }));
      return { ...b, fotos: [...b.fotos, ...nuevas] };
    }));
    setFotosBloque(null);
  }

  async function addFotoToBloque(idx: number) {
    try {
      const photo = await pickPhotoDataUrl('library', { maxDim: 1600, quality: 0.8 });
      if (!photo) return;
      const nueva: InformacionParticularFoto = { photo, caption: '', destacado: false, destacado_label: null };
      setBloquesDraft((cur) => cur.map((b, i) => (i === idx ? { ...b, fotos: [...b.fotos, nueva] } : b)));
    } catch (e: any) {
      Alert.alert(t('presentacion.noSePudoAgregarLa'), e?.message || 'Inténtalo nuevamente.');
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
      Alert.alert(t('presentacion.noSePudoGuardar'), e?.message || 'Inténtalo nuevamente.');
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
    if (s.tipo === 'lamina_imagenes') {
      const n = (s.bloques || []).reduce((a, b) => a + b.fotos.length, 0);
      return `${s.titulo || 'Sin título'} · ${n} imagen${n === 1 ? '' : 'es'}`;
    }
    if (s.tipo === 'croquis_estacion') return nodes.find((n) => n.id === s.node_id)?.name || s.node_id || 'Estación no cargada';
    if (s.tipo === 'avance_grafico') return planos.find((p) => p.id === s.plano_id)?.nombre || s.plano_id || 'Plano no cargado';
    if (['ambiental', 'social', 'seguridad', 'proyecto', 'calidad', 'pendientes', 'electromecanico'].includes(s.tipo)) {
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
        <ScreenHeader
          title={detail?.titulo || 'Presentación'}
          backgroundColor={headerColor}
          onBack={() => setSelectedId(null)}
          right={(
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('vistaPrevia')} hitSlop={10} style={styles.accionEncabezado} onPress={goToPreview}>
              <Ionicons name="eye-outline" size={20} color={headerTextColor} />
            </Pressable>
          )}
        />

        {detailLoading || !detail ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
            {secciones.some((s) => s.tipo === 'financiero') ? (
              <View style={[styles.card, { padding: spacing.md, marginBottom: spacing.md }]}>
                <PeriodoFinancieroSelector
                  value={periodoDePresentacion(detail.periodo_financiero)}
                  onChange={onCambiarPeriodo}
                  disabled={!canEditEstructura || guardandoPeriodo}
                />
              </View>
            ) : null}
            {canEditEstructura ? (
              <View style={[styles.card, { padding: spacing.md, marginBottom: spacing.md }]}>
                <Text style={styles.seccionTitulo}>Copiar de la semana anterior</Text>
                <Text style={styles.seccionSub}>Trae las actividades de cada estación y tus láminas libres para editarlas</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.sm }}>
                  <Pressable accessibilityRole="button" onPress={() => onCopiarAnterior(false)} style={styles.chip}>
                    <Text style={styles.chipTxt}>Solo textos</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => onCopiarAnterior(true)} style={styles.chip}>
                    <Text style={styles.chipTxt}>Textos y fotos subidas</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            <Pressable accessibilityRole="button" onPress={onRevisar} disabled={revisando}
              style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, marginBottom: spacing.md }]}>
              <Ionicons name="checkmark-done-circle-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.seccionTitulo}>Revisar antes de exportar</Text>
                <Text style={styles.seccionSub}>Renders sin subir, láminas sin fotos o texto, secciones sin datos</Text>
              </View>
              {revisando ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
            </Pressable>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t('presentacion.secciones')}</Text>
              {canEditEstructura ? (
                <Pressable accessibilityRole="button" onPress={onAgregarEstaciones} style={styles.addBtn}>
                  <Ionicons name="business-outline" size={16} color={colors.primary} />
                  <Text style={styles.addBtnTxt}>Estaciones</Text>
                </Pressable>
              ) : null}
              {canEditEstructura ? (
                <Pressable accessibilityRole="button" onPress={() => { setInsertarDespuesDe(null); setTipoPickerOpen(true); }} style={styles.addBtn}>
                  <Ionicons name="add" size={16} color={colors.primary} />
                  <Text style={styles.addBtnTxt}>{t('presentacion.agregar')}</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.card}>
              {secciones.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="albums-outline" size={22} color={colors.textMuted} />
                  <Text style={styles.emptyTxt}>{t('presentacion.aunNoHaySecciones')}</Text>
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
                      <Pressable accessibilityRole="button" accessibilityLabel="Seleccionar" onPress={() => openReportesSelector(s)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
                        <Ionicons name="checkbox-outline" size={18} color={colors.primary} />
                      </Pressable>
                    ) : null}
                    {s.tipo === 'informacion_particular' || s.tipo === 'lamina_imagenes' ? (
                      <Pressable accessibilityRole="button" accessibilityLabel={a11y('editar')} onPress={() => openBloquesEditor(s)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
                        <Ionicons name="create-outline" size={18} color={colors.primary} />
                      </Pressable>
                    ) : null}
                    {canEditEstructura ? (
                      <>
                        <Pressable accessibilityRole="button" accessibilityLabel="Insertar una sección después de esta" onPress={() => { setInsertarDespuesDe(s.id); setTipoPickerOpen(true); }} hitSlop={8} style={{ paddingHorizontal: 2 }}>
                          <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={a11y('moverArriba')} onPress={() => onMoveSeccion(s, -1)} hitSlop={8} disabled={idx === 0} style={{ paddingHorizontal: 2, opacity: idx === 0 ? 0.3 : 1 }}>
                          <Ionicons name="chevron-up" size={18} color={colors.textMuted} />
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={a11y('moverAbajo')} onPress={() => onMoveSeccion(s, 1)} hitSlop={8} disabled={idx === secciones.length - 1} style={{ paddingHorizontal: 2, opacity: idx === secciones.length - 1 ? 0.3 : 1 }}>
                          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} onPress={() => onDeleteSeccion(s)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
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

        {/* Modal: resultado de la revisión */}
        <Modal visible={revision !== null} transparent animationType="slide" onRequestClose={() => setRevision(null)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setRevision(null)}>
            <Pressable accessibilityRole="button" style={[styles.modalCard, { maxHeight: '80%' }]} onPress={() => {}}>
              <Text style={styles.modalTitle}>Revisión de la presentación</Text>
              {revision && revision.length === 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: spacing.md }}>
                  <Ionicons name="checkmark-circle" size={22} color="#16A34A" />
                  <Text style={styles.seccionTitulo}>Todo listo: no encontré pendientes.</Text>
                </View>
              ) : (
                <ScrollView>
                  {(revision || []).map((it, i) => (
                    <View key={i} style={[styles.tipoOption, { alignItems: 'flex-start' }]}>
                      <Ionicons name={it.nivel === 'error' ? 'alert-circle' : 'warning-outline'} size={20} color={it.nivel === 'error' ? colors.error : '#D97706'} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.seccionSub}>{it.seccion}</Text>
                        <Text style={styles.tipoOptionTxt}>{it.mensaje}</Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
              <Button label="Cerrar" variant="secondary" onPress={() => setRevision(null)} style={{ marginTop: spacing.md }} />
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: elegir tipo de sección */}
        <Modal visible={tipoPickerOpen} transparent animationType="slide" onRequestClose={() => setTipoPickerOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setTipoPickerOpen(false)}>
            <Pressable accessibilityRole="button" style={[styles.modalCard, { maxHeight: '85%' }]} onPress={() => {}}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={[styles.modalTitle, { marginBottom: 0 }]}>{t('presentacion.agregarSeccion')}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12} onPress={() => setTipoPickerOpen(false)}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </Pressable>
              </View>
              <ScrollView style={{ flexShrink: 1 }}>
                {TIPO_ORDEN_PICKER.map((t) => (
                  <Pressable accessibilityRole="button" key={t} onPress={() => onPickTipo(t)} style={styles.tipoOption}>
                    <Ionicons name={TIPO_ICON[t]} size={18} color={colors.primary} />
                    <Text style={styles.tipoOptionTxt}>{TIPO_LABEL[t]}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Button label="Cancelar" variant="secondary" onPress={() => setTipoPickerOpen(false)} style={{ marginTop: spacing.sm }} />
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
                    <Pressable accessibilityRole="button" onPress={() => setReportesSel(reportesSemana.map((r) => r.id))}><Text style={styles.addBtnTxt}>Seleccionar todos</Text></Pressable>
                    <Pressable accessibilityRole="button" onPress={() => setReportesSel([])}><Text style={styles.addBtnTxt}>Ninguno</Text></Pressable>
                    <Text style={[styles.seccionSub, { marginLeft: 'auto' }]}>{reportesSel.length} de {reportesSemana.length}</Text>
                  </View>
                  <ScrollView>
                    {reportesSemana.map((r) => {
                      const on = reportesSel.includes(r.id);
                      return (
                        <Pressable accessibilityRole="button" key={r.id} onPress={() => toggleReporte(r.id)} style={styles.tipoOption}>
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
        <Modal visible={configTipo === 'lamina_imagenes'} transparent animationType="slide" onRequestClose={() => setConfigTipo(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Imágenes y gráficas</Text>
              <Text style={styles.fieldLabel}>Título de la franja superior</Text>
              <TextInput
                value={configTitulo} onChangeText={setConfigTitulo}
                placeholder="Ej. ACTIVIDADES SEMANALES DE OBRA ELECTROMECÁNICA"
                placeholderTextColor={colors.textMuted} style={styles.input} autoFocus
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label={t('presentacion.cancelar')} variant="secondary" onPress={() => setConfigTipo(null)} style={{ flex: 1 }} />
                <Button label={t('presentacion.agregar')} loading={savingSeccion} onPress={() => createSeccion({ tipo: 'lamina_imagenes', titulo: configTitulo || 'INFORMACIÓN' })} style={{ flex: 1 }} />
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={configTipo === 'divisor'} transparent animationType="slide" onRequestClose={() => setConfigTipo(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{t('presentacion.divisorDeSeccion')}</Text>
              <Text style={styles.fieldLabel}>{t('presentacion.titulo')}</Text>
              <TextInput
                value={configTitulo} onChangeText={setConfigTitulo}
                placeholder={t('presentacion.ejFinancieroEstudiosYAnalisis')}
                placeholderTextColor={colors.textMuted} style={styles.input} autoFocus
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label={t('presentacion.cancelar')} variant="secondary" onPress={() => setConfigTipo(null)} style={{ flex: 1 }} />
                <Button label={t('presentacion.agregar')} loading={savingSeccion} onPress={() => createSeccion({ tipo: 'divisor', titulo: configTitulo })} style={{ flex: 1 }} />
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Modal: config de "croquis_estacion" (elegir nodo) */}
        <Modal visible={configTipo === 'croquis_estacion'} transparent animationType="slide" onRequestClose={() => setConfigTipo(null)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { maxHeight: '70%' }]}>
              <Text style={styles.modalTitle}>{t('presentacion.elegirEstacion')}</Text>
              <ScrollView>
                {nodes.map((n) => (
                  <Pressable accessibilityRole="button" key={n.id} onPress={() => createSeccion({ tipo: 'croquis_estacion', node_id: n.id })} style={styles.tipoOption}>
                    <Text style={[styles.tipoOptionTxt, { marginLeft: n.depth * 12 }]}>{n.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Button label={t('presentacion.cancelar')} variant="secondary" onPress={() => setConfigTipo(null)} style={{ marginTop: spacing.sm }} />
            </View>
          </View>
        </Modal>

        {/* Modal: config de "avance_grafico" (elegir plano) */}
        <Modal visible={configTipo === 'avance_grafico'} transparent animationType="slide" onRequestClose={() => setConfigTipo(null)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { maxHeight: '70%' }]}>
              <Text style={styles.modalTitle}>{t('presentacion.elegirPlano')}</Text>
              {planos.length === 0 ? <Text style={styles.emptyTxt}>{t('presentacion.noHayPlanosDeAvance')}</Text> : null}
              <ScrollView>
                {planos.map((p) => (
                  <Pressable accessibilityRole="button" key={p.id} onPress={() => createSeccion({ tipo: 'avance_grafico', plano_id: p.id })} style={styles.tipoOption}>
                    <Text style={styles.tipoOptionTxt}>{p.nombre}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Button label={t('presentacion.cancelar')} variant="secondary" onPress={() => setConfigTipo(null)} style={{ marginTop: spacing.sm }} />
            </View>
          </View>
        </Modal>

        {/* Modal: elegir fotos entre las subidas en la semana */}
        <Modal visible={fotosBloque !== null} animationType="slide" onRequestClose={() => setFotosBloque(null)}>
          <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
            <View style={[styles.headerWrap, { backgroundColor: headerColor }]}>
              <View style={styles.headerTopRow}>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={() => setFotosBloque(null)} hitSlop={10} style={styles.iconBtn}>
                  <Ionicons name="close" size={22} color={headerTextColor} />
                </Pressable>
                <Text style={[styles.titleBar, { color: headerTextColor }]}>{t('presentacion.fotosDeLaSemana')}</Text>
                <View style={{ width: 32 }} />
              </View>
            </View>
            {fotosBloque !== null && bloquesDraft[fotosBloque]?.node_id ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => { const v = !fotosSoloNodo; setFotosSoloNodo(v); cargarFotosSemana(fotosBloque, v); }}
                style={[styles.chip, fotosSoloNodo && styles.chipActive, { alignSelf: 'flex-start', margin: spacing.md }]}
              >
                <Text style={[styles.chipTxt, fotosSoloNodo && styles.chipTxtActive]}>{t('presentacion.soloEstaEstacion')}</Text>
              </Pressable>
            ) : null}
            <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 90 }}>
              {fotosCargando ? <ActivityIndicator color={colors.primary} /> : null}
              {!fotosCargando && !fotosSemana.length ? <Text style={styles.fieldLabel}>{t('presentacion.sinFotosSemana')}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {fotosSemana.map((f) => {
                  const k = claveFoto(f);
                  const on = fotosSel.includes(k);
                  return (
                    <Pressable
                      key={k} accessibilityRole="button"
                      onPress={() => setFotosSel((cur) => (on ? cur.filter((x) => x !== k) : [...cur, k]))}
                      style={[styles.fotoSemanaCard, on && { borderColor: colors.primary, borderWidth: 3 }]}
                    >
                      {f.thumb ? <Image source={{ uri: f.thumb }} style={styles.fotoSemanaImg} /> : <View style={styles.fotoSemanaImg} />}
                      {on ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} style={styles.fotoSemanaCheck} /> : null}
                      <Text numberOfLines={1} style={styles.fotoSemanaTxt}>{f.caption || f.titulo}</Text>
                      <Text numberOfLines={1} style={styles.fotoSemanaSub}>{f.ubicacion}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.md, paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.bg }}>
              <Button label={t('presentacion.agregarSeleccionadas', { n: fotosSel.length })} onPress={agregarFotosSeleccionadas} disabled={!fotosSel.length} />
            </View>
          </View>
        </Modal>

        {/* Modal: editor de bloques de "informacion_particular" */}
        <Modal visible={!!bloquesSeccion} animationType="slide" onRequestClose={() => setBloquesSeccion(null)}>
          <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
            <View style={[styles.headerWrap, { backgroundColor: headerColor }]}>
              <View style={styles.headerTopRow}>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={() => setBloquesSeccion(null)} hitSlop={10} style={styles.iconBtn}>
                  <Ionicons name="close" size={22} color={headerTextColor} />
                </Pressable>
                <Text style={[styles.titleBar, { color: headerTextColor }]}>{t('presentacion.informacionParticular')}</Text>
                <View style={{ width: 32 }} />
              </View>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
              {bloquesDraft.map((b, bIdx) => (
                <View key={bIdx} style={styles.bloqueEditCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm }}>
                    <TextInput
                      value={b.titulo} onChangeText={(v) => updateBloque(bIdx, { titulo: v })}
                      placeholder={t('presentacion.tituloEjEstacion3Perisur')}
                      placeholderTextColor={colors.textMuted} style={[styles.input, { flex: 1 }]}
                    />
                    <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} onPress={() => removeBloque(bIdx)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  </View>
                  {bloquesSeccion?.tipo === 'lamina_imagenes' ? null : <Text style={styles.fieldLabel}>{t('presentacion.ligarAEstacionOpcionalJala')}</Text>}
                  {bloquesSeccion?.tipo === 'lamina_imagenes' ? null : <Pressable accessibilityRole="button"
                    onPress={async () => { if (!nodes.length) { try { setNodes(await api.listNodes(projectId)); } catch { /* noop */ } } }}
                    style={styles.linkNodeBtn}
                  >
                    <Text style={styles.linkNodeTxt}>{b.node_id ? (nodes.find((n) => n.id === b.node_id)?.name || b.node_id) : t('presentacion.sinLigar')}</Text>
                  </Pressable>}
                  {nodes.length && bloquesSeccion?.tipo !== 'lamina_imagenes' ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable accessibilityRole="button" onPress={() => updateBloque(bIdx, { node_id: null })} style={[styles.chip, !b.node_id && styles.chipActive]}>
                          <Text style={[styles.chipTxt, !b.node_id && styles.chipTxtActive]}>{t('presentacion.sinLigar')}</Text>
                        </Pressable>
                        {nodes.map((n) => (
                          <Pressable accessibilityRole="button" key={n.id} onPress={() => updateBloque(bIdx, { node_id: n.id })} style={[styles.chip, b.node_id === n.id && styles.chipActive]}>
                            <Text style={[styles.chipTxt, b.node_id === n.id && styles.chipTxtActive]} numberOfLines={1}>{n.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  ) : null}
                  {bloquesSeccion?.tipo === 'lamina_imagenes' ? (
                    <View style={{ marginBottom: spacing.sm }}>
                      <Pressable accessibilityRole="button"
                        onPress={() => updateBloque(bIdx, { estilo: b.estilo === 'registro' ? 'tarjetas' : 'registro' })}
                        style={[styles.chip, b.estilo === 'registro' && styles.chipActive, { alignSelf: 'flex-start' }]}>
                        <Text style={[styles.chipTxt, b.estilo === 'registro' && styles.chipTxtActive]}>Registro fotográfico (pie debajo de cada foto)</Text>
                      </Pressable>
                      {b.estilo === 'registro' ? (
                        <TextInput
                          value={b.banda || ''} onChangeText={(v) => updateBloque(bIdx, { banda: v })}
                          placeholder="Texto de la barra (def. REGISTRO FOTOGRÁFICO DE ACTIVIDADES GENERALES)"
                          placeholderTextColor={colors.textMuted} style={[styles.input, { marginTop: spacing.xs }]}
                        />
                      ) : null}
                    </View>
                  ) : null}
                  <Pressable accessibilityRole="button" onPress={() => updateBloque(bIdx, { auto_fotos: !b.auto_fotos })}
                    style={[styles.chip, b.auto_fotos && styles.chipActive, { alignSelf: 'flex-start', marginBottom: spacing.sm }]}>
                    <Text style={[styles.chipTxt, b.auto_fotos && styles.chipTxtActive]}>
                      Completar con fotos de la semana (hasta 8){b.node_id ? ' de esta estación' : ''}
                    </Text>
                  </Pressable>
                  <Text style={styles.fieldLabel}>{t('presentacion.actividadesUnaPorLinea')}</Text>
                  <TextInput
                    value={b.actividades.join('\n')}
                    onChangeText={(v) => updateBloque(bIdx, { actividades: v.split('\n') })}
                    multiline
                    placeholder={t('presentacion.ejContinuaElHabilitadoDe')}
                    placeholderTextColor={colors.textMuted}
                    style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                  />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
                    <Text style={styles.fieldLabel}>{t('presentacion.fotos', { n: b.fotos.length })}</Text>
                    <Pressable accessibilityRole="button" onPress={() => abrirFotosSemana(bIdx)} style={styles.addBtn}>
                      <Ionicons name="images-outline" size={16} color={colors.primary} />
                      <Text style={styles.addBtnTxt}>{t('presentacion.elegirDeLaSemana')}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => addFotoToBloque(bIdx)} style={styles.addBtn}>
                      <Ionicons name="add" size={16} color={colors.primary} />
                      <Text style={styles.addBtnTxt}>{t('presentacion.agregarFoto')}</Text>
                    </Pressable>
                  </View>
                  {b.fotos.map((f, fIdx) => (
                    <View key={fIdx} style={styles.fotoEditRow}>
                      <Text style={styles.fotoEditIdx}>{fIdx + 1}.</Text>
                      {f.photo || f.thumb ? (
                        <Image source={{ uri: (f.photo || f.thumb) as string }} style={styles.fotoMini} />
                      ) : null}
                      <TextInput
                        value={f.caption} onChangeText={(v) => updateFoto(bIdx, fIdx, { caption: v })}
                        placeholder={t('presentacion.pieDeFoto')} placeholderTextColor={colors.textMuted}
                        style={[styles.input, { flex: 1 }]}
                      />
                      <Pressable accessibilityRole="button" accessibilityLabel="Gráfica: mostrar completa sin recortar" hitSlop={8} onPress={() => updateFoto(bIdx, fIdx, { ajustar: !f.ajustar })} style={{ paddingHorizontal: 6 }}>
                        <Ionicons name={f.ajustar ? 'scan' : 'scan-outline'} size={18} color={f.ajustar ? colors.primary : colors.textMuted} />
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={a11y(f.destacado ? 'quitarDestacado' : 'destacar')} hitSlop={8} onPress={() => updateFoto(bIdx, fIdx, { destacado: !f.destacado })} style={{ paddingHorizontal: 6 }}>
                        <Ionicons name={f.destacado ? 'star' : 'star-outline'} size={18} color={f.destacado ? '#D97706' : colors.textMuted} />
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} onPress={() => removeFoto(bIdx, fIdx)} hitSlop={8}>
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
                      placeholder={t('presentacion.etiquetaDelDestacadoEjProblematica')}
                      placeholderTextColor={colors.textMuted}
                      style={[styles.input, { marginTop: spacing.xs }]}
                    />
                  ) : null}
                </View>
              ))}
              <Button label={t('presentacion.agregarBloque')} variant="secondary" onPress={addBloque} style={{ marginTop: spacing.sm }} />
              <Button label={t('presentacion.guardar')} loading={savingBloques} onPress={onSaveBloques} style={{ marginTop: spacing.md }} />
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  // ======================= Vista de LISTA de presentaciones =======================
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t('presentacion.presentacion')} backgroundColor={headerColor} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('presentacion.informesSemanales')}</Text>
          {canEditEstructura ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Pressable accessibilityRole="button" onPress={() => setPlantillasOpen(true)} style={styles.addBtn}>
                <Ionicons name="albums-outline" size={16} color={colors.primary} />
                <Text style={styles.addBtnTxt}>Plantillas</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setNewOpen(true)} style={styles.addBtn}>
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={styles.addBtnTxt}>{t('presentacion.nueva')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          {lista.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="easel-outline" size={22} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>{t('presentacion.aunNoHayPresentaciones')}</Text>
            </View>
          ) : (
            lista.map((p, idx) => (
              <View key={p.id} style={[styles.seccionRow, idx > 0 && styles.rowBorder]}>
                <Pressable accessibilityRole="button" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => setSelectedId(p.id)}>
                  <Ionicons name="easel-outline" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.seccionTitulo} numberOfLines={1}>{p.titulo}</Text>
                    <Text style={styles.seccionSub}>{p.fecha}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
                {canEditEstructura ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} hitSlop={8} onPress={() => onDeletePresentacion(p)} style={{ paddingLeft: spacing.sm }}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <PresentacionPlantillasModal visible={plantillasOpen} onClose={() => setPlantillasOpen(false)} onChanged={cargarPlantillas} />

      <Modal visible={newOpen} transparent animationType="slide" onRequestClose={() => setNewOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('presentacion.nuevaPresentacion')}</Text>
            <Text style={styles.fieldLabel}>{t('presentacion.fechaYyyyMmDd')}</Text>
            <TextInput value={fechaDraft} onChangeText={setFechaDraft} style={styles.input} placeholder="2026-09-10" placeholderTextColor={colors.textMuted} />
            <Text style={styles.fieldLabel}>{t('presentacion.titulo')}</Text>
            <TextInput value={tituloDraft} onChangeText={setTituloDraft} style={styles.input} />
            <Text style={styles.fieldLabel}>Plantilla</Text>
            <ScrollView style={{ maxHeight: 190 }} nestedScrollEnabled>
              {[...plantillas.map((p) => ({ id: p.id, nombre: p.nombre, sub: `${p.secciones.length} secciones` })),
                { id: '', nombre: 'Presentación vacía', sub: 'Agregas las secciones tú mismo.' }].map((op) => (
                <Pressable key={op.id || 'vacia'} accessibilityRole="radio" onPress={() => setPlantillaSel(op.id)} style={[styles.tipoOption, { borderTopWidth: 0 }]}>
                  <Ionicons name={plantillaSel === op.id ? 'radio-button-on' : 'radio-button-off'} size={22} color={plantillaSel === op.id ? colors.primary : colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tipoOptionTxt}>{op.nombre}</Text>
                    <Text style={styles.seccionSub}>{op.sub}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            <PeriodoFinancieroSelector value={periodoDraft} onChange={setPeriodoDraft} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={t('presentacion.cancelar')} variant="secondary" onPress={() => setNewOpen(false)} style={{ flex: 1 }} />
              <Button label={t('presentacion.crear')} loading={creating} onPress={onCreatePresentacion} style={{ flex: 1 }} />
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
  accionEncabezado: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
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
  fotoMini: { width: 40, height: 40, borderRadius: 4 },
  fotoSemanaCard: { width: 108, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  fotoSemanaImg: { width: '100%', height: 84, backgroundColor: colors.border },
  fotoSemanaCheck: { position: 'absolute', top: 4, right: 4 },
  fotoSemanaTxt: { fontSize: 10, fontWeight: '700', color: colors.text, paddingHorizontal: 4, paddingTop: 3 },
  fotoSemanaSub: { fontSize: 9, color: colors.textMuted, paddingHorizontal: 4, paddingBottom: 3 },
  fotoEditRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  fotoEditIdx: { fontSize: 11, color: colors.textMuted, width: 16 },
});
