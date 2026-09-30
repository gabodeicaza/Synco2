// Módulo "Fotos LiDAR" — un registro por frente/estación con DOS fotos
// reemplazables de forma independiente: la ORIGINAL (línea base, ej. el vuelo
// inicial) y la ACTUAL (la más reciente). Mismo patrón "un componente hace
// todo, rutas delgadas por rol" que TablaResumenScreen.tsx. Crear/borrar
// registros es de Coordinador/Sub-Coordinador; adjuntar o reemplazar una foto
// lo puede hacer cualquier rol de escritura (captura de campo) — el backend
// aplica el mismo criterio (ver `set_foto_lidar_foto`, backend/server.py).
// Reemplazar una foto sobrescribe la anterior: solo importa el estado vigente.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, FotoLidar, FotoLidarSlot, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';

const SLOT_LABEL: Record<FotoLidarSlot, string> = { original: 'Original', actual: 'Actual' };

function hoyISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fmtFecha(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export default function FotosLidarScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const canEditEstructura = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<FotoLidar[]>([]);

  const [newOpen, setNewOpen] = useState(false);
  const [tituloDraft, setTituloDraft] = useState('');
  const [creating, setCreating] = useState(false);

  // Visor/editor de UNA foto (original o actual) de un registro.
  const [viewer, setViewer] = useState<{ id: string; titulo: string; slot: FotoLidarSlot } | null>(null);
  const [viewerImg, setViewerImg] = useState<string | null>(null);
  const [viewerFecha, setViewerFecha] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [fechaDraft, setFechaDraft] = useState(hoyISO());
  const [saving, setSaving] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, list] = await Promise.all([api.getProject(projectId), api.listFotosLidar(projectId)]);
      setProject(proj);
      setItems(list);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar las Fotos LiDAR.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function onCreate() {
    const titulo = tituloDraft.trim();
    if (!titulo) {
      Alert.alert('Falta información', 'Escribe un título (ej. "Estación 1 · Universidad").');
      return;
    }
    try {
      setCreating(true);
      await api.createFotoLidar(projectId, { titulo, orden: items.length });
      setNewOpen(false);
      setTituloDraft('');
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo crear', e?.message || 'Intentalo nuevamente.');
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(it: FotoLidar) {
    const ok = await confirm('Eliminar registro', `¿Eliminar "${it.titulo}" y sus dos fotos?`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deleteFotoLidar(projectId, it.id);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function openViewer(it: FotoLidar, slot: FotoLidarSlot) {
    setViewer({ id: it.id, titulo: it.titulo, slot });
    setViewerImg(null);
    setViewerFecha(slot === 'original' ? it.foto_original_fecha || null : it.foto_actual_fecha || null);
    setFechaDraft(hoyISO());
    const tiene = slot === 'original' ? it.tiene_original : it.tiene_actual;
    if (!tiene) return;
    try {
      setViewerLoading(true);
      const full = await api.getFotoLidar(projectId, it.id);
      setViewerImg((slot === 'original' ? full.foto_original : full.foto_actual) || null);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar la foto.');
    } finally {
      setViewerLoading(false);
    }
  }

  async function pickAndUpload(source: 'camera' | 'library') {
    if (!viewer) return;
    const fecha = fechaDraft.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      Alert.alert('Fecha inválida', 'Usa el formato AAAA-MM-DD (ej. 2026-09-29).');
      return;
    }
    try {
      if (Platform.OS !== 'web') {
        const perm = source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Sin permiso', source === 'camera' ? 'No hay permiso para usar la cámara.' : 'No hay permiso para acceder a la galería.');
          return;
        }
      }
      const opts = { mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 0.9, exif: false };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled || !result.assets?.[0]) return;
      setSaving(true);
      // Se reduce en el dispositivo (ancho 1800 px) para no subir fotos de
      // varios MB; el backend la normaliza otra vez a JPEG ≤1800 px.
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, [{ resize: { width: 1800 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) throw new Error('No se pudo leer la imagen.');
      await api.setFotoLidarFoto(projectId, viewer.id, viewer.slot, {
        image: `data:image/jpeg;base64,${manipulated.base64}`,
        fecha,
      });
      setViewer(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar la foto', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function onRemovePhoto() {
    if (!viewer) return;
    const ok = await confirm('Quitar foto', `¿Quitar la foto ${SLOT_LABEL[viewer.slot].toLowerCase()} de "${viewer.titulo}"?`, {
      confirmText: 'Quitar', destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteFotoLidarFoto(projectId, viewer.id, viewer.slot);
      setViewer(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo quitar', e?.message || 'Intentalo nuevamente.');
    }
  }

  function renderSlot(it: FotoLidar, slot: FotoLidarSlot) {
    const tiene = slot === 'original' ? it.tiene_original : it.tiene_actual;
    const thumb = slot === 'original' ? it.thumb_original : it.thumb_actual;
    const fecha = slot === 'original' ? it.foto_original_fecha : it.foto_actual_fecha;
    return (
      <Pressable style={styles.slot} onPress={() => openViewer(it, slot)}>
        <Text style={styles.slotLabel}>{SLOT_LABEL[slot]}</Text>
        {tiene && thumb ? (
          <Image source={{ uri: `data:image/jpeg;base64,${thumb}` }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Ionicons name="camera-outline" size={24} color={colors.textMuted} />
            <Text style={styles.thumbEmptyTxt}>Adjuntar</Text>
          </View>
        )}
        <Text style={styles.slotFecha}>{tiene ? fmtFecha(fecha) : ' '}</Text>
      </Pressable>
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
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Fotos LiDAR</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Frentes</Text>
          {canEditEstructura ? (
            <Pressable onPress={() => setNewOpen(true)} style={styles.addBtn}>
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={styles.addBtnTxt}>Nuevo registro</Text>
            </Pressable>
          ) : null}
        </View>

        {items.length === 0 ? (
          <View style={[styles.card, styles.empty]}>
            <Ionicons name="images-outline" size={22} color={colors.textMuted} />
            <Text style={styles.emptyTxt}>
              {canEditEstructura
                ? 'Aún no hay registros. Crea uno por estación o frente y adjunta su foto original y su foto actual.'
                : 'Aún no hay registros de Fotos LiDAR.'}
            </Text>
          </View>
        ) : (
          items.map((it) => (
            <View key={it.id} style={[styles.card, { padding: spacing.md }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={2}>{it.titulo}</Text>
                {canEditEstructura ? (
                  <Pressable hitSlop={8} onPress={() => onDelete(it)}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.slotsRow}>
                {renderSlot(it, 'original')}
                {renderSlot(it, 'actual')}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Modal: nuevo registro */}
      <Modal visible={newOpen} transparent animationType="slide" onRequestClose={() => setNewOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nuevo registro</Text>
            <Text style={styles.fieldLabel}>Título</Text>
            <TextInput
              value={tituloDraft}
              onChangeText={setTituloDraft}
              placeholder="Ej. Estación 1 · Universidad"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setNewOpen(false)} style={{ flex: 1 }} />
              <Button label="Crear" loading={creating} onPress={onCreate} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: ver / adjuntar / reemplazar una foto */}
      <Modal visible={!!viewer} transparent animationType="slide" onRequestClose={() => setViewer(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '92%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>
                {viewer ? `${viewer.titulo} · ${SLOT_LABEL[viewer.slot]}` : ''}
              </Text>
              {viewerLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
              ) : viewerImg ? (
                <>
                  <Image source={{ uri: viewerImg }} style={styles.viewerImg} resizeMode="contain" />
                  {viewerFecha ? <Text style={styles.slotFecha}>Tomada el {fmtFecha(viewerFecha)}</Text> : null}
                </>
              ) : (
                <View style={[styles.viewerImg, styles.thumbEmpty]}>
                  <Ionicons name="camera-outline" size={28} color={colors.textMuted} />
                  <Text style={styles.thumbEmptyTxt}>Sin foto todavía</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>Fecha de la nueva foto (AAAA-MM-DD)</Text>
              <TextInput
                value={fechaDraft}
                onChangeText={setFechaDraft}
                placeholder="2026-09-29"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                autoCapitalize="none"
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button
                  label={viewerImg ? 'Reemplazar (galería)' : 'Elegir de galería'}
                  variant="secondary" loading={saving} onPress={() => pickAndUpload('library')} style={{ flex: 1 }}
                />
                <Button
                  label={viewerImg ? 'Reemplazar (cámara)' : 'Tomar foto'}
                  loading={saving} onPress={() => pickAndUpload('camera')} style={{ flex: 1 }}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                {viewerImg && canEditEstructura ? (
                  <Button label="Quitar foto" variant="danger" onPress={onRemovePhoto} style={{ flex: 1 }} />
                ) : null}
                <Button label="Cerrar" variant="secondary" onPress={() => setViewer(null)} style={{ flex: 1 }} />
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
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.md },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  slotsRow: { flexDirection: 'row', gap: spacing.sm },
  slot: { flex: 1, alignItems: 'center' },
  slotLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  slotFecha: { fontSize: 11, color: colors.textMuted, marginTop: 4, textAlign: 'center' },
  thumb: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.bg },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  thumbEmptyTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  viewerImg: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.bg },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
