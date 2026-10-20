import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList, ActivityIndicator, Pressable, Alert, Platform,
  Linking, Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError, CustomModule, Project, ReferenceFile, FeedItem, LocationNode } from '@/src/api';
import { ZONAS_HORARIAS_MX } from '@/src/utils/zonasHorarias';
import { COLOR_IDENTIDAD_DEFECTO, COLOR_TEXTO_REPORTE_DEFECTO, colors, radius, shadow, spacing } from '@/src/theme';
import { ColorInput } from '@/src/components/ColorInput';
import { InlineError } from '@/src/components/InlineError';
import { errorDeColor, normalizarColorHex } from '@/src/utils/color';
import { esErrorDeRed } from '@/src/utils/errores';
import { showToast } from '@/src/utils/toast';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { ReportPeriod, periodToInformeType } from '@/src/components/PeriodSheet';
import { RangoFechasPicker } from '@/src/components/RangoFechasPicker';
import { codificarPeriodoPersonalizado, decodificarPeriodoPersonalizado, etiquetaPeriodoPersonalizado } from '@/src/utils/rangoFechas';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { DailyGoalsPanel } from '@/src/components/DailyGoalsPanel';
import { WeatherWidget } from '@/src/components/WeatherWidget';
import { HistoryCalendarModal } from '@/src/components/HistoryCalendarModal';
import { ReportPreviewSheet } from '@/src/components/ReportPreviewSheet';
import { GravedadDot, GravedadFiltro, filtrarPorGravedad, type GravedadFiltroValor } from '@/src/components/GravedadDot';
import { fmtDateTimeCDMX } from '@/src/utils/tz';
import {
  agruparModulosPorArea, asignacionesConPersonalizados, modulosActivos, modulosPersonalizadosDef, ModuloDef, SIN_AREA_ID,
} from '@/src/utils/modulos';
import { DatosContratoModal } from '@/src/components/DatosContratoModal';
import { moduloActivo } from '@/src/utils/modulos';
import { getMediaLibraryPermission, requestMediaLibraryPermission } from '@/src/utils/permissions';
import { t, a11y } from '@/src/i18n';
import { olvidarSeparadorDecimal } from '@/src/hooks/useSeparadorDecimal';
import { ProgramaObraSection } from '@/src/components/ProgramaObraSection';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useModalUnico } from '@/src/hooks/useModalUnico';
import { usePestanaProyecto } from '@/src/hooks/usePestanaProyecto';
import { SinReportesAviso } from '@/src/components/SinReportesAviso';
import { ReportesVacio } from '@/src/components/ReportesVacio';
import { verificarConteoExportacion } from '@/src/utils/conteoExportacion';
import { validarNombreNivel, validarUnidadPersonalizada } from '@/src/utils/unidades';
import { validarTurnoNocturno } from '@/src/utils/turnoNocturno';
import { unir } from '@/src/utils/texto';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD } from '@/src/utils/roles';
import { ResumenProyecto } from '@/src/components/ResumenProyecto';
import { SelectorGeneroNivel } from '@/src/components/SelectorGeneroNivel';
import { TipoObraProyectoModal } from '@/src/components/TipoObraProyectoModal';
import {
  claveDeConcepto, generoDe, generosParaGuardar, migrarGenero, normalizarGeneros, ponerGenero, type MapaGeneros,
} from '@/src/utils/generoNiveles';

// Limite cliente coherente con backend (20 MB). Evita subidas que el servidor rechazaria.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Tamano de pagina del feed de reportes (scroll infinito).
const PAGE_SIZE = 20;

// Tipos MIME aceptados para el picker (Excel/CSV/PDF/Word).
const UPLOAD_ACCEPTED_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx', '.xls', '.csv', '.pdf', '.doc', '.docx',
];

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// === Flujo de Exportacion en 2 pasos ====================================
type ExportFormat = 'pdf' | 'docx' | 'pptx' | 'xlsx';
type ExportStep = 'period' | 'area' | 'format';

const PERIOD_OPTIONS: { value: ReportPeriod; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'today',     label: t('proyectoPantalla.hoy'),         sub: t('proyectoPantalla.informeDiarioSoloJerarquiaDiario'),  icon: 'today-outline' },
  { value: 'yesterday', label: t('proyectoPantalla.ayer'),        sub: t('proyectoPantalla.reportesDelDiaAnterior'), icon: 'calendar-clear-outline' },
  { value: 'week',      label: t('proyectoPantalla.estaSemana'), sub: t('proyectoPantalla.informeSemanalSoloJerarquiaSemanal'),            icon: 'calendar-outline' },
  { value: 'last_week', label: t('proyectoPantalla.semanaPasada'), sub: t('proyectoPantalla.informeSemanaPasadaLunesADomingo'), icon: 'calendar-outline' },
  { value: 'month',     label: t('proyectoPantalla.esteMes'),    sub: t('proyectoPantalla.informeMensualSoloJerarquiaMensual'),           icon: 'calendar-number-outline' },
];

const FORMAT_OPTIONS: { value: ExportFormat; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; tint: string }[] = [
  { value: 'pdf',  label: 'PDF',        sub: t('proyectoPantalla.documentoHorizontalListoParaImprimir'), icon: 'document-text', tint: '#DC2626' },
  { value: 'docx', label: 'Word',       sub: t('proyectoPantalla.editableEnMicrosoftWord'),                icon: 'document',      tint: '#1D4ED8' },
  { value: 'pptx', label: 'PowerPoint', sub: t('proyectoPantalla.presentacionConPortadaDirac'),            icon: 'easel',         tint: '#B45309' },
  { value: 'xlsx', label: 'Excel',      sub: t('proyectoPantalla.sabanaPlanaConJerarquiaY'),       icon: 'grid',          tint: '#059669' },
];

const ReportFeedItem = React.memo(function ReportFeedItem({ report, onPress }: { report: FeedItem; onPress: (r: FeedItem) => void }) {
  const r = report;
  const hh = fmtDateTimeCDMX(r.created_at);
  const pathLbl = (r.node_path_names || []).join(' > ') || (r as any).area_name || '-';
  const author = (r as any).captured_by_name
    || (r as any).user_name
    || (r as any).author_name
    || 'Especialista';
  const valor = (r as any).avance ?? (r as any).medicion ?? '';
  const thumb = (r as any).thumbnail_base64;
  const photoUrl = (r as any).foto || (r as any).photo_url;
  const hasIncidencia = !!(r as any).incidencias;
  // `severidad` ahora es una lista (selección múltiple de jerarquías); se
  // acepta también el string legacy por si llega un dato viejo sin normalizar.
  const severidadRaw = (r as any).severidad;
  const severidadList: string[] = Array.isArray(severidadRaw) ? severidadRaw : severidadRaw ? [severidadRaw] : [];
  return (
    <Pressable accessibilityRole="button" onPress={() => onPress(r)} style={({ pressed }) => [styles.feedCard, pressed && { opacity: 0.85 }]}>
      {thumb ? (
        <Image
          source={{ uri: thumb.startsWith('data:image') ? thumb : `data:image/jpeg;base64,${thumb}` }}
          style={styles.feedThumb}
          contentFit="cover"
        />
      ) : photoUrl ? (
        <Image
          source={{ uri: photoUrl.startsWith('data:image') ? photoUrl : (photoUrl.startsWith('http') ? photoUrl : `data:image/jpeg;base64,${photoUrl}`) }}
          style={styles.feedThumb}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.feedThumb, styles.feedThumbPlaceholder]}>
          <Ionicons name="image-outline" size={24} color={colors.textMuted} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        {/* Nombre del reporte (estricto title, nombre, titulo, name, description) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <GravedadDot gravedad={(r as any).gravedad} />
          <Text style={[styles.feedTitle, { flex: 1 }]} numberOfLines={1}>
            {r.title || r.nombre || r.titulo || r.name || r.description || r.descripcion || t('proyectoPantalla.sinTitulo')}
          </Text>
        </View>
        {(hasIncidencia || severidadList.includes('urgente') || severidadList.includes('importante')) && (
          <View style={styles.badgeRow}>
            {hasIncidencia && (
              <View style={[styles.badge, styles.badgeIncidencia]}>
                <Text style={styles.badgeTxt}>{t('proyectoPantalla.incidencia')}</Text>
              </View>
            )}
            {severidadList.includes('urgente') && (
              <View style={[styles.badge, styles.badgeUrgente]}>
                <Text style={styles.badgeTxt}>{t('proyectoPantalla.urgente')}</Text>
              </View>
            )}
            {severidadList.includes('importante') && (
              <View style={[styles.badge, styles.badgeImportante]}>
                <Text style={styles.badgeTxt}>{t('proyectoPantalla.importante')}</Text>
              </View>
            )}
          </View>
        )}
        <View style={styles.feedRowTop}>
          <Ionicons name="person-circle-outline" size={16} color={colors.primary} />
          <Text style={styles.feedMetaTxt} numberOfLines={1}>{author}</Text>
          <Text style={styles.feedDate} numberOfLines={1}>{hh}</Text>
        </View>
        <View style={styles.feedRowMid}>
          <Ionicons name="git-branch-outline" size={13} color="#6B7280" />
          <Text style={styles.feedPath} numberOfLines={2}>{pathLbl}</Text>
        </View>
        {!!valor && (
          <View style={styles.feedRowVal}>
            <Ionicons name="speedometer-outline" size={14} color={colors.success} />
            <Text style={styles.feedVal}>{String(valor)}</Text>
          </View>
        )}
        {!!r.actividades && (
          <Text style={styles.feedActividades} numberOfLines={2}>{r.actividades}</Text>
        )}
        {!!r.comment && (
          <Text style={styles.feedComment} numberOfLines={3}>{r.comment}</Text>
        )}
      </View>
    </Pressable>
  );
});

export default function ProjectDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reports para alimentar HistoryCalendarModal
  const [reports, setReports] = useState<FeedItem[]>([]);
  // K-06: un solo modal a la vez. Abrir uno cierra el anterior; las banderas de abajo
  // conservan su nombre pero salen de este único estado.
  const modal = useModalUnico<'calendario' | 'ia' | 'exportar' | 'catalogos' | 'catalogoConfig' | 'objeto' | 'plantillas' | 'generales' | 'tipoObra'>();
  const { user } = useAuth();
  const esCoordGeneral = user?.role === ROLE_COORD;
  const tipoObraOpen = modal.visible('tipoObra');
  const setTipoObraOpen = modal.ponerVisible('tipoObra');
  const calendarOpen = modal.visible('calendario');
  const setCalendarOpen = modal.ponerVisible('calendario');


  // Filtrado cruzado: Nodo (Tramo/Subtramo/Poste) x Area (Disciplina) x Tiempo
  const [selectedNodeFilter, setSelectedNodeFilter] = useState<string | null>(null);
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<string | null>(null);
  // Antes arrancaba en 'all' -> cada apertura del proyecto disparaba una
  // consulta sin acotar por fecha sobre TODO el historial de reportes,
  // aunque el feed ya estuviera paginado (PAGE_SIZE) del lado del cliente.
  // Acotar el arranque a "hoy" no pierde precisión, solo evita la consulta pesada.
  const [selectedTimeFilter, setSelectedTimeFilter] = useState<'today' | 'week' | 'month' | 'all'>('today');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'incidencia' | 'avance' | null>(null);
  const [gravedadFiltro, setGravedadFiltro] = useState<GravedadFiltroValor>('todas');

  // Busqueda de texto libre (nodo / autor) sobre lo ya paginado en memoria.
  // Debounce 350ms antes de aplicar el filtro para no recalcular en cada tecla.
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim().toLowerCase()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Resumen Ejecutivo con IA
  const aiOpen = modal.visible('ia');
  const setAiOpen = modal.ponerVisible('ia');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<{ reports_count: number; period_hours: number } | null>(null);
  const [aiCopied, setAiCopied] = useState(false);
  const [aiPeriodo, setAiPeriodo] = useState<'diario' | 'semanal' | 'mensual'>('diario');

  // Tabs: Reportes / Operacion / Configuracion. P-04: la pestaña activa se recuerda por proyecto.
  const [activeTab, setActiveTab] = usePestanaProyecto(pid);

  // Exportacion unificada (3 pasos: periodo -> area -> formato)
  const exportOpen = modal.visible('exportar');
  const setExportOpen = modal.ponerVisible('exportar');
  const [exportStep, setExportStep] = useState<ExportStep>('period');
  const [exportPeriod, setExportPeriod] = useState<ReportPeriod>('today');
  const [rangoExportOpen, setRangoExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportSinReportes, setExportSinReportes] = useState<{ fmt: ExportFormat; otros: number } | null>(null);
  // P0 Mega-Feature: filtro por Area para exportacion
  const [exportAreas, setExportAreas] = useState<{ id: string; name: string; color?: string }[]>([]);
  const [exportAreaId, setExportAreaId] = useState<string | null>(null); // null = "Todas"

  // Preview de reporte (tap en feed)
  const [previewItem, setPreviewItem] = useState<FeedItem | null>(null);
  const cerrarModales = modal.cerrar;
  const handleFeedItemPress = useCallback((r: FeedItem) => { cerrarModales(); setPreviewItem(r); }, [cerrarModales]);

  // Archivos de Consulta (Reference Files) - ahora via expo-document-picker.
  const [refBusy, setRefBusy] = useState(false);
  const [refUploadName, setRefUploadName] = useState<string | null>(null); // nombre archivo en curso
  const [refOpeningId, setRefOpeningId] = useState<string | null>(null);   // file_id en descarga

  // P0 Mega-Feature: configuracion de Catalogos dinamicos (personal/equipo)
  const catModalOpen = modal.visible('catalogos');
  const setCatModalOpen = modal.ponerVisible('catalogos');
  const [catSaving, setCatSaving] = useState(false);
  const [catPersonalList, setCatPersonalList] = useState<string[]>([]);
  const [catEquipoList, setCatEquipoList] = useState<{ nombre: string; marca?: string; modelo?: string; serie?: string }[]>([]);
  const [catPersonalDraft, setCatPersonalDraft] = useState('');
  const [catEquipoDraft, setCatEquipoDraft] = useState('');

  // Configuracion del Catalogo de Conceptos / avance (tipo_contrato,
  // modo_avance, nombres de nivel, unidades, titulo, cadencia) — Etapas 1 y
  // 4. Un solo modal, mismo criterio que el resto de esta pantalla: drafts
  // locales que solo se confirman al guardar.
  const catalogoConfigModalOpen = modal.visible('catalogoConfig');
  const setCatalogoConfigModalOpen = modal.ponerVisible('catalogoConfig');
  const [catalogoConfigSaving, setCatalogoConfigSaving] = useState(false);
  const [tipoContratoDraft, setTipoContratoDraft] = useState<'PRECIOS_UNITARIOS' | 'PRECIO_ALZADO'>('PRECIOS_UNITARIOS');
  const [modoAvanceDraft, setModoAvanceDraft] = useState<'CANTIDAD' | 'PORCENTAJE' | 'MATRIZ'>('CANTIDAD');
  const [cadenciaDraft, setCadenciaDraft] = useState<'DIARIA' | 'SEMANAL' | 'MENSUAL'>('MENSUAL');
  const [zonaHorariaDraft, setZonaHorariaDraft] = useState<string>('America/Mexico_City');
  const [turnoNocturnoInicioDraft, setTurnoNocturnoInicioDraft] = useState('');
  const [turnoNocturnoFinDraft, setTurnoNocturnoFinDraft] = useState('');
  const [separadorDecimalDraft, setSeparadorDecimalDraft] = useState<'.' | ','>('.');
  const [diaInicioSemanaDraft, setDiaInicioSemanaDraft] = useState<
    'LUNES' | 'MARTES' | 'MIERCOLES' | 'JUEVES' | 'VIERNES' | 'SABADO' | 'DOMINGO'
  >('LUNES');
  const [nombresNivelesDraft, setNombresNivelesDraft] = useState<string[]>([]);
  const [nombreNivelPartidaDraft, setNombreNivelPartidaDraft] = useState('');
  const [nombreNivelConceptoDraft, setNombreNivelConceptoDraft] = useState('');
  const [generosDraft, setGenerosDraft] = useState<MapaGeneros>({});
  const [unidadesPersonalizadasDraft, setUnidadesPersonalizadasDraft] = useState<string[]>([]);
  const [unidadPersonalizadaDraftTxt, setUnidadPersonalizadaDraftTxt] = useState('');
  const [unidadPersonalizadaError, setUnidadPersonalizadaError] = useState<string | null>(null);
  const [nombreNivelError, setNombreNivelError] = useState<string | null>(null);
  const [tituloModuloDraft, setTituloModuloDraft] = useState('');

  // P0 - Identidad institucional (objeto_contrato + cliente_principal + color_tema)
  const objetoModalOpen = modal.visible('objeto');
  const setObjetoModalOpen = modal.ponerVisible('objeto');
  const [contratoModalOpen, setContratoModalOpen] = useState(false);

  // P0 Mega-Feature: Plantillas de exportacion (PDF/DOCX/PPTX)
  const tplModalOpen = modal.visible('plantillas');
  const setTplModalOpen = modal.ponerVisible('plantillas');
  const [tplBusyKind, setTplBusyKind] = useState<'pdf' | 'docx' | 'pptx' | null>(null);
  const gdModalOpen = modal.visible('generales');
  const setGdModalOpen = modal.ponerVisible('generales');
  const [objetoSaving, setObjetoSaving] = useState(false);
  const [objetoError, setObjetoError] = useState<string | null>(null);
  const [objetoDraft, setObjetoDraft] = useState('');
  const [clienteDraft, setClienteDraft] = useState('');
  // color_tema: ACOTADO al título de portada del Informe PDF/PPTX exportado.
  const [colorDraft, setColorDraft] = useState(COLOR_IDENTIDAD_DEFECTO);
  // color_institucional: color de marca real -- banners, tablas, botones y
  // acentos de toda la app y el resto de documentos exportados.
  const [colorInstitucionalDraft, setColorInstitucionalDraft] = useState(COLOR_IDENTIDAD_DEFECTO);
  // Color del texto de observaciones (pie de foto) en reportes ejecutivos.
  const [reportTextColorDraft, setReportTextColorDraft] = useState(COLOR_TEXTO_REPORTE_DEFECTO);
  // Grupo de WhatsApp (Whapi.cloud) donde se publican los reportes de este proyecto.
  const [whatsappGroupDraft, setWhatsappGroupDraft] = useState('');

  // Módulos creados con el Creador de módulos (se refrescan al volver a la pantalla).
  const [customModulos, setCustomModulos] = useState<CustomModule[]>([]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const p = await api.getProject(pid);
      setProject(p);
      api.listCustomModules(pid, true).then(setCustomModulos).catch(() => setCustomModulos([]));
    } catch (e: any) {
      setError(e?.message || t('proyectoPantalla.errorAlCargar'));
    } finally {
      setLoading(false);
    }
  }, [pid]);

  // === Feed paginado (scroll infinito) =====================================
  // Reemplaza la carga completa (hasta 500 reportes con imagenes originales)
  // por paginas de PAGE_SIZE, filtradas del lado del servidor. `reports` solo
  // contiene lo ya paginado en memoria — nunca el historial completo.
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [feedInitialLoading, setFeedInitialLoading] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedTotal, setFeedTotal] = useState(0); // total real (stats del servidor), no solo lo paginado
  const feedSkipRef = useRef(0);
  const feedReqRef = useRef(0);

  // Nodos raiz (Tramos) y Areas para los chips de filtro. Se cargan aparte
  // (livianos, sin imagenes) para no depender de cuanto se haya paginado.
  // Se usa listNodes (plano) en vez de getTree (arbol anidado) porque el
  // resultado plano tambien alimenta WeatherWidget, evitando que cada uno
  // haga su propio GET /nodes redundante.
  const [nodes, setNodes] = useState<string[]>([]);
  const [flatNodes, setFlatNodes] = useState<LocationNode[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [areasFull, setAreasFull] = useState<{ id: string; name: string; color?: string }[]>([]);
  const [modulosAreaCerrada, setModulosAreaCerrada] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!pid) return;
    let alive = true;
    api.listNodes(pid)
      .then((list) => {
        if (!alive) return;
        setFlatNodes(list || []);
        setNodes((list || []).filter((n) => !n.parent_id).map((n) => n.name).filter(Boolean));
      })
      .catch(() => { if (alive) { setFlatNodes([]); setNodes([]); } });
    api.listAreas(pid)
      .then((list) => {
        if (!alive) return;
        setAreas((list || []).map((a) => a.name).filter(Boolean));
        setAreasFull((list || []).map((a) => ({ id: a.id, name: a.name, color: a.color })));
      })
      .catch(() => { if (alive) { setAreas([]); setAreasFull([]); } });
    return () => { alive = false; };
  }, [pid]);

  // Carga una pagina del feed. reset=true reinicia la paginacion (primer
  // montaje o cambio de filtro); reset=false concatena (scroll infinito).
  const loadFeedPage = useCallback(async (reset: boolean) => {
    if (!pid) return;
    const skip = reset ? 0 : feedSkipRef.current;
    const reqId = ++feedReqRef.current;
    if (reset) {
      // Cambio de filtro/día: se vacía la lista anterior (p. ej. la de "Hoy") hasta que llegue la nueva.
      setReports([]);
      feedSkipRef.current = 0;
      setFeedInitialLoading(true);
    } else setFeedLoadingMore(true);
    try {
      const f = await api.feed(pid, selectedTimeFilter, PAGE_SIZE, undefined, {
        skip,
        node: selectedNodeFilter || undefined,
        area: selectedAreaFilter || undefined,
        date: selectedDate || undefined,
      });
      // Una respuesta más vieja no debe pisar la del filtro/día actual.
      if (reqId !== feedReqRef.current) return;
      const page = f?.reports || [];
      setReports((prev) => (reset ? page : [...prev, ...page]));
      feedSkipRef.current = skip + page.length;
      setFeedHasMore(!!f?.has_more);
      if (reset) setFeedTotal(f?.stats?.total || 0);
    } catch {
      // Silencioso: en reset limpia a vacio; en scroll infinito conserva lo ya cargado.
      if (reset) { setReports([]); setFeedHasMore(false); }
    } finally {
      if (reqId === feedReqRef.current) {
        if (reset) setFeedInitialLoading(false); else setFeedLoadingMore(false);
      }
    }
  }, [pid, selectedTimeFilter, selectedNodeFilter, selectedAreaFilter, selectedDate]);

  // Reinicia la paginacion cuando cambia el proyecto o algun filtro.
  useEffect(() => { loadFeedPage(true); }, [loadFeedPage]);

  const loadMoreFeed = useCallback(() => {
    if (feedLoadingMore || feedInitialLoading || !feedHasMore) return;
    loadFeedPage(false);
  }, [feedLoadingMore, feedInitialLoading, feedHasMore, loadFeedPage]);

  // Chequeo ligero al recuperar foco: NO destruye la paginacion ya cargada en
  // memoria, solo antepone los reportes creados desde el mas reciente visible.
  const checkForNewReports = useCallback(async () => {
    if (!pid || reports.length === 0) return;
    const newest = reports[0]?.created_at;
    if (!newest) return;
    const reqId = feedReqRef.current;
    try {
      const f = await api.feed(pid, selectedTimeFilter, PAGE_SIZE, undefined, {
        node: selectedNodeFilter || undefined,
        area: selectedAreaFilter || undefined,
        date: selectedDate || undefined,
        since: newest,
      });
      // Si mientras tanto cambió el filtro/día (o se recargó la lista), esta
      // respuesta ya no corresponde a lo que se ve: no debe anteponerse.
      if (reqId !== feedReqRef.current) return;
      const fresh = (f?.reports || []).filter((r) => !reports.some((existing) => existing.id === r.id));
      if (fresh.length > 0) {
        setReports((prev) => [...fresh, ...prev]);
        feedSkipRef.current += fresh.length;
        setFeedTotal((prev) => prev + fresh.length);
      }
    } catch {
      // Silencioso: si falla, se mantiene la lista cacheada tal cual.
    }
  }, [pid, reports, selectedTimeFilter, selectedNodeFilter, selectedAreaFilter, selectedDate]);

  useFocusEffect(useCallback(() => {
    load();
    checkForNewReports();
  }, [load, checkForNewReports]));

  // === Resumen Ejecutivo con IA ===========================================
  async function openAiSummary() {
    setAiOpen(true);
    setAiCopied(false);
    if (aiSummary) return; // ya generado en esta sesion; usuario puede regenerar manualmente
    await runAiSummary();
  }

  async function runAiSummary(periodoOverride?: 'diario' | 'semanal' | 'mensual') {
    if (!pid) return;
    try {
      setAiBusy(true);
      setAiError(null);
      setAiSummary(null);
      setAiMeta(null);
      const res = await api.aiSummary(pid, periodoOverride ?? aiPeriodo);
      setAiSummary(res.summary);
      setAiMeta({ reports_count: res.reports_count, period_hours: res.period_hours });
    } catch (e: any) {
      setAiError(e?.message || t('proyectoPantalla.noSePudoGenerarEl'));
    } finally {
      setAiBusy(false);
    }
  }

  async function changeAiPeriodo(p: 'diario' | 'semanal' | 'mensual') {
    if (p === aiPeriodo) return;
    setAiPeriodo(p);
    await runAiSummary(p);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  async function persistRefs(next: ReferenceFile[]) {
    try {
      setRefBusy(true);
      const res = await api.setProjectReferenceFiles(pid, next);
      setProject((p) => (p ? { ...p, reference_files: res.reference_files } : p));
    } catch (e: any) {
      Alert.alert(t('proyectoPantalla.noSePudoGuardar'), e?.message || t('proyectoPantalla.intentaloNuevamente'));
    } finally {
      setRefBusy(false);
    }
  }

  // === Subida real con expo-document-picker -> multipart al backend ===========
  async function onPickAndUploadFile() {
    if (refBusy) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: UPLOAD_ACCEPTED_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      // Validacion cliente del tamano (20 MB).
      if (asset.size && asset.size > MAX_UPLOAD_BYTES) {
        Alert.alert(
          t('proyectoPantalla.archivoDemasiadoGrande'),
          t('proyectoPantalla.archivoPesaMax20', { tam: formatBytes(asset.size) }),
        );
        return;
      }

        setRefBusy(true);
        setRefUploadName(asset.name || 'archivo');
        if (!asset.uri) {
          throw new Error('La URI del archivo seleccionado es nula o inválida.');
        }
        const res = await api.uploadProjectFile(pid, {
          uri: asset.uri,
          name: asset.name || 'archivo',
          mimeType: asset.mimeType,
        });

      if (res.type === 'nodes_bulk' && res.summary) {
        const s = res.summary;
        const lines = [
          `Nuevos: ${s.created}`,
          `Actualizados: ${s.updated}`,
          `Omitidos (filas vacias): ${s.skipped}`,
        ];
        if (s.leaves_configured) {
          lines.push(`Hojas configuradas automaticamente: ${s.leaves_configured} (${s.coords_set || 0} con coordenadas)`);
        }
        if (s.errors?.length) {
          lines.push('');
          lines.push(`Errores: ${s.errors.length}`);
          for (const e of s.errors.slice(0, 5)) {
            lines.push(`• Fila ${e.row}: ${e.error}`);
          }
        }
        Alert.alert(t('proyectoPantalla.nodosImportados'), lines.join('\n'));
      } else {
        Alert.alert(t('proyectoPantalla.archivoSubido'), t('proyectoPantalla.archivoAdjuntado', { nombre: res.filename }));
      }

      // Refrescar proyecto para reflejar reference_files actualizados.
      await load();
    } catch (e: any) {
      Alert.alert(t('proyectoPantalla.noSePudoSubir'), e?.message || t('proyectoPantalla.errorDesconocidoAlSubirEl'));
    } finally {
      setRefBusy(false);
      setRefUploadName(null);
    }
  }

  async function onRemoveRefFile(idx: number) {
    const current = project?.reference_files || [];
    const target = current[idx];
    if (!target) return;
    const ok = await confirm(
      t('proyectoPantalla.eliminarArchivo'),
      t('proyectoPantalla.quitarArchivoPregunta', { nombre: target.name || t('proyectoPantalla.archivoGenerico') }),
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    try {
      setRefBusy(true);
      if (target.file_id) {
        // Archivo subido al servidor -> borrar registro + binario.
        const res = await api.deleteProjectFile(pid, target.file_id);
        if (res?.ok) {
          setProject((p) =>
            p ? { ...p, reference_files: (p.reference_files || []).filter((f) => f.file_id !== target.file_id) } : p,
          );
        } else {
          throw new Error('Respuesta inesperada del servidor.');
        }
      } else {
        // Enlace externo (legacy) -> reescribir lista completa.
        const next = current.filter((_, i) => i !== idx);
        await persistRefs(next);
      }
    } catch (e: any) {
      Alert.alert(t('proyectoPantalla.noSePudoEliminar'), e?.message || t('proyectoPantalla.intentaloNuevamente'));
    } finally {
      setRefBusy(false);
    }
  }

  // Abrir/descargar archivo. Si tiene file_id (subido al backend) descarga con
  // Bearer token via fetch y comparte/abre con downloadBlob. Si es URL externa,
  // simplemente abre el enlace.
  async function onOpenRefFile(f: ReferenceFile) {
    try {
      if (f.file_id) {
        setRefOpeningId(f.file_id);
        const { blob, filename, mime } = await api.downloadProjectFile(
          pid,
          f.file_id,
          f.original_name || f.name || 'archivo',
        );
        await downloadBlob(blob, filename, mime || f.mime_type);
      } else if (f.url) {
        await Linking.openURL(f.url);
      } else {
        Alert.alert(t('proyectoPantalla.sinDestino'), t('proyectoPantalla.elArchivoNoTieneUrl'));
      }
    } catch (e: any) {
      Alert.alert(t('proyectoPantalla.noSePudoAbrir'), e?.message || t('proyectoPantalla.revisaTuConexionEIntentalo'));
    } finally {
      setRefOpeningId(null);
    }
  }

  async function onArchive() {
    const ok = await confirm(
      t('proyectoPantalla.archivarProyecto'),
      t('proyectoPantalla.elProyectoSeOcultaraPero'),
      { confirmText: 'Archivar', destructive: true },
    );
    if (!ok) return;
    try { await api.archiveProject(pid); router.back(); }
    catch (e: any) { Alert.alert(t('proyectoPantalla.error'), e?.message || t('proyectoPantalla.noSePudoArchivar')); }
  }

  // === Catalogos del proyecto: categorias personal/equipo ====================
  function openCatModal() {
    if (!project) return;
    setCatPersonalList(((project as any).categorias_personal as string[]) || []);
    setCatEquipoList(((project as any).categorias_equipo as any[]) || []);
    setCatPersonalDraft('');
    setCatEquipoDraft('');
    setCatModalOpen(true);
  }

  // === Identidad institucional (objeto + cliente + color) ===================
  function openObjetoModal() {
    if (!project) return;
    setObjetoDraft((project as any).objeto_contrato || '');
    setClienteDraft((project as any).cliente_principal || '');
    setColorDraft((project as any).color_tema || COLOR_IDENTIDAD_DEFECTO);
    setColorInstitucionalDraft((project as any).color_institucional || COLOR_IDENTIDAD_DEFECTO);
    setReportTextColorDraft((project as any).report_text_color || COLOR_TEXTO_REPORTE_DEFECTO);
    setObjetoError(null);
    // Se guardan como "id1, id2"; en el editor se muestra uno por línea.
    setWhatsappGroupDraft(((project as any).whatsapp_group_id || '').split(/[,;\s]+/).filter(Boolean).join('\n'));
    setObjetoModalOpen(true);
  }

  async function saveObjeto() {
    if (!pid || objetoSaving) return;
    setObjetoError(null);
    // P-02: un color inválido NO se sustituye en silencio: se avisa junto al campo y no se guarda.
    if (errorDeColor(colorDraft) || errorDeColor(colorInstitucionalDraft) || errorDeColor(reportTextColorDraft)) {
      setObjetoError(t('color.corrige'));
      return;
    }
    try {
      setObjetoSaving(true);
      const upd = await api.updateProject(pid, {
        objeto_contrato: objetoDraft.trim() || null,
        cliente_principal: clienteDraft.trim() || null,
        color_tema: normalizarColorHex(colorDraft),
        color_institucional: normalizarColorHex(colorInstitucionalDraft),
        report_text_color: normalizarColorHex(reportTextColorDraft),
        // '' (no null): el backend ignora null; '' desactiva el envío.
        whatsapp_group_id: whatsappGroupDraft.trim(),
      } as any);
      setProject((p) => ({ ...(p || ({} as any)), ...upd }));
      setObjetoModalOpen(false);
      showToast(t('proyectoPantalla.laIdentidadInstitucionalDelProyecto'));
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setObjetoError(e?.message || t('proyectoPantalla.noSePudoGuardarIntentalo'));
    } finally {
      setObjetoSaving(false);
    }
  }

  // === Plantillas de exportacion (PDF/DOCX/PPTX/MAP) =========================
  const TPL_MIMES: Record<'pdf' | 'docx' | 'pptx' | 'map', string[]> = {
    pdf: ['application/pdf', '.pdf'],
    docx: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.docx',
    ],
    pptx: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.pptx',
    ],
    map: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
    ],
  };

  async function onPickAndUploadTemplate(kind: 'pdf' | 'docx' | 'pptx' | 'map') {
    if (tplBusyKind) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: TPL_MIMES[kind],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const size = asset.size ?? 0;
      const MAX = 25 * 1024 * 1024;
      if (size && size > MAX) {
        Alert.alert(
          t('proyectoPantalla.plantillaDemasiadoGrande'),
          t('proyectoPantalla.archivoPesaMax25', { tam: formatBytes(size) }),
        );
        return;
      }
      setTplBusyKind(kind);
      if (!asset.uri) {
        throw new Error('La URI de la plantilla seleccionada es nula o inválida.');
      }
      const upd = await api.uploadProjectTemplate(pid, kind, {
        uri: asset.uri,
        name: asset.name || `template.${kind}`,
        mimeType: asset.mimeType,
      });
      setProject((p) => ({ ...(p || ({} as any)), ...upd }));
      Alert.alert(
        t('proyectoPantalla.plantillaCargada'),
        t('proyectoPantalla.plantillaGuardada', { tipo: kind.toUpperCase() }),
      );
    } catch (e: any) {
      Alert.alert(t('proyectoPantalla.noSePudoSubirLa'), e?.message || t('proyectoPantalla.intentaloNuevamente'));
    } finally {
      setTplBusyKind(null);
    }
  }

  async function onDeleteTemplate(kind: 'pdf' | 'docx' | 'pptx' | 'map') {
    if (tplBusyKind) return;
    const ok = await confirm(
      t('proyectoPantalla.eliminarPlantilla'),
      t('proyectoPantalla.quitarPlantillaPregunta', { tipo: kind.toUpperCase() }),
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    try {
      setTplBusyKind(kind);
      const upd = await api.deleteProjectTemplate(pid, kind);
      setProject((p) => ({ ...(p || ({} as any)), ...upd }));
    } catch (e: any) {
      Alert.alert(t('proyectoPantalla.noSePudoEliminar'), e?.message || t('proyectoPantalla.intentaloNuevamente'));
    } finally {
      setTplBusyKind(null);
    }
  }

  // ==========================================================================
  // Datos Generales (ex-Mapa) - multiples imagenes por proyecto que se
  // emiten como slides/paginas dedicadas al inicio de las exportaciones.
  // ==========================================================================
  const [gdBusy, setGdBusy] = useState<'add' | number | null>(null);
  // El contenido de las imagenes ya NO viaja con `project` (puede pesar
  // varios MB) -- se pide bajo demanda solo al abrir este modal.
  const [gdImages, setGdImages] = useState<string[]>([]);
  const [gdImagesLoading, setGdImagesLoading] = useState(false);
  const [gdImagesFetched, setGdImagesFetched] = useState(false);
  // Nombre de cada imagen (alineado por indice): es la entrada que aparece en
  // el indice del PDF/PPTX.
  const [gdNames, setGdNames] = useState<string[]>([]);
  const gdCount = gdImagesFetched ? gdImages.length : ((project as any)?.general_data_images_count ?? 0);

  const loadGeneralDataImages = useCallback(async () => {
    if (!pid || gdImagesFetched || gdImagesLoading) return;
    setGdImagesLoading(true);
    try {
      const res = await api.getGeneralDataImages(pid);
      setGdImages(res.general_data_images || []);
      setGdNames(res.general_data_names || []);
      setGdImagesFetched(true);
    } catch (e: any) {
      Alert.alert(t('proyectoPantalla.error'), e?.message || t('proyectoPantalla.noSePudieronCargarLas'));
    } finally {
      setGdImagesLoading(false);
    }
  }, [pid, gdImagesFetched, gdImagesLoading]);

  async function onAddGeneralDataImages() {
    if (gdBusy) return;
    try {
      let perm = await getMediaLibraryPermission();
      if (perm.status !== 'granted') {
        if (!perm.canAskAgain) {
          const openIt = await confirm(
            t('proyectoPantalla.permisoRequerido'),
            t('proyectoPantalla.necesitamosAccesoATuGaleria'),
            { confirmText: 'Abrir ajustes' },
          );
          if (openIt) Linking.openSettings();
          return;
        }
        perm = await requestMediaLibraryPermission();
        if (perm.status !== 'granted') return;
      }
      // [P0 FIX] Subida multipart (no base64 en JSON). En movil se usa
      // FileSystem.uploadAsync (stack nativa OkHttp/NSURLSession) que elimina
      // el bug "Network request failed" en Android y libera memoria en iOS.
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        base64: false,   // !NO base64!
        exif: false,
        allowsMultipleSelection: Platform.OS !== 'ios',
      });
      if (res.canceled) return;
      const assets = res.assets || [];
      if (!assets.length) return;
      setGdBusy('add');
      let last: any = project;
      let uploaded = 0;
      const errors: string[] = [];
      for (const a of assets) {
        if (!a.uri) { errors.push('URI vacia'); continue; }
        // Android exige `file://` como prefijo o falla el multipart.
        let uri = a.uri;
        if (Platform.OS === 'android' && !uri.startsWith('file://') && !uri.startsWith('content://')) {
          uri = `file://${uri.replace(/^\/+/, '')}`;
        }
        const rawMime = (a as any).mimeType || (a as any).type || 'image/jpeg';
        const mime = typeof rawMime === 'string' && rawMime.includes('/') ? rawMime : 'image/jpeg';
        const name = (a as any).fileName || `gd_${Date.now()}_${uploaded}.jpg`;
        try {
          if (!uri) throw new Error('URI de imagen para Datos Generales es nula.');
          last = await api.addGeneralDataImageFile(pid, { uri, name, mimeType: mime });
          uploaded += 1;
        } catch (err: any) {
          errors.push(err?.message || 'error de red');
        }
      }
      if (last) {
        const { general_data_images: freshImages, ...rest } = last as any;
        setProject((p) => ({ ...(p || ({} as any)), ...rest, general_data_images_count: (freshImages || []).length }));
        setGdImages(freshImages || []);
        setGdNames((last as any).general_data_names || []);
        setGdImagesFetched(true);
      }
      if (uploaded === 0 && errors.length > 0) {
        // [DEBUG UI] Detalle COMPLETO de los errores (incluye URL, tamano y
        // mime enriquecidos por api.ts) para que el usuario pueda leerlos
        // en su dispositivo fisico.
        Alert.alert(
          t('proyectoPantalla.errorDeSubidaDatosGenerales'),
          errors.slice(0, 3).map((e, i) => `#${i + 1}: ${e}`).join('\n\n'),
          [{ text: t('proyectoPantalla.ok') }],
        );
      } else if (errors.length > 0) {
        Alert.alert(
          t('proyectoPantalla.imagenesSubidasConAvisos'),
          `Se subieron ${uploaded}, pero ${errors.length} fallaron:\n\n` +
            errors.slice(0, 3).map((e, i) => `#${i + 1}: ${e}`).join('\n\n'),
          [{ text: t('proyectoPantalla.ok') }],
        );
      }
    } catch (e: any) {
      Alert.alert(
        t('proyectoPantalla.errorDeSubidaDatosGenerales'),
        String(e?.message || 'Verifica que el archivo pese menos de 5 MB e inténtalo nuevamente.'),
        [{ text: t('proyectoPantalla.ok') }],
      );
    } finally {
      setGdBusy(null);
    }
  }

  // `texto` llega directo del campo (evento de fin de edicion): no depende de
  // que el estado ya se haya actualizado, asi el ultimo caracter nunca se pierde.
  async function onSaveGeneralDataNames(idx: number, texto: string) {
    try {
      const upd: any = await api.setGeneralDataNames(
        pid, gdImages.map((_, i) => (i === idx ? texto : gdNames[i] || '')),
      );
      setGdNames(upd.general_data_names || []);
    } catch (e: any) {
      Alert.alert('No se pudo guardar el nombre', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function onDeleteGeneralDataImage(idx: number) {
    if (gdBusy !== null) return;
    const ok = await confirm(
      t('proyectoPantalla.eliminarImagen'),
      t('proyectoPantalla.quitarEstaImagenDeDatos'),
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    try {
      setGdBusy(idx);
      const upd = await api.deleteGeneralDataImage(pid, idx);
      const { general_data_images: freshImages, ...rest } = upd as any;
      setProject((p) => ({ ...(p || ({} as any)), ...rest, general_data_images_count: (freshImages || []).length }));
      setGdImages(freshImages || []);
      setGdNames((upd as any).general_data_names || []);
      setGdImagesFetched(true);
    } catch (e: any) {
      Alert.alert(t('proyectoPantalla.noSePudoEliminar'), e?.message || t('proyectoPantalla.intentaloNuevamente'));
    } finally {
      setGdBusy(null);
    }
  }

  function addCatPersonal() {
    const t = catPersonalDraft.trim();
    if (!t) return;
    setCatPersonalList((arr) => {
      const next = Array.from(new Set([...arr, t]));
      return next;
    });
    setCatPersonalDraft('');
  }

  function addCatEquipo() {
    const t = catEquipoDraft.trim();
    if (!t) return;
    setCatEquipoList((arr) => {
      const next = Array.from(new Set([...arr, t]));
      return next;
    });
    setCatEquipoDraft('');
  }

  async function saveCatalogos() {
    if (!pid || catSaving) return;
    try {
      setCatSaving(true);
      // Guardar catalogos dinamicos (Personal / Equipo).
      // Nota: `objeto_contrato` ya NO se edita aqui - vive en su propio modal (objetoModal).
      const upd2 = await api.setProjectCatalogos(pid, {
        categorias_personal: catPersonalList,
        categorias_equipo: catEquipoList,
      });
      setProject((p) => ({ ...(p || ({} as any)), ...upd2 }));
      setCatModalOpen(false);
      Alert.alert(t('proyectoPantalla.guardado'), t('proyectoPantalla.laConfiguracionDelProyectoSe'));
    } catch (e: any) {
      Alert.alert(t('proyectoPantalla.noSePudoGuardar'), e?.message || t('proyectoPantalla.intentaloNuevamente'));
    } finally {
      setCatSaving(false);
    }
  }

  // === Configuracion del Catalogo de Conceptos / avance (Etapas 1 y 4) ======
  function openCatalogoConfigModal() {
    if (!project) return;
    const p = project as any;
    setTipoContratoDraft(p.tipo_contrato || 'PRECIOS_UNITARIOS');
    setModoAvanceDraft(p.modo_avance || 'CANTIDAD');
    setCadenciaDraft(p.cadencia_reporte || 'MENSUAL');
    setDiaInicioSemanaDraft(p.dia_inicio_semana || 'LUNES');
    setZonaHorariaDraft(p.zona_horaria || 'America/Mexico_City');
    setTurnoNocturnoInicioDraft(p.turno_nocturno_inicio || '');
    setTurnoNocturnoFinDraft(p.turno_nocturno_fin || '');
    setSeparadorDecimalDraft(p.separador_decimal === ',' ? ',' : '.');
    setNombresNivelesDraft(p.nombres_niveles_partida || []);
    setNombreNivelPartidaDraft('');
    setNombreNivelConceptoDraft(p.nombre_nivel_concepto || '');
    setGenerosDraft(normalizarGeneros(p.genero_niveles));
    setUnidadesPersonalizadasDraft(p.unidades_personalizadas || []);
    setUnidadPersonalizadaDraftTxt('');
    setUnidadPersonalizadaError(null);
    setNombreNivelError(null);
    setTituloModuloDraft(p.titulo_modulo_catalogo || '');
    setCatalogoConfigModalOpen(true);
  }

  function addNombreNivel() {
    const r = validarNombreNivel(nombresNivelesDraft, nombreNivelPartidaDraft);
    if (!r.ok) {
      setNombreNivelError(t(r.motivo === 'vacio' ? 'catalogoForm.nombreNivelVacio' : 'catalogoForm.nombreNivelRepetido'));
      return;
    }
    setNombresNivelesDraft((arr) => [...arr, r.nombre]); // orden importa (nivel 1, nivel 2...) -- no reordena
    setNombreNivelPartidaDraft('');
    setNombreNivelError(null);
  }

  function addUnidadPersonalizada() {
    const r = validarUnidadPersonalizada(unidadesPersonalizadasDraft, unidadPersonalizadaDraftTxt);
    if (!r.ok) {
      setUnidadPersonalizadaError(t(r.motivo === 'vacia' ? 'catalogoForm.unidadPersonalizadaVacia' : 'catalogoForm.unidadPersonalizadaRepetida'));
      return;
    }
    setUnidadesPersonalizadasDraft((arr) => [...arr, r.unidad]);
    setUnidadPersonalizadaDraftTxt('');
    setUnidadPersonalizadaError(null);
  }

  // Cambiar tipo_contrato o modo_avance con datos ya cargados exige
  // confirmacion explicita (server.py lo rechaza con 400 la primera vez) --
  // el mensaje del propio backend explica la consecuencia, se reusa tal
  // cual en el dialogo de confirmacion en vez de redactar una advertencia
  // aparte que podria desincronizarse de la real.
  async function saveCatalogoConfig(confirmar?: { tipoContrato?: boolean; modoAvance?: boolean }) {
    if (!pid || catalogoConfigSaving) return;
    const turno = validarTurnoNocturno(turnoNocturnoInicioDraft, turnoNocturnoFinDraft);
    if (!turno.ok) {
      Alert.alert(t('turnoNocturno.titulo'), t(turno.motivo === 'iguales' ? 'turnoNocturno.iguales' : 'turnoNocturno.invalido'));
      return;
    }
    try {
      setCatalogoConfigSaving(true);
      const upd = await api.updateProject(pid, {
        turno_nocturno_inicio: turno.inicio,
        turno_nocturno_fin: turno.fin,
        tipo_contrato: tipoContratoDraft,
        modo_avance: modoAvanceDraft,
        cadencia_reporte: cadenciaDraft,
        dia_inicio_semana: diaInicioSemanaDraft,
        zona_horaria: zonaHorariaDraft,
        separador_decimal: separadorDecimalDraft,
        nombres_niveles_partida: nombresNivelesDraft,
        nombre_nivel_concepto: nombreNivelConceptoDraft.trim() || null,
        genero_niveles: generosParaGuardar(generosDraft, nombresNivelesDraft, nombreNivelConceptoDraft),
        unidades_personalizadas: unidadesPersonalizadasDraft,
        titulo_modulo_catalogo: tituloModuloDraft.trim() || null,
        confirmar_cambio_tipo_contrato: !!confirmar?.tipoContrato,
        confirmar_cambio_modo_avance: !!confirmar?.modoAvance,
      } as any);
      olvidarSeparadorDecimal(pid);
      setProject((p) => ({ ...(p || ({} as any)), ...upd }));
      setCatalogoConfigModalOpen(false);
      Alert.alert(t('proyectoPantalla.guardado'), t('proyectoPantalla.laConfiguracionDelCatalogoSe'));
    } catch (e: any) {
      const status = e instanceof ApiError ? e.status : 0;
      const msg = e?.message || '';
      if (status === 400 && /tipo_contrato/i.test(msg) && !confirmar?.tipoContrato) {
        const ok = await confirm(t('proyectoPantalla.cambiarTipoDeContrato'), msg);
        if (ok) { await saveCatalogoConfig({ ...confirmar, tipoContrato: true }); }
      } else if (status === 400 && /modo_avance/i.test(msg) && !confirmar?.modoAvance) {
        const ok = await confirm(t('proyectoPantalla.cambiarModoDeAvance'), msg);
        if (ok) { await saveCatalogoConfig({ ...confirmar, modoAvance: true }); }
      } else {
        Alert.alert(t('proyectoPantalla.noSePudoGuardar'), msg || t('proyectoPantalla.intentaloNuevamente'));
      }
    } finally {
      setCatalogoConfigSaving(false);
    }
  }

  // === Exportacion: flujo en 3 pasos =========================================
  function openExportFlow() {
    setExportStep('period');
    setExportPeriod('today');
    setExportAreaId(null);
    setExportSinReportes(null);
    setExportOpen(true);
    // Cargar areas en paralelo
    if (pid) {
      api.listAreas(pid)
        .then((list) => setExportAreas(
          (list || []).map((a) => ({ id: a.id, name: a.name, color: a.color })),
        ))
        .catch(() => setExportAreas([]));
    }
  }

  function closeExportFlow() {
    if (exportBusy) return;
    setExportOpen(false);
    setTimeout(() => setExportStep('period'), 200);
  }

  function onPickPeriod(p: ReportPeriod) {
    setExportPeriod(p);
    setExportStep('area');
  }

  function onPickArea(areaId: string | null) {
    setExportAreaId(areaId);
    setExportSinReportes(null);
    setExportStep('format');
  }

  async function onPickFormat(fmt: ExportFormat, forzar?: boolean) {
    if (!pid) return;
    try {
      setExportBusy(true);
      setExportSinReportes(null);
      if (fmt === 'xlsx') {
        // Excel ignora periodo (sabana completa). Reusamos descarga existente.
        if (Platform.OS === 'web') {
          const { blob, filename } = await api.downloadReportsXlsx(pid);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename; document.body.appendChild(a); a.click();
          a.remove(); URL.revokeObjectURL(url);
        } else {
          const { blob, filename } = await api.downloadReportsXlsx(pid);
          const reader = new FileReader();
          const dataUri: string = await new Promise((resolve, reject) => {
            reader.onerror = () => reject(reader.error);
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          const base64 = dataUri.split(',')[1] || '';
          const FileSystem: any = await import('expo-file-system/legacy');
          const Sharing: any = await import('expo-sharing');
          const dest = `${FileSystem.cacheDirectory || ''}${filename}`;
          await FileSystem.writeAsStringAsync(dest, base64, { encoding: FileSystem.EncodingType?.Base64 || 'base64' });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(dest, {
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              dialogTitle: 'Compartir reporte',
            });
          } else {
            Alert.alert(t('proyectoPantalla.listo'), t('proyectoPantalla.archivoGuardadoCache', { destino: dest }));
          }
        }
      } else {
        const opts: { area_id?: string; period_type?: string } = {
          ...(exportAreaId ? { area_id: exportAreaId } : {}),
          period_type: periodToInformeType(exportPeriod),
        };
        if (!forzar) {
          const conteo = await verificarConteoExportacion(pid, exportPeriod, opts);
          if (conteo.vacio) {
            setExportSinReportes({ fmt, otros: conteo.otros });
            return;
          }
        }
        let blob: Blob; let filename: string; let mime: string;
        if (fmt === 'docx') {
          const r = await api.downloadReportsDocx(pid, exportPeriod, opts);
          blob = r.blob; filename = r.filename;
          mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (fmt === 'pptx') {
          const r = await api.downloadReportsPptx(pid, exportPeriod, opts);
          blob = r.blob; filename = r.filename;
          mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        } else {
          const r = await api.downloadReportsPdf(pid, exportPeriod, opts);
          blob = r.blob; filename = r.filename;
          mime = 'application/pdf';
        }
        await downloadBlob(blob, filename, mime);
      }
      setExportOpen(false);
      setTimeout(() => setExportStep('period'), 200);
    } catch (e: any) {
      Alert.alert(
        t('proyectoPantalla.noSePudoGenerar', { formato: fmt.toUpperCase() }),
        e?.message || t('proyectoPantalla.intentaloNuevamente'),
      );
    } finally {
      setExportBusy(false);
    }
  }

  const filteredReports = useMemo(() => {
    let list = reports;
    if (debouncedSearch) {
      list = list.filter((r) => {
        const title = (r.title || r.nombre || r.titulo || r.name || r.description || r.descripcion || '').toLowerCase();
        const author = ((r as any).captured_by_name || (r as any).user_name || (r as any).author_name || '').toLowerCase();
        const path = (r.node_path_names || []).join(' > ').toLowerCase();
        return title.includes(debouncedSearch) || author.includes(debouncedSearch) || path.includes(debouncedSearch);
      });
    }
    if (selectedStatusFilter === 'incidencia') {
      list = list.filter((r) => !!(r as any).incidencias);
    } else if (selectedStatusFilter === 'avance') {
      list = list.filter((r) => {
        const av = (r as any).avance;
        if (!av) return false;
        const num = parseFloat(av);
        // El backend siempre manda "avance" como string (p.ej. "0.00m"), asi que
        // un valor numerico de 0 no cuenta como avance real.
        return isNaN(num) || num !== 0;
      });
    }
    return filtrarPorGravedad(list, gravedadFiltro);
  }, [reports, debouncedSearch, selectedStatusFilter, gravedadFiltro]);

  // Plantillas fijas encendidas + módulos del Creador de módulos (activos).
  const gruposModulos = agruparModulosPorArea(
    [...modulosActivos(project?.modulos), ...modulosPersonalizadosDef(customModulos)],
    asignacionesConPersonalizados(project?.modulos_areas, customModulos),
    areasFull,
  );
  const tileModulo = (m: ModuloDef) => (
    <ActionTile
      key={m.key}
      icon={m.icon}
      title={m.label}
      subtitle={m.subtitle}
      onPress={() => router.push({
        pathname: `/(coord)/projects/[id]/${m.screen}` as any,
        params: m.customId ? { id: pid, mid: m.customId } : { id: pid },
      })}
    />
  );

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <ScreenHeader title={project?.name || t('proyectoPantalla.proyecto')} fallbackHref="/(coord)" safeArea={false} />

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error || !project ? (
        <View style={[styles.errorBox, { marginHorizontal: spacing.lg }]}>
          <Ionicons name="alert-circle" size={18} color={colors.error} />
          <Text style={styles.errorText}>{error || t('proyectoPantalla.proyectoNoDisponible')}</Text>
        </View>
      ) : (
        <>
          {/* ===== Pestanas: Reportes / Operacion / Configuracion (justo debajo del header) ===== */}
          <View style={styles.tabBarWrap}>
            <View style={styles.tabBar}>
              <Pressable accessibilityRole="button"
                onPress={() => setActiveTab('reportes')}
                style={[styles.tabBtn, activeTab === 'reportes' && styles.tabBtnActive]}
              >
                <Ionicons
                  name="document-text-outline"
                  size={16}
                  color={activeTab === 'reportes' ? '#fff' : colors.text}
                />
                <Text style={[styles.tabTxt, activeTab === 'reportes' && styles.tabTxtActive]} numberOfLines={1}>
                  {t('proyectoPantalla.reportes')}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button"
                onPress={() => setActiveTab('operacion')}
                style={[styles.tabBtn, activeTab === 'operacion' && styles.tabBtnActive]}
              >
                <Ionicons
                  name="construct-outline"
                  size={16}
                  color={activeTab === 'operacion' ? '#fff' : colors.text}
                />
                <Text style={[styles.tabTxt, activeTab === 'operacion' && styles.tabTxtActive]} numberOfLines={1}>
                  {t('proyectoPantalla.operacion')}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button"
                onPress={() => setActiveTab('configuracion')}
                style={[styles.tabBtn, activeTab === 'configuracion' && styles.tabBtnActive]}
              >
                <Ionicons
                  name="settings-outline"
                  size={16}
                  color={activeTab === 'configuracion' ? '#fff' : colors.text}
                />
                <Text style={[styles.tabTxt, activeTab === 'configuracion' && styles.tabTxtActive]} numberOfLines={1}>
                  {t('proyectoPantalla.configuracion')}
                </Text>
              </Pressable>
            </View>
          </View>

          {activeTab === 'reportes' ? (
            /* ===== TAB 1: REPORTES - feed limpio (filtros + busqueda + tarjetas) + herramientas de reportes + resumen IA ===== */
            <FlatList
              data={filteredReports}
              keyExtractor={(r) => r.id}
              renderItem={({ item }) => <ReportFeedItem report={item} onPress={handleFeedItemPress} />}
              onEndReached={loadMoreFeed}
              onEndReachedThreshold={0.4}
              contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
              ListHeaderComponent={
                <>
                  {/* Boton GRANDE: Exportar Reportes (PDF / Word / PPT / Excel) _ arriba de los filtros a peticion del Coord. General */}
                  <Pressable accessibilityRole="button"
                    onPress={openExportFlow}
                    disabled={exportBusy}
                    style={({ pressed }) => [
                      styles.exportMainBtn,
                      { marginBottom: spacing.md },
                      exportBusy && { opacity: 0.55 },
                      pressed && !exportBusy && { opacity: 0.92 },
                    ]}
                  >
                    {exportBusy ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Ionicons name="download-outline" size={22} color="#fff" />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.exportMainTitle}>{t('proyectoPantalla.exportarReportes')}</Text>
                      <Text style={styles.exportMainSub}>
                        {exportBusy ? t('proyectoPantalla.generandoArchivo') : t('proyectoPantalla.pdfWordPowerpointExcel')}
                      </Text>
                    </View>
                    {!exportBusy && (
                      <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
                    )}
                  </Pressable>

                  {/* Killer Feature . Resumen Ejecutivo con IA */}
                  <Pressable accessibilityRole="button"
                    onPress={openAiSummary}
                    disabled={aiBusy}
                    style={({ pressed }) => [
                      styles.aiBtn,
                      { marginBottom: spacing.md },
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
                      <Text style={styles.aiBtnTitle}>{t('proyectoPantalla.generarResumenEjecutivoConIa')}</Text>
                      <Text style={styles.aiBtnSub}>
                        {aiBusy ? t('proyectoPantalla.analizandoReportesDelDia') : t('proyectoPantalla.avancesActividadesPersonalYNoticias')}
                      </Text>
                    </View>
                    {!aiBusy && (
                      <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" />
                    )}
                  </Pressable>

                  {(nodes.length > 0 || areas.length > 0 || reports.length > 0) ? (
                  <>
                    <View style={styles.chipWrap}>
                      <Text style={styles.chipTitle}>{t('proyectoPantalla.filtrarActividad')}</Text>

                      {/* Fila 1: Tiempo + Calendario */}
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipRow}
                      >
                        {([
                          { k: 'today', l: 'Hoy', i: 'today-outline' },
                          { k: 'week', l: 'Semana', i: 'calendar-outline' },
                          { k: 'month', l: 'Mes', i: 'calendar-clear-outline' },
                          { k: 'all', l: 'Todo', i: 'apps-outline' },
                        ] as const).map((t) => {
                          const active = selectedTimeFilter === t.k && !selectedDate;
                          return (
                            <Pressable accessibilityRole="button"
                              key={t.k}
                              onPress={() => {
                                setSelectedDate(null);
                                setSelectedTimeFilter(t.k);
                              }}
                              style={[styles.chip, active && styles.chipActive]}
                            >
                              <Ionicons
                                name={t.i as any}
                                size={14}
                                color={active ? '#fff' : colors.text}
                              />
                              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                {t.l}
                              </Text>
                            </Pressable>
                          );
                        })}

                        {/* Boton Calendario */}
                        <Pressable accessibilityRole="button"
                          onPress={() => setCalendarOpen(true)}
                          style={[styles.chip, !!selectedDate && styles.chipActive]}
                        >
                          <Ionicons
                            name="calendar"
                            size={14}
                            color={selectedDate ? '#fff' : colors.text}
                          />
                          <Text style={[styles.chipText, !!selectedDate && styles.chipTextActive]}>
                            {selectedDate || t('proyectoPantalla.calendario')}
                          </Text>
                          {selectedDate && (
                            <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} hitSlop={8} onPress={() => setSelectedDate(null)} style={{ marginLeft: 4 }}>
                              <Ionicons name="close-circle" size={14} color="#fff" />
                            </Pressable>
                          )}
                        </Pressable>
                      </ScrollView>

                      {/* Fila: Filtros rapidos por estatus */}
                      <View style={[styles.chipRow, { marginTop: 8 }]}>
                        <Pressable accessibilityRole="button"
                          onPress={() => setSelectedStatusFilter((s) => (s === 'incidencia' ? null : 'incidencia'))}
                          style={[styles.chip, selectedStatusFilter === 'incidencia' && styles.chipActive]}
                        >
                          <Ionicons
                            name="alert-circle-outline"
                            size={14}
                            color={selectedStatusFilter === 'incidencia' ? '#fff' : colors.text}
                          />
                          <Text style={[styles.chipText, selectedStatusFilter === 'incidencia' && styles.chipTextActive]}>
                            {t('proyectoPantalla.conIncidencia')}
                          </Text>
                        </Pressable>
                        <Pressable accessibilityRole="button"
                          onPress={() => setSelectedStatusFilter((s) => (s === 'avance' ? null : 'avance'))}
                          style={[styles.chip, selectedStatusFilter === 'avance' && styles.chipActive]}
                        >
                          <Ionicons
                            name="trending-up-outline"
                            size={14}
                            color={selectedStatusFilter === 'avance' ? '#fff' : colors.text}
                          />
                          <Text style={[styles.chipText, selectedStatusFilter === 'avance' && styles.chipTextActive]}>
                            {t('proyectoPantalla.avance')}
                          </Text>
                        </Pressable>
                      </View>

                      {/* Filtro por semaforo de gravedad */}
                      <View style={{ marginTop: 8, marginHorizontal: -16 }}>
                        <GravedadFiltro valor={gravedadFiltro} onChange={setGravedadFiltro} />
                      </View>

                      {/* Barra de busqueda: texto libre por nodo o autor (debounce 350ms) */}
                      <View style={styles.searchBar}>
                        <Ionicons name="search-outline" size={16} color="#6B7280" />
                        <TextInput
                          value={searchQuery}
                          onChangeText={setSearchQuery}
                          placeholder={t('proyectoPantalla.buscarPorNodoOAutor')}
                          placeholderTextColor="#6B7280"
                          style={styles.searchInput}
                          returnKeyType="search"
                        />
                        {!!searchQuery && (
                          <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} onPress={() => setSearchQuery('')} hitSlop={8}>
                            <Ionicons name="close-circle" size={16} color="#6B7280" />
                          </Pressable>
                        )}
                      </View>

                      {/* Fila 2: Nodos / Tramos */}
                      {nodes.length > 0 && (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={[styles.chipRow, { marginTop: 8 }]}
                        >
                          <Pressable accessibilityRole="button"
                            onPress={() => setSelectedNodeFilter(null)}
                            style={[styles.chip, !selectedNodeFilter && styles.chipActive]}
                          >
                            <Ionicons
                              name="apps-outline"
                              size={14}
                              color={!selectedNodeFilter ? '#fff' : colors.text}
                            />
                            <Text style={[styles.chipText, !selectedNodeFilter && styles.chipTextActive]}>
                              {t('proyectoPantalla.todosN', { n: feedTotal })}
                            </Text>
                          </Pressable>
                          {nodes.map((n) => {
                            const active = selectedNodeFilter === n;
                            return (
                              <Pressable accessibilityRole="button"
                                key={`node-${n}`}
                                onPress={() => setSelectedNodeFilter(active ? null : n)}
                                style={[styles.chip, active && styles.chipActive]}
                              >
                                <Ionicons
                                  name="location-outline"
                                  size={14}
                                  color={active ? '#fff' : colors.text}
                                />
                                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                  {n}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                      )}

                      {/* Fila 2: Areas / Disciplinas */}
                      {areas.length > 0 && (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={[styles.chipRow, { marginTop: 8 }]}
                        >
                          <Pressable accessibilityRole="button"
                            onPress={() => setSelectedAreaFilter(null)}
                            style={[styles.chip, !selectedAreaFilter && styles.chipActive]}
                          >
                            <Ionicons
                              name="grid-outline"
                              size={14}
                              color={!selectedAreaFilter ? '#fff' : colors.text}
                            />
                            <Text style={[styles.chipText, !selectedAreaFilter && styles.chipTextActive]}>
                              {t('proyectoPantalla.todasAreasN', { n: feedTotal })}
                            </Text>
                          </Pressable>
                          {areas.map((a) => {
                            const active = selectedAreaFilter === a;
                            return (
                              <Pressable accessibilityRole="button"
                                key={`area-${a}`}
                                onPress={() => setSelectedAreaFilter(active ? null : a)}
                                style={[styles.chip, active && styles.chipActive]}
                              >
                                <Ionicons
                                  name="construct-outline"
                                  size={14}
                                  color={active ? '#fff' : colors.text}
                                />
                                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                  {a}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                      )}
                    </View>

                    <Text style={styles.sectionTitle}>{t('proyectoPantalla.reportesRecientes')}</Text>
                  </>
                  ) : null}
                </>
              }
              ListEmptyComponent={
                feedInitialLoading ? (
                  <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
                ) : (
                  <ReportesVacio
                    variante="coord"
                    hayFiltros={!!(selectedNodeFilter || selectedAreaFilter || selectedStatusFilter || selectedDate || selectedTimeFilter !== 'all')}
                    busqueda={debouncedSearch}
                    onQuitarFiltros={() => {
                      setSelectedNodeFilter(null);
                      setSelectedAreaFilter(null);
                      setSelectedStatusFilter(null);
                      setSelectedDate(null);
                      setSelectedTimeFilter('all');
                      setSearchQuery('');
                    }}
                    onInvitar={() => router.push({ pathname: '/(coord)/projects/[id]/invitations' as any, params: { id: pid } })}
                  />
                )
              }
              ListFooterComponent={
                feedLoadingMore ? (
                  <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
                ) : !feedHasMore && reports.length > 0 ? (
                  <Text style={styles.feedMore}>{t('proyectoPantalla.hasLlegadoAlFinalDel')}</Text>
                ) : null
              }
            />
          ) : activeTab === 'operacion' ? (
            /* ===== TAB 2: OPERACION - modulos, fuerza laboral, costos y accesos operativos diarios ===== */
            <ScrollView
              contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
            >
              {/* Módulos piloto del sistema Multi-Proyecto Modular — solo
                  aparecen si el Coordinador los encendió para este proyecto
                  (ver pestaña Configuracion > Módulos). */}
              <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
                {/* Los módulos se agrupan por el Área que el Coordinador les
                    asignó en Configuración > Módulos (project.modulos_areas),
                    igual que el hub de Módulos de Sub-Coordinador/Especialista.
                    Sin áreas asignadas queda la lista plana de siempre. */}
                {gruposModulos.length === 1 && gruposModulos[0].areaId === SIN_AREA_ID ? (
                  gruposModulos[0].modulos.map(tileModulo)
                ) : (
                  gruposModulos.map((g) => {
                    const cerrado = !!modulosAreaCerrada[g.areaId];
                    return (
                      <View key={g.areaId} style={{ gap: spacing.sm }}>
                        <Pressable accessibilityRole="button"
                          onPress={() => setModulosAreaCerrada((c) => ({ ...c, [g.areaId]: !c[g.areaId] }))}
                          style={styles.moduloAreaHeader}
                        >
                          <View style={[styles.moduloAreaDot, { backgroundColor: g.color || colors.primary }]} />
                          <Text style={styles.moduloAreaTitle} numberOfLines={1}>{g.nombre}</Text>
                          <Text style={styles.moduloAreaCount}>{g.modulos.length}</Text>
                          <Ionicons name={cerrado ? 'chevron-down' : 'chevron-up'} size={16} color={colors.textMuted} />
                        </Pressable>
                        {cerrado ? null : g.modulos.map(tileModulo)}
                      </View>
                    );
                  })
                )}
                {/* Fuerza de Trabajo no es un módulo apagable (MODULOS_KEYS) —
                    siempre disponible, con la misma presentación de tile que
                    los módulos de arriba en vez de quedar siempre expandida
                    en esta pantalla (ver fuerza-de-trabajo.tsx). */}
                <ActionTile
                  icon="checkbox-outline"
                  title="Asistencia"
                  subtitle="Quién reportó hoy, con hora y ubicación; resumen semanal y mensual"
                  onPress={() => router.push({ pathname: '/(coord)/projects/[id]/asistencia' as any, params: { id: pid } })}
                />
                <ActionTile
                  icon="ribbon-outline"
                  title="Capacidades de Operadores"
                  subtitle="Certificaciones, constancias y aptitud de cada operador y equipo"
                  onPress={() => router.push({ pathname: '/(coord)/projects/[id]/capacidades' as any, params: { id: pid } })}
                />
                <ActionTile
                  icon="people-outline"
                  title={t('proyectoPantalla.fuerzaDeTrabajo')}
                  subtitle={t('proyectoPantalla.personalYMaquinariaDerivadosDe')}
                  onPress={() => router.push({ pathname: '/(coord)/projects/[id]/fuerza-de-trabajo' as any, params: { id: pid } })}
                />
              </View>

              {/* Clima de la zona del proyecto */}
              <WeatherWidget projectId={pid} nodes={flatNodes} />

              {/* Metas Diarias */}
              <DailyGoalsPanel projectId={pid} />

              {/* Control de Costos (EVM) */}
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                <ActionTile
                  icon="stats-chart-outline"
                  title={t('proyectoPantalla.controlDeCostosEvm')}
                  subtitle={t('proyectoPantalla.valorGanadoSpiCpiCurva')}
                  onPress={() => router.push({ pathname: '/(coord)/projects/[id]/dashboard' as any, params: { id: pid } })}
                />
                <ActionTile
                  icon="create-outline"
                  title={t('proyectoPantalla.registrarAvance')}
                  subtitle={t('proyectoPantalla.capturaDiariaEnCampoCuanto')}
                  onPress={() => router.push({ pathname: '/(coord)/projects/[id]/registrar-avance' as any, params: { id: pid } })}
                />
                <ActionTile
                  icon="easel-outline"
                  title={t('proyectoPantalla.presentacion')}
                  subtitle={t('proyectoPantalla.informeDeActividadesSemanalPreview')}
                  onPress={() => router.push({ pathname: '/(coord)/projects/[id]/presentacion' as any, params: { id: pid } })}
                />
                <ActionTile
                  icon="bar-chart-outline"
                  title={t('proyectoPantalla.visualizarAvance')}
                  subtitle={t('proyectoPantalla.reporteDeAvancePorPeriodo')}
                  onPress={() => router.push({ pathname: '/(coord)/projects/[id]/visualizar-avance' as any, params: { id: pid } })}
                />
                <ActionTile
                  icon="map-outline"
                  title={t('proyectoPantalla.planoDeAvance')}
                  subtitle={t('proyectoPantalla.marcadoresDeEstadoSobrePlanos')}
                  onPress={() => router.push({ pathname: '/(coord)/projects/[id]/plano-avance' as any, params: { id: pid } })}
                />
                <ActionTile
                  icon="shield-checkmark-outline"
                  title={t('proyectoPantalla.accesoAlPredio')}
                  subtitle={t('proyectoPantalla.estatusDeAccesoYSituacion')}
                  onPress={() => router.push({ pathname: '/(coord)/projects/[id]/acceso-predio', params: { id: pid } })}
                />
                {/* Generales y Por Ubicación son tabs de la misma pantalla. */}
                <ActionTile
                  icon="reader-outline"
                  title={t('proyectoPantalla.actividadesGenerales')}
                  subtitle={t('proyectoPantalla.actividadesSinNodoAsociadoNotas')}
                  onPress={() => router.push({ pathname: '/(coord)/projects/[id]/actividades-generales' as any, params: { id: pid, nivel: 'GENERAL' } })}
                />
              </View>
            </ScrollView>
          ) : (
            /* ===== TAB 3: CONFIGURACION - administracion del proyecto ===== */
            <ScrollView
              contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.card}>
                <ResumenProyecto project={project} />
              </View>

              <Text style={styles.sectionTitle}>{t('proyectoPantalla.configuracionDelProyecto')}</Text>

              {/* Hub del sistema Multi-Proyecto Modular — primer tile a
                  propósito: es donde se encienden/apagan Forestal y
                  Arbolado, Seguridad e Higiene, etc. para este proyecto (sin
                  esto quedan invisibles en el menú de Sub-Coord/Especialista). */}
              <ActionTile
                icon="apps-outline"
                title={t('proyectoPantalla.modulos')}
                subtitle={t('proyectoPantalla.enciendeApagaForestalYArbolado')}
                onPress={() => router.push({ pathname: '/(coord)/projects/[id]/modulos' as any, params: { id: pid } })}
              />
              {esCoordGeneral ? (
                <ActionTile
                  icon="construct-outline"
                  title={t('tipoObra.titulo')}
                  subtitle={t('proyectoPantalla.tipoObraTileSub')}
                  onPress={() => setTipoObraOpen(true)}
                />
              ) : null}
              <ActionTile
                icon="construct-outline"
                title="Creador de módulos"
                subtitle="Crea tus propios módulos: campos, interruptores y cómo se imprimen en cada informe"
                onPress={() => router.push({ pathname: '/(coord)/projects/[id]/modulos-personalizados' as any, params: { id: pid } })}
              />
              <ActionTile
                icon="git-network-outline"
                title={t('proyectoPantalla.arbolDeNodos')}
                subtitle={t('proyectoPantalla.estructuraEspacialRecursivaTramosEstaciones')}
                onPress={() => router.push({ pathname: '/(coord)/projects/[id]/tree', params: { id: pid } })}
              />
              <ActionTile
                icon="color-palette-outline"
                title={t('proyectoPantalla.areasDisciplinas')}
                subtitle={t('proyectoPantalla.topografiaGeotecniaEstructuras')}
                onPress={() => router.push({ pathname: '/(coord)/projects/[id]/areas', params: { id: pid } })}
              />
              <ActionTile
                icon="mail-outline"
                title={t('proyectoPantalla.invitaciones')}
                subtitle={t('proyectoPantalla.generaTokensParaSubCoord')}
                onPress={() => router.push({ pathname: '/(coord)/projects/[id]/invitations', params: { id: pid } })}
              />
              <ActionTile
                icon="color-palette-outline"
                title={t('proyectoPantalla.identidadInstitucional')}
                subtitle={t('proyectoPantalla.objetoDelContratoClientePrincipal')}
                onPress={openObjetoModal}
              />
              <ActionTile
                icon="document-text-outline"
                title="Datos de contrato"
                subtitle="Obra y supervisión . Montos . Periodo . Anticipo (slide del informe PPTX)"
                onPress={() => setContratoModalOpen(true)}
              />
              <ActionTile
                icon="people-outline"
                title={t('proyectoPantalla.personal')}
                subtitle={t('proyectoPantalla.gestionaCategoriasYRolesDel')}
                onPress={() => router.push({ pathname: '/(coord)/projects/[id]/personal', params: { id: pid } })}
              />
              <ActionTile
                icon="construct-outline"
                title={t('proyectoPantalla.equipo')}
                subtitle={t('proyectoPantalla.inventarioDetalladoMarcaModeloSerie')}
                onPress={() => router.push({ pathname: '/(coord)/projects/[id]/equipo', params: { id: pid } })}
              />
              <ActionTile
                icon="document-attach-outline"
                title={t('proyectoPantalla.plantillasDeExportacion')}
                subtitle={t('proyectoPantalla.pdfRecomendadoWordPowerpointMapa')}
                onPress={() => setTplModalOpen(true)}
              />
              <ActionTile
                icon="list-outline"
                title="Indice de informes"
                subtitle="Orden y titulos de las secciones del PDF/PPTX . Diario, Semanal y Mensual"
                onPress={() => router.push({ pathname: '/(coord)/projects/[id]/indice' as any, params: { id: pid } })}
              />
              <ActionTile
                icon="images-outline"
                title={t('proyectoPantalla.datosGenerales')}
                subtitle={
                  gdCount > 0
                    ? gdCount === 1 ? t('proyectoPantalla.imagenUnaDetalle') : t('proyectoPantalla.imagenesDetalle', { n: gdCount })
                    : t('proyectoPantalla.subeImagenesPresupuestoProgramaPlanos')
                }
                onPress={() => { setGdModalOpen(true); loadGeneralDataImages(); }}
              />
              <ActionTile
                icon="calendar-outline"
                title={t('proyectoPantalla.eventosDelProyecto')}
                subtitle={t('proyectoPantalla.programaVisitasHitosYReuniones')}
                onPress={() => router.push({ pathname: '/(coord)/projects/[id]/events' as any, params: { id: pid } })}
              />
              {/* ===== Catalogo de Conceptos (consulta/administracion — Registrar y
                  Visualizar avance viven en la pestaña Operacion, no aqui) ===== */}
              <Text style={styles.sectionTitle}>{t('proyectoPantalla.catalogoDeConceptos')}</Text>
              <ActionTile
                icon="albums-outline"
                title={t('proyectoPantalla.catalogoDeConceptos2')}
                subtitle={t('proyectoPantalla.partidasYConceptosConsultaAdministracion')}
                onPress={() => router.push({ pathname: '/(coord)/projects/[id]/catalogo-conceptos' as any, params: { id: pid } })}
              />
              <ActionTile
                icon="options-outline"
                title={t('proyectoPantalla.configuracionDelCatalogo')}
                subtitle={t('proyectoPantalla.tipoDeContratoAvanceEn')}
                onPress={openCatalogoConfigModal}
              />
              <ProgramaObraSection projectId={pid} zona={project as any} />

              {/* ===== Archivos de Consulta ===== */}
              <Text style={styles.sectionTitle}>{t('proyectoPantalla.archivosDeConsulta')}</Text>
              <View style={styles.refCard}>
                <Text style={styles.refHelp}>
                  {t('proyectoPantalla.subeDocumentosExcelCsvDe')}
                </Text>

                {(project.reference_files || []).length === 0 ? (
                  <View style={styles.refEmpty}>
                    <Ionicons name="folder-open-outline" size={20} color={colors.textMuted} />
                    <Text style={styles.refEmptyTxt}>{t('proyectoPantalla.aunNoHayArchivosCompartidos')}</Text>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    {(project.reference_files || []).map((f, idx) => {
                      const key = f.file_id || `${f.url}-${idx}`;
                      const opening = !!(f.file_id && refOpeningId === f.file_id);
                      const subtitle = f.file_id
                        ? unir([f.original_name, formatBytes(f.size)])
                        : f.url;
                      return (
                        <View key={key} style={styles.refItem}>
                          <Ionicons
                            name={f.file_id ? 'document-attach-outline' : 'link-outline'}
                            size={18}
                            color={colors.primary}
                          />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.refItemName} numberOfLines={1}>{f.name}</Text>
                            {!!subtitle && (
                              <Text style={styles.refItemUrl} numberOfLines={1}>{subtitle}</Text>
                            )}
                          </View>
                          <Pressable accessibilityRole="button"
                            onPress={() => onOpenRefFile(f)}
                            hitSlop={6}
                            style={styles.refIconBtn}
                            disabled={opening || refBusy}
                            accessibilityLabel={t('proyectoPantalla.abrirArchivo', { nombre: f.name })}
                          >
                            {opening ? (
                              <ActivityIndicator size="small" color={colors.primary} />
                            ) : (
                              <Ionicons
                                name={f.file_id ? 'cloud-download-outline' : 'open-outline'}
                                size={18}
                                color={colors.primary}
                              />
                            )}
                          </Pressable>
                          <Pressable accessibilityRole="button"
                            onPress={() => onRemoveRefFile(idx)}
                            hitSlop={6}
                            style={styles.refIconBtn}
                            disabled={refBusy}
                            accessibilityLabel={t('proyectoPantalla.eliminarArchivo', { nombre: f.name })}
                          >
                            <Ionicons name="trash-outline" size={18} color={colors.error} />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}

                <Pressable
                  onPress={onPickAndUploadFile}
                  disabled={refBusy}
                  style={({ pressed }) => [
                    styles.refAddBtn,
                    refBusy && { opacity: 0.85 },
                    pressed && !refBusy && { opacity: 0.85 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('proyectoPantalla.seleccionarArchivoParaSubir')}
                >
                  {refBusy ? (
                    <>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.refAddBtnTxt} numberOfLines={1}>
                        {refUploadName ? t('proyectoPantalla.subiendoNombre', { nombre: refUploadName }) : t('proyectoPantalla.subiendoArchivo')}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                      <Text style={styles.refAddBtnTxt}>{t('proyectoPantalla.seleccionarArchivo')}</Text>
                    </>
                  )}
                </Pressable>
                <Text style={styles.refHint}>
                  {t('proyectoPantalla.formatosExcelXlsxXlsCsv')}
                </Text>
              </View>

              <Pressable accessibilityRole="button" onPress={onArchive} style={styles.archiveBtn}>
                <Ionicons name="archive-outline" size={16} color={colors.error} />
                <Text style={styles.archiveText}>{t('proyectoPantalla.archivarProyecto')}</Text>
              </Pressable>
            </ScrollView>
          )}
        </>
      )}

      {/* ===== Modal de Exportacion: Periodo -> Formato ===== */}
      <Modal
        visible={exportOpen}
        animationType="slide"
        transparent
        onRequestClose={closeExportFlow}
      >
        <Pressable style={styles.exportBackdrop} onPress={closeExportFlow} />
        <View style={styles.exportSheet} pointerEvents="box-none">
          {/* maxHeight + ScrollView interno en cada paso (ver mas abajo) —
              mismo patron que los demas modales de esta pantalla (ver
              sheetSurface con maxHeight '85%'/'88%'/'90%'). Sin esto, con
              muchas areas configuradas la lista del Paso 2 se salia del
              cuadro y las ultimas quedaban imposibles de tocar. */}
          <View style={[styles.exportSheetInner, { maxHeight: '80%' }]}>
            <View style={styles.exportHandle} />

            <View style={styles.exportHeader}>
              {exportStep === 'period' ? (
                <View style={styles.exportBack} />
              ) : (
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')}
                  onPress={() => {
                    if (exportBusy) return;
                    if (exportStep === 'format') setExportStep('area');
                    else if (exportStep === 'area') setExportStep('period');
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
                    ? t('proyectoPantalla.exportarReportes')
                    : exportStep === 'area'
                    ? t('proyectoPantalla.filtrarPorArea')
                    : t('proyectoPantalla.elegirFormato')}
                </Text>
                <Text style={styles.exportSubtitle}>
                  {exportStep === 'period'
                    ? t('proyectoPantalla.paso1De3Selecciona')
                    : exportStep === 'area'
                    ? t('proyectoPantalla.paso2Periodo', { periodo: PERIOD_OPTIONS.find((p) => p.value === exportPeriod)?.label ?? etiquetaPeriodoPersonalizado(exportPeriod) })
                    : t('proyectoPantalla.paso3Area', { area: exportAreaId ? exportAreas.find((a) => a.id === exportAreaId)?.name ?? t('proyectoPantalla.areaSola') : t('proyectoPantalla.todasLasAreas') })}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
                onPress={closeExportFlow}
                disabled={exportBusy}
                hitSlop={10}
                style={styles.exportBack}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.exportSteps}>
              <View style={[styles.exportStepDot, styles.exportStepDotActive]} />
              <View style={[styles.exportStepBar, (exportStep === 'area' || exportStep === 'format') && styles.exportStepBarActive]} />
              <View
                style={[
                  styles.exportStepDot,
                  (exportStep === 'area' || exportStep === 'format') && styles.exportStepDotActive,
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
                    <Pressable accessibilityRole="button"
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
                <Pressable accessibilityRole="button"
                  onPress={() => setRangoExportOpen(true)}
                  style={({ pressed }) => [
                    styles.exportItem,
                    !!decodificarPeriodoPersonalizado(exportPeriod) && styles.exportItemActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={[styles.exportItemIcon, { backgroundColor: '#EEF2FF' }]}>
                    <Ionicons name="calendar-outline" size={20} color="#1E3A8A" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exportItemTitle}>{t('exportar.rangoPersonalizado')}</Text>
                    <Text style={styles.exportItemSub}>{t('exportar.rangoPersonalizadoSub')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </Pressable>
                <RangoFechasPicker
                  visible={rangoExportOpen}
                  desdeInicial={null}
                  hastaInicial={null}
                  onCancelar={() => setRangoExportOpen(false)}
                  onConfirmar={(desde, hasta) => { setRangoExportOpen(false); onPickPeriod(codificarPeriodoPersonalizado(desde, hasta)); }}
                />
              </View>
            ) : exportStep === 'area' ? (
              <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                <Pressable accessibilityRole="button"
                  onPress={() => onPickArea(null)}
                  style={({ pressed }) => [
                    styles.exportItem,
                    exportAreaId === null && styles.exportItemActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={[styles.exportItemIcon, { backgroundColor: '#EEF2FF' }]}>
                    <Ionicons name="apps-outline" size={20} color="#1E3A8A" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exportItemTitle}>{t('proyectoPantalla.todasLasAreas2')}</Text>
                    <Text style={styles.exportItemSub}>{t('proyectoPantalla.incluyeTodosLosReportesImportantes')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </Pressable>
                {exportAreas.length === 0 ? (
                  <Text style={[styles.exportBusyHint, { marginTop: 12 }]}>
                    {t('proyectoPantalla.esteProyectoAunNoTiene')}
                  </Text>
                ) : (
                  exportAreas.map((a) => (
                    <Pressable accessibilityRole="button"
                      key={a.id}
                      onPress={() => onPickArea(a.id)}
                      style={({ pressed }) => [
                        styles.exportItem,
                        exportAreaId === a.id && styles.exportItemActive,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <View
                        style={[
                          styles.exportItemIcon,
                          { backgroundColor: (a.color || '#1E3A8A') + '22' },
                        ]}
                      >
                        <Ionicons name="grid-outline" size={20} color={a.color || '#1E3A8A'} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.exportItemTitle}>{a.name}</Text>
                        <Text style={styles.exportItemSub}>{t('proyectoPantalla.soloReportesDelAreaSeleccionada')}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    </Pressable>
                  ))
                )}
              </ScrollView>
            ) : (
              <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                {exportSinReportes ? (
                  <SinReportesAviso
                    otros={exportSinReportes.otros}
                    onCambiarPeriodo={() => { setExportSinReportes(null); setExportStep('period'); }}
                    onExportarDeTodosModos={() => onPickFormat(exportSinReportes.fmt, true)}
                  />
                ) : null}
                {FORMAT_OPTIONS.map((opt) => (
                  <Pressable accessibilityRole="button"
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
                    {t('proyectoPantalla.generandoArchivoEnElServidor')}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ===== Modal Calendario Historico (Sprint 2) ===== */}
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

      {/* ===== Modal: Preview de Reporte (componente compartido) ===== */}
      <ReportPreviewSheet
        visible={!!previewItem}
        item={previewItem}
        project={project}
        onClose={() => setPreviewItem(null)}
        onGravedadChange={(id, g) => setReports((prev) => prev.map((r) => (r.id === id ? { ...r, gravedad: g } : r)))}
      />

      {/* ===== Modal: Resumen Ejecutivo con IA ===== */}
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

      {/* ===== Modal: Contrato y Catalogos (P0 Mega-Feature) ===== */}
      <Modal
        visible={catModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => !catSaving && setCatModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
          style={styles.exportBackdrop}
        >
          <Pressable accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => !catSaving && setCatModalOpen(false)} />
          <View style={[styles.exportSheet, styles.sheetSurface, { maxHeight: '85%' }]}>
            <View style={styles.exportHandle} />
            <View style={styles.exportHeader}>
              <View style={styles.exportBack} />
              <View style={{ flex: 1 }}>
                <Text style={styles.exportTitle}>{t('proyectoPantalla.contratoYCatalogos')}</Text>
                <Text style={styles.exportSubtitle}>
                  {t('proyectoPantalla.configuraElObjetoDelContrato')}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
                onPress={() => !catSaving && setCatModalOpen(false)}
                hitSlop={10}
                style={styles.exportBack}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.md }}
            >
              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.categoriasDePersonal')}</Text>
                <Text style={styles.catHelper}>
                  {t('proyectoPantalla.rolesDisponiblesAlCapturarUn')}
                </Text>
                <View style={styles.catChipsWrap}>
                  {catPersonalList.map((it, idx) => (
                    <View key={`${it}-${idx}`} style={styles.catChip}>
                      <Text style={styles.catChipTxt}>{it}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
                        onPress={() => setCatPersonalList((arr) => arr.filter((x) => x !== it))}
                        hitSlop={6}
                      >
                        <Ionicons name="close" size={14} color="#1E3A8A" />
                      </Pressable>
                    </View>
                  ))}
                  {catPersonalList.length === 0 && (
                    <Text style={styles.catEmpty}>{t('proyectoPantalla.aunNoHayCategoriasAgrega')}</Text>
                  )}
                </View>
                <View style={styles.catInputRow}>
                  <TextInput
                    value={catPersonalDraft}
                    onChangeText={setCatPersonalDraft}
                    onSubmitEditing={addCatPersonal}
                    placeholder={t('proyectoPantalla.nuevaCategoriaDePersonal')}
                    placeholderTextColor={colors.textMuted}
                    style={styles.catInput}
                    returnKeyType="done"
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} hitSlop={8} onPress={addCatPersonal} style={styles.catAddBtn}>
                    <Ionicons name="add" size={20} color="#fff" />
                  </Pressable>
                </View>
              </View>

              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.categoriasDeEquipo')}</Text>
                <Text style={styles.catHelper}>
                  {t('proyectoPantalla.equipoDisponibleAlCapturarUn')}
                </Text>
                <View style={styles.catChipsWrap}>
                  {catEquipoList.map((it, idx) => (
                    <View key={`${it}-${idx}`} style={styles.catChip}>
                      <Text style={styles.catChipTxt}>{it}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
                        onPress={() => setCatEquipoList((arr) => arr.filter((x) => x !== it))}
                        hitSlop={6}
                      >
                        <Ionicons name="close" size={14} color="#1E3A8A" />
                      </Pressable>
                    </View>
                  ))}
                  {catEquipoList.length === 0 && (
                    <Text style={styles.catEmpty}>{t('proyectoPantalla.aunNoHayCategoriasAgrega')}</Text>
                  )}
                </View>
                <View style={styles.catInputRow}>
                  <TextInput
                    value={catEquipoDraft}
                    onChangeText={setCatEquipoDraft}
                    onSubmitEditing={addCatEquipo}
                    placeholder={t('proyectoPantalla.nuevaCategoriaDeEquipo')}
                    placeholderTextColor={colors.textMuted}
                    style={styles.catInput}
                    returnKeyType="done"
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} hitSlop={8} onPress={addCatEquipo} style={styles.catAddBtn}>
                    <Ionicons name="add" size={20} color="#fff" />
                  </Pressable>
                </View>
              </View>

              <Pressable accessibilityRole="button"
                onPress={saveCatalogos}
                disabled={catSaving}
                style={({ pressed }) => [
                  styles.catSaveBtn,
                  catSaving && { opacity: 0.6 },
                  pressed && !catSaving && { opacity: 0.9 },
                ]}
              >
                {catSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save-outline" size={18} color="#fff" />
                    <Text style={styles.catSaveTxt}>{t('proyectoPantalla.guardarConfiguracion')}</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===== Modal: Configuracion del Catalogo de Conceptos / avance (Etapas 1 y 4) ===== */}
      <Modal
        visible={catalogoConfigModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => !catalogoConfigSaving && setCatalogoConfigModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
          style={styles.exportBackdrop}
        >
          <Pressable accessibilityRole="button"
            style={StyleSheet.absoluteFill}
            onPress={() => !catalogoConfigSaving && setCatalogoConfigModalOpen(false)}
          />
          <View style={[styles.exportSheet, styles.sheetSurface, { maxHeight: '90%' }]}>
            <View style={styles.exportHandle} />
            <View style={styles.exportHeader}>
              <View style={styles.exportBack} />
              <View style={{ flex: 1 }}>
                <Text style={styles.exportTitle}>{t('proyectoPantalla.configuracionDelCatalogo')}</Text>
                <Text style={styles.exportSubtitle}>
                  {t('proyectoPantalla.tipoDeContratoFormaDe')}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
                onPress={() => !catalogoConfigSaving && setCatalogoConfigModalOpen(false)}
                hitSlop={10}
                style={styles.exportBack}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.md }}
            >
              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.tipoDeContrato')}</Text>
                <Text style={styles.catHelper}>
                  {t('proyectoPantalla.precioAlzadoAyuda')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {([
                    { v: 'PRECIOS_UNITARIOS' as const, label: t('proyectoPantalla.preciosUnitarios') },
                    { v: 'PRECIO_ALZADO' as const, label: t('proyectoPantalla.precioAlzado') },
                  ]).map((o) => {
                    const active = tipoContratoDraft === o.v;
                    return (
                      <Pressable accessibilityRole="button" key={o.v} onPress={() => setTipoContratoDraft(o.v)} style={[styles.chip, active && styles.chipActive]}>
                        <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.capturaDeAvance')}</Text>
                <Text style={styles.catHelper}>
                  {t('proyectoPantalla.capturaPorcentajeAyuda')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {([
                    { v: 'CANTIDAD' as const, label: t('proyectoPantalla.cantidad') },
                    { v: 'PORCENTAJE' as const, label: t('proyectoPantalla.porcentaje') },
                    { v: 'MATRIZ' as const, label: t('proyectoPantalla.matriz') },
                  ]).map((o) => {
                    const active = modoAvanceDraft === o.v;
                    return (
                      <Pressable accessibilityRole="button" key={o.v} onPress={() => setModoAvanceDraft(o.v)} style={[styles.chip, active && styles.chipActive]}>
                        <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.cadenciaDeReporte')}</Text>
                <Text style={styles.catHelper}>
                  {t('proyectoPantalla.soloControlaComoSeAgrupan')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {([
                    { v: 'DIARIA' as const, label: t('proyectoPantalla.diaria') },
                    { v: 'SEMANAL' as const, label: t('proyectoPantalla.semanal') },
                    { v: 'MENSUAL' as const, label: t('proyectoPantalla.mensual') },
                  ]).map((o) => {
                    const active = cadenciaDraft === o.v;
                    return (
                      <Pressable accessibilityRole="button" key={o.v} onPress={() => setCadenciaDraft(o.v)} style={[styles.chip, active && styles.chipActive]}>
                        <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {cadenciaDraft === 'SEMANAL' ? (
                <View>
                  <Text style={styles.catLabel}>{t('proyectoPantalla.diaDeInicioDeSemana')}</Text>
                  <Text style={styles.catHelper}>
                    {t('proyectoPantalla.ejSiElInformeDe')}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {(['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'] as const).map((d) => {
                      const active = diaInicioSemanaDraft === d;
                      return (
                        <Pressable accessibilityRole="button" key={d} onPress={() => setDiaInicioSemanaDraft(d)} style={[styles.chip, active && styles.chipActive]}>
                          <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>
                            {d.charAt(0) + d.slice(1).toLowerCase()}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              <View>
                <Text style={styles.catLabel}>{t('numeros.separadorTitulo')}</Text>
                <Text style={styles.catHelper}>{t('numeros.separadorAyuda')}</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {([['.', t('numeros.separadorPunto')], [',', t('numeros.separadorComa')]] as const).map(([valor, etiqueta]) => {
                    const active = separadorDecimalDraft === valor;
                    return (
                      <Pressable
                        accessibilityRole="button" accessibilityState={{ selected: active }}
                        key={valor} onPress={() => setSeparadorDecimalDraft(valor)}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>{etiqueta}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View>
                <Text style={styles.catLabel}>{t('zona.titulo')}</Text>
                <Text style={styles.catHelper}>{t('zona.ayuda')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {ZONAS_HORARIAS_MX.map((z) => {
                    const active = zonaHorariaDraft === z.id;
                    return (
                      <Pressable
                        accessibilityRole="button" accessibilityState={{ selected: active }}
                        key={z.id} onPress={() => setZonaHorariaDraft(z.id)}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Text style={{ color: active ? colors.textInverse : colors.text, fontWeight: '700', fontSize: 12 }}>{z.etiqueta}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View>
                <Text style={styles.catLabel}>{t('turnoNocturno.titulo')}</Text>
                <Text style={styles.catHelper}>{t('turnoNocturno.ayuda')}</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    value={turnoNocturnoInicioDraft}
                    onChangeText={setTurnoNocturnoInicioDraft}
                    placeholder={t('turnoNocturno.inicio')}
                    accessibilityLabel={t('turnoNocturno.inicio')}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    style={[styles.catInput, { flex: 1 }]}
                  />
                  <TextInput
                    value={turnoNocturnoFinDraft}
                    onChangeText={setTurnoNocturnoFinDraft}
                    placeholder={t('turnoNocturno.fin')}
                    accessibilityLabel={t('turnoNocturno.fin')}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    style={[styles.catInput, { flex: 1 }]}
                  />
                </View>
              </View>

              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.nombresDeNivelDePartida')}</Text>
                <Text style={styles.catHelper}>
                  {t('proyectoPantalla.nombresNivelAyuda')}
                </Text>
                <View style={styles.catChipsWrap}>
                  {nombresNivelesDraft.map((it, idx) => (
                    <View key={`${it}-${idx}`} style={styles.catChip}>
                      <Text style={styles.catChipTxt}>{idx + 1}. {it}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
                        onPress={() => setNombresNivelesDraft((arr) => arr.filter((_, i) => i !== idx))}
                        hitSlop={6}
                      >
                        <Ionicons name="close" size={14} color="#1E3A8A" />
                      </Pressable>
                    </View>
                  ))}
                  {nombresNivelesDraft.length === 0 && (
                    <Text style={styles.catEmpty}>{t('proyectoPantalla.sinConfigurarSeUsaEl')}</Text>
                  )}
                </View>
                <View style={styles.catInputRow}>
                  <TextInput
                    value={nombreNivelPartidaDraft}
                    onChangeText={(v) => { setNombreNivelPartidaDraft(v); setNombreNivelError(null); }}
                    onSubmitEditing={addNombreNivel}
                    placeholder={t('proyectoPantalla.nivelEjemplo', { n: nombresNivelesDraft.length + 1 })}
                    placeholderTextColor={colors.textMuted}
                    style={styles.catInput}
                    returnKeyType="done"
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} hitSlop={8} onPress={addNombreNivel} style={styles.catAddBtn}>
                    <Ionicons name="add" size={20} color="#fff" />
                  </Pressable>
                </View>
                <InlineError message={nombreNivelError} style={{ marginTop: 6 }} />
                {nombresNivelesDraft.length > 0 ? (
                  <Text style={styles.catHelper}>{t('proyectoPantalla.generoAyuda')}</Text>
                ) : null}
                {nombresNivelesDraft.map((nombre) => (
                  <SelectorGeneroNivel
                    key={`genero-${nombre}`}
                    nombre={nombre}
                    valor={generoDe(generosDraft, nombre)}
                    onChange={(g) => setGenerosDraft((m) => ponerGenero(m, nombre, g))}
                  />
                ))}
              </View>

              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.nombreDelNivelHojaConcepto')}</Text>
                <TextInput
                  value={nombreNivelConceptoDraft}
                  onChangeText={(v) => {
                    setGenerosDraft((m) => migrarGenero(m, claveDeConcepto(nombreNivelConceptoDraft), claveDeConcepto(v)));
                    setNombreNivelConceptoDraft(v);
                  }}
                  placeholder={t('proyectoPantalla.concepto')}
                  placeholderTextColor={colors.textMuted}
                  style={styles.catInput}
                />
                <SelectorGeneroNivel
                  nombre={nombreNivelConceptoDraft.trim() || t('proyectoPantalla.concepto')}
                  valor={generoDe(generosDraft, claveDeConcepto(nombreNivelConceptoDraft))}
                  onChange={(g) => setGenerosDraft((m) => ponerGenero(m, claveDeConcepto(nombreNivelConceptoDraft), g))}
                />
              </View>

              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.tituloDelModuloDeCatalogo')}</Text>
                <Text style={styles.catHelper}>
                  {t('proyectoPantalla.apareceEnLaPantallaEl')}
                </Text>
                <TextInput
                  value={tituloModuloDraft}
                  onChangeText={setTituloModuloDraft}
                  placeholder={t('proyectoPantalla.catalogoDeConceptos')}
                  placeholderTextColor={colors.textMuted}
                  style={styles.catInput}
                />
              </View>

              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.unidadesPersonalizadas')}</Text>
                <Text style={styles.catHelper}>
                  {t('proyectoPantalla.seSumanAlCatalogoBase')}
                </Text>
                <View style={styles.catChipsWrap}>
                  {unidadesPersonalizadasDraft.map((it, idx) => (
                    <View key={`${it}-${idx}`} style={styles.catChip}>
                      <Text style={styles.catChipTxt}>{it}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
                        onPress={() => setUnidadesPersonalizadasDraft((arr) => arr.filter((x) => x !== it))}
                        hitSlop={6}
                      >
                        <Ionicons name="close" size={14} color="#1E3A8A" />
                      </Pressable>
                    </View>
                  ))}
                  {unidadesPersonalizadasDraft.length === 0 && (
                    <Text style={styles.catEmpty}>{t('proyectoPantalla.ningunaAdicionalConfigurada')}</Text>
                  )}
                </View>
                <View style={styles.catInputRow}>
                  <TextInput
                    value={unidadPersonalizadaDraftTxt}
                    onChangeText={(v) => { setUnidadPersonalizadaDraftTxt(v); setUnidadPersonalizadaError(null); }}
                    onSubmitEditing={addUnidadPersonalizada}
                    placeholder={t('proyectoPantalla.ejLoteViaje')}
                    placeholderTextColor={colors.textMuted}
                    style={styles.catInput}
                    autoCapitalize="characters"
                    returnKeyType="done"
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} hitSlop={8} onPress={addUnidadPersonalizada} style={styles.catAddBtn}>
                    <Ionicons name="add" size={20} color="#fff" />
                  </Pressable>
                </View>
                <InlineError message={unidadPersonalizadaError} style={{ marginTop: 6 }} />
              </View>

              <Button
                label={t('proyectoPantalla.guardarConfiguracion')}
                loading={catalogoConfigSaving}
                onPress={() => saveCatalogoConfig()}
                disabled={catalogoConfigSaving}
                fullWidth
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <DatosContratoModal
        visible={contratoModalOpen}
        project={project}
        onClose={() => setContratoModalOpen(false)}
        onSaved={(upd) => setProject((p) => ({ ...(p || ({} as any)), ...upd }))}
      />

      {/* ===== Modal: Identidad institucional (objeto + cliente + color) ===== */}
      <Modal
        visible={objetoModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => !objetoSaving && setObjetoModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
          style={styles.exportBackdrop}
        >
          <Pressable accessibilityRole="button"
            style={StyleSheet.absoluteFill}
            onPress={() => !objetoSaving && setObjetoModalOpen(false)}
          />
          <View style={[styles.exportSheet, styles.sheetSurface, { maxHeight: '88%' }]}>
            <View style={styles.exportHandle} />
            <View style={styles.exportHeader}>
              <View style={styles.exportBack} />
              <View style={{ flex: 1 }}>
                <Text style={styles.exportTitle}>{t('proyectoPantalla.identidadInstitucional')}</Text>
                <Text style={styles.exportSubtitle}>
                  {t('proyectoPantalla.estosDatosAparecenEnLas')}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
                onPress={() => !objetoSaving && setObjetoModalOpen(false)}
                hitSlop={10}
                style={styles.exportBack}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.md }}
            >
              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.clientePrincipal')}</Text>
                <Text style={styles.catHelper}>
                  {t('proyectoPantalla.dependenciaOEntidadQueContrata')}
                </Text>
                <TextInput
                  value={clienteDraft}
                  onChangeText={setClienteDraft}
                  placeholder={t('proyectoPantalla.ejGobiernoDeLaCiudad')}
                  placeholderTextColor={colors.textMuted}
                  style={styles.catInput}
                />
              </View>

              <View>
                <Text style={styles.catLabel}>Grupos de WhatsApp (IDs)</Text>
                <Text style={styles.catHelper}>
                  Grupos a los que se envía cada reporte de obra publicado en este proyecto (fotos + texto). Formato
                  120363XXXXXXXXXX@g.us. Para varios grupos, escribe un ID por línea (o separados por coma).
                  Déjalo vacío para no enviar a WhatsApp.
                </Text>
                <TextInput
                  value={whatsappGroupDraft}
                  onChangeText={setWhatsappGroupDraft}
                  placeholder={'120363430765044545@g.us\n120363111111111111@g.us'}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  style={[styles.catInput, { minHeight: 84, textAlignVertical: 'top' }]}
                />
              </View>

              <ColorInput
                label={t('proyectoPantalla.colorInstitucionalRrggbb')}
                ayuda="Color principal usado en banners, tablas, botones y acentos de toda la app y los reportes exportados."
                value={colorInstitucionalDraft}
                onChange={setColorInstitucionalDraft}
                editable={!objetoSaving}
              />
              <ColorInput
                label={t('proyectoPantalla.colorDelTituloDePortada')}
                ayuda={'Color del título grande en la portada del Informe exportado (PDF/PPTX Diario/Semanal/Mensual). No afecta banners ni tablas: usa "Color institucional" para eso.'}
                value={colorDraft}
                onChange={setColorDraft}
                editable={!objetoSaving}
              />
              <ColorInput
                label={t('proyectoPantalla.colorDelTextoDeObservaciones')}
                ayuda="Color del pie de foto (observaciones) que acompaña cada imagen en los reportes ejecutivos PDF/PPTX."
                value={reportTextColorDraft}
                onChange={setReportTextColorDraft}
                placeholder={COLOR_TEXTO_REPORTE_DEFECTO}
                editable={!objetoSaving}
              />

              <View>
                <Text style={styles.catLabel}>{t('proyectoPantalla.objetoDelContrato')}</Text>
                <Text style={styles.catHelper}>
                  {t('proyectoPantalla.descripcionInstitucionalDelAlcanceDel')}
                </Text>
                <TextInput
                  value={objetoDraft}
                  onChangeText={setObjetoDraft}
                  placeholder={t('proyectoPantalla.ejSupervisionTecnicaDeLa')}
                  placeholderTextColor={colors.textMuted}
                  multiline
                  style={[styles.catInput, { minHeight: 90, textAlignVertical: 'top', paddingTop: 10 }]}
                />
              </View>

              <InlineError message={objetoError} />

              <Pressable accessibilityRole="button"
                onPress={saveObjeto}
                disabled={objetoSaving}
                style={({ pressed }) => [
                  styles.catSaveBtn,
                  objetoSaving && { opacity: 0.7 },
                  pressed && !objetoSaving && { opacity: 0.85 },
                ]}
              >
                {objetoSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save-outline" size={18} color="#fff" />
                    <Text style={styles.catSaveTxt}>{t('proyectoPantalla.guardarIdentidad')}</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===== Modal: Datos Generales (imagenes multiples) ===== */}
      <Modal
        visible={gdModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => gdBusy === null && setGdModalOpen(false)}
      >
        <Pressable
          style={styles.exportBackdrop}
          onPress={() => gdBusy === null && setGdModalOpen(false)}
        />
        <View style={[styles.exportSheet, styles.sheetSurface, { maxHeight: '88%' }]}>
          <View style={styles.exportHandle} />
          <View style={styles.exportHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
              style={styles.exportBack}
              onPress={() => gdBusy === null && setGdModalOpen(false)}
              hitSlop={10}
            >
              <Ionicons name="chevron-down" size={22} color={colors.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.exportTitle}>{t('proyectoPantalla.datosGenerales')}</Text>
              <Text style={styles.exportSubtitle}>
                {t('proyectoPantalla.subeImagenesPresupuestoProgramaPlanos2')}
              </Text>
            </View>
          </View>
          <ScrollView
            style={{ marginTop: 12 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable accessibilityRole="button"
              onPress={onAddGeneralDataImages}
              disabled={gdBusy !== null}
              style={({ pressed }) => ({
                marginHorizontal: 20,
                marginBottom: 16,
                paddingVertical: 16,
                borderRadius: radius.md,
                backgroundColor: gdBusy === 'add' ? '#94A3B8' : colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                opacity: pressed ? 0.9 : 1,
                ...shadow.card,
              })}
            >
              {gdBusy === 'add' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="add-circle" size={22} color="#fff" />
              )}
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
                {gdBusy === 'add' ? t('proyectoPantalla.subiendo2') : t('proyectoPantalla.agregarImagenEs')}
              </Text>
            </Pressable>
            {gdImagesLoading && !gdImagesFetched ? (
              <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : gdImages.length === 0 ? (
              <View style={{ paddingHorizontal: 24, paddingVertical: 30, alignItems: 'center' }}>
                <Ionicons name="images-outline" size={48} color={colors.textMuted} />
                <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 10, fontSize: 15 }}>
                  {t('proyectoPantalla.aunNoHasSubidoImagenes')}
                </Text>
                <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 4, fontSize: 12 }}>
                  {t('proyectoPantalla.maximo5MbPorImagen')}
                </Text>
                {/* Boton secundario redundante para no perder el CTA en el empty-state */}
                <Pressable accessibilityRole="button"
                  onPress={onAddGeneralDataImages}
                  disabled={gdBusy !== null}
                  style={({ pressed }) => ({
                    marginTop: 22,
                    paddingHorizontal: 22,
                    paddingVertical: 12,
                    borderRadius: radius.md,
                    borderWidth: 1.5,
                    borderColor: colors.primary,
                    backgroundColor: pressed ? 'rgba(0,51,102,0.06)' : 'transparent',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  })}
                >
                  <Ionicons name="cloud-upload-outline" size={20} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 15 }}>
                    {t('proyectoPantalla.elegirDeGaleria')}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {gdImages.map((src, idx) => (
                  <View
                    key={idx}
                    style={{
                      width: '48%',
                      backgroundColor: colors.surface,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: colors.border,
                      overflow: 'hidden',
                    }}
                  >
                    <Image
                      source={{ uri: src }}
                      style={{ width: '100%', aspectRatio: 16 / 10, backgroundColor: '#F1F5F9' }}
                      resizeMode="cover"
                    />
                    <TextInput
                      value={gdNames[idx] ?? ''}
                      onChangeText={(t) => setGdNames((arr) => {
                        const next = gdImages.map((_, i) => arr[i] ?? '');
                        next[idx] = t;
                        return next;
                      })}
                      onEndEditing={(e) => onSaveGeneralDataNames(idx, e.nativeEvent.text)}
                      placeholder={`Nombre (indice) . Datos generales ${idx + 1}`}
                      placeholderTextColor={colors.textMuted}
                      maxLength={120}
                      style={{
                        marginHorizontal: 8, marginTop: 8, paddingHorizontal: 8, paddingVertical: 6,
                        borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
                        fontSize: 13, color: colors.text, backgroundColor: colors.bg,
                      }}
                    />
                    <View style={{ padding: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.textMuted, fontSize: 12 }}>#{idx + 1}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')}
                        onPress={() => onDeleteGeneralDataImage(idx)}
                        disabled={gdBusy !== null}
                        hitSlop={8}
                      >
                        {gdBusy === idx ? (
                          <ActivityIndicator size="small" color="#EF4444" />
                        ) : (
                          <Ionicons name="trash-outline" size={18} color="#EF4444" />
                        )}
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ===== Modal: Plantillas de exportacion (PDF/DOCX/PPTX) ===== */}
      <Modal
        visible={tplModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => !tplBusyKind && setTplModalOpen(false)}
      >
        <Pressable
          style={styles.exportBackdrop}
          onPress={() => !tplBusyKind && setTplModalOpen(false)}
        />
        <View style={[styles.exportSheet, styles.sheetSurface, { maxHeight: '88%' }]}>
          <View style={styles.exportHandle} />
          <View style={styles.exportHeader}>
            <View style={styles.exportBack} />
            <View style={{ flex: 1 }}>
              <Text style={styles.exportTitle}>{t('proyectoPantalla.plantillasDeExportacion')}</Text>
              <Text style={styles.exportSubtitle}>
                {t('proyectoPantalla.subeFondosInstitucionalesQueSe')}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
              onPress={() => !tplBusyKind && setTplModalOpen(false)}
              hitSlop={10}
              style={styles.exportBack}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.md }}
          >
            <View style={styles.tplHelperBox}>
              <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.tplHelperTxt}>
                <Text style={{ fontWeight: '900' }}>{t('proyectoPantalla.modoSuperposicionPdf')}</Text>{t('proyectoPantalla.superposicionIntro')}{'\n'}
                · <Text style={{ fontWeight: '900' }}>{t('proyectoPantalla.pagina1')}</Text>{t('proyectoPantalla.pagina1Desc')}{'\n'}
                · <Text style={{ fontWeight: '900' }}>{t('proyectoPantalla.pagina2')}</Text>{t('proyectoPantalla.pagina2Desc')}{'\n'}
                · <Text style={{ fontWeight: '900' }}>{t('proyectoPantalla.pagina3')}</Text>{t('proyectoPantalla.pagina3Desc')}{'\n'}
                {t('proyectoPantalla.max25MbPorArchivo')}
              </Text>
            </View>

            {(['pdf', 'docx', 'pptx', 'map'] as const).map((kind) => {
              const meta =
                kind === 'pdf'
                  ? { label: t('proyectoPantalla.pdfPlantillaBase'), sub: t('proyectoPantalla.portadaPortadillaDeNodoBase'), icon: 'document-text' as const, tint: '#DC2626' }
                  : kind === 'docx'
                  ? { label: t('proyecto.plantillaWordOpcional'), sub: t('proyecto.plantillaWordDescripcion'), icon: 'document' as const, tint: '#1D4ED8' }
                  : kind === 'pptx'
                  ? { label: t('proyectoPantalla.powerpointOpcional'), sub: t('proyectoPantalla.seUsaComoBaseTal'), icon: 'easel' as const, tint: '#B45309' }
                  : { label: t('proyecto.mapaUbicacion'), sub: t('proyecto.mapaUbicacionDescripcion'), icon: 'map' as const, tint: '#059669' };
              const hasFile = !!(project as any)?.[`template_${kind}`];
              const busy = tplBusyKind === kind;
              return (
                <View key={kind} style={styles.tplCard}>
                  <View style={styles.tplCardTop}>
                    <View style={[styles.exportItemIcon, { backgroundColor: `${meta.tint}1A` }]}>
                      <Ionicons name={meta.icon} size={22} color={meta.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tplCardTitle}>{meta.label}</Text>
                      <Text style={styles.tplCardSub}>{meta.sub}</Text>
                      <View style={styles.tplStatusRow}>
                        <View
                          style={[
                            styles.tplStatusDot,
                            { backgroundColor: hasFile ? colors.success : colors.textMuted },
                          ]}
                        />
                        <Text
                          style={[
                            styles.tplStatusTxt,
                            { color: hasFile ? colors.success : colors.textMuted },
                          ]}
                        >
                          {hasFile ? t('proyectoPantalla.plantillaCargada') : t('proyectoPantalla.sinPlantillaDisenoDirac')}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.tplBtnRow}>
                    <Pressable accessibilityRole="button"
                      onPress={() => onPickAndUploadTemplate(kind)}
                      disabled={!!tplBusyKind}
                      style={({ pressed }) => [
                        styles.tplPrimaryBtn,
                        { backgroundColor: meta.tint },
                        !!tplBusyKind && { opacity: 0.55 },
                        pressed && !tplBusyKind && { opacity: 0.85 },
                      ]}
                    >
                      {busy ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Ionicons
                            name={hasFile ? 'refresh-outline' : 'cloud-upload-outline'}
                            size={16}
                            color="#fff"
                          />
                          <Text style={styles.tplPrimaryTxt}>
                            {hasFile ? t('proyectoPantalla.reemplazar') : t('proyectoPantalla.subirPlantilla')}
                          </Text>
                        </>
                      )}
                    </Pressable>
                    {hasFile && (
                      <Pressable accessibilityRole="button"
                        onPress={() => onDeleteTemplate(kind)}
                        disabled={!!tplBusyKind}
                        style={({ pressed }) => [
                          styles.tplGhostBtn,
                          !!tplBusyKind && { opacity: 0.55 },
                          pressed && !tplBusyKind && { opacity: 0.85 },
                        ]}
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                        <Text style={styles.tplGhostTxt}>{t('proyectoPantalla.eliminar')}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
      <TipoObraProyectoModal
        visible={tipoObraOpen && esCoordGeneral}
        project={project}
        onClose={() => setTipoObraOpen(false)}
        onProjectUpdated={(upd) => setProject((p) => ({ ...(p || ({} as any)), ...upd }))}
      />
    </View>
  );
}

function ActionTile({ icon, title, subtitle, disabled, comingSoon, onPress, busy, badge }: any) {
  return (
    <Pressable accessibilityRole="button"
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
          {comingSoon ? <Text style={styles.soonBadge}>{t('proyectoPantalla.proximamente')}</Text> : null}
        </View>
        <Text style={styles.tileSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function AiSummaryModal({
  visible,
  busy,
  summary,
  error,
  meta,
  copied,
  periodo,
  onClose,
  onRegenerate,
  onChangePeriodo,
  onCopy,
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
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} hitSlop={10} style={styles.exportBack}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 6, backgroundColor: '#F1F5F9', borderRadius: 10, margin: spacing.md, marginBottom: 0, padding: 3 }}>
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
                  <Text style={{ color: colors.primary, fontWeight: '800' }}>{t('proyectoPantalla.reintentar')}</Text>
                </Pressable>
              </View>
            ) : summary ? (
              <View style={{ gap: 12 }}>
                {meta && (
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                    <View style={{ backgroundColor: '#F0F9FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#BAE6FD' }}>
                      <Text style={{ fontSize: 10, color: '#0369A1', fontWeight: '800' }}>{t('proyectoPantalla.reportesHoyN', { n: meta.reports_count })}</Text>
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
                      pressed && { opacity: 0.9 }
                    ]}
                  >
                    <Ionicons name={copied ? "checkmark-circle" : "copy-outline"} size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{copied ? t('proyectoPantalla.copiado') : t('proyectoPantalla.copiarResumen')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('actualizar')} hitSlop={8}
                    onPress={onRegenerate}
                    style={({ pressed }) => [
                      { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary },
                      pressed && { backgroundColor: '#F0F7FF' }
                    ]}
                  >
                    <Ionicons name="refresh-outline" size={20} color={colors.primary} />
                  </Pressable>
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Button label={t('proyectoPantalla.cerrar')} variant="secondary" fullWidth onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  // ===== Tabs (Detalle / Resumen IA) =====
  tabBarWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  tabBtnActive: {
    backgroundColor: colors.primary,
    ...shadow.sm,
  },
  tabTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  tabTxtActive: {
    color: '#fff',
  },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md },
  errorText: { flex: 1, color: colors.error, fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  rowValue: { fontSize: 14, color: colors.text, fontWeight: '700' },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textBody, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.sm },
  moduloAreaHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 4, paddingTop: spacing.xs,
  },
  moduloAreaDot: { width: 10, height: 10, borderRadius: 5 },
  moduloAreaTitle: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  moduloAreaCount: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  tileIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  tileSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  soonBadge: { fontSize: 9, fontWeight: '800', color: colors.primary, backgroundColor: colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  archiveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: spacing.md, marginTop: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.errorBg },
  archiveText: { color: colors.error, fontSize: 13, fontWeight: '700' },

  // Archivos de Consulta
  refCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  refHelp: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  refEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
  },
  refEmptyTxt: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  refItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  refItemName: { fontSize: 13, fontWeight: '700', color: colors.text },
  refItemUrl: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  refIconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  refAddBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 12,
    borderRadius: radius.md, minHeight: 48, marginTop: 4,
  },
  refAddBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '800', flexShrink: 1 },
  refHint: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 2 },

  // === Exportacion (Boton + Modal en 2 pasos) ================================
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
  sheetSurface: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: undefined,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: (radius as any).xl ?? 20,
    borderTopRightRadius: (radius as any).xl ?? 20,
    paddingTop: 10,
    paddingBottom: 24,
    ...shadow.card,
  },
  exportSheetInner: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: (radius as any).xl ?? 20,
    borderTopRightRadius: (radius as any).xl ?? 20,
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
    borderRadius: (radius as any).full ?? 999,
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
    width: 40, height: 40, borderRadius: (radius as any).full ?? 999,
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

  // === Boton IA . Resumen Ejecutivo =========================================
  aiBtn: {
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
  aiBtnTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  aiBtnSub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },

  // === Filtro de tramos / areas (chips horizontales) ========================
  chipWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: 8,
  },
  chipTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 36,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  chipTextActive: {
    color: '#fff',
  },

  // ===== Barra de busqueda (feed) =====
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bg,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    paddingVertical: 8,
  },

  // ===== Feed de Reportes =====
  feedEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  feedEmptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedEmptyTxt: { color: '#6B7280', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  feedCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.md,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  feedThumb: {
    width: 76,
    height: 76,
    borderRadius: 16,
    backgroundColor: colors.bg,
  },
  feedThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  feedRowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  feedTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeTxt: { fontSize: 10, fontWeight: '800', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.3 },
  badgeIncidencia: { backgroundColor: '#DC2626' },
  badgeUrgente: { backgroundColor: '#DC2626' },
  badgeImportante: { backgroundColor: '#D97706' },
  feedMetaTxt: { flex: 1, fontSize: 12, fontWeight: '600', color: '#6B7280' },
  feedDate: { fontSize: 11, fontWeight: '600', color: '#6B7280' },
  feedRowMid: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  feedPath: { flex: 1, fontSize: 12, fontWeight: '500', color: '#6B7280' },
  feedRowVal: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  feedVal: { fontSize: 13, fontWeight: '800', color: colors.success },
  feedActividades: { fontSize: 12, color: colors.textBody, marginTop: 2, fontStyle: 'italic' },
  feedComment: { fontSize: 12, color: colors.textBody, lineHeight: 17, fontStyle: 'italic' },
  feedMore: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 4, fontStyle: 'italic' },

  // ===== Preview Modal (tap en feed) =====
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  previewCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: (radius as any).xl ?? 16,
    overflow: 'hidden',
    ...shadow.card,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  previewTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewMeta: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textBody },
  previewBlock: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: 10,
    gap: 4,
  },
  previewBlockTitle: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  previewBlockTxt: { fontSize: 13, color: colors.text, lineHeight: 18 },
  previewFooter: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  previewCloseBtn: {
    minHeight: 44,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  previewCloseTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },

  // ===== Estilos del modal Contrato y Catalogos (P0 Mega-Feature) =====
  catLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  catHelper: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  catTextArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 80,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 14,
  },
  catCounter: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'right',
  },
  catChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 6,
    minHeight: 30,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  catChipTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E3A8A',
  },
  catEmpty: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  catInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  catInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 14,
  },
  catAddBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  catSaveBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  catSaveTxt: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },

  // ===== Estilos: Modal de Plantillas de Exportacion (P0) =====
  tplHelperBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tplHelperTxt: {
    flex: 1,
    fontSize: 12,
    color: '#1E3A8A',
    lineHeight: 17,
    fontWeight: '600',
  },
  tplCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    gap: 10,
  },
  tplCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  tplCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  tplCardSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  tplStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  tplStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tplStatusTxt: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tplBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tplPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.md,
    minHeight: 44,
  },
  tplPrimaryTxt: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  tplGhostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
    minHeight: 44,
  },
  tplGhostTxt: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '800',
  },
});
