// Dashboard de Sub-coordinador (Fase 4) _ UI unificada con (spec)/index.tsx
// Layout: fondo azul + hero card + stat cards + paneles + exportar + alertas + feed
import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth-context';
import { api, FeedItem, LocationNode, Project, ProjectEvent } from '@/src/api';
import { colors, radius, shadow, spacing, areaTone } from '@/src/theme';
import { roleLabel } from '@/src/utils/roles';
import { HeaderMenu } from '@/src/components/HeaderMenu';
import { DailyGoalsPanel } from '@/src/components/DailyGoalsPanel';
import { NodeProgressPanel } from '@/src/components/NodeProgressPanel';
import { MyMeetingsPanel } from '@/src/components/MyMeetingsPanel';
import { ReportPreviewSheet } from '@/src/components/ReportPreviewSheet';
import { periodToInformeType } from '@/src/components/PeriodSheet';
import { HistoryCalendarModal } from '@/src/components/HistoryCalendarModal';
import {
  dayjs, toISODateCDMX, fmtTimeCDMX, CDMX_TZ,
  getStartOfTodayCDMX, getStartOfNaturalWeekCDMX, getStartOfNaturalMonthCDMX
} from '@/src/utils/tz';
import { shareWithAutoRecover } from '@/src/utils/share';

type ProgressRow = {
  node: LocationNode;
  count: number;
  pct: number; // 0..100
};

export default function SubCoordDashboard() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [pid, setPid] = useState<string | null>(null);
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [reports, setReports] = useState<FeedItem[]>([]);
  const [stats, setStats] = useState({ total: 0, mine: 0, others: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resumen Ejecutivo con IA
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<{ reports_count: number; period_hours: number } | null>(null);
  const [aiCopied, setAiCopied] = useState(false);

  // Estado para compartir reporte individual
  const [sharingReportId, setSharingReportId] = useState<string | null>(null);

  // Badge del Hub de Minutas (acuerdos asignados / urgentes al usuario).
  const [minutasBadge, setMinutasBadge] = useState<{ assigned_pending: number; urgent: number } | null>(null);

  // "Mis reuniones" (proximas reuniones donde soy autor o asistente).
  const [myMeetings, setMyMeetings] = useState<ProjectEvent[]>([]);
  const [myMeetingsLoading, setMyMeetingsLoading] = useState(true);

  // Filtros Sub-coord por Area + Exportacion Avanzada (Task 4)
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set());
  const [advExportOpen, setAdvExportOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<FeedItem | null>(null);
  const [advExporting, setAdvExporting] = useState(false);

  // P4 - Filtro de tiempo (Hoy/Semana/Mes/Todo)
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('today');

  // Calendario historico _ filtrar reportes por dia calendario en CDMX.
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null); // YYYY-MM-DD (CDMX)

  // P4 - Estado del modal de exportacion avanzada
  const [expFormat, setExpFormat] = useState<'xlsx' | 'pdf' | 'docx' | 'pptx'>('xlsx');
  const [expPeriod, setExpPeriod] = useState<'today' | 'yesterday' | 'week' | 'month'>('today');
  // P0 Mega-Feature: filtro por Area para exportacion (Supervisores)
  const [expAreas, setExpAreas] = useState<{ id: string; name: string; color?: string }[]>([]);
  const [expAreaId, setExpAreaId] = useState<string | null>(null); // null = "Todas las areas"

  // Busqueda inteligente del feed (nombre, ubicacion, texto).
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const loadProjects = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(list || []);
      if ((list || []).length > 0 && !pid) {
        setPid(list[0].id);
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los proyectos');
    }
  }, [pid]);

  // Nodos + badge de minutas: cambian con el proyecto, no con cada tecla de
  // busqueda. Separado de loadFeed para que escribir en el buscador no
  // vuelva a pedir /nodes (aggregation pesada) ni /minutas/badge de arriba.
  const loadStructure = useCallback(async (projectId: string) => {
    setMyMeetingsLoading(true);
    const [ns, b, evs] = await Promise.all([
      api.listNodes(projectId),
      api.minutasBadge(projectId).catch(() => null),
      api.listEvents(projectId, 'upcoming', 5, true).catch(() => [] as ProjectEvent[]),
    ]);
    setNodes(ns || []);
    setMinutasBadge(b);
    setMyMeetings(evs);
    setMyMeetingsLoading(false);
  }, []);

  const loadFeed = useCallback(async (projectId: string) => {
    const feed = await api.feed(projectId, period, 100, debouncedQuery || undefined);
    setReports(feed?.reports || []);
    setStats(feed?.stats || { total: 0, mine: 0, others: 0 });
  }, [period, debouncedQuery]);

  const loadData = useCallback(async (projectId: string) => {
    try {
      setError(null);
      await Promise.all([loadStructure(projectId), loadFeed(projectId)]);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar la informacion');
    }
  }, [loadStructure, loadFeed]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadProjects();
      setLoading(false);
    })();
  }, [loadProjects]);

  const loadedStructureForPid = useRef<string | null>(null);

  useEffect(() => {
    if (!pid) return;
    (async () => {
      setLoading(true);
      await loadData(pid);
      loadedStructureForPid.current = pid;
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  // Cambios de busqueda/periodo despues de la carga inicial: solo refetch
  // del feed, no de la estructura completa del proyecto.
  useEffect(() => {
    if (!pid || loadedStructureForPid.current !== pid) return;
    loadFeed(pid).catch((e: any) => setError(e?.message || 'No se pudo cargar la informacion'));
  }, [debouncedQuery, period, pid, loadFeed]);

  const onRefresh = useCallback(async () => {
    if (!pid) return;
    setRefreshing(true);
    await loadData(pid);
    setRefreshing(false);
  }, [pid, loadData]);

  const allAreas = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of reports) {
      if (r.area_name) m.set(r.area_name, r.area_color || '');
    }
    return Array.from(m, ([name, color]) => ({ name, color }));
  }, [reports]);

  const filteredReports = useMemo(() => {
    let base = reports;

    // 1. Busqueda Inteligente (Título, Personal, Equipo, Actividades, Ubicación)
    const q = debouncedQuery.toLowerCase();
    if (q) {
      base = base.filter((r) => {
        const textToSearch = [
          r.title,
          r.nombre,
          r.name,
          r.captured_by_name,
          ...(r.personnel || []),
          ...(r.equipment || []),
          r.notes,
          r.actividades,
          r.observaciones,
          r.comment,
          ...(r.node_path_names || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return textToSearch.includes(q);
      });
    }

    // 2. Filtrado por Calendario (prioridad alta)
    if (selectedDate) {
      base = base.filter((r) => toISODateCDMX(r.created_at) === selectedDate);
    } else {
      // 3. Filtrado por Periodo (Hoy / Semana / Mes) si no hay fecha de calendario
      const startOfDay = getStartOfTodayCDMX();
      const startOfWeek = getStartOfNaturalWeekCDMX();
      const startOfMonth = getStartOfNaturalMonthCDMX();

      base = base.filter((r) => {
        if (!r.created_at) return false;
        const created = dayjs.utc(r.created_at).tz(CDMX_TZ);

        if (period === 'today') {
          return created.isSameOrAfter(startOfDay);
        }
        if (period === 'week') {
          return created.isSameOrAfter(startOfWeek);
        }
        if (period === 'month') {
          return created.isSameOrAfter(startOfMonth);
        }
        return true;
      });
    }

    // 4. Filtrado por Area
    if (selectedAreas.size > 0) {
      base = base.filter((r) => r.area_name && selectedAreas.has(r.area_name));
    }

    return base;
  }, [reports, selectedAreas, selectedDate, period, debouncedQuery]);

  // Nombre del nodo tramo (scope_node_id) para Hero Card (Task 2)
  const scopeNodeName = useMemo(() => {
    const sid = (user as any)?.scope_node_id;
    if (!sid) return null;
    const n = nodes.find((x) => x.id === sid);
    return n?.name || null;
  }, [nodes, user]);

  const progressRows: ProgressRow[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of filteredReports) {
      const anyR: any = r;
      const raw = anyR.avance ?? anyR.medicion ?? 0;
      const val = parseFloat(String(raw));
      const inc = Number.isFinite(val) ? val : 0;
      counts.set(r.node_id, (counts.get(r.node_id) || 0) + inc);
    }
    const rows: ProgressRow[] = [];
    for (const n of nodes) {
      if (typeof n.meta === 'number' && (n.meta || 0) > 0) {
        const count = counts.get(n.id) || 0;
        const pct = Math.min(100, Math.round((count / (n.meta || 1)) * 100));
        rows.push({ node: n, count, pct });
      }
    }
    return rows;
  }, [nodes, filteredReports]);

  const globalPct = useMemo(() => {
    if (progressRows.length === 0) return 0;
    const sum = progressRows.reduce((acc, r) => acc + r.pct, 0);
    return Math.round(sum / progressRows.length);
  }, [progressRows]);

  const alerts = useMemo(
    () => progressRows.filter((r) => r.pct < 50).sort((a, b) => a.pct - b.pct),
    [progressRows],
  );

  const todayReports = useMemo(
    () => [...filteredReports].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 12),
    [filteredReports],
  );

  // === Resumen Ejecutivo con IA ===========================================
  // [FIX 2026-08-07] `openAiSummary` dependia de `runAiSummary` en su arreglo
  // de dependencias mientras este ultimo se declaraba mas abajo. Al ser
  // `const`, esa referencia caia en zona muerta temporal y lanzaba
  // "Cannot access 'runAiSummary' before initialization" en cada render,
  // rompiendo la pantalla completa (no solo el boton de resumen IA).
  const runAiSummary = useCallback(async () => {
    if (!pid) return;
    try {
      setAiBusy(true);
      setAiError(null);
      setAiSummary(null);
      setAiMeta(null);
      const res = await api.aiSummary(pid);
      setAiSummary(res.summary);
      setAiMeta({ reports_count: res.reports_count, period_hours: res.period_hours });
    } catch (e: any) {
      setAiError(e?.message || 'No se pudo generar el resumen.');
    } finally {
      setAiBusy(false);
    }
  }, [pid]);

  const openAiSummary = useCallback(async () => {
    setAiOpen(true);
    setAiCopied(false);
    if (aiSummary) return;
    await runAiSummary();
  }, [aiSummary, runAiSummary]);

  async function copyAiSummary() {
    if (!aiSummary) return;
    try {
      await Clipboard.setStringAsync(aiSummary);
      setAiCopied(true);
      setTimeout(() => setAiCopied(false), 1800);
    } catch {
      Alert.alert('No se pudo copiar', 'Intenta seleccionar el texto manualmente.');
    }
  }

  async function shareSummaryWhatsApp() {
    if (!aiSummary) return;
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('No disponible', 'Compartir no esta disponible en este dispositivo.');
        return;
      }
      const ts = Date.now();
      const fileUri = `${FileSystem.cacheDirectory}resumen_ejecutivo_${ts}.txt`;
      const header = `__ Resumen Ejecutivo _ SynCo\n${
        aiMeta ? `${aiMeta.reports_count} reportes _ ultimas ${aiMeta.period_hours}h\n` : ''
      }\n`;
      await FileSystem.writeAsStringAsync(fileUri, header + aiSummary, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/plain',
        dialogTitle: 'Compartir resumen ejecutivo',
        UTI: 'public.plain-text',
      });
    } catch (e: any) {
      Alert.alert('No se pudo compartir', e?.message || 'Intentalo nuevamente.');
    }
  }

  // === Compartir reporte individual en WhatsApp (foto + texto) ============
  async function shareReportWhatsApp(item: FeedItem) {
    if (sharingReportId) return;
    try {
      setSharingReportId(item.id);
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('No disponible', 'Compartir no esta disponible en este dispositivo.');
        return;
      }

      const path = (item.node_path_names || []).join(' _ ') || '_';
      const ts = item.created_at ? dayjs.utc(item.created_at).tz(CDMX_TZ).format('DD/MM/YYYY HH:mm') : '';
      const captionLines = [
        '__ *Reporte de obra _ SynCo*',
        '',
        `__ *Ubicacion:* ${path}`,
        `__ *Capturado por:* ${item.captured_by_name || '_'}`,
        ts ? `__ *Fecha:* ${ts}` : '',
        item.area_name ? `___ *Area:* ${item.area_name}` : '',
        item.avance ? `\n__ *Avance:*\n${item.avance}` : '',
      ].filter(Boolean);
      const caption = captionLines.join('\n');

      // Si hay miniatura, escribimos la imagen a cache y compartimos
      if (item.thumbnail_base64) {
        const fileUri = `${FileSystem.cacheDirectory}reporte_${item.id}.jpg`;
        await FileSystem.writeAsStringAsync(fileUri, item.thumbnail_base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        // Copiar texto al portapapeles antes de abrir el share sheet,
        // asi el usuario puede pegarlo como caption en WhatsApp.
        try { await Clipboard.setStringAsync(caption); } catch {}
        await shareWithAutoRecover(fileUri, {
          mimeType: 'image/jpeg',
          dialogTitle: 'Compartir reporte',
          UTI: 'public.jpeg',
        });
      } else {
        // Sin imagen, compartimos solo el texto
        const fileUri = `${FileSystem.cacheDirectory}reporte_${item.id}.txt`;
        await FileSystem.writeAsStringAsync(fileUri, caption, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        await shareWithAutoRecover(fileUri, {
          mimeType: 'text/plain',
          dialogTitle: 'Compartir reporte',
          UTI: 'public.plain-text',
        });
      }
    } catch (e: any) {
      Alert.alert('No se pudo compartir', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSharingReportId(null);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function onExport() {
    if (!pid || exporting) return;
    try {
      setExporting(true);
      const { blob, filename } = await api.downloadReportsXlsx(pid);
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        const reader = new FileReader();
        const dataUri: string = await new Promise((resolve, reject) => {
          reader.onerror = () => reject(reader.error);
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        const base64 = dataUri.split(',')[1] || '';
        const dest = `${FileSystem.cacheDirectory || ''}${filename}`;
        await FileSystem.writeAsStringAsync(dest, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(dest, {
            mimeType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Compartir reporte SynCo',
          });
        } else {
          Alert.alert('Listo', `Archivo guardado en cache:\n${dest}`);
        }
      }
    } catch (e: any) {
      Alert.alert(
        'No se pudo exportar',
        e?.message || 'Intentalo nuevamente.',
      );
    } finally {
      setExporting(false);
    }
  }

  // P0 Mega-Feature: cargar areas al abrir el modal de exportacion
  useEffect(() => {
    if (!advExportOpen || !pid) return;
    let alive = true;
    (async () => {
      try {
        const list = await api.listAreas(pid);
        if (alive) setExpAreas((list || []).map((a) => ({ id: a.id, name: a.name, color: a.color })));
      } catch {
        if (alive) setExpAreas([]);
      }
    })();
    return () => { alive = false; };
  }, [advExportOpen, pid]);

  // P0 - Exportacion Avanzada: PDF / XLSX / DOCX / PPTX _ Hoy/Ayer/Semana/Mes
  async function onAdvExport() {
    if (!pid || advExporting) return;
    try {
      setAdvExporting(true);
      let blob: Blob;
      let filename: string;
      const exportOpts: { area_id?: string; period_type?: string } = {
        ...(expAreaId ? { area_id: expAreaId } : {}),
        period_type: periodToInformeType(expPeriod),
      };
      if (expFormat === 'xlsx') {
        const r = await api.downloadReportsXlsx(pid);
        blob = r.blob;
        filename = r.filename;
      } else if (expFormat === 'pdf') {
        const r = await api.downloadReportsPdf(pid, expPeriod, exportOpts);
        blob = r.blob;
        filename = r.filename;
      } else if (expFormat === 'docx') {
        const r = await api.downloadReportsDocx(pid, expPeriod, exportOpts);
        blob = r.blob;
        filename = r.filename;
      } else {
        const r = await api.downloadReportsPptx(pid, expPeriod, exportOpts);
        blob = r.blob;
        filename = r.filename;
      }
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        const reader = new FileReader();
        const dataUri: string = await new Promise((resolve, reject) => {
          reader.onerror = () => reject(reader.error);
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        const base64 = dataUri.split(',')[1] || '';
        const dest = `${FileSystem.cacheDirectory || ''}${filename}`;
        await FileSystem.writeAsStringAsync(dest, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(dest, { dialogTitle: 'Compartir reporte SynCo' });
        } else {
          Alert.alert('Listo', `Archivo guardado en cache:\n${dest}`);
        }
      }
      setAdvExportOpen(false);
    } catch (e: any) {
      Alert.alert('No se pudo exportar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setAdvExporting(false);
    }
  }

  function getProgressColor(pct: number) {
    if (pct >= 100) return colors.success;
    if (pct >= 50) return colors.primary;
    return colors.error;
  }

  // [DELETE] formatTime local ya no se usa, usamos fmtTimeCDMX de tz.ts

  const currentProject = projects.find((p) => p.id === pid);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      {/* Fondo azul superior */}
      <View style={[styles.blueTop, { height: 240 + insets.top }]} />

      {/* Header sobre el azul */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <HeaderMenu basePath="/(subcoord)" projectId={pid} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle}>SynCo</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            Sub-coordinador _ {roleLabel(user?.role)}
          </Text>
        </View>
        <Pressable hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="notifications-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#fff"
            colors={[colors.primary]}
          />
        }
      >
        {/* Hero Card: PROYECTO COORDINADO */}
        <View style={[styles.heroWrap, { marginTop: spacing.sm }]}>
          <View style={styles.heroCard}>
            <View style={styles.heroHeaderRow}>
              <View style={styles.heroIcon}>
                <Ionicons name="briefcase" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroLabel}>PROYECTO COORDINADO</Text>
                <Text style={styles.heroTitle} numberOfLines={1}>
                  {currentProject?.name || 'Sin proyecto'}
                </Text>
              </View>
              <View style={styles.heroLeavesPill}>
                <Ionicons name="speedometer" size={11} color={colors.primary} />
                <Text style={styles.heroLeavesTxt}>{globalPct}%</Text>
              </View>
            </View>
            <Text style={styles.heroPuesto}>
              Hola, {user?.name || 'Sub-coordinador'}
            </Text>
            {scopeNodeName ? (
              <View style={styles.heroScopeRow}>
                <Ionicons name="location" size={12} color={colors.primary} />
                <Text style={styles.heroScopeTxt} numberOfLines={1}>
                  Tramo asignado: <Text style={styles.heroScopeName}>{scopeNodeName}</Text>
                </Text>
              </View>
            ) : (
              <View style={styles.heroScopeRow}>
                <Ionicons name="alert-circle" size={12} color={colors.textMuted} />
                <Text style={[styles.heroScopeTxt, { color: colors.textMuted }]} numberOfLines={1}>
                  Sin tramo asignado
                </Text>
              </View>
            )}
            {currentProject?.contract_number ? (
              <Text style={styles.heroMeta}>
                Contrato {currentProject.contract_number}
                {currentProject.constructora ? `  _  ${currentProject.constructora}` : ''}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Selector de proyectos (si hay mas de uno) */}
        {projects.length > 1 && (
          <View style={{ paddingHorizontal: spacing.md, marginTop: spacing.md }}>
            <Text style={styles.sectionLabel}>Cambiar proyecto</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, paddingVertical: 4 }}
            >
              {projects.map((p) => {
                const sel = p.id === pid;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setPid(p.id)}
                    style={[styles.chip, sel && styles.chipActive]}
                  >
                    <Text
                      style={[styles.chipTxt, sel && styles.chipTxtActive]}
                      numberOfLines={1}
                    >
                      {p.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Stat Cards: TOTAL _ MÍOS _ COMPAÑEROS (Dynamic) */}
        <View style={styles.statsRow}>
          <StatCard label="TOTAL" value={stats.total} icon="albums-outline" tint={colors.primary} />
          <StatCard label="MÍOS" value={stats.mine} icon="person" tint="#0EA5E9" />
          <StatCard label="COMPAÑEROS" value={stats.others} icon="people-outline" tint="#10B981" />
        </View>

        {/* P4 - Chips de Tiempo (Hoy / Semana / Mes / Todo / Dia calendario) */}
        <View style={styles.timeChipsRow}>
          {([
            { k: 'today', label: 'Hoy', icon: 'today-outline' },
            { k: 'week', label: 'Semana', icon: 'calendar-outline' },
            { k: 'month', label: 'Mes', icon: 'calendar-clear-outline' },
            { k: 'all', label: 'Todo', icon: 'apps-outline' },
          ] as const).map((t) => {
            const sel = period === t.k && !selectedDate;
            return (
              <Pressable
                key={t.k}
                onPress={() => {
                  setPeriod(t.k);
                  setSelectedDate(null);
                }}
                style={[styles.timeChip, sel && styles.timeChipActive]}
              >
                <Ionicons
                  name={t.icon as any}
                  size={13}
                  color={sel ? '#fff' : colors.primary}
                />
                <Text style={[styles.timeChipTxt, sel && styles.timeChipTxtActive]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
          {/* Boton Dia _ abre calendario historico */}
          <Pressable
            onPress={() => setCalendarOpen(true)}
            style={[styles.timeChip, !!selectedDate && styles.timeChipActive]}
          >
            <Ionicons
              name="calendar"
              size={13}
              color={selectedDate ? '#fff' : colors.primary}
            />
            <Text
              style={[styles.timeChipTxt, !!selectedDate && styles.timeChipTxtActive]}
              numberOfLines={1}
            >
              {selectedDate || 'Dia'}
            </Text>
            {selectedDate && (
              <Pressable
                hitSlop={8}
                onPress={(e) => {
                  e.stopPropagation();
                  setSelectedDate(null);
                }}
              >
                <Ionicons name="close-circle" size={14} color="#fff" />
              </Pressable>
            )}
          </Pressable>
        </View>

        {/* P5 - Chips de Areas (filtros visuales) */}
        {allAreas.length > 0 && (
          <View style={{ marginTop: spacing.sm }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.areaChipsContent}
            >
              <Pressable
                onPress={() => setSelectedAreas(new Set())}
                style={[
                  styles.areaChip,
                  selectedAreas.size === 0 && styles.areaChipActive,
                ]}
              >
                <Ionicons
                  name="apps-outline"
                  size={12}
                  color={selectedAreas.size === 0 ? '#fff' : colors.textBody}
                />
                <Text
                  style={[
                    styles.areaChipTxt,
                    selectedAreas.size === 0 && styles.areaChipTxtActive,
                  ]}
                >
                  Todas
                </Text>
              </Pressable>
              {allAreas.map((a) => {
                const sel = selectedAreas.has(a.name);
                const tone = areaTone(a.color || undefined);
                return (
                  <Pressable
                    key={a.name}
                    onPress={() => {
                      const next = new Set(selectedAreas);
                      if (sel) next.delete(a.name);
                      else next.add(a.name);
                      setSelectedAreas(next);
                    }}
                    style={[
                      styles.areaChip,
                      {
                        backgroundColor: sel ? tone.text : tone.bg,
                        borderColor: tone.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.areaChipDot,
                        { backgroundColor: sel ? '#fff' : tone.text },
                      ]}
                    />
                    <Text
                      style={[
                        styles.areaChipTxt,
                        { color: sel ? '#fff' : tone.text },
                      ]}
                      numberOfLines={1}
                    >
                      {a.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {loading ? (
          <View style={styles.centerPad}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.error} />
            <Text style={styles.errorTxt}>{error}</Text>
            <Pressable onPress={() => pid && loadData(pid)} style={styles.retryBtn}>
              <Text style={styles.retryTxt}>Reintentar</Text>
            </Pressable>
          </View>
        ) : !pid ? (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIcon}>
              <Ionicons name="folder-open-outline" size={28} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>Sin proyectos asignados</Text>
            <Text style={styles.emptyMsg}>
              Pidele a tu Coordinador General que te asigne a un proyecto para ver el panel.
            </Text>
          </View>
        ) : (
          <>
            <MyMeetingsPanel items={myMeetings} loading={myMeetingsLoading} />

            {/* DailyGoalsPanel */}
            <View style={styles.sprintBlock}>
              <DailyGoalsPanel projectId={pid} />
            </View>

            {/* NodeProgressPanel _ con guardia defensiva */}
            <View style={styles.sprintBlock}>
              <NodeProgressPanel projectId={pid} reports={reports || []} nodes={nodes} />
            </View>

            {/* Boton Resumen Ejecutivo IA */}
            <View style={styles.exportRow}>
              <Pressable
                onPress={openAiSummary}
                disabled={aiBusy}
                style={({ pressed }) => [
                  styles.aiMainBtn,
                  aiBusy && { opacity: 0.7 },
                  pressed && !aiBusy && { opacity: 0.92 },
                ]}
              >
                {aiBusy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name="sparkles" size={22} color="#fff" />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.exportMainTitle}>Resumen Ejecutivo con IA</Text>
                  <Text style={styles.exportMainSub}>
                    {aiBusy ? 'Analizando reportes_' : 'Analisis ejecutivo _ ultimas 24h'}
                  </Text>
                </View>
                {!aiBusy && (
                  <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
                )}
              </Pressable>
            </View>

            {/* Boton Exportacion Avanzada (PDF/XLSX/DOCX/PPTX _ periodo) */}
            <View style={styles.exportRow}>
              <Pressable
                onPress={() => setAdvExportOpen(true)}
                style={({ pressed }) => [
                  styles.exportMainBtn,
                  pressed && { opacity: 0.92 },
                ]}
              >
                <Ionicons name="download-outline" size={22} color="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.exportMainTitle}>Exportacion Avanzada</Text>
                  <Text style={styles.exportMainSub}>
                    PDF _ XLSX _ DOCX _ PPTX  _  Hoy/Ayer/Semana/Mes
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
              </Pressable>
            </View>

            {/* Alertas Semaforo */}
            <View style={styles.cardWrap}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIcon, { backgroundColor: colors.error }]}>
                    <Ionicons name="warning" size={16} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>Alertas Semaforo</Text>
                    <Text style={styles.cardSubtitle}>
                      Nodos con avance menor al 50% de su meta
                    </Text>
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>{alerts.length}</Text>
                  </View>
                </View>

                {alerts.length === 0 ? (
                  <View style={styles.emptyInline}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                    <Text style={styles.emptyInlineTxt}>
                      Sin alertas activas. Todos los nodos con meta van bien.
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    {alerts.slice(0, 10).map((r) => (
                      <View key={r.node.id} style={styles.alertRow}>
                        <View style={[styles.dot, { backgroundColor: getProgressColor(r.pct) }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.alertName} numberOfLines={1}>
                            {r.node.name}
                          </Text>
                          <View style={styles.alertMiniBar}>
                            <View
                              style={[
                                styles.alertMiniFill,
                                {
                                  width: `${Math.max(4, r.pct)}%`,
                                  backgroundColor: getProgressColor(r.pct),
                                },
                              ]}
                            />
                          </View>
                          <Text style={styles.alertMeta}>
                            {r.count} / {r.node.meta} reportes
                          </Text>
                        </View>
                        <Text style={[styles.alertPct, { color: getProgressColor(r.pct) }]}>
                          {r.pct}%
                        </Text>
                      </View>
                    ))}
                    {alerts.length > 10 && (
                      <Text style={styles.alertMore}>+{alerts.length - 10} mas_</Text>
                    )}
                  </View>
                )}
              </View>
            </View>

            {/* Reportes Recientes con boton compartir WhatsApp */}
            <View style={styles.subSearchWrap}>
              <View style={styles.subSearchBox}>
                <Ionicons name="search" size={17} color={colors.textMuted} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Buscar reporte por nombre, ubicacion o texto_"
                  placeholderTextColor={colors.textMuted}
                  style={styles.subSearchInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                />
                {searchQuery ? (
                  <Pressable hitSlop={8} onPress={() => setSearchQuery('')}>
                    <Ionicons name="close-circle" size={17} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            </View>
            <View style={styles.feedHeaderRow}>
              <Text style={styles.feedTitle}>
                {debouncedQuery ? 'Resultados' : 'Reportes Recientes'}
              </Text>
              {todayReports.length > 0 ? (
                <Text style={styles.feedCount}>{todayReports.length}</Text>
              ) : null}
            </View>

            {todayReports.length === 0 ? (
              <View style={styles.emptyBox}>
                <View style={styles.emptyIcon}>
                  <Ionicons
                    name={debouncedQuery ? 'search-outline' : 'time-outline'}
                    size={26}
                    color={colors.primary}
                  />
                </View>
                <Text style={styles.emptyTitle}>
                  {debouncedQuery ? 'Sin resultados' : 'Aun sin reportes hoy'}
                </Text>
                <Text style={styles.emptyMsg}>
                  {debouncedQuery
                    ? `No encontramos reportes que coincidan con "${debouncedQuery}".`
                    : 'Cuando tu equipo capture actividad, aparecera aqui.'}
                </Text>
              </View>
            ) : (
              <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
                {todayReports.map((r) => {
                  const tone = areaTone(r.area_color || undefined);
                  const path = r.node_path_names || [];
                  const leafName = path[path.length - 1] || 'Sin ubicacion';
                  const parentName = path.length >= 2 ? path[path.length - 2] : '';
                  const subtitle = parentName ? `${parentName} _ ${leafName}` : leafName;
                  return (
                    <FeedCard
                      key={r.id}
                      r={r}
                      tone={tone}
                      subtitle={subtitle}
                      onPreview={setPreviewItem}
                      onShare={shareReportWhatsApp}
                      isSharing={sharingReportId === r.id}
                    />
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ===== Modal: Resumen Ejecutivo con IA ===== */}
      <Modal
        visible={aiOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAiOpen(false)}
      >
        <View style={styles.aiBackdrop}>
          <View style={styles.aiCard}>
            <View style={styles.aiHeader}>
              <View style={styles.aiTitleRow}>
                <Ionicons name="sparkles" size={20} color={colors.primary} />
                <Text style={styles.aiTitle}>Resumen Ejecutivo</Text>
              </View>
              <Pressable
                onPress={() => setAiOpen(false)}
                hitSlop={10}
                style={({ pressed }) => [styles.aiClose, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            {aiMeta && (
              <Text style={styles.aiMeta}>
                {aiMeta.reports_count} reportes _ ultimas {aiMeta.period_hours}h
              </Text>
            )}

            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingVertical: spacing.sm }}>
              {aiBusy ? (
                <View style={styles.aiLoading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.aiLoadingTxt}>Analizando reportes_</Text>
                </View>
              ) : aiError ? (
                <Text style={styles.aiError}>{aiError}</Text>
              ) : aiSummary ? (
                <Text style={styles.aiBody}>{aiSummary}</Text>
              ) : (
                <Text style={styles.aiBody}>Sin contenido.</Text>
              )}
            </ScrollView>

            <View style={styles.aiActions}>
              <Pressable
                onPress={runAiSummary}
                disabled={aiBusy}
                style={({ pressed }) => [
                  styles.aiSecBtn,
                  (aiBusy || pressed) && { opacity: 0.7 },
                ]}
              >
                <Ionicons name="refresh" size={16} color={colors.text} />
                <Text style={styles.aiSecTxt}>Regenerar</Text>
              </Pressable>
              <Pressable
                onPress={copyAiSummary}
                disabled={!aiSummary || aiBusy}
                style={({ pressed }) => [
                  styles.aiPrimBtn,
                  (!aiSummary || aiBusy) && { opacity: 0.5 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Ionicons name={aiCopied ? 'checkmark' : 'copy-outline'} size={16} color="#fff" />
                <Text style={styles.aiPrimTxt}>{aiCopied ? 'Copiado' : 'Copiar'}</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={shareSummaryWhatsApp}
              disabled={!aiSummary || aiBusy}
              style={({ pressed }) => [
                styles.waBtn,
                (!aiSummary || aiBusy) && { opacity: 0.5 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="logo-whatsapp" size={18} color="#fff" />
              <Text style={styles.waTxt}>Compartir por WhatsApp</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ===== Modal: Preview de Reporte (componente compartido) ===== */}
      <ReportPreviewSheet
        visible={!!previewItem}
        item={previewItem}
        project={currentProject}
        onClose={() => setPreviewItem(null)}
        onShare={shareReportWhatsApp}
        sharing={!!previewItem && sharingReportId === previewItem.id}
      />

      {/* ===== Modal: Calendario historico ===== */}
      <HistoryCalendarModal
        visible={calendarOpen}
        reports={reports}
        selectedDate={selectedDate}
        onClose={() => setCalendarOpen(false)}
        onPickDate={(d) => {
          setSelectedDate(d);
          setCalendarOpen(false);
        }}
      />

      {/* ===== Modal: Exportacion Avanzada ===== */}
      <Modal
        visible={advExportOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !advExporting && setAdvExportOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}
          onPress={() => !advExporting && setAdvExportOpen(false)}
        >
          <Pressable
            style={{ width: '92%', maxWidth: 460, maxHeight: '85%', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' }}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>Exportacion Avanzada</Text>
              <Pressable
                hitSlop={10}
                disabled={advExporting}
                onPress={() => setAdvExportOpen(false)}
              >
                <Ionicons name="close" size={22} color="#0f172a" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
              <View>
                <Text style={styles.advLabel}>Formato</Text>
                <View style={styles.advGrid}>
                  {(['xlsx', 'pdf', 'docx', 'pptx'] as const).map((f) => {
                    const active = expFormat === f;
                    return (
                      <Pressable
                        key={f}
                        onPress={() => setExpFormat(f)}
                        style={[styles.advChip, active && styles.advChipActive]}
                      >
                        <Text style={[styles.advChipTxt, active && styles.advChipTxtActive]}>
                          {f.toUpperCase()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View>
                <Text style={styles.advLabel}>Periodo</Text>
                <View style={styles.advGrid}>
                  {([
                    { k: 'today', l: 'Hoy' },
                    { k: 'yesterday', l: 'Ayer' },
                    { k: 'week', l: 'Semana' },
                    { k: 'month', l: 'Mes' },
                  ] as const).map((p) => {
                    const active = expPeriod === p.k;
                    return (
                      <Pressable
                        key={p.k}
                        onPress={() => setExpPeriod(p.k as any)}
                        style={[styles.advChip, active && styles.advChipActive]}
                      >
                        <Text style={[styles.advChipTxt, active && styles.advChipTxtActive]}>
                          {p.l}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {expFormat === 'xlsx' ? (
                  <Text style={styles.advHint}>
                    Nota: XLSX exporta todos los reportes vigentes (el periodo no aplica).
                  </Text>
                ) : (expPeriod === 'today' || expPeriod === 'week' || expPeriod === 'month') && (
                  <Text style={styles.advHint}>
                    {expPeriod === 'today' && 'Informe Diario: solo reportes con jerarquia "Diario".'}
                    {expPeriod === 'week' && 'Informe Semanal: solo reportes con jerarquia "Semanal".'}
                    {expPeriod === 'month' && 'Informe Mensual: solo reportes con jerarquia "Mensual".'}
                  </Text>
                )}
              </View>
              {expFormat !== 'xlsx' && expAreas.length > 0 && (
                <View>
                  <Text style={styles.advLabel}>Area</Text>
                  <View style={styles.advGrid}>
                    <Pressable
                      onPress={() => setExpAreaId(null)}
                      style={[styles.advChip, expAreaId === null && styles.advChipActive]}
                    >
                      <Text style={[styles.advChipTxt, expAreaId === null && styles.advChipTxtActive]}>
                        Todas
                      </Text>
                    </Pressable>
                    {expAreas.map((a) => {
                      const active = expAreaId === a.id;
                      return (
                        <Pressable
                          key={a.id}
                          onPress={() => setExpAreaId(a.id)}
                          style={[styles.advChip, active && styles.advChipActive]}
                        >
                          {!!a.color && (
                            <View
                              style={{
                                width: 8, height: 8, borderRadius: 4,
                                backgroundColor: a.color, marginRight: 6,
                              }}
                            />
                          )}
                          <Text style={[styles.advChipTxt, active && styles.advChipTxtActive]}>
                            {a.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.advHint}>
                    Filtra los reportes por area. Solo se incluyen severidades Importante y Urgente.
                  </Text>
                </View>
              )}
              <Pressable
                onPress={onAdvExport}
                disabled={advExporting}
                style={({ pressed }) => [
                  styles.advExportGo,
                  (advExporting || pressed) && { opacity: 0.85 },
                ]}
              >
                {advExporting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name="download-outline" size={20} color="#fff" />
                )}
                <Text style={styles.advExportGoTxt}>
                  {advExporting ? 'Generando_' : 'Exportar ahora'}
                </Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ============================================================================
// Componente StatCard
// ============================================================================
const StatCard = memo(({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}) => {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
});

const FeedCard = memo(({ r, tone, subtitle, onPreview, onShare, isSharing }: any) => {
  return (
    <Pressable
      onPress={() => onPreview(r)}
      style={({ pressed }) => [
        styles.feedCard,
        pressed && { opacity: 0.88, transform: [{ scale: 0.995 }] },
      ]}
    >
      <View style={styles.thumbWrap}>
        {r.thumbnail_base64 ? (
          <Image
            source={{ uri: r.thumbnail_base64.startsWith('data:image') ? r.thumbnail_base64 : `data:image/jpeg;base64,${r.thumbnail_base64}` }}
            style={styles.thumb}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="image-outline" size={24} color={colors.textMuted} />
          </View>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.feedTopRow}>
          {r.area_name ? (
            <View
              style={[
                styles.areaBadge,
                { backgroundColor: tone.bg, borderColor: tone.border },
              ]}
            >
              <View style={[styles.areaDot, { backgroundColor: tone.text }]} />
              <Text
                style={[styles.areaBadgeTxt, { color: tone.text }]}
                numberOfLines={1}
              >
                {r.area_name}
              </Text>
            </View>
          ) : null}
          <Text style={styles.feedTime}>{fmtTimeCDMX(r.created_at)}</Text>
        </View>
        <Text style={styles.feedCardTitle} numberOfLines={1}>
          {r.title || r.nombre || r.titulo || r.name || r.description || r.descripcion || subtitle || 'Reporte de Obra'}
        </Text>
        <Text style={styles.feedCardSub} numberOfLines={1}>
          {subtitle}
        </Text>
        <Text style={styles.feedMetaTxt} numberOfLines={1}>
          __ {r.captured_by_name || '_'}
        </Text>
        {!!r.actividades && (
          <Text style={styles.feedActividades} numberOfLines={2}>
            {r.actividades}
          </Text>
        )}
        {!!r.avance && (
          <Text style={styles.feedAvance} numberOfLines={2}>
            {r.avance}
          </Text>
        )}
      </View>
      <Pressable
        onPress={() => onShare(r)}
        disabled={isSharing}
        hitSlop={8}
        style={({ pressed }) => [
          styles.waMiniBtn,
          (isSharing || pressed) && { opacity: 0.7 },
        ]}
      >
        {isSharing ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Ionicons name="logo-whatsapp" size={18} color="#fff" />
        )}
      </Pressable>
    </Pressable>
  );
});

const HeroCard = memo(({ user, currentProject, globalPct, scopeNodeName }: any) => {
  return (
    <View style={[styles.heroWrap, { marginTop: spacing.sm }]}>
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <View style={styles.heroIcon}>
            <Ionicons name="briefcase" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>PROYECTO COORDINADO</Text>
            <Text style={styles.heroTitle} numberOfLines={1}>
              {currentProject?.name || 'Sin proyecto'}
            </Text>
          </View>
          <View style={styles.heroLeavesPill}>
            <Ionicons name="speedometer" size={11} color={colors.primary} />
            <Text style={styles.heroLeavesTxt}>{globalPct}%</Text>
          </View>
        </View>
        <Text style={styles.heroPuesto}>
          Hola, {user?.name || 'Sub-coordinador'}
        </Text>
        {scopeNodeName ? (
          <View style={styles.heroScopeRow}>
            <Ionicons name="location" size={12} color={colors.primary} />
            <Text style={styles.heroScopeTxt} numberOfLines={1}>
              Tramo asignado: <Text style={styles.heroScopeName}>{scopeNodeName}</Text>
            </Text>
          </View>
        ) : (
          <View style={styles.heroScopeRow}>
            <Ionicons name="alert-circle" size={12} color={colors.textMuted} />
            <Text style={[styles.heroScopeTxt, { color: colors.textMuted }]} numberOfLines={1}>
              Sin tramo asignado
            </Text>
          </View>
        )}
        {currentProject?.contract_number ? (
          <Text style={styles.heroMeta}>
            Contrato {currentProject.contract_number}
            {currentProject.constructora ? `  _  ${currentProject.constructora}` : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const ActionTile = memo(({ icon, title, subtitle, disabled, comingSoon, onPress, busy, badge }: any) => {
  return (
    <Pressable
      onPress={onPress}
      disabled={!!disabled}
      style={({ pressed }) => [styles.tile, disabled && { opacity: 0.55 }, pressed && !disabled && { transform: [{ scale: 0.99 }] }]}
    >
      <View style={styles.tileIcon}>
        {busy ? <ActivityIndicator color={colors.primary} /> : <Ionicons name={icon} size={20} color={colors.primary} />}
        {!!badge && badge > 0 && (
          <View style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 16, height: 16, borderRadius: 8,
            backgroundColor: '#DC2626',
            alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 3,
            borderWidth: 1.5, borderColor: colors.surface,
          }}>
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
              {badge > 99 ? '99+' : String(badge)}
            </Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.tileTitle}>{title}</Text>
          {comingSoon ? <Text style={styles.soonBadge}>Proximamente</Text> : null}
        </View>
        <Text style={styles.tileSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
});

// ============================================================================
// Styles _ sincronizados con (spec)/index.tsx
// ============================================================================
const styles = StyleSheet.create({
  blueTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.primary,
  },

  // === Chips de tiempo (P4) ==================================================
  timeChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  timeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  timeChipTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textBody,
  },
  timeChipTxtActive: {
    color: '#fff',
  },

  // === Chips de areas (P5) ===================================================
  areaChipsContent: {
    paddingHorizontal: spacing.md,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  areaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    maxWidth: 180,
  },
  areaChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  areaChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  areaChipTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textBody,
  },
  areaChipTxtActive: {
    color: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
  headerSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 1, maxWidth: '80%' },

  // Hero
  heroWrap: { paddingHorizontal: spacing.md },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
    ...shadow.card,
  },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLabel: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.2 },
  heroTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 1 },
  heroPuesto: { fontSize: 13, color: colors.textBody, marginTop: 4, marginLeft: 36 + spacing.sm },
  heroMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2, marginLeft: 36 + spacing.sm },
  heroScopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    marginLeft: 36 + spacing.sm,
  },
  heroScopeTxt: { fontSize: 12, color: colors.textBody },
  heroScopeName: { fontWeight: '800', color: colors.text },
  heroLeavesPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  heroLeavesTxt: { color: colors.primary, fontSize: 10, fontWeight: '800' },

  // Stat row
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    alignItems: 'flex-start',
    gap: 4,
    ...shadow.card,
  },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  // Action Tile (Sprint 2 / Phase 4)
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  tileIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  tileSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  soonBadge: { fontSize: 9, fontWeight: '800', color: colors.primary, backgroundColor: colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Sprint blocks
  sprintBlock: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },

  // Card wrap (alerts)
  cardWrap: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadow.card,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  cardSubtitle: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontWeight: '600' },
  badge: {
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.errorBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTxt: { fontSize: 12, fontWeight: '900', color: colors.error },

  // Chips
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 13, fontWeight: '700', color: colors.textBody },
  chipTxtActive: { color: '#fff' },

  // Export & AI buttons
  exportRow: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  exportMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    borderRadius: radius.lg,
    minHeight: 64,
    ...shadow.card,
  },
  aiMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#7C3AED',
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    borderRadius: radius.lg,
    minHeight: 64,
    ...shadow.card,
  },
  corteCajaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#B45309',
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    borderRadius: radius.lg,
    minHeight: 64,
    ...shadow.card,
  },
  exportMainTitle: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  exportMainSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', marginTop: 2 },

  // Alerts list
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  alertName: { fontSize: 13, fontWeight: '800', color: colors.text },
  alertMiniBar: {
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: 4,
  },
  alertMiniFill: { height: '100%', borderRadius: radius.full },
  alertMeta: { fontSize: 11, color: colors.textMuted, fontWeight: '700', marginTop: 2 },
  alertPct: { fontSize: 14, fontWeight: '900', minWidth: 44, textAlign: 'right' },
  alertMore: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },

  // Feed
  feedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  feedTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  subSearchWrap: {
    marginBottom: spacing.sm,
  },
  subSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subSearchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: Platform.OS === 'android' ? 4 : 0,
  },
  feedCount: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  feedCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    gap: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  thumb: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  feedTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 2,
  },
  feedTime: { fontSize: 10, color: colors.textMuted, fontWeight: '700' },
  areaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    maxWidth: 140,
  },
  areaDot: { width: 6, height: 6, borderRadius: 3 },
  areaBadgeTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  feedCardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  feedCardSub: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  feedMetaTxt: { fontSize: 11, color: colors.textBody, marginTop: 3 },
  feedActividades: { fontSize: 11, color: colors.textBody, marginTop: 4, fontStyle: 'italic' },
  feedAvance: { fontSize: 11, color: colors.textBody, marginTop: 4, fontStyle: 'italic' },
  waMiniBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },

  // States
  centerPad: { padding: spacing.xl, alignItems: 'center' },
  errorBox: {
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorTxt: { textAlign: 'center', color: colors.textBody, fontSize: 13 },
  retryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  retryTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },

  emptyBox: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 6,
    ...shadow.card,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyMsg: { fontSize: 12, color: colors.textBody, textAlign: 'center', lineHeight: 18 },
  emptyInline: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  emptyInlineTxt: { fontSize: 13, color: colors.textMuted, flex: 1, fontWeight: '600' },

  // AI Modal
  aiBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  aiCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.lg,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiTitle: { fontSize: 17, fontWeight: '900', color: colors.text },
  aiClose: { padding: 4 },
  aiMeta: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },
  aiBody: { fontSize: 14, color: colors.text, lineHeight: 21, fontWeight: '500' },
  aiError: { fontSize: 13, color: '#dc2626', fontWeight: '700' },
  aiLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: spacing.md },
  aiLoadingTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '700' },
  aiActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  aiSecBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  aiSecTxt: { fontSize: 13, fontWeight: '800', color: colors.text },
  aiPrimBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  aiPrimTxt: { fontSize: 13, fontWeight: '800', color: '#fff' },
  waBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: '#25D366',
    marginTop: spacing.sm,
  },
  waTxt: { fontSize: 14, fontWeight: '800', color: '#fff' },
  // ===== Exportacion Avanzada Modal =====
  advCard: {
    width: '92%',
    maxWidth: 460,
    maxHeight: '85%',
    backgroundColor: '#fff',
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.md,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  previewTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  advLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  advGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  advChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    minWidth: 76,
    alignItems: 'center',
  },
  advChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  advChipTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  advChipTxtActive: {
    color: '#fff',
  },
  advHint: {
    marginTop: 8,
    fontSize: 11,
    color: '#64748b',
    fontStyle: 'italic',
  },
  advExportGo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  advExportGoTxt: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.3,
  },
});
