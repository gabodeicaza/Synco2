// Dirac · Tab "Inicio" / Feed del Especialista.
// Cumple con la descripcion exacta solicitada por el usuario:
//   _ Fondo azul corporativo en la mitad superior.
//   _ Hero Card "MI AREA ASIGNADA" en blanco con datos del especialista.
//   _ Tres Stat Cards blancas (Total _ Mios _ De companeros).
//   _ Chips horizontales de filtro temporal (Hoy / Semana / Mes / Todo).
//   _ Lista vertical de actividad con thumbnail a la izquierda, badge de
//     area coloreado, titulo en negritas y meta debajo.
//   _ Pull-to-refresh y estados vacios amigables.
import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, RefreshControl,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View, FlatList,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { useAuth } from '@/src/auth-context';
import { useProyectoActivo } from '@/src/proyecto-activo-context';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { HeaderMenu } from '@/src/components/HeaderMenu';
import { api, FeedItem, FeedResponse, Project, ProjectEvent } from '@/src/api';
import { storage } from '@/src/utils/storage';
import { ReportPeriod, periodToInformeType } from '@/src/components/PeriodSheet';
import { RangoFechasPicker } from '@/src/components/RangoFechasPicker';
import { codificarPeriodoPersonalizado } from '@/src/utils/rangoFechas';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { SinReportesAviso } from '@/src/components/SinReportesAviso';
import { ReportesVacio } from '@/src/components/ReportesVacio';
import { verificarConteoExportacion } from '@/src/utils/conteoExportacion';
import { DailyGoalsPanel } from '@/src/components/DailyGoalsPanel';
import { MyMeetingsPanel } from '@/src/components/MyMeetingsPanel';
import { BorradoresCard } from '@/src/components/BorradoresCard';
import { GravedadDot, GravedadFiltro, filtrarPorGravedad, type GravedadFiltroValor } from '@/src/components/GravedadDot';
import { ReportPreviewSheet } from '@/src/components/ReportPreviewSheet';
import { suscribirReporteEditado } from '@/src/utils/reportEdit';
import { HistoryCalendarModal } from '@/src/components/HistoryCalendarModal';
import { a11y, t } from '@/src/i18n';
import {
  dayjs, toISODateCDMX, CDMX_TZ,
} from '@/src/utils/tz';

// === Configuracion del flujo de exportacion en 3 pasos ============================
type ExportFormat = 'pdf' | 'docx' | 'pptx';
type ExportStep = 'period' | 'scope' | 'format';
type ExportScope = 'mine' | 'area';

const PERIOD_OPTIONS: { value: ReportPeriod; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'today',     label: 'Hoy',         sub: 'Informe Diario · solo jerarquía "Diario"',  icon: 'today-outline' },
  { value: 'yesterday', label: 'Ayer',        sub: 'Reportes del día anterior', icon: 'calendar-clear-outline' },
  { value: 'week',      label: 'Esta semana', sub: 'Informe Semanal · solo jerarquía "Semanal"',            icon: 'calendar-outline' },
  { value: 'last_week', label: 'Semana pasada', sub: 'Informe Semanal · lunes a domingo de la semana anterior', icon: 'calendar-outline' },
  { value: 'month',     label: 'Este mes',   sub: 'Informe Mensual · solo jerarquía "Mensual"',           icon: 'calendar-number-outline' },
];

const FORMAT_OPTIONS: { value: ExportFormat; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; tint: string }[] = [
  { value: 'pdf',  label: 'PDF',        sub: 'Documento horizontal listo para imprimir', icon: 'document-text', tint: '#DC2626' },
  { value: 'docx', label: 'Word',       sub: 'Editable en Microsoft Word',                icon: 'document',      tint: '#1D4ED8' },
  { value: 'pptx', label: 'PowerPoint', sub: 'Presentación institucional 16:9',            icon: 'easel',         tint: '#B45309' },
];

// Campos que realmente se pintan en una `FeedCard`. Se usan para decidir si
// un item "cambio de verdad" entre dos fetch del feed.
function feedItemsShallowEqual(a: FeedItem, b: FeedItem): boolean {
  return (
    a.title === b.title && a.nombre === b.nombre && a.actividades === b.actividades &&
    a.observaciones === b.observaciones && a.avance === b.avance && a.area_name === b.area_name &&
    a.area_color === b.area_color && a.gravedad === b.gravedad && a.is_mine === b.is_mine && a.captured_by_name === b.captured_by_name &&
    a.created_at === b.created_at && a.images_count === b.images_count &&
    a.thumbnail_base64 === b.thumbnail_base64 &&
    (a.personnel || []).join('|') === (b.personnel || []).join('|') &&
    (a.equipment || []).join('|') === (b.equipment || []).join('|') &&
    (a.node_path_names || []).join('|') === (b.node_path_names || []).join('|')
  );
}

type RangeKey = 'today' | 'week' | 'month' | 'all';

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'all', label: 'Todo' },
];

export default function SpecFeedScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  // P-05: mismo proyecto activo que Minutas, Mensajes, Noticias y Calendario (con respaldo al primero del usuario).
  const { proyectoId } = useProyectoActivo();
  const projectId = proyectoId || (user?.project_ids || [])[0] || '';

  const [project, setProject] = useState<Project | null>(null);
  const [myMeetings, setMyMeetings] = useState<ProjectEvent[]>([]);
  const [myMeetingsLoading, setMyMeetingsLoading] = useState(true);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [range, setRange] = useState<RangeKey>('today');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportStep, setExportStep] = useState<ExportStep>('period');
  const [exportPeriod, setExportPeriod] = useState<ReportPeriod>('today');
  const [exportScope, setExportScope] = useState<ExportScope>('mine');
  const [rangoExportOpen, setRangoExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportSinReportes, setExportSinReportes] = useState<{ fmt: ExportFormat; otros: number } | null>(null);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<FeedItem | null>(null);

  // Resumen Ejecutivo con IA
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<{ reports_count: number; period_hours: number } | null>(null);
  const [aiCopied, setAiCopied] = useState(false);
  const [aiPeriodo, setAiPeriodo] = useState<'diario' | 'semanal' | 'mensual'>('diario');

  const stats = useMemo(() => {
    return feed?.stats || { total: 0, mine: 0, others: 0 };
  }, [feed]);

  const [searchQuery, setSearchQuery] = useState('');
  const [gravedadFiltro, setGravedadFiltro] = useState<GravedadFiltroValor>('todas');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce del input de busqueda (350ms) _ evita spam de requests.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Cache de items por id: si un reporte llega identico en un refresh
  // posterior, reusamos la MISMA referencia de objeto. Esto es lo que
  // permite que `React.memo` en `FeedCard` realmente evite el re-render
  // (de lo contrario, cada fetch trae objetos nuevos del JSON y el memo
  // nunca podria detectar "sin cambios").
  const itemsCacheRef = useRef<Map<string, FeedItem>>(new Map());
  const reconcileReports = useCallback((next: FeedItem[]): FeedItem[] => {
    const cache = itemsCacheRef.current;
    const nextCache = new Map<string, FeedItem>();
    const out = next.map((item) => {
      const prev = cache.get(item.id);
      const reused = prev && feedItemsShallowEqual(prev, item) ? prev : item;
      nextCache.set(item.id, reused);
      return reused;
    });
    itemsCacheRef.current = nextCache;
    return out;
  }, []);

  // El proyecto (datos del area asignada) no cambia con la busqueda ni el
  // rango de fechas: separado de loadFeed para no volver a pedirlo en cada
  // tecla del buscador o cambio de chip temporal.
  const loadProject = useCallback(async () => {
    if (!projectId) return;
    const proj = await api.getProject(projectId);
    setProject(proj);
  }, [projectId]);

  const loadMyMeetings = useCallback(async () => {
    if (!projectId) { setMyMeetingsLoading(false); return; }
    try {
      const evs = await api.listEvents(projectId, 'upcoming', 5, true);
      setMyMeetings(evs);
    } catch {
      // silencioso: no bloquea el resto del Inicio si falla.
    } finally {
      setMyMeetingsLoading(false);
    }
  }, [projectId]);

  const loadFeed = useCallback(async (nextRange: RangeKey = range, silent = false, q = debouncedQuery, date: string | null = selectedDate) => {
    if (!projectId) {
      setLoading(false);
      setError(t('inicioEspecialista.tuCuentaNoEsta'));
      return;
    }
    try {
      setError(null);
      if (!silent) setLoading(true);
      // Con un día elegido en el calendario se pide ese día al backend: el
      // feed del rango (p. ej. "Hoy") no contiene reportes de otras fechas.
      const f = await api.feed(projectId, nextRange, 50, q || undefined, date ? { date } : undefined);
      setFeed({ ...f, reports: reconcileReports(f.reports || []) });
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el feed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, range, debouncedQuery, selectedDate, reconcileReports]);

  const load = useCallback(async (nextRange: RangeKey = range, silent = false, q = debouncedQuery) => {
    await Promise.all([loadProject(), loadFeed(nextRange, silent, q), loadMyMeetings()]);
  }, [loadProject, loadFeed, loadMyMeetings]);

  useEffect(() => { load(range, false, ''); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!projectId) return;
    loadFeed(range, true, debouncedQuery);
  }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Un reporte editado (pantalla de captura en modo edición) refresca el feed.
  useEffect(() => suscribirReporteEditado(() => { loadFeed(range, true, debouncedQuery); }), [loadFeed, range, debouncedQuery]);

  // Elegir un chip de rango siempre descarta el día del calendario.
  const onPickRange = useCallback((r: RangeKey) => {
    setRange(r);
    loadFeed(r, true, debouncedQuery, null);
  }, [loadFeed, debouncedQuery]);

  // Cambio de día en el calendario (elegir o quitar): refetch del feed.
  const primeraCargaFecha = useRef(true);
  useEffect(() => {
    if (primeraCargaFecha.current) { primeraCargaFecha.current = false; return; }
    if (!projectId) return;
    loadFeed(range, true, debouncedQuery, selectedDate);
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(range, true, debouncedQuery);
  }, [range, debouncedQuery, load]);

  // === Flujo de exportacion ====================================================
  function openExportFlow() {
    setExportStep('period');
    setExportPeriod('today');
    setExportScope('mine');
    setExportSinReportes(null);
    setExportOpen(true);
  }

  function closeExportFlow() {
    if (exportBusy) return;
    setExportOpen(false);
    setTimeout(() => setExportStep('period'), 200);
  }

  // === Resumen Ejecutivo con IA ===========================================
  async function openAiSummary() {
    setAiOpen(true);
    setAiCopied(false);
    if (aiSummary) return; // ya generado en esta sesion; usuario puede regenerar manualmente
    await runAiSummary();
  }

  async function runAiSummary(periodoOverride?: 'diario' | 'semanal' | 'mensual') {
    if (!projectId) return;
    try {
      setAiBusy(true);
      setAiError(null);
      setAiSummary(null);
      setAiMeta(null);
      const res = await api.aiSummary(projectId, periodoOverride ?? aiPeriodo);
      setAiSummary(res.summary);
      setAiMeta({ reports_count: res.reports_count, period_hours: res.period_hours });
    } catch (e: any) {
      setAiError(e?.message || 'No se pudo generar el resumen.');
    } finally {
      setAiBusy(false);
    }
  }

  async function changeAiPeriodo(p: 'diario' | 'semanal' | 'mensual') {
    if (p === aiPeriodo) return;
    setAiPeriodo(p);
    await runAiSummary(p);
  }

  async function copyAiSummary() {
    if (!aiSummary) return;
    try {
      await Clipboard.setStringAsync(aiSummary);
      setAiCopied(true);
      setTimeout(() => setAiCopied(false), 1800);
    } catch {
      Alert.alert(t('proyectoPantalla.noSePudoCopiar'), t('proyectoPantalla.intentaSeleccionarElTextoManualmente'));
    }
  }

  function onPickPeriod(p: ReportPeriod) { setExportPeriod(p); setExportStep('scope'); }
  function onPickScope(s: ExportScope) { setExportScope(s); setExportSinReportes(null); setExportStep('format'); }

  async function onPickFormat(fmt: ExportFormat, forzar?: boolean) {
    if (!projectId) return;
    try {
      setExportBusy(true);
      setExportSinReportes(null);
      const opts = { scope: exportScope, period_type: periodToInformeType(exportPeriod) } as { scope: ExportScope; period_type?: string };
      if (!forzar) {
        const conteo = await verificarConteoExportacion(projectId, exportPeriod, opts);
        if (conteo.vacio) {
          setExportSinReportes({ fmt, otros: conteo.otros });
          return;
        }
      }
      let blob: Blob; let filename: string; let mime: string;
      if (fmt === 'docx') {
        const r = await api.downloadReportsDocx(projectId, exportPeriod, opts);
        blob = r.blob; filename = r.filename;
        mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else if (fmt === 'pptx') {
        const r = await api.downloadReportsPptx(projectId, exportPeriod, opts);
        blob = r.blob; filename = r.filename;
        mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      } else {
        const r = await api.downloadReportsPdf(projectId, exportPeriod, opts);
        blob = r.blob; filename = r.filename;
        mime = 'application/pdf';
      }
      await downloadBlob(blob, filename, mime);
      setExportOpen(false);
      setTimeout(() => setExportStep('period'), 200);
    } catch (e: any) {
      Alert.alert(t('inicioEspecialista.noSePudoGenerar', { formato: fmt.toUpperCase() }), e?.message || t('inicioEspecialista.intentaNuevamente'));
    } finally {
      setExportBusy(false);
    }
  }

  // Callback estable (identidad fija) para abrir el detalle de un reporte.
  // Se pasa a `FeedCard`, que esta envuelto en `React.memo`: si esta funcion
  // cambiara de referencia en cada render del padre, invalidaria el memo de
  // TODAS las tarjetas visibles en cada re-render.
  const openPreview = useCallback((item: FeedItem) => setPreviewItem(item), []);

  const renderFeedItem = useCallback(({ item }: { item: FeedItem }) => (
    <View style={styles.feedItemWrap}>
      <FeedCard item={item} onPreview={openPreview} />
    </View>
  ), [openPreview]);

  const reports = useMemo(() => feed?.reports || [], [feed]);

  const filteredReports = useMemo(() => {
    let base = reports;
    // Busqueda inteligente client-side (para fluidez total)
    const q = debouncedQuery.toLowerCase();
    if (q) {
      base = base.filter((r) => {
        const textToSearch = [
          r.title, r.nombre, r.name, r.captured_by_name,
          ...(r.node_path_names || []),
          r.avance,
        ].filter(Boolean).join(' ').toLowerCase();
        return textToSearch.includes(q);
      });
    }
    if (selectedDate) {
      base = base.filter((r) => toISODateCDMX(r.created_at) === selectedDate);
    }
    return filtrarPorGravedad(base, gravedadFiltro);
  }, [reports, selectedDate, debouncedQuery, gravedadFiltro]);

  const ListHeader = useMemo(() => (
    <>
      <HeroCard user={user} project={project} globalPct={0} />
      <View style={styles.statsRow}>
        <StatCard label={t('inicioEspecialista.total')} value={stats.total} icon="albums-outline" tint={colors.primary} />
        <StatCard label={t('inicioEspecialista.mios')} value={stats.mine} icon="person" tint="#0EA5E9" />
        <StatCard label={t('inicioEspecialista.companeros')} value={stats.others} icon="people-outline" tint="#10B981" />
      </View>

      <BorradoresCard basePath="/(spec)" />

      {projectId ? (
        <>
          <MyMeetingsPanel items={myMeetings} loading={myMeetingsLoading} />
          <View style={styles.sprintBlock}><DailyGoalsPanel projectId={projectId} /></View>
        </>
      ) : null}

      <ExportRow busy={exportBusy} onPress={openExportFlow} />
      <AiSummaryRow busy={aiBusy} onPress={openAiSummary} />


      <View style={styles.timeFiltersWrap}>
        <Text style={styles.sectionLabel}>{t('proyectoPantalla.filtrarActividad')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
          {RANGE_OPTIONS.map((opt) => {
            const active = range === opt.key && !selectedDate;
            return (
              <Pressable accessibilityRole="button" key={opt.key} onPress={() => { setSelectedDate(null); onPickRange(opt.key); }} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{opt.label}</Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" onPress={() => setCalendarOpen(true)} style={[styles.chip, !!selectedDate && styles.chipActive]}>
            <Ionicons name="calendar-outline" size={14} color={selectedDate ? '#fff' : colors.textBody} />
            <Text style={[styles.chipTxt, !!selectedDate && styles.chipTxtActive]}>{selectedDate || 'Calendario'}</Text>
            {selectedDate && (
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} onPress={() => setSelectedDate(null)} hitSlop={8} style={{ marginLeft: 6 }}>
                <Ionicons name="close-circle" size={14} color="#fff" />
              </Pressable>
            )}
          </Pressable>
        </ScrollView>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('inicioEspecialista.buscarReporte')}
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
          />
          {searchQuery ? <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} onPress={() => setSearchQuery('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable> : null}
        </View>
      </View>

      <GravedadFiltro valor={gravedadFiltro} onChange={setGravedadFiltro} />

      <View style={styles.feedHeaderRow}>
        <Text style={styles.feedTitle}>{debouncedQuery ? t('inicioEspecialista.resultados') : t('inicioEspecialista.actividadReciente')}</Text>
        {reports.length > 0 && <Text style={styles.feedCount}>{reports.length}</Text>}
      </View>

      {loading && filteredReports.length === 0 && (
        <View style={styles.centerPad}><ActivityIndicator color={colors.primary} /></View>
      )}
    </>
  ), [user, project, stats, projectId, reports, exportBusy, aiBusy, selectedDate, range, searchQuery, loading, filteredReports, debouncedQuery, gravedadFiltro, onPickRange, myMeetings, myMeetingsLoading]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.blueTop, { height: 240 + insets.top }]} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <HeaderMenu basePath="/(spec)" projectId={projectId} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle}>{t('marca.nombre')}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{project?.name || 'Cargando...'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('notificaciones')} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="notifications-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <FlatList
        data={filteredReports}
        keyExtractor={(item) => item.id}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews={true}
        renderItem={renderFeedItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          !loading ? (
            <ReportesVacio
              variante="spec"
              hayFiltros={range !== 'all' || !!selectedDate}
              busqueda={debouncedQuery}
              onQuitarFiltros={() => { setSelectedDate(null); setSearchQuery(''); onPickRange('all'); }}
              onCrear={() => router.push('/(spec)/nuevo' as any)}
            />
          ) : null
        }
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" colors={[colors.primary]} />}
      />

      <HistoryCalendarModal visible={calendarOpen} reports={reports} onClose={() => setCalendarOpen(false)} selectedDate={selectedDate} onPickDate={(d) => { setSelectedDate(d); setCalendarOpen(false); }} />
      <ReportPreviewSheet visible={!!previewItem} item={previewItem} project={project} onClose={() => setPreviewItem(null)}
        onGravedadChange={(id, g) => setFeed((f) => (f ? { ...f, reports: f.reports.map((r) => (r.id === id ? { ...r, gravedad: g } : r)) } : f))} />

      <AiSummaryModal
        visible={aiOpen}
        busy={aiBusy}
        summary={aiSummary}
        error={aiError}
        meta={aiMeta}
        copied={aiCopied}
        periodo={aiPeriodo}
        onClose={() => setAiOpen(false)}
        onRegenerate={() => runAiSummary()}
        onChangePeriodo={changeAiPeriodo}
        onCopy={copyAiSummary}
      />

      <Modal visible={exportOpen} animationType="slide" transparent onRequestClose={closeExportFlow}>
        <Pressable style={styles.exportBackdrop} onPress={closeExportFlow} />
        <View style={styles.exportSheet} pointerEvents="box-none">
          <View style={styles.exportSheetInner}>
            <View style={styles.exportHandle} />
            <View style={styles.exportHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.exportTitle}>{t('proyectoPantalla.exportarReportes')}</Text>
                <Text style={styles.exportSubtitle}>{t('inicioEspecialista.pasoDe3', { n: exportStep === 'period' ? 1 : exportStep === 'scope' ? 2 : 3 })}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={closeExportFlow} hitSlop={10} style={styles.headerBtn}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
            </View>
            <View style={{ padding: spacing.md, gap: 10 }}>
              {exportStep === 'period' && PERIOD_OPTIONS.map(opt => (
                <Pressable accessibilityRole="button" key={opt.value} onPress={() => onPickPeriod(opt.value)} style={styles.exportItem}>
                  <View style={styles.exportItemIcon}><Ionicons name={opt.icon} size={20} color={colors.primary} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.exportItemTitle}>{opt.label}</Text><Text style={styles.exportItemSub}>{opt.sub}</Text></View>
                </Pressable>
              ))}
              {exportStep === 'period' && (
                <Pressable accessibilityRole="button" onPress={() => setRangoExportOpen(true)} style={styles.exportItem}>
                  <View style={styles.exportItemIcon}><Ionicons name="calendar-outline" size={20} color={colors.primary} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.exportItemTitle}>Rango personalizado</Text><Text style={styles.exportItemSub}>Elige fecha de inicio y de fin</Text></View>
                </Pressable>
              )}
              {exportStep === 'scope' && (
                <>
                  <Pressable accessibilityRole="button" onPress={() => onPickScope('mine')} style={styles.exportItem}><View style={styles.exportItemIcon}><Ionicons name="person-outline" size={20} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.exportItemTitle}>{t('inicioEspecialista.misReportes')}</Text><Text style={styles.exportItemSub}>{t('inicioEspecialista.soloLoQueYo')}</Text></View></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => onPickScope('area')} style={styles.exportItem}><View style={styles.exportItemIcon}><Ionicons name="grid-outline" size={20} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.exportItemTitle}>{t('inicioEspecialista.miArea')}</Text><Text style={styles.exportItemSub}>{t('inicioEspecialista.reportesDeTodaMi')}</Text></View></Pressable>
                </>
              )}
              {exportStep === 'format' && exportSinReportes ? (
                <SinReportesAviso
                  otros={exportSinReportes.otros}
                  onCambiarPeriodo={() => { setExportSinReportes(null); setExportStep('period'); }}
                  onExportarDeTodosModos={() => onPickFormat(exportSinReportes.fmt, true)}
                />
              ) : null}
              {exportStep === 'format' && FORMAT_OPTIONS.map(opt => (
                <Pressable accessibilityRole="button" key={opt.value} onPress={() => onPickFormat(opt.value)} style={styles.exportItem}>
                  <View style={[styles.exportItemIcon, { backgroundColor: opt.tint + '1A' }]}><Ionicons name={opt.icon} size={20} color={opt.tint} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.exportItemTitle}>{opt.label}</Text><Text style={styles.exportItemSub}>{opt.sub}</Text></View>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <RangoFechasPicker
        visible={rangoExportOpen}
        desdeInicial={null}
        hastaInicial={null}
        onCancelar={() => setRangoExportOpen(false)}
        onConfirmar={(desde, hasta) => { setRangoExportOpen(false); onPickPeriod(codificarPeriodoPersonalizado(desde, hasta)); }}
      />
    </View>
  );
}

const StatCard = memo(({ label, value, icon, tint }: any) => {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: tint + '1A' }]}><Ionicons name={icon} size={16} color={tint} /></View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
});

const HeroCard = memo(({ user, project }: any) => {
  return (
    <View style={[styles.heroWrap, { marginTop: spacing.sm }]}>
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <View style={styles.heroIcon}><Ionicons name="location" size={18} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>{t('inicioEspecialista.miAreaAsignada')}</Text>
            <Text style={styles.heroTitle} numberOfLines={1}>{user?.area || 'Sin área asignada'}</Text>
          </View>
          <View style={styles.heroLeavesPill}>
            <Ionicons name="flag" size={11} color={colors.primary} />
            <Text style={styles.heroLeavesTxt}>
              {(user?.scope_node_ids || []).length > 0 ? (user.scope_node_ids.length === 1 ? t('inicioEspecialista.hojasUna') : t('inicioEspecialista.hojas', { n: user.scope_node_ids.length })) : t('avanceNiveles.todoElProyecto')}
            </Text>
          </View>
        </View>
        {user?.puesto ? <Text style={styles.heroPuesto}>{user.puesto}</Text> : null}
        {project?.contract_number ? (
          <Text style={styles.heroMeta}>
            {t('proyectoPantalla.contrato')} {project.contract_number}
            {project.constructora ? `  ·  ${project.constructora}` : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const ExportRow = memo(({ busy, onPress }: any) => {
  return (
    <View style={styles.exportRow}>
      <Pressable accessibilityRole="button" onPress={onPress} disabled={busy} style={styles.exportMainBtn}>
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="download-outline" size={22} color="#fff" />}
        <View style={{ flex: 1 }}>
          <Text style={styles.exportMainTitle}>{t('proyectoPantalla.exportarReportes')}</Text>
          <Text style={styles.exportMainSub}>{busy ? t('proyectoPantalla.generandoArchivo') : t('inicioEspecialista.pdfWordPowerpoint')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
      </Pressable>
    </View>
  );
});

const AiSummaryRow = memo(({ busy, onPress }: any) => {
  return (
    <View style={styles.exportRow}>
      <Pressable accessibilityRole="button" onPress={onPress} disabled={busy} style={styles.aiBtn}>
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="sparkles" size={22} color="#fff" />}
        <View style={{ flex: 1 }}>
          <Text style={styles.aiBtnTitle}>{t('proyectoPantalla.generarResumenEjecutivoConIa')}</Text>
          <Text style={styles.aiBtnSub}>{busy ? t('proyectoPantalla.analizandoReportesDelDia') : t('inicioEspecialista.avancesEquipoYPersonal')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
      </Pressable>
    </View>
  );
});

function AiSummaryModal({
  visible, busy, summary, error, meta, copied, periodo, onClose, onRegenerate, onChangePeriodo, onCopy,
}: {
  visible: boolean;
  busy: boolean;
  summary: string | null;
  error: string | null;
  meta: { reports_count: number; period_hours: number } | null;
  copied: boolean;
  periodo: 'diario' | 'semanal' | 'mensual';
  onClose: () => void;
  onRegenerate: () => void;
  onChangePeriodo: (p: 'diario' | 'semanal' | 'mensual') => void;
  onCopy: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.exportBackdrop} onPress={onClose} />
      <View style={styles.exportSheet} pointerEvents="box-none">
        <View style={[styles.exportSheetInner, { maxHeight: '80%' }]}>
          <View style={styles.exportHandle} />
          <View style={styles.exportHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.exportTitle}>{t('proyectoPantalla.resumenEjecutivoConIa')}</Text>
              <Text style={styles.exportSubtitle}>{t('proyectoPantalla.generadoAPartirDeLos')}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} hitSlop={10} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: '#F1F5F9', borderRadius: 10, margin: spacing.md, marginBottom: 0, padding: 3 }}>
            {([
              ['diario', 'Hoy'],
              ['semanal', 'Semana'],
              ['mensual', 'Mes'],
            ] as const).map(([key, label]) => (
              <Pressable accessibilityRole="button"
                key={key}
                onPress={() => onChangePeriodo(key)}
                disabled={busy}
                style={({ pressed }) => [
                  { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
                  periodo === key && { backgroundColor: colors.primary },
                  (busy || pressed) && { opacity: 0.7 },
                ]}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: periodo === key ? '#fff' : colors.textMuted }}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: spacing.md }}>
            {busy ? (
              <View style={{ paddingVertical: 40, alignItems: 'center', gap: 12 }}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={{ color: colors.textMuted, fontWeight: '600' }}>{t('proyectoPantalla.analizandoReportesDeHoy')}</Text>
              </View>
            ) : error ? (
              <View style={{ paddingVertical: 20, alignItems: 'center', gap: 8 }}>
                <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
                <Text style={{ color: colors.error, textAlign: 'center', fontWeight: '700' }}>{error}</Text>
                <Pressable accessibilityRole="button" onPress={onRegenerate} style={{ marginTop: 12, padding: 10 }}>
                  <Text style={{ color: colors.primary, fontWeight: '800' }}>{t('red.reintentar')}</Text>
                </Pressable>
              </View>
            ) : summary ? (
              <View style={{ gap: 12 }}>
                {meta && (
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                    <View style={{ backgroundColor: '#F0F9FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#BAE6FD' }}>
                      <Text style={{ fontSize: 10, color: '#0369A1', fontWeight: '800' }}>{meta.reports_count} {t('inicioEspecialista.reportesHoy')}</Text>
                    </View>
                  </View>
                )}
                <View style={{ backgroundColor: '#F8FAFC', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0' }}>
                  <Text style={{ fontSize: 14, color: '#0F172A', lineHeight: 22 }}>{summary}</Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <Pressable accessibilityRole="button"
                    onPress={onCopy}
                    style={({ pressed }) => [
                      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 10, backgroundColor: copied ? colors.success : colors.primary },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{copied ? t('proyectoPantalla.copiado') : t('proyectoPantalla.copiarResumen')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('actualizar')} hitSlop={8}
                    onPress={onRegenerate}
                    style={({ pressed }) => [
                      { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary },
                      pressed && { backgroundColor: '#F0F7FF' },
                    ]}
                  >
                    <Ionicons name="refresh-outline" size={20} color={colors.primary} />
                  </Pressable>
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Pressable accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border },
                pressed && { backgroundColor: colors.bg },
              ]}
            >
              <Text style={{ color: colors.text, fontWeight: '800' }}>{t('a11y.cerrar')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface FeedCardProps {
  item: FeedItem;
  onPreview: (item: FeedItem) => void;
}

// Comparador manual: solo re-renderiza la tarjeta si cambia el propio
// `item` (referencia) o el callback de preview. Esto evita que TODAS las
// tarjetas se vuelvan a pintar cuando el padre cambia (filtros, busqueda,
// refresh de otras secciones).
function areFeedCardPropsEqual(prev: FeedCardProps, next: FeedCardProps): boolean {
  return prev.item === next.item && prev.onPreview === next.onPreview;
}

// Tarjeta minimalista: SOLO nombre del reporte, ubicacion y autor. Todo lo
// demas (fotos, texto completo, jerarquia, actividades, observaciones) vive
// en el detalle (`ReportPreviewSheet`) que se abre al tocarla.
const FeedCard = memo(function FeedCard({ item, onPreview }: FeedCardProps) {
  const leafName = (item.node_path_names || [])[(item.node_path_names || []).length - 1] || 'Sin ubicación';
  const handlePreview = useCallback(() => onPreview(item), [onPreview, item]);

  return (
    <Pressable accessibilityRole="button" onPress={handlePreview} style={styles.feedCard}>
      <View style={styles.feedCardIcon}><Ionicons name="document-text-outline" size={18} color={colors.primary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.feedCompactRow}>
          <GravedadDot gravedad={item.gravedad} />
          <Text style={[styles.feedCardTitle, { flex: 1 }]} numberOfLines={1}>{item.title || item.nombre || item.titulo || item.name || 'Reporte'}</Text>
        </View>
        <View style={styles.feedCompactRow}>
          <Ionicons name="location-outline" size={12} color={colors.textMuted} />
          <Text style={styles.feedCardSub} numberOfLines={1}>{leafName}</Text>
        </View>
        <View style={styles.feedCompactRow}>
          <Ionicons name="person-outline" size={12} color={colors.textMuted} />
          <Text style={styles.feedCardSub} numberOfLines={1}>{item.captured_by_name || '—'}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}, areFeedCardPropsEqual);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  blueTop: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.primary },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.md, height: 60 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  headerSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },
  heroWrap: { paddingHorizontal: spacing.md },
  heroCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.card, borderWidth: 1, borderColor: colors.border },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  heroLabel: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.5 },
  heroTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  heroPuesto: { fontSize: 13, color: colors.textBody, marginTop: 4, marginLeft: 46 },
  heroMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2, marginLeft: 46 },
  heroLeavesPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  heroLeavesTxt: { color: colors.primary, fontSize: 10, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, ...shadow.card, borderWidth: 1, borderColor: colors.border },
  statIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '900', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '800', textTransform: 'uppercase' },
  sprintBlock: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  exportRow: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  exportMainBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primary, padding: spacing.md, borderRadius: radius.lg, ...shadow.card },
  exportMainTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  exportMainSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#7C3AED', paddingHorizontal: spacing.md, paddingVertical: 16,
    borderRadius: radius.lg, minHeight: 64, ...shadow.card,
  },
  aiBtnTitle: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },
  aiBtnSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  timeFiltersWrap: { marginTop: spacing.md },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, paddingHorizontal: spacing.md, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center' },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 13, fontWeight: '700', color: colors.textBody },
  chipTxtActive: { color: '#fff' },
  searchWrap: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: radius.md, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },
  feedHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: spacing.sm },
  feedTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  feedCount: { fontSize: 11, fontWeight: '800', color: colors.primary, backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  feedCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  feedCardIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  feedCardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  feedCompactRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  feedCardSub: { fontSize: 12, color: colors.textMuted, flexShrink: 1 },
  feedItemWrap: { paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  centerPad: { padding: spacing.xl, alignItems: 'center' },
  emptyBox: { marginHorizontal: spacing.md, marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: 10, ...shadow.card, borderWidth: 1, borderColor: colors.border },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  emptyMsg: { fontSize: 13, color: colors.textBody, textAlign: 'center' },
  emptyBtn: { marginTop: 8, backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: radius.md },
  emptyBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // Action Tile (Sprint 2 / Phase 4)
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  tileIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  tileSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  exportBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  exportSheet: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  exportSheetInner: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, ...shadow.lg },
  exportHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginVertical: 12 },
  exportHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  exportTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  exportSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  exportItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  exportItemIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  exportItemTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  exportItemSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
