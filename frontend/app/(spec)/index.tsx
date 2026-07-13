// SynCo v2.0 — Tab "Inicio" / Feed del Especialista.
// Cumple con la descripción exacta solicitada por el usuario:
//   • Fondo azul corporativo en la mitad superior.
//   • Hero Card "MI ÁREA ASIGNADA" en blanco con datos del especialista.
//   • Tres Stat Cards blancas (Total · Míos · De compañeros).
//   • Chips horizontales de filtro temporal (Hoy / Semana / Mes / Todo).
//   • Lista vertical de actividad con thumbnail a la izquierda, badge de
//     área coloreado, título en negritas y meta debajo.
//   • Pull-to-refresh y estados vacíos amigables.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import { colors, radius, shadow, spacing, areaTone } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { api, FeedItem, FeedResponse, Project } from '@/src/api';
import { storage } from '@/src/utils/storage';
import { shareWithAutoRecover } from '@/src/utils/share';
import { ReportPeriod } from '@/src/components/PeriodSheet';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { DailyGoalsPanel } from '@/src/components/DailyGoalsPanel';
import { NodeProgressPanel } from '@/src/components/NodeProgressPanel';
import { ReportPreviewSheet } from '@/src/components/ReportPreviewSheet';
import { HistoryCalendarModal } from '@/src/components/HistoryCalendarModal';

// === Configuración del flujo de exportación en 3 pasos ============================
type ExportFormat = 'pdf' | 'docx' | 'pptx';
type ExportStep = 'period' | 'scope' | 'format';
type ExportScope = 'mine' | 'area';

const PERIOD_OPTIONS: { value: ReportPeriod; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'today',     label: 'Hoy',         sub: 'Reportes capturados hoy',  icon: 'today-outline' },
  { value: 'yesterday', label: 'Ayer',        sub: 'Reportes del día anterior', icon: 'calendar-clear-outline' },
  { value: 'week',      label: 'Esta semana', sub: 'Últimos 7 días',            icon: 'calendar-outline' },
  { value: 'month',     label: 'Este mes',    sub: 'Últimos 30 días',           icon: 'calendar-number-outline' },
];

const FORMAT_OPTIONS: { value: ExportFormat; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; tint: string }[] = [
  { value: 'pdf',  label: 'PDF',        sub: 'Documento horizontal listo para imprimir', icon: 'document-text', tint: '#DC2626' },
  { value: 'docx', label: 'Word',       sub: 'Editable en Microsoft Word',                icon: 'document',      tint: '#1D4ED8' },
  { value: 'pptx', label: 'PowerPoint', sub: 'Presentación institucional 16:9',            icon: 'easel',         tint: '#B45309' },
];

type RangeKey = 'today' | 'week' | 'month' | 'all';

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'week', label: 'Esta semana' },
  { key: 'month', label: 'Este mes' },
  { key: 'all', label: 'Todos' },
];

export default function SpecFeedScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const projectId = (user?.project_ids || [])[0] || '';

  const [project, setProject] = useState<Project | null>(null);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [range, setRange] = useState<RangeKey>('today');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportStep, setExportStep] = useState<ExportStep>('period');
  const [exportPeriod, setExportPeriod] = useState<ReportPeriod>('today');
  const [exportScope, setExportScope] = useState<ExportScope>('mine');
  const [exportBusy, setExportBusy] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sharingReportId, setSharingReportId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<FeedItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // === Compartir reporte individual en WhatsApp =============================
  // Estrategia nativa (sin expo-print) con fallback a Collage 2x2:
  //   • 0 fotos  → comparte sólo .txt con la descripción del reporte.
  //   • 1 foto   → descarga la foto y la comparte como image/jpeg (+ caption copiada al portapapeles).
  //   • 2-4 fotos → descarga el collage 2x2 generado por el backend (/api/reports/{id}/collage.jpg)
  //                  y lo comparte como una sola imagen (caption en portapapeles).
  //   • 5+ fotos → mismo collage 2x2 con las primeras 4; el caption aclara cuántas más existen.
  // -------------------------------------------------------------------------
  const shareReportWhatsApp = useCallback(async (item: FeedItem) => {
    if (sharingReportId) return;
    try {
      setSharingReportId(item.id);
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('No disponible', 'Compartir no está disponible en este dispositivo.');
        return;
      }
      const path = (item.node_path_names || []).join(' › ') || '—';
      const ts = item.created_at ? new Date(item.created_at).toLocaleString('es-MX') : '';

      // 1) Resolvemos cuántas fotos tiene el reporte realmente.
      let totalFotos = item.images_count || (item.thumbnail_base64 ? 1 : 0);
      let firstPhotoB64: string | null = item.thumbnail_base64 || null;
      try {
        const full = await api.getReport(item.id);
        if (full && Array.isArray(full.images)) {
          totalFotos = full.images.length;
          if (!firstPhotoB64 && full.images[0]) firstPhotoB64 = full.images[0];
        }
      } catch { /* sin red — usamos lo que tengamos */ }

      // 2) Construimos el caption.
      const captionLines = [
        '📋 *Reporte de obra — SynCo*',
        '',
        `📍 *Ubicación:* ${path}`,
        `👤 *Capturado por:* ${item.captured_by_name || '—'}`,
        ts ? `🕒 *Fecha:* ${ts}` : '',
        item.area_name ? `🏷️ *Área:* ${item.area_name}` : '',
        totalFotos > 4
          ? `🖼️ *Fotografías:* ${totalFotos} (collage muestra las primeras 4)`
          : (totalFotos > 1 ? `🖼️ *Fotografías:* ${totalFotos} (collage 2x2)` : ''),
        item.avance ? `\n📝 *Avance:*\n${item.avance}` : '',
      ].filter(Boolean);
      const caption = captionLines.join('\n');

      // 3) CASO 0 fotos → texto plano.
      if (totalFotos <= 0) {
        const txtUri = `${FileSystem.cacheDirectory}reporte_${item.id}.txt`;
        await FileSystem.writeAsStringAsync(txtUri, caption, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        await shareWithAutoRecover(txtUri, {
          mimeType: 'text/plain',
          dialogTitle: 'Compartir reporte',
          UTI: 'public.plain-text',
        });
        return;
      }

      // 4) CASO 1 foto → la compartimos directo.
      if (totalFotos === 1 && firstPhotoB64) {
        const oneUri = `${FileSystem.cacheDirectory}reporte_${item.id}.jpg`;
        const raw = firstPhotoB64.startsWith('data:')
          ? firstPhotoB64.split(',', 2)[1] || firstPhotoB64
          : firstPhotoB64;
        await FileSystem.writeAsStringAsync(oneUri, raw, {
          encoding: FileSystem.EncodingType.Base64,
        });
        try { await Clipboard.setStringAsync(caption); } catch {}
        await shareWithAutoRecover(oneUri, {
          mimeType: 'image/jpeg',
          dialogTitle: 'Compartir reporte',
          UTI: 'public.jpeg',
        });
        return;
      }

      // 5) CASO 2+ fotos → descargamos el collage 2x2 del backend.
      const collageUrl = `https://apm-app.mx/api/reports/${item.id}/collage.jpg`;
      const tok = await storage.secureGet<string>('syncsite_token', '');
      const collageUri = `${FileSystem.cacheDirectory}SynCo_collage_${item.id.slice(0, 8)}.jpg`;
      const dl = await FileSystem.downloadAsync(collageUrl, collageUri, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (dl.status !== 200) {
        // Fallback final: si el collage falla, compartimos la primera foto disponible.
        if (firstPhotoB64) {
          const oneUri = `${FileSystem.cacheDirectory}reporte_${item.id}.jpg`;
          const raw = firstPhotoB64.startsWith('data:')
            ? firstPhotoB64.split(',', 2)[1] || firstPhotoB64
            : firstPhotoB64;
          await FileSystem.writeAsStringAsync(oneUri, raw, {
            encoding: FileSystem.EncodingType.Base64,
          });
          try { await Clipboard.setStringAsync(caption); } catch {}
          await shareWithAutoRecover(oneUri, {
            mimeType: 'image/jpeg',
            dialogTitle: 'Compartir reporte',
            UTI: 'public.jpeg',
          });
          return;
        }
        throw new Error('No se pudo generar el collage.');
      }
      try { await Clipboard.setStringAsync(caption); } catch {}
      await shareWithAutoRecover(dl.uri, {
        mimeType: 'image/jpeg',
        dialogTitle: 'Compartir reporte',
        UTI: 'public.jpeg',
      });
    } catch (e: any) {
      Alert.alert('No se pudo compartir', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSharingReportId(null);
    }
  }, [sharingReportId]);

  const load = useCallback(async (nextRange: RangeKey = range, silent = false, q = debouncedQuery) => {
    if (!projectId) {
      setLoading(false);
      setError('Tu cuenta no está asociada a ningún proyecto. Pide a tu Coordinador General una invitación.');
      return;
    }
    try {
      setError(null);
      if (!silent) setLoading(true);
      const [proj, f] = await Promise.all([
        project ? Promise.resolve(project) : api.getProject(projectId),
        api.feed(projectId, nextRange, 100, q || undefined),
      ]);
      setProject(proj);
      setFeed(f);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el feed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, range, debouncedQuery]);

  useEffect(() => { load(range, false, ''); /* initial */ }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce del input de búsqueda (350ms) — evita spam de requests.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Cuando cambia el query debounced, recargamos el feed silenciosamente.
  useEffect(() => {
    if (!projectId) return;
    load(range, true, debouncedQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  function onPickRange(r: RangeKey) {
    setRange(r);
    load(r, true, debouncedQuery);
  }

  async function onLogout() {
    const ok = await confirm('Cerrar sesión', '¿Seguro que quieres salir?', { confirmText: 'Salir', destructive: true });
    if (!ok) return;
    await logout();
    router.replace('/(auth)/login');
  }

  // === Flujo de exportación en 3 pasos =========================================
  function openExportFlow() {
    setExportStep('period');
    setExportPeriod('today');
    setExportScope('mine');
    setExportOpen(true);
  }

  function closeExportFlow() {
    if (exportBusy) return;
    setExportOpen(false);
    // Pequeño delay para evitar parpadeo si reabre
    setTimeout(() => setExportStep('period'), 200);
  }

  function onPickPeriod(p: ReportPeriod) {
    setExportPeriod(p);
    setExportStep('scope');
  }

  function onPickScope(s: ExportScope) {
    setExportScope(s);
    setExportStep('format');
  }

  async function onPickFormat(fmt: ExportFormat) {
    if (!projectId) return;
    try {
      setExportBusy(true);
      const opts = { scope: exportScope } as { scope: ExportScope };
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
      Alert.alert(
        `No se pudo generar el ${fmt.toUpperCase()}`,
        e?.message || 'Inténtalo nuevamente.',
      );
    } finally {
      setExportBusy(false);
    }
  }

  const stats = feed?.stats || { total: 0, mine: 0, others: 0 };
  const reports = useMemo(() => feed?.reports || [], [feed]);
  const filteredReports = useMemo(() => {
    if (!selectedDate) return reports;
    return reports.filter((r) => (r.created_at || '').slice(0, 10) === selectedDate);
  }, [reports, selectedDate]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      {/* Fondo azul que cubre la zona superior */}
      <View style={[styles.blueTop, { height: 240 + insets.top }]} />

      {/* Header transparente sobre el azul */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable hitSlop={10} style={styles.headerBtn} onPress={onLogout}>
          <Ionicons name="menu" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle}>SynCo</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {project?.name || 'Cargando proyecto…'}
          </Text>
        </View>
        <Pressable hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="notifications-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(range, true); }}
            tintColor="#fff"
            colors={[colors.primary]}
          />
        }
      >
        {/* Hero Card: MI ÁREA ASIGNADA */}
        <View style={[styles.heroWrap, { marginTop: spacing.sm }]}>
          <View style={styles.heroCard}>
            <View style={styles.heroHeaderRow}>
              <View style={styles.heroIcon}>
                <Ionicons name="location" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroLabel}>MI ÁREA ASIGNADA</Text>
                <Text style={styles.heroTitle} numberOfLines={1}>
                  {user?.area || 'Sin área asignada'}
                </Text>
              </View>
              <View style={styles.heroLeavesPill}>
                <Ionicons name="flag" size={11} color={colors.primary} />
                <Text style={styles.heroLeavesTxt}>
                  {(user?.scope_node_ids || []).length} hojas
                </Text>
              </View>
            </View>
            {user?.puesto ? (
              <Text style={styles.heroPuesto}>{user.puesto}</Text>
            ) : null}
            {project?.contract_number ? (
              <Text style={styles.heroMeta}>
                Contrato {project.contract_number}
                {project.constructora ? `  ·  ${project.constructora}` : ''}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Stat Cards */}
        <View style={styles.statsRow}>
          <StatCard
            label="Total"
            value={stats.total}
            icon="albums-outline"
            tint={colors.primary}
          />
          <StatCard
            label="Míos"
            value={stats.mine}
            icon="person"
            tint="#0EA5E9"
          />
          <StatCard
            label="Compañeros"
            value={stats.others}
            icon="people-outline"
            tint="#10B981"
          />
        </View>

        {/* Sprint 2 — Metas diarias (solo lectura para especialistas) */}
        {projectId ? (
          <View style={styles.sprintBlock}>
            <DailyGoalsPanel projectId={projectId} />
          </View>
        ) : null}

        {/* Sprint 2 — Avance por nodo (gráficas circulares) */}
        {projectId ? (
          <View style={styles.sprintBlock}>
            <NodeProgressPanel projectId={projectId} reports={reports} />
          </View>
        ) : null}

        {/* Botón único de exportación (abre modal de 2 pasos: Período → Formato) */}
        <View style={styles.exportRow}>
          <Pressable
            onPress={openExportFlow}
            disabled={exportBusy || !projectId}
            style={({ pressed }) => [
              styles.exportMainBtn,
              (exportBusy || !projectId) && styles.pdfBtnDisabled,
              pressed && !exportBusy && { opacity: 0.92 },
            ]}
          >
            {exportBusy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="download-outline" size={22} color="#fff" />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.exportMainTitle}>Exportar Reportes</Text>
              <Text style={styles.exportMainSub}>
                {exportBusy ? 'Generando archivo…' : 'PDF · Word · PowerPoint'}
              </Text>
            </View>
            {!exportBusy && (
              <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
            )}
          </Pressable>
        </View>

        {/* Filtros temporales */}
        <View style={styles.timeFiltersWrap}>
          <Text style={styles.sectionLabel}>Filtrar actividad</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}
          >
            {RANGE_OPTIONS.map((opt) => {
              const active = range === opt.key && !selectedDate;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => { setSelectedDate(null); onPickRange(opt.key); }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setCalendarOpen(true)}
              style={[styles.chip, !!selectedDate && styles.chipActive]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons
                  name="calendar-outline"
                  size={14}
                  color={selectedDate ? '#fff' : colors.textBody}
                />
                <Text style={[styles.chipTxt, !!selectedDate && styles.chipTxtActive]}>
                  {selectedDate ? selectedDate : 'Calendario'}
                </Text>
                {selectedDate ? (
                  <Pressable hitSlop={8} onPress={() => setSelectedDate(null)}>
                    <Ionicons name="close-circle" size={14} color="#fff" />
                  </Pressable>
                ) : null}
              </View>
            </Pressable>
          </ScrollView>
        </View>

        {/* Barra de búsqueda por nombre de reporte / actividades / etc. */}
        <View style={styles.searchWrap}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Buscar reporte por nombre, ubicación o texto…"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchQuery ? (
              <Pressable hitSlop={8} onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Lista de actividad */}
        <View style={styles.feedHeaderRow}>
          <Text style={styles.feedTitle}>
            {debouncedQuery ? 'Resultados' : 'Actividad reciente'}
          </Text>
          {feed && reports.length > 0 ? (
            <Text style={styles.feedCount}>{reports.length}</Text>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.centerPad}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.error} />
            <Text style={styles.errorTxt}>{error}</Text>
            <Pressable onPress={() => load(range, false)} style={styles.retryBtn}>
              <Text style={styles.retryTxt}>Reintentar</Text>
            </Pressable>
          </View>
        ) : filteredReports.length === 0 ? (
          selectedDate ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIcon}>
                <Ionicons name="calendar-outline" size={28} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>Sin reportes el {selectedDate}</Text>
              <Text style={styles.emptyMsg}>
                Prueba otra fecha o vuelve a los filtros generales.
              </Text>
              <Pressable style={styles.emptyBtn} onPress={() => setSelectedDate(null)}>
                <Ionicons name="refresh" size={18} color="#fff" />
                <Text style={styles.emptyBtnTxt}>Limpiar fecha</Text>
              </Pressable>
            </View>
          ) : debouncedQuery ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIcon}>
                <Ionicons name="search-outline" size={28} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>Sin resultados</Text>
              <Text style={styles.emptyMsg}>
                No encontramos reportes que coincidan con “{debouncedQuery}”. Prueba con otras palabras.
              </Text>
              <Pressable style={styles.emptyBtn} onPress={() => setSearchQuery('')}>
                <Ionicons name="close" size={18} color="#fff" />
                <Text style={styles.emptyBtnTxt}>Limpiar búsqueda</Text>
              </Pressable>
            </View>
          ) : (
            <EmptyFeed range={range} onNew={() => router.push('/(spec)/nuevo' as any)} />
          )
        ) : (
          <FlatList
            data={filteredReports}
            keyExtractor={(it) => it.id}
            scrollEnabled={false}
            contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.md }}
            renderItem={({ item }) => (
              <FeedCard
                item={item}
                onShare={shareReportWhatsApp}
                sharing={sharingReportId === item.id}
                onPreview={() => setPreviewItem(item)}
              />
            )}
          />
        )}
      </ScrollView>

      {/* Sprint 2 — Modal Calendario Histórico */}
      <HistoryCalendarModal
        visible={calendarOpen}
        reports={reports}
        onClose={() => setCalendarOpen(false)}
        selectedDate={selectedDate}
        onPickDate={(d) => {
          setSelectedDate(d);
          setCalendarOpen(false);
        }}
      />

      {/* Modal de exportación en 2 pasos: Período → Formato */}
      <Modal
        visible={exportOpen}
        animationType="slide"
        transparent
        onRequestClose={closeExportFlow}
      >
        <Pressable style={styles.exportBackdrop} onPress={closeExportFlow} />
        <View style={styles.exportSheet} pointerEvents="box-none">
          <View style={styles.exportSheetInner}>
            <View style={styles.exportHandle} />

            {/* Header con título y paso actual */}
            <View style={styles.exportHeader}>
              {exportStep === 'period' ? (
                <View style={styles.exportBack} />
              ) : (
                <Pressable
                  onPress={() => {
                    if (exportBusy) return;
                    if (exportStep === 'format') setExportStep('scope');
                    else if (exportStep === 'scope') setExportStep('period');
                  }}
                  hitSlop={10}
                  style={styles.exportBack}
                >
                  <Ionicons name="chevron-back" size={22} color={colors.text} />
                </Pressable>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.exportTitle}>
                  {exportStep === 'period'
                    ? 'Exportar Reportes'
                    : exportStep === 'scope'
                    ? 'Alcance del reporte'
                    : 'Elegir formato'}
                </Text>
                <Text style={styles.exportSubtitle}>
                  {exportStep === 'period'
                    ? 'Paso 1 de 3 · Selecciona el período'
                    : exportStep === 'scope'
                    ? `Paso 2 de 3 · ${PERIOD_OPTIONS.find((p) => p.value === exportPeriod)?.label ?? ''}`
                    : `Paso 3 de 3 · ${exportScope === 'mine' ? 'Sólo mis reportes' : 'Mi área'}`}
                </Text>
              </View>
              <Pressable
                onPress={closeExportFlow}
                disabled={exportBusy}
                hitSlop={10}
                style={styles.exportBack}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            {/* Indicador de progreso (3 pasos) */}
            <View style={styles.exportSteps}>
              <View style={[styles.exportStepDot, styles.exportStepDotActive]} />
              <View style={[styles.exportStepBar, (exportStep === 'scope' || exportStep === 'format') && styles.exportStepBarActive]} />
              <View
                style={[
                  styles.exportStepDot,
                  (exportStep === 'scope' || exportStep === 'format') && styles.exportStepDotActive,
                ]}
              />
              <View style={[styles.exportStepBar, exportStep === 'format' && styles.exportStepBarActive]} />
              <View
                style={[
                  styles.exportStepDot,
                  exportStep === 'format' && styles.exportStepDotActive,
                ]}
              />
            </View>

            {exportStep === 'period' ? (
              <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                {PERIOD_OPTIONS.map((opt) => {
                  const active = exportPeriod === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => onPickPeriod(opt.value)}
                      style={({ pressed }) => [
                        styles.exportItem,
                        active && styles.exportItemActive,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <View style={[styles.exportItemIcon, { backgroundColor: '#EEF2FF' }]}>
                        <Ionicons name={opt.icon} size={20} color="#1E3A8A" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.exportItemTitle}>{opt.label}</Text>
                        <Text style={styles.exportItemSub}>{opt.sub}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    </Pressable>
                  );
                })}
              </View>
            ) : exportStep === 'scope' ? (
              <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                <Pressable
                  onPress={() => onPickScope('mine')}
                  style={({ pressed }) => [
                    styles.exportItem,
                    exportScope === 'mine' && styles.exportItemActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={[styles.exportItemIcon, { backgroundColor: '#EEF2FF' }]}>
                    <Ionicons name="person-outline" size={20} color="#1E3A8A" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exportItemTitle}>Mis reportes</Text>
                    <Text style={styles.exportItemSub}>
                      Sólo los reportes capturados por mí (excluye severidad Informativo).
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </Pressable>
                <Pressable
                  onPress={() => onPickScope('area')}
                  style={({ pressed }) => [
                    styles.exportItem,
                    exportScope === 'area' && styles.exportItemActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={[styles.exportItemIcon, { backgroundColor: '#FEF3C7' }]}>
                    <Ionicons name="grid-outline" size={20} color="#B45309" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exportItemTitle}>Mi área</Text>
                    <Text style={styles.exportItemSub}>
                      Reportes de todos los especialistas de mi misma área.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : (
              <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                {FORMAT_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => onPickFormat(opt.value)}
                    disabled={exportBusy}
                    style={({ pressed }) => [
                      styles.exportItem,
                      exportBusy && { opacity: 0.6 },
                      pressed && !exportBusy && { opacity: 0.85 },
                    ]}
                  >
                    <View style={[styles.exportItemIcon, { backgroundColor: `${opt.tint}1A` }]}>
                      <Ionicons name={opt.icon} size={20} color={opt.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.exportItemTitle}>{opt.label}</Text>
                      <Text style={styles.exportItemSub}>{opt.sub}</Text>
                    </View>
                    {exportBusy ? (
                      <ActivityIndicator color={opt.tint} />
                    ) : (
                      <Ionicons name="download-outline" size={20} color={colors.textMuted} />
                    )}
                  </Pressable>
                ))}
                {exportBusy ? (
                  <Text style={styles.exportBusyHint}>
                    Generando archivo en el servidor… esto puede tardar unos segundos.
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Preview del reporte (componente compartido) */}
      <ReportPreviewSheet
        visible={!!previewItem}
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onShare={shareReportWhatsApp}
        sharing={!!previewItem && sharingReportId === previewItem.id}
      />
    </View>
  );
}

// ============================================================================
// Componentes auxiliares
// ============================================================================
function StatCard({ label, value, icon, tint }: {
  label: string; value: number; icon: keyof typeof Ionicons.glyphMap; tint: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function FeedCard({
  item,
  onShare,
  sharing,
  onPreview,
}: {
  item: FeedItem;
  onShare?: (item: FeedItem) => void;
  sharing?: boolean;
  onPreview?: () => void;
}) {
  const tone = areaTone(item.area_color || undefined);
  const path = item.node_path_names || [];
  const leafName = path[path.length - 1] || 'Sin ubicación';
  const parentName = path.length >= 2 ? path[path.length - 2] : '';
  const subtitle = parentName ? `${parentName} · ${leafName}` : leafName;
  const ago = timeAgo(item.created_at);
  const measure = formatMeasurement(item.measurement_type, item.measurement_value);

  return (
    <Pressable
      style={({ pressed }) => [styles.feedCard, pressed && { opacity: 0.85 }]}
      onPress={() => onPreview?.()}
    >
      {/* Thumbnail */}
      <View style={styles.thumbWrap}>
        {item.thumbnail_base64 ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${item.thumbnail_base64}` }}
            style={styles.thumb}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="image-outline" size={26} color={colors.textMuted} />
          </View>
        )}
        {item.images_count > 1 ? (
          <View style={styles.thumbBadge}>
            <Ionicons name="copy" size={9} color="#fff" />
            <Text style={styles.thumbBadgeTxt}>{item.images_count}</Text>
          </View>
        ) : null}
      </View>

      {/* Contenido */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.feedTopRow}>
          {item.area_name ? (
            <View style={[styles.areaBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
              <View style={[styles.areaDot, { backgroundColor: tone.text }]} />
              <Text style={[styles.areaBadgeTxt, { color: tone.text }]} numberOfLines={1}>
                {item.area_name}
              </Text>
            </View>
          ) : (
            <View style={[styles.areaBadge, styles.areaBadgeNeutral]}>
              <Text style={styles.areaBadgeTxtNeutral}>Sin área</Text>
            </View>
          )}
          {item.is_mine ? (
            <View style={styles.minePill}>
              <Text style={styles.minePillTxt}>Mío</Text>
            </View>
          ) : null}
        </View>
        {/* Nombre del reporte (fallback: fecha corta). Se muestra ARRIBA del
            leaf/ubicación para que el usuario identifique rápido el reporte. */}
        <Text style={styles.feedCardTitle} numberOfLines={1}>
          {(item.title && item.title.trim()) || `Reporte del ${shortDate(item.created_at)}`}
        </Text>
        <Text style={styles.feedCardSub} numberOfLines={1}>{subtitle}</Text>
        <View style={styles.feedMetaRow}>
          <Ionicons name="time-outline" size={12} color={colors.textMuted} />
          <Text style={styles.feedMeta} numberOfLines={1}>{ago}</Text>
          <Text style={styles.feedMetaDot}>·</Text>
          <Ionicons name="person-outline" size={12} color={colors.textMuted} />
          <Text style={styles.feedMeta} numberOfLines={1}>
            {item.captured_by_name || '—'}
          </Text>
        </View>
        {measure ? (
          <View style={styles.measureRow}>
            <Ionicons name="speedometer-outline" size={12} color={colors.primary} />
            <Text style={styles.measureTxt} numberOfLines={1}>{measure}</Text>
          </View>
        ) : null}
        {item.avance ? (
          <Text style={styles.avanceTxt} numberOfLines={2}>{item.avance}</Text>
        ) : null}
      </View>

      <View style={{ alignItems: 'center', gap: 8, justifyContent: 'center' }}>
        {onShare ? (
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation?.(); onShare(item); }}
            disabled={!!sharing}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: '#25D366',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: sharing ? 0.6 : 1,
            }}
            accessibilityLabel="Compartir por WhatsApp"
            hitSlop={8}
          >
            {sharing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="logo-whatsapp" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

function EmptyFeed({ range, onNew }: { range: RangeKey; onNew: () => void }) {
  const lbl = RANGE_OPTIONS.find((r) => r.key === range)?.label.toLowerCase() || '';
  return (
    <View style={styles.emptyBox}>
      <View style={styles.emptyIcon}>
        <Ionicons name="reader-outline" size={28} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>Sin reportes en {lbl}</Text>
      <Text style={styles.emptyMsg}>
        Cuando tú o tus compañeros capturen actividad, aparecerá aquí.
      </Text>
      <Pressable style={styles.emptyBtn} onPress={onNew}>
        <Ionicons name="add" size={18} color="#fff" />
        <Text style={styles.emptyBtnTxt}>Crear nuevo reporte</Text>
      </Pressable>
    </View>
  );
}

// ============================================================================
// Helpers
// ============================================================================
function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Hace instantes';
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `Hace ${d} d`;
  const date = new Date(iso);
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

// Fecha corta usada como fallback cuando el reporte no tiene título.
function shortDate(iso?: string | null): string {
  if (!iso) return 'sin fecha';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'sin fecha';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatMeasurement(type?: string | null, v?: Record<string, any> | null): string {
  if (!type || !v) return '';
  if (type === 'coord_latlon') {
    if (typeof v.lat === 'number' && typeof v.lon === 'number') {
      return `${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}`;
    }
  }
  if (type === 'cadenamiento' && v.cadenamiento) return `Cad. ${v.cadenamiento}`;
  if (type === 'eje' && v.eje) return `Eje ${v.eje}`;
  if (type === 'nivel' && typeof v.nivel === 'number') return `Nivel ${v.nivel} m`;
  return '';
}

// ============================================================================
// Styles
// ============================================================================
const styles = StyleSheet.create({
  blueTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    backgroundColor: colors.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
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
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  heroLabel: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.2 },
  heroTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 1 },
  heroPuesto: { fontSize: 13, color: colors.textBody, marginTop: 4, marginLeft: 36 + spacing.sm },
  heroMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2, marginLeft: 36 + spacing.sm },
  heroLeavesPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8, paddingVertical: 4,
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
    width: 28, height: 28, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },

  // Sprint 2 — bloques de metas/avance
  sprintBlock: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },

  // PDF Button
  pdfBtnWrap: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  pdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    minHeight: 48,
    ...shadow.card,
  },
  pdfBtnDisabled: { opacity: 0.55 },
  pdfBtnTxt: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // Time filters
  timeFiltersWrap: { marginTop: spacing.md },
  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: colors.textMuted,
    letterSpacing: 1, textTransform: 'uppercase',
    paddingHorizontal: spacing.md, marginBottom: 8,
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
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipTxt: { fontSize: 13, fontWeight: '700', color: colors.textBody },
  chipTxtActive: { color: '#fff' },

  // Search bar
  searchWrap: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 6,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: Platform.OS === 'android' ? 4 : 0,
  },

  // Feed header
  feedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  feedTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  feedCount: {
    fontSize: 11, fontWeight: '800', color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full,
  },

  // Feed card
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
    width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  thumb: { width: '100%', height: '100%' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  thumbBadge: {
    position: 'absolute', bottom: 4, right: 4,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(15,23,42,0.7)',
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: radius.full,
  },
  thumbBadgeTxt: { color: '#fff', fontSize: 9, fontWeight: '800' },

  feedTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  areaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    maxWidth: 160,
  },
  areaBadgeNeutral: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
  },
  areaDot: { width: 6, height: 6, borderRadius: 3 },
  areaBadgeTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  areaBadgeTxtNeutral: { fontSize: 10, fontWeight: '800', color: colors.textMuted },
  minePill: {
    backgroundColor: colors.success + '22',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full,
  },
  minePillTxt: { color: colors.success, fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },

  feedCardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  feedCardSub: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  feedMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 4,
  },
  feedMeta: { fontSize: 11, color: colors.textMuted },
  feedMetaDot: { color: colors.textMuted, fontSize: 11, marginHorizontal: 2 },
  measureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
  },
  measureTxt: { fontSize: 11, fontWeight: '700', color: colors.primary },
  avanceTxt: { fontSize: 11, color: colors.textBody, marginTop: 4, fontStyle: 'italic' },

  // States
  centerPad: { padding: spacing.xl, alignItems: 'center' },
  errorBox: { padding: spacing.lg, alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  errorTxt: { textAlign: 'center', color: colors.textBody, fontSize: 13 },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md },
  retryTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },

  emptyBox: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 6,
    ...shadow.card,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyMsg: { fontSize: 12, color: colors.textBody, textAlign: 'center', lineHeight: 18 },
  emptyBtn: {
    marginTop: spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radius.md,
  },
  emptyBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },

  // === Botón único de exportación + Modal de 2 pasos =========================
  exportRow: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
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
  exportMainTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  exportMainSub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },

  exportBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  exportSheet: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  exportSheetInner: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: 10,
    paddingBottom: 24,
    ...shadow.card,
  },
  exportHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  exportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: 4,
    gap: 6,
  },
  exportBack: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.full,
  },
  exportTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  exportSubtitle: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginTop: 2 },

  exportSteps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: spacing.sm,
  },
  exportStepDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.border,
  },
  exportStepDotActive: { backgroundColor: colors.primary },
  exportStepBar: {
    width: 48, height: 3, borderRadius: 2,
    backgroundColor: colors.border,
  },
  exportStepBarActive: { backgroundColor: colors.primary },

  exportItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginTop: spacing.sm,
    minHeight: 64,
  },
  exportItemActive: {
    borderColor: colors.primary,
    backgroundColor: '#EEF2FF',
  },
  exportItemIcon: {
    width: 40, height: 40, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  exportItemTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  exportItemSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  exportBusyHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    fontStyle: 'italic',
  },

  // === Modal Preview Reporte (P3) ============================================
  previewSheet: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  previewInner: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: '90%',
    ...shadow.card,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: 8,
    backgroundColor: '#FFFFFF',
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  previewSubtitle: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
    fontWeight: '600',
  },
  previewImage: {
    width: '100%',
    height: 250,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    marginBottom: spacing.md,
    resizeMode: 'cover',
  },
  previewMetaBlock: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  previewMetaLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  previewMetaValue: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
  },
  previewAvance: {
    fontSize: 14,
    color: '#0F172A',
    lineHeight: 20,
  },
  previewShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25D366',
    paddingVertical: 14,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  previewShareTxt: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});

// Suprime ESLint warning para web platform-specific styles si los hubiese.
void Platform;
