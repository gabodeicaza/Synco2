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
  Image,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, type FeedItem, type Report } from '@/src/api';
import { formatMeasurementValue } from '@/src/utils/whatsapp';
import { fmtDateTimeCDMX } from '@/src/utils/tz';

interface ReportPreviewSheetProps {
  visible: boolean;
  item: FeedItem | null;
  onClose: () => void;
  /** Optional share-via-WhatsApp callback. If omitted, the share button is hidden. */
  onShare?: (item: FeedItem) => void | Promise<void>;
  /** Cuando true, deshabilita el botón "Compartir" y muestra spinner. */
  sharing?: boolean;
}

export function ReportPreviewSheet({
  visible,
  item,
  onClose,
  onShare,
  sharing = false,
}: ReportPreviewSheetProps) {
  // Defensive: tolerate legacy/alt field names from the backend.
  const it = (item ?? {}) as Record<string, any>;

  // --- Estado interno: edición de descripciones individuales por foto ------
  const [editOpen, setEditOpen] = React.useState(false);
  const [loadingFull, setLoadingFull] = React.useState(false);
  const [savingCaps, setSavingCaps] = React.useState(false);
  const [fullReport, setFullReport] = React.useState<Report | null>(null);
  const [draftCaps, setDraftCaps] = React.useState<string[]>(['', '']);

  // === Galería completa de fotos (2026-07-06) =============================
  // El FeedItem sólo trae `thumbnail_base64` (foto 0). Para mostrar TODAS
  // las fotos del reporte hacemos un fetch perezoso del `Report` completo
  // al abrir el modal.
  const [galleryImages, setGalleryImages] = React.useState<string[]>([]);
  const [galleryLoading, setGalleryLoading] = React.useState(false);
  const [galleryCaptions, setGalleryCaptions] = React.useState<string[]>([]);

  const reportId: string | null = (it.id as string) || null;

  React.useEffect(() => {
    let alive = true;
    if (!visible || !reportId) {
      setGalleryImages([]);
      setGalleryCaptions([]);
      return;
    }
    // Kick-off: cargar reporte completo para tener images[] + captions.
    setGalleryLoading(true);
    api
      .getReport(reportId)
      .then((full) => {
        if (!alive) return;
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
    return () => {
      alive = false;
    };
  }, [visible, reportId]);

  const openEditCaptions = React.useCallback(async () => {
    if (!reportId) return;
    setEditOpen(true);
    setLoadingFull(true);
    try {
      // Reutilizamos el reporte cargado por la galería si ya está en memoria.
      let full = fullReport;
      if (!full) {
        full = await api.getReport(reportId);
        setFullReport(full);
      }
      const caps = (full.photo_captions || []).slice(0, 2);
      const seed = [caps[0] || '', caps[1] || ''];
      setDraftCaps(seed);
    } catch (e: any) {
      Alert.alert('No se pudo cargar', e?.message || 'Intenta de nuevo.');
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
      // Enviamos sólo tantas captions como fotos hay realmente (max 2).
      const send = draftCaps.slice(0, Math.min(2, totalImgs)).map((c) => (c || '').trim());
      const updated = await api.updateReportCaptions(reportId, send);
      setFullReport(updated);
      Alert.alert('Descripciones guardadas', 'Se actualizaron las descripciones de las fotos.');
      setEditOpen(false);
    } catch (e: any) {
      Alert.alert('Error al guardar', e?.message || 'No se pudo actualizar.');
    } finally {
      setSavingCaps(false);
    }
  }, [reportId, fullReport, draftCaps]);

  // Título: si el reporte fue creado con nombre, lo priorizamos; si no,
  // fallback al nombre del leaf node (comportamiento previo).
  const title = ((it.title && it.title.trim()) as string | undefined) ||
    (it.node_path_names && it.node_path_names.slice(-1)[0]) || 'Reporte';
  const path = (it.node_path_names || []).join(' › ') || '—';
  const author =
    it.captured_by_name || it.user_name || it.author_name || 'Especialista';
  const area = it.area_name || 'Sin área asignada';
  const created = fmtDateTimeCDMX(it.created_at);
  const photoUri: string | null = it.thumbnail_base64
    ? `data:image/jpeg;base64,${it.thumbnail_base64}`
    : it.foto || it.photo_url || null;

  const measurement = formatMeasurementValue(
    it.measurement_type,
    it.measurement_value || {},
  );
  const avance = it.avance ? String(it.avance) : '';
  const medicion = it.medicion ? String(it.medicion) : '';
  // Actividades: prefer explicit "actividades", fall back to notes/observaciones/comment.
  const actividadesRaw =
    it.actividades || it.notes || it.observaciones || it.comment || '';
  const actividades = String(actividadesRaw || '').trim();
  const hasActividades = actividades.length > 0;

  // Cuántas fotos reales tiene el reporte (para decidir si mostrar botón).
  // Priorizamos el conteo REAL (galleryImages) cargado del reporte completo.
  const imagesCount: number =
    galleryImages.length > 0
      ? galleryImages.length
      : typeof it.images_count === 'number'
      ? it.images_count
      : (it.thumbnail_base64 ? 1 : 0);

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
        dispositivos físicos. Con esta separación, el backdrop sólo capta
        taps en los bordes; el card es un `View` normal y su ScrollView
        recibe todos los pans limpios.
      */}
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar vista previa"
        />
        <View style={styles.card} pointerEvents="box-none">
          <View style={styles.cardInner}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Pressable hitSlop={10} onPress={onClose}>
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
            {/* ===== Galería completa de fotos (2026-07-06) ===== */}
            {galleryLoading && galleryImages.length === 0 ? (
              <View style={[styles.image, styles.imagePlaceholder]}>
                <ActivityIndicator color="#1E40AF" />
                <Text style={styles.imagePlaceholderTxt}>Cargando fotos…</Text>
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
                <Text style={styles.imagePlaceholderTxt}>Sin foto adjunta</Text>
              </View>
            )}

            <Row icon="person-outline" text={author} />
            <Row icon="grid-outline" text={area} />
            <Row icon="location-outline" text={path} numberOfLines={3} />
            <Row icon="time-outline" text={created} />

            {measurement ? <Block title="Medición" body={measurement} /> : null}
            {avance ? <Block title="Avance" body={avance} /> : null}
            {medicion && !measurement ? (
              <Block title="Medición" body={medicion} />
            ) : null}

            {/* Actividades: vital block for the field crew. Always rendered. */}
            <Block
              title="Actividades"
              body={hasActividades ? actividades : 'Sin actividades registradas'}
              muted={!hasActividades}
            />

            {/* CTA para editar descripciones individuales por foto ---------- */}
            {imagesCount > 0 && reportId ? (
              <Pressable
                onPress={openEditCaptions}
                style={({ pressed }) => [
                  styles.editCaptionsBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Ionicons name="create-outline" size={16} color="#1E40AF" />
                <Text style={styles.editCaptionsBtnTxt}>
                  Editar descripciones de fotos
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              {onShare ? (
                <Pressable
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
                  accessibilityLabel="Compartir por WhatsApp"
                  accessibilityState={{ disabled: sharing }}
                >
                  {sharing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" />
                  )}
                  <Text style={styles.waTxt}>
                    {sharing ? 'Compartiendo…' : 'Compartir'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.closeTxt}>Cerrar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      {/* Modal secundario: edición de descripciones individuales por foto */}
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
// Muestra las 2 primeras fotos (tope duro de exportación) con TextInput
// limitados a 160 chars (~4 líneas en PPTX/PDF).
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
        <Pressable style={styles.editCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              Descripciones de fotos
            </Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Ionicons name="close" size={22} color="#0F172A" />
            </Pressable>
          </View>

          {loading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator color="#1E40AF" />
              <Text style={{ marginTop: 8, fontSize: 12, color: '#64748B' }}>
                Cargando reporte…
              </Text>
            </View>
          ) : !report || images.length === 0 ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', gap: 8 }}>
              <Ionicons name="image-outline" size={32} color="#94A3B8" />
              <Text style={{ fontSize: 13, color: '#64748B' }}>
                Este reporte no tiene fotos.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.editHint}>
                Estas descripciones aparecen al pie de cada foto en el reporte
                ejecutivo (PPTX/PDF). Máx. 160 caracteres para no rebasar 4
                líneas.
              </Text>

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
                      Descripción foto {i + 1}
                    </Text>
                    <TextInput
                      placeholder={
                        i === 0
                          ? 'Descripción de la primera foto (máx. 4 líneas)'
                          : 'Descripción de la segunda foto (máx. 4 líneas)'
                      }
                      placeholderTextColor="#94A3B8"
                      style={styles.editInput}
                      multiline
                      numberOfLines={4}
                      maxLength={160}
                      value={draft[i] || ''}
                      onChangeText={(t) => {
                        const next = [...draft];
                        while (next.length <= i) next.push('');
                        next[i] = t;
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
            <Pressable
              onPress={onClose}
              disabled={saving}
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: '#E2E8F0' },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.closeTxt, { color: '#0F172A' }]}>
                Cancelar
              </Text>
            </Pressable>
            <Pressable
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
                <Text style={styles.closeTxt}>Guardar</Text>
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
// Styles — inlined hex colors to avoid theme drift across roles.
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
    // Garantiza salto de línea para textos largos.
    flexShrink: 1,
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    gap: 8,
  },
  closeBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E40AF',
    borderRadius: 10,
  },
  closeTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  waBtn: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 44,
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    borderRadius: 10,
  },
  waTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  // ── CTA para abrir el modal de edición de captions ──
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

  // ── Modal secundario para editar captions ──
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
});

export default ReportPreviewSheet;
