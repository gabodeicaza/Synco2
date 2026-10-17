/**
 * Shared preview/detail modal for a Report (FeedItem).
 * Used by:
 *  - Coordinador/Jefe (coord)
 *  - Sub-coordinador (subcoord)
 *  - Especialista (spec)
 *
 * Design tokens are inlined to guarantee a consistent, readable, white sheet
 * across all roles (avoids legacy theme/sheet conflicts).
 */
import React from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  View,
  Text,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { puedeEditarReporte, rutaEditarReporte } from '@/src/utils/reportEdit';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { api, type FeedItem, type Report, type Project, type ReportTemplate } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { formatMeasurementValue } from '@/src/utils/whatsapp';
import { fmtDateTimeCDMX } from '@/src/utils/tz';
import { buildReportShareText, formatDynamicValue } from '@/src/utils/reportText';
import { shareWithAutoRecover } from '@/src/utils/share';
import { showToast } from '@/src/utils/toast';
import { unirOVacio } from '@/src/utils/texto';
import { a11y, t } from '@/src/i18n';
import { GravedadDot } from '@/src/components/GravedadDot';

interface ReportPreviewSheetProps {
  visible: boolean;
  item: FeedItem | null;
  onClose: () => void;
  /** Datos del proyecto (constructora / no. de contrato) para el texto completo. */
  project?: Project | null;
  /** Optional share-via-WhatsApp callback. If omitted, the share button is hidden. */
  onShare?: (item: FeedItem) => void | Promise<void>;
  /** Cuando true, deshabilita el boton "Compartir" y muestra spinner. */
  sharing?: boolean;
  /** Se llama tras cambiar el semáforo de gravedad, para refrescar la tarjeta del Inicio. */
  onGravedadChange?: (id: string, gravedad: 'verde' | 'amarillo' | 'rojo') => void;
}

export function ReportPreviewSheet({
  visible,
  item,
  project,
  onClose,
  onShare,
  sharing = false,
  onGravedadChange,
}: ReportPreviewSheetProps) {
  const { user } = useAuth();
  // Defensive: tolerate legacy/alt field names from the backend.
  const it = (item ?? {}) as Record<string, any>;

  // --- Estado interno: edicion de descripciones individuales por foto ------
  const [editOpen, setEditOpen] = React.useState(false);
  const [loadingFull, setLoadingFull] = React.useState(false);
  const [savingCaps, setSavingCaps] = React.useState(false);
  const [fullReport, setFullReport] = React.useState<Report | null>(null);
  const [draftCaps, setDraftCaps] = React.useState<string[]>(['', '']);
  const [savingSev, setSavingSev] = React.useState(false);
  // Plantillas de reporte estructurado, para traducir `dynamic_data` (claves)
  // a las etiquetas legibles definidas en cada plantilla.
  const [reportTemplates, setReportTemplates] = React.useState<ReportTemplate[]>([]);

  // === Galeria completa de fotos (2026-07-06) =============================
  // El FeedItem solo trae `thumbnail_base64` (foto 0). Para mostrar TODAS
  // las fotos del reporte hacemos un fetch perezoso del `Report` completo
  // al abrir el modal.
  const [galleryImages, setGalleryImages] = React.useState<string[]>([]);
  const [galleryLoading, setGalleryLoading] = React.useState(false);
  const [galleryCaptions, setGalleryCaptions] = React.useState<string[]>([]);

  const reportId: string | null = (it.id as string) || null;

  React.useEffect(() => {
    let alive = true;
    if (!visible || !reportId) {
      setFullReport(null);
      setGalleryImages([]);
      setGalleryCaptions([]);
      return;
    }
    // Kick-off: cargar reporte completo para tener data + images + captions.
    setGalleryLoading(true);
    api
      .getReport(reportId)
      .then((full) => {
        if (!alive) return;
        setFullReport(full);
        setGalleryImages((full.images || []).filter(Boolean));
        setGalleryCaptions(full.photo_captions || []);
      })
      .catch(() => {
        // Fallback silencioso: si falla, quedamos con el thumbnail.
        if (!alive) return;
        setGalleryImages([]);
      })
      .finally(() => {
        if (alive) setGalleryLoading(false);
      });
    // Plantillas: solo para traducir claves de `dynamic_data` a etiquetas;
    // fallo silencioso (se muestran las claves crudas como respaldo).
    api
      .getReportTemplates()
      .then((tpls) => { if (alive) setReportTemplates(tpls || []); })
      .catch(() => { /* usa claves crudas como respaldo */ });
    return () => {
      alive = false;
    };
  }, [visible, reportId]);

  const openEditCaptions = React.useCallback(async () => {
    if (!reportId) return;
    setEditOpen(true);
    setLoadingFull(true);
    try {
      // Reutilizamos el reporte cargado por la galeria si ya esta en memoria.
      let full = fullReport;
      if (!full) {
        full = await api.getReport(reportId);
        setFullReport(full);
      }
      const caps = (full.photo_captions || []).slice(0, 2);
      const seed = [caps[0] || '', caps[1] || ''];
      setDraftCaps(seed);
    } catch (e: any) {
      Alert.alert(t('vistaPreviaReporte.noSeCargo'), e?.message || t('vistaPreviaReporte.reintentar'));
      setEditOpen(false);
    } finally {
      setLoadingFull(false);
    }
  }, [reportId, fullReport]);

  const saveCaptions = React.useCallback(async () => {
    if (!reportId || !fullReport) return;
    setSavingCaps(true);
    try {
      const totalImgs = (fullReport.images || []).length;
      // Enviamos solo tantas captions como fotos hay realmente (max 2).
      const send = draftCaps.slice(0, Math.min(2, totalImgs)).map((c) => (c || '').trim());
      const updated = await api.updateReportCaptions(reportId, send);
      setFullReport(updated);
      Alert.alert(t('vistaPreviaReporte.descripcionesGuardadas'), t('vistaPreviaReporte.descripcionesActualizadas'));
      setEditOpen(false);
    } catch (e: any) {
      Alert.alert(t('vistaPreviaReporte.errorGuardar'), e?.message || t('vistaPreviaReporte.noSeActualizo'));
    } finally {
      setSavingCaps(false);
    }
  }, [reportId, fullReport, draftCaps]);

  // Guarda la lista completa de severidades del reporte (selección múltiple:
  // p.ej. ["diario", "urgente"] para que aparezca en Diario Y en Mensual).
  const updateSeverity = React.useCallback(async (next: string[]) => {
    if (!reportId) return;
    setSavingSev(true);
    try {
      const updated = await api.updateReportSeverity(reportId, next);
      setFullReport(updated);
    } catch (e: any) {
      Alert.alert(t('vistaPreviaReporte.error'), e?.message || t('vistaPreviaReporte.noSeActualizoSeveridad'));
    } finally {
      setSavingSev(false);
    }
  }, [reportId]);

  // Semáforo de gravedad (verde / amarillo / rojo); mismos permisos que la severidad.
  const [savingGrav, setSavingGrav] = React.useState(false);
  const updateGravedad = React.useCallback(async (next: 'verde' | 'amarillo' | 'rojo') => {
    if (!reportId) return;
    setSavingGrav(true);
    try {
      const updated = await api.updateReportGravedad(reportId, next);
      setFullReport(updated);
      onGravedadChange?.(reportId, next);
    } catch (e: any) {
      Alert.alert(t('vistaPreviaReporte.error'), e?.message || t('vistaPreviaReporte.noSeActualizoSeveridad'));
    } finally {
      setSavingGrav(false);
    }
  }, [reportId, onGravedadChange]);

  // Use fullReport if loaded to get the most accurate data (including title keys).
  const source = (fullReport || it) as Record<string, any>;
  // Actividades con semáforo propio (reportes nuevos). Los anteriores solo traen texto.
  const actividadesItems: { texto: string; gravedad: 'verde' | 'amarillo' | 'rojo' }[] = (
    Array.isArray(source.actividades_items) ? source.actividades_items : []
  ).filter((a: any) => a && String(a.texto || '').trim())
    .map((a: any) => ({ texto: String(a.texto), gravedad: a.gravedad === 'amarillo' || a.gravedad === 'rojo' ? a.gravedad : 'verde' }));
  // Toca el punto de una actividad: verde → amarillo → rojo → verde.
  const cycleActividadGravedad = async (idx: number) => {
    if (!reportId || savingGrav) return;
    const orden = ['verde', 'amarillo', 'rojo'] as const;
    const next = actividadesItems.map((a) => a.gravedad) as ('verde' | 'amarillo' | 'rojo')[];
    next[idx] = orden[(orden.indexOf(next[idx]) + 1) % 3];
    setSavingGrav(true);
    try {
      const updated = await api.updateActividadesGravedad(reportId, next);
      setFullReport(updated);
      onGravedadChange?.(reportId, (updated.gravedad as any) || 'verde');
    } catch (e: any) {
      Alert.alert(t('vistaPreviaReporte.error'), e?.message || t('vistaPreviaReporte.noSeActualizoSeveridad'));
    } finally {
      setSavingGrav(false);
    }
  };
  const currentGravedad: string = source.gravedad === 'amarillo' || source.gravedad === 'rojo' ? source.gravedad : 'verde';

  // Lista de severidades vigentes del reporte (acepta datos legacy en los
  // que `severidad` llegaba como string único).
  const currentSeveridad: string[] = Array.isArray(source.severidad)
    ? source.severidad
    : source.severidad
    ? [source.severidad]
    : ['informativo'];

  // "Informativo" es excluyente: elegirlo limpia el resto. Los otros tres
  // (Diario/Semanal/Mensual) se pueden combinar libremente entre sí.
  function toggleSeverity(key: 'informativo' | 'diario' | 'importante' | 'urgente') {
    if (key === 'informativo') { updateSeverity(['informativo']); return; }
    const withoutInfo = currentSeveridad.filter((s) => s !== 'informativo');
    const next = withoutInfo.includes(key) ? withoutInfo.filter((s) => s !== key) : [...withoutInfo, key];
    updateSeverity(next.length ? next : ['informativo']);
  }

  // Edición de jerarquía habilitada en cualquier momento SOLO para: el autor
  // original del reporte, el Coordinador General y los Sub-coordinadores.
  // Jefe de Proyecto es de solo lectura y el resto de especialistas no puede
  // editar reportes ajenos (coincide con la autorización del backend en
  // `patch_report_severity`).
  const canEditSeverity =
    !!user &&
    (source.captured_by === user.id ||
      user.role === 'coordinador_general' ||
      user.role === 'sub_coordinador');

  // Edición completa: el autor, hasta 8 h después de capturar. Abre la pantalla de
  // captura con el reporte ya cargado.
  const rutaEditar = rutaEditarReporte(user?.role);
  const puedeEditarCompleto = !!rutaEditar && puedeEditarReporte(source as any, user?.id);
  const onEditarCompleto = React.useCallback(() => {
    if (!rutaEditar || !reportId) return;
    onClose();
    router.push({ pathname: rutaEditar, params: { editar_id: reportId, editar_ts: String(Date.now()) } } as any);
  }, [rutaEditar, reportId, onClose]);

  // Titulo: strictly check valid keys (title, nombre, titulo, name).
  // DO NOT use description/notes for title as they contain activities/observations.
  const title =
    (
      source.title ||
      source.nombre ||
      source.titulo ||
      source.name ||
      ''
    ).trim() || t('vistaPreviaReporte.sinTitulo');

  const path = unirOVacio(source.node_path_names || []);
  const author =
    source.captured_by_name ||
    source.user_name ||
    source.author_name ||
    t('vistaPreviaReporte.autorPorDefecto');
  const area = source.area_name || t('vistaPreviaReporte.sinArea');
  const created = fmtDateTimeCDMX(source.created_at);
  const photoUri: string | null = source.thumbnail_base64
    ? `data:image/jpeg;base64,${source.thumbnail_base64}`
    : source.foto || source.photo_url || null;

  const measurement = formatMeasurementValue(
    source.measurement_type,
    source.measurement_value || {},
  );
  const avance = source.avance ? String(source.avance) : '';
  const medicion = source.medicion ? String(source.medicion) : '';

  // === Datos especificos de la plantilla (formulario dinamico) ============
  // `dynamic_data` solo viene en el Report completo (no en el FeedItem del
  // feed), asi que depende de `fullReport`. Traducimos claves a etiquetas
  // usando la plantilla (`template_id`) cuando esta disponible.
  const dynamicData: Record<string, any> = fullReport?.dynamic_data || {};
  const usedTemplate = reportTemplates.find(
    (pl) => pl.id === (fullReport?.template_id || (source as any).template_id),
  ) || null;
  const dynamicEntries = Object.entries(dynamicData).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  const dynamicDataText = dynamicEntries
    .map(([k, v]) => {
      const label = usedTemplate?.fields.find((f) => f.key === k)?.label || k;
      return `${label}: ${formatDynamicValue(v)}`;
    })
    .join('\n');

  // Actividades & Observaciones (Separated in 2026-07)
  // [P0] Check activities, then activities_text, then activities, then description, then comment.
  const activitiesRaw = (
    source.actividades ||
    source.activities ||
    source.actividades_text ||
    source.actividad ||
    source.description ||
    source.descripcion ||
    source.comment ||
    source.notes ||
    ''
  ).toString().trim();
  const actividades = activitiesRaw.toLowerCase() === 'null' ? '' : activitiesRaw;

  const observationsRaw = (
    source.observaciones ||
    source.observacion ||
    source.observations ||
    ''
  ).toString().trim();
  const observaciones = observationsRaw.toLowerCase() === 'null' ? '' : observationsRaw;
  const hasActividades = actividades.length > 0;
  const hasObservaciones = observaciones.length > 0;

  // Cuantas fotos reales tiene el reporte (para decidir si mostrar boton).
  // Priorizamos el conteo REAL (galleryImages) cargado del reporte completo.
  const imagesCount: number =
    galleryImages.length > 0
      ? galleryImages.length
      : typeof source.images_count === 'number'
      ? source.images_count
      : source.thumbnail_base64
      ? 1
      : 0;

  // === Texto completo + acciones (Copiar / Compartir fotos) ===============
  const shareText = React.useMemo(
    () =>
      buildReportShareText(
        { ...source, dynamic_data: dynamicData } as any,
        { project, authorName: author, templateFields: usedTemplate?.fields },
      ),
    [source, project, author, dynamicData, usedTemplate],
  );

  const [sharingPhotos, setSharingPhotos] = React.useState(false);

  const onCopyText = React.useCallback(async () => {
    await Clipboard.setStringAsync(shareText);
    showToast(t('vistaPreviaReporte.textoCopiado'));
  }, [shareText]);

  const onSharePhotos = React.useCallback(async () => {
    if (sharingPhotos) return;
    setSharingPhotos(true);
    try {
      // Web: expo-sharing usa navigator.share (Web Share API, disponible por
      // HTTPS), asi que isAvailableAsync() SI puede dar true aqui -- pero el
      // resto de este flujo escribe cada foto a expo-file-system (inexistente
      // en web) antes de compartir. En vez de intentarlo y truenar, avisamos.
      if (Platform.OS === 'web') {
        Alert.alert(t('vistaPreviaReporte.noDisponibleWeb'), t('vistaPreviaReporte.compartirFotosWeb'));
        return;
      }

      const available = await Sharing.isAvailableAsync();
      if (!available) { Alert.alert(t('vistaPreviaReporte.noDisponible'), t('vistaPreviaReporte.compartirNoDisponible')); return; }

      let imgs = galleryImages;
      if (imgs.length === 0 && reportId) {
        try {
          const full = fullReport || (await api.getReport(reportId));
          imgs = (full.images || []).filter(Boolean);
        } catch { /* usa lo que haya */ }
      }
      if (imgs.length === 0 && photoUri) imgs = [photoUri];
      if (imgs.length === 0) { Alert.alert(t('vistaPreviaReporte.sinFotos'), t('vistaPreviaReporte.sinFotosDetalle')); return; }

      // expo-sharing solo admite una URI por invocacion: si hay varias fotos,
      // se comparten en secuencia (una hoja de compartir por foto).
      for (let i = 0; i < imgs.length; i++) {
        const raw = imgs[i].includes(',') ? imgs[i].split(',')[1] : imgs[i];
        const fileUri = `${FileSystem.cacheDirectory}reporte_${reportId || 'x'}_${i}.jpg`;
        await FileSystem.writeAsStringAsync(fileUri, raw, { encoding: FileSystem.EncodingType.Base64 });
        await shareWithAutoRecover(fileUri, {
          mimeType: 'image/jpeg',
          dialogTitle: imgs.length > 1 ? t('vistaPreviaReporte.compartirFotoDe', { i: i + 1, n: imgs.length }) : t('vistaPreviaReporte.compartirFoto'),
          UTI: 'public.jpeg',
        });
      }
    } catch (e: any) {
      Alert.alert(t('vistaPreviaReporte.error'), e?.message || t('vistaPreviaReporte.noSeComparti'));
    } finally {
      setSharingPhotos(false);
    }
  }, [sharingPhotos, galleryImages, reportId, fullReport, photoUri]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {/*
        Estructura anti-scroll-lock (2026-07-06):
        El backdrop DEBE ser un componente hermano al card, no un padre
        `Pressable` que envuelva todo. Cuando el backdrop envuelve la card,
        el sistema de gestos del `Pressable` puede interceptar los pans
        verticales del ScrollView y provocar que se "trabe" el scroll en
        dispositivos fisicos. Con esta separacion, el backdrop solo capta
        taps en los bordes; el card es un `View` normal y su ScrollView
        recibe todos los pans limpios.
      */}
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('vistaPreviaReporte.cerrarVistaPrevia')}
        />
        <View style={styles.card} pointerEvents="box-none">
          <View style={styles.cardInner}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {puedeEditarCompleto && (
                <Pressable accessibilityRole="button" accessibilityLabel={t('vistaPreviaReporte.editarReporte')} hitSlop={10} onPress={onEditarCompleto} style={{ marginRight: 14 }}>
                  <Ionicons name="create-outline" size={22} color="#1E40AF" />
                </Pressable>
              )}
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} hitSlop={10} onPress={onClose}>
                <Ionicons name="close" size={22} color="#0F172A" />
              </Pressable>
            </View>

            {/* Body */}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              bounces
            >
            {/* ===== Fecha (siempre hasta arriba) ===== */}
            <View style={styles.dateTopRow}>
              <Ionicons name="calendar-outline" size={15} color="#1E40AF" />
              <Text style={styles.dateTopTxt}>{created}</Text>
            </View>

            {/* ===== Severidad / Jerarquia (seleccion multiple) =====
                Editable en cualquier momento solo por: autor del reporte,
                Coordinador General y Sub-coordinadores (`canEditSeverity`).
                Para el resto se muestra como badges de solo lectura. */}
            {reportId && (
              <View style={styles.sevRowPreview}>
                <TouchableOpacity accessibilityRole="button"
                  disabled={!canEditSeverity}
                  onPress={() => toggleSeverity('informativo')}
                  style={[styles.sevBtnSmall, { borderColor: '#1E40AF' }, currentSeveridad.includes('informativo') && { backgroundColor: '#1E40AF' }, !canEditSeverity && { opacity: 0.6 }]}
                >
                  <Text style={[styles.sevBtnTxt, currentSeveridad.includes('informativo') ? { color: '#fff' } : { color: '#1E40AF' }]}>{t('vistaPreviaReporte.sevInformativo')}</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button"
                  disabled={!canEditSeverity}
                  onPress={() => toggleSeverity('diario')}
                  style={[styles.sevBtnSmall, { borderColor: '#10B981' }, currentSeveridad.includes('diario') && { backgroundColor: '#10B981' }, !canEditSeverity && { opacity: 0.6 }]}
                >
                  <Text style={[styles.sevBtnTxt, currentSeveridad.includes('diario') ? { color: '#fff' } : { color: '#10B981' }]}>{t('vistaPreviaReporte.sevDiario')}</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button"
                  disabled={!canEditSeverity}
                  onPress={() => toggleSeverity('importante')}
                  style={[styles.sevBtnSmall, { borderColor: '#D97706' }, currentSeveridad.includes('importante') && { backgroundColor: '#D97706' }, !canEditSeverity && { opacity: 0.6 }]}
                >
                  <Text style={[styles.sevBtnTxt, currentSeveridad.includes('importante') ? { color: '#fff' } : { color: '#D97706' }]}>{t('vistaPreviaReporte.sevSemanal')}</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button"
                  disabled={!canEditSeverity}
                  onPress={() => toggleSeverity('urgente')}
                  style={[styles.sevBtnSmall, { borderColor: '#DC2626' }, currentSeveridad.includes('urgente') && { backgroundColor: '#DC2626' }, !canEditSeverity && { opacity: 0.6 }]}
                >
                  <Text style={[styles.sevBtnTxt, currentSeveridad.includes('urgente') ? { color: '#fff' } : { color: '#DC2626' }]}>{t('vistaPreviaReporte.sevMensual')}</Text>
                </TouchableOpacity>
                {savingSev && <ActivityIndicator size="small" color="#1E40AF" />}
              </View>
            )}

            {/* ===== Gravedad (semaforo verde / amarillo / rojo) ===== */}
            {reportId && actividadesItems.length === 0 && (
              <View style={styles.sevRowPreview}>
                {([
                  ['verde', '#16A34A', t('nuevoReporte.gravedadVerde')],
                  ['amarillo', '#EAB308', t('nuevoReporte.gravedadAmarillo')],
                  ['rojo', '#DC2626', t('nuevoReporte.gravedadRojo')],
                ] as const).map(([key, color, label]) => (
                  <TouchableOpacity accessibilityRole="button" key={key}
                    disabled={!canEditSeverity}
                    onPress={() => updateGravedad(key)}
                    style={[styles.sevBtnSmall, { borderColor: color }, currentGravedad === key && { backgroundColor: color }, !canEditSeverity && { opacity: 0.6 }]}
                  >
                    <Text style={[styles.sevBtnTxt, currentGravedad === key ? { color: '#fff' } : { color }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
                {savingGrav && <ActivityIndicator size="small" color="#1E40AF" />}
              </View>
            )}

            {/* ===== Galeria completa de fotos (2026-07-06) ===== */}
            {galleryLoading && galleryImages.length === 0 ? (
              <View style={[styles.image, styles.imagePlaceholder]}>
                <ActivityIndicator color="#1E40AF" />
                <Text style={styles.imagePlaceholderTxt}>{t('vistaPreviaReporte.cargandoFotos')}</Text>
              </View>
            ) : galleryImages.length > 0 ? (
              <View style={{ gap: 10 }}>
                {galleryImages.map((b64, idx) => {
                  const cap = (galleryCaptions[idx] || '').trim();
                  const src = b64.startsWith('data:')
                    ? b64
                    : `data:image/jpeg;base64,${b64}`;
                  return (
                    <View key={`gal-${idx}`} style={styles.galleryItem}>
                      <Image
                        source={{ uri: src }}
                        style={styles.image}
                        resizeMode="cover"
                      />
                      <View style={styles.galleryBadge}>
                        <Text style={styles.galleryBadgeTxt}>
                          {idx + 1}/{galleryImages.length}
                        </Text>
                      </View>
                      {cap ? (
                        <Text style={styles.galleryCap} numberOfLines={4}>
                          {cap}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : photoUri ? (
              // Fallback: al menos la miniatura del feed si no se pudo
              // cargar el reporte completo.
              <Image
                source={{ uri: photoUri }}
                style={styles.image}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.image, styles.imagePlaceholder]}>
                <Ionicons name="image-outline" size={40} color="#94A3B8" />
                <Text style={styles.imagePlaceholderTxt}>{t('vistaPreviaReporte.sinFotoAdjunta')}</Text>
              </View>
            )}

            <Row icon="person-outline" text={author} />
            <Row icon="grid-outline" text={area} />
            <Row icon="location-outline" text={path} numberOfLines={3} />

            {measurement ? <Block title={t('vistaPreviaReporte.medicion')} body={measurement} /> : null}
            {avance ? <Block title={t('vistaPreviaReporte.avance')} body={avance} /> : null}
            {medicion && !measurement ? (
              <Block title={t('vistaPreviaReporte.medicion')} body={medicion} />
            ) : null}

            {/* Datos especificos de la plantilla elegida al capturar (si aplica). */}
            {dynamicEntries.length > 0 ? (
              <Block
                title={usedTemplate ? t('vistaPreviaReporte.datosPlantilla', { plantilla: usedTemplate.name }) : t('vistaPreviaReporte.datosReporte')}
                body={dynamicDataText}
              />
            ) : null}

            {/* Actividades & Observaciones: vital blocks for the field crew. */}
            {actividadesItems.length > 0 ? (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>{t('vistaPreviaReporte.actividades')}</Text>
                {actividadesItems.map((a, idx) => (
                  <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`${t('nuevoReporte.gravedadSemaforo')}: ${a.gravedad}`}
                      disabled={!canEditSeverity || savingGrav}
                      hitSlop={8}
                      onPress={() => cycleActividadGravedad(idx)}
                      style={{ paddingTop: 3 }}
                    >
                      <GravedadDot gravedad={a.gravedad} size={16} />
                    </TouchableOpacity>
                    <Text style={[styles.blockTxt, { flex: 1 }]}>{a.texto}</Text>
                  </View>
                ))}
                {canEditSeverity && (
                  <Text style={{ fontSize: 11, color: '#94A3B8' }}>{t('vistaPreviaReporte.tocaSemaforoActividad')}</Text>
                )}
                {savingGrav && <ActivityIndicator size="small" color="#1E40AF" />}
              </View>
            ) : (
              <Block
                title={t('vistaPreviaReporte.actividades')}
                body={hasActividades ? actividades : t('vistaPreviaReporte.sinActividades')}
                muted={!hasActividades}
              />
            )}

            <Block
              title={t('vistaPreviaReporte.observaciones')}
              body={hasObservaciones ? observaciones : t('vistaPreviaReporte.sinObservaciones')}
              muted={!hasObservaciones}
            />

            {/* Texto completo (el mismo que se copia / comparte abajo) ------ */}
            <Block title={t('vistaPreviaReporte.textoReporte')} body={shareText} />

            {/* CTA para editar descripciones individuales por foto ---------- */}
            {imagesCount > 0 && reportId ? (
              <Pressable accessibilityRole="button"
                onPress={openEditCaptions}
                style={({ pressed }) => [
                  styles.editCaptionsBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Ionicons name="create-outline" size={16} color="#1E40AF" />
                <Text style={styles.editCaptionsBtnTxt}>
                  {t('vistaPreviaReporte.editarDescripciones')}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <Pressable accessibilityRole="button"
                onPress={onCopyText}
                style={({ pressed }) => [styles.copyTextBtn, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="copy-outline" size={16} color="#1E40AF" />
                <Text style={styles.copyTextBtnTxt}>{t('vistaPreviaReporte.copiarTexto')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button"
                onPress={onSharePhotos}
                disabled={sharingPhotos}
                style={({ pressed }) => [
                  styles.copyTextBtn,
                  sharingPhotos && { opacity: 0.6 },
                  pressed && !sharingPhotos && { opacity: 0.85 },
                ]}
              >
                {sharingPhotos ? (
                  <ActivityIndicator size="small" color="#1E40AF" />
                ) : (
                  <Ionicons name="share-social-outline" size={16} color="#1E40AF" />
                )}
                <Text style={styles.copyTextBtnTxt}>
                  {sharingPhotos ? t('vistaPreviaReporte.compartiendo') : t('vistaPreviaReporte.compartirFotos')}
                </Text>
              </Pressable>
              {onShare ? (
                <Pressable accessibilityRole="button"
                  onPress={() => {
                    if (item && onShare && !sharing) {
                      onClose();
                      setTimeout(() => onShare(item), 220);
                    }
                  }}
                  disabled={sharing}
                  style={({ pressed }) => [
                    styles.waBtn,
                    sharing && { opacity: 0.6 },
                    pressed && !sharing && { opacity: 0.85 },
                  ]}
                  accessibilityLabel={t('vistaPreviaReporte.compartirWhatsapp')}
                  accessibilityState={{ disabled: sharing }}
                >
                  {sharing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" />
                  )}
                  <Text style={styles.waTxt}>
                    {sharing ? t('vistaPreviaReporte.compartiendo') : t('vistaPreviaReporte.compartir')}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.closeTxt}>{t('vistaPreviaReporte.cerrar')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      {/* Modal secundario: edicion de descripciones individuales por foto */}
      <EditCaptionsModal
        visible={editOpen}
        loading={loadingFull}
        saving={savingCaps}
        report={fullReport}
        draft={draftCaps}
        onChangeDraft={setDraftCaps}
        onClose={() => setEditOpen(false)}
        onSave={saveCaptions}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal secundario para editar `photo_captions` de un reporte existente.
// Muestra las 2 primeras fotos (tope duro de exportacion) con TextInput
// limitados a 160 chars (~4 lineas en PPTX/PDF).
// ---------------------------------------------------------------------------
function EditCaptionsModal({
  visible,
  loading,
  saving,
  report,
  draft,
  onChangeDraft,
  onClose,
  onSave,
}: {
  visible: boolean;
  loading: boolean;
  saving: boolean;
  report: Report | null;
  draft: string[];
  onChangeDraft: (next: string[]) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const images: string[] = (report?.images || []).slice(0, 2);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.editBackdrop} onPress={onClose}>
        <Pressable accessibilityRole="button" style={styles.editCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {t('vistaPreviaReporte.descripcionesFotos')}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} hitSlop={10} onPress={onClose}>
              <Ionicons name="close" size={22} color="#0F172A" />
            </Pressable>
          </View>

          {loading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator color="#1E40AF" />
              <Text style={{ marginTop: 8, fontSize: 12, color: '#64748B' }}>
                {t('vistaPreviaReporte.cargandoReporte')}
              </Text>
            </View>
          ) : !report || images.length === 0 ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', gap: 8 }}>
              <Ionicons name="image-outline" size={32} color="#94A3B8" />
              <Text style={{ fontSize: 13, color: '#64748B' }}>
                {t('vistaPreviaReporte.sinFotosReporte')}
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.editHint}>{t('vistaPreviaReporte.ayudaDescripciones')}</Text>

              {images.map((b64, i) => (
                <View key={`edit-${i}`} style={styles.editPhotoRow}>
                  <View style={styles.editIndexBadge}>
                    <Text style={styles.editIndexBadgeTxt}>{i + 1}</Text>
                  </View>
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${b64}` }}
                    style={styles.editThumb}
                    resizeMode="cover"
                  />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.editFieldLabel}>
                      {t('vistaPreviaReporte.descripcionFoto', { n: i + 1 })}
                    </Text>
                    <TextInput
                      placeholder={
                        i === 0
                          ? t('vistaPreviaReporte.descripcionPrimera')
                          : t('vistaPreviaReporte.descripcionSegunda')
                      }
                      placeholderTextColor="#94A3B8"
                      style={styles.editInput}
                      multiline
                      numberOfLines={4}
                      maxLength={160}
                      value={draft[i] || ''}
                      onChangeText={(v) => {
                        const next = [...draft];
                        while (next.length <= i) next.push('');
                        next[i] = v;
                        onChangeDraft(next);
                      }}
                    />
                    <Text style={styles.editCounter}>
                      {(draft[i] || '').length}/160
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <Pressable accessibilityRole="button"
              onPress={onClose}
              disabled={saving}
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: '#E2E8F0' },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeTxt, { color: '#0F172A' }]}>
                {t('vistaPreviaReporte.cancelar')}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              onPress={onSave}
              disabled={saving || loading || !report}
              style={({ pressed }) => [
                styles.closeBtn,
                (saving || loading || !report) && { opacity: 0.6 },
                pressed && { opacity: 0.85 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.closeTxt}>{t('vistaPreviaReporte.guardar')}</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function Row({
  icon,
  text,
  numberOfLines = 2,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  numberOfLines?: number;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={16} color="#64748B" />
      <Text style={styles.meta} numberOfLines={numberOfLines}>
        {text}
      </Text>
    </View>
  );
}

function Block({
  title,
  body,
  muted,
}: {
  title: string;
  body: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{title}</Text>
      <Text
        style={[
          styles.blockTxt,
          muted && { fontStyle: 'italic', color: '#94A3B8' },
        ]}
      >
        {body}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles _ inlined hex colors to avoid theme drift across roles.
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '92%',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  cardInner: {
    width: '100%',
    maxHeight: '100%',
    flexShrink: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  scroll: {
    backgroundColor: '#FFFFFF',
    flexShrink: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
    gap: 12,
    backgroundColor: '#FFFFFF',
  },
  image: {
    width: '100%',
    height: 250,
    borderRadius: 10,
    backgroundColor: '#DBEAFE',
  },
  galleryItem: {
    position: 'relative',
  },
  galleryBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(15,23,42,0.75)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  galleryBadgeTxt: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  galleryCap: {
    marginTop: 4,
    fontSize: 12,
    color: '#334155',
    lineHeight: 16,
    paddingHorizontal: 4,
  },
  imagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  imagePlaceholderTxt: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  meta: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  block: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 4,
  },
  blockTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  blockTxt: {
    fontSize: 14,
    color: '#0F172A',
    lineHeight: 20,
    // Garantiza salto de linea para textos largos.
    flexShrink: 1,
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  closeBtn: {
    flexGrow: 1,
    flexBasis: '48%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E40AF',
    borderRadius: 10,
  },
  closeTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  waBtn: {
    flexGrow: 1,
    flexBasis: '48%',
    flexDirection: 'row',
    minHeight: 44,
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    borderRadius: 10,
  },
  waTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  copyTextBtn: {
    flexGrow: 1,
    flexBasis: '48%',
    flexDirection: 'row',
    minHeight: 44,
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E40AF',
  },
  copyTextBtnTxt: { color: '#1E40AF', fontSize: 14, fontWeight: '800' },
  dateTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 4,
  },
  dateTopTxt: { color: '#1E40AF', fontSize: 13, fontWeight: '800' },

  // __ CTA para abrir el modal de edicion de captions __
  editCaptionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E40AF',
    borderStyle: 'dashed',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
  },
  editCaptionsBtnTxt: {
    color: '#1E40AF',
    fontWeight: '800',
    fontSize: 13,
  },

  // __ Modal secundario para editar captions __
  editBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  editCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  editHint: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
    lineHeight: 16,
  },
  editPhotoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
  },
  editIndexBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1E40AF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  editIndexBadgeTxt: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  editThumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: '#DBEAFE',
  },
  editFieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  editInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 14,
    color: '#0F172A',
    minHeight: 72,
    textAlignVertical: 'top',
  },
  editCounter: {
    fontSize: 10,
    color: '#94A3B8',
    textAlign: 'right',
  },
  sevRowPreview: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sevBtnSmall: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  sevBtnTxt: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
  },
});

export default ReportPreviewSheet;
