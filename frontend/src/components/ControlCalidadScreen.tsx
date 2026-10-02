// Módulo "Control de Calidad" — registro fotográfico de las actividades de
// control de calidad: una FOTO con la descripción de la actividad (que el
// reporte imprime arriba) y un pie de foto (abajo), agrupado por estación o
// por un grupo libre (ej. "Suministro Gefsa-Puebla"). El export semanal
// acomoda dos registros por diapositiva. Mismo patrón "un componente hace
// todo, rutas delgadas por rol" que FotosLidarScreen.tsx. Captura abierta a
// cualquier rol de escritura; borrar: Coordinador/Sub-Coordinador o quien lo
// capturó (el backend aplica el mismo criterio, ver `delete_control_calidad`).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ControlCalidad, LocationNode, Project } from '@/src/api';
import { EstacionPicker } from '@/src/components/EstacionPicker';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { fechaTecleadaOk, FECHA_AYUDA } from '@/src/utils/fecha';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB, ROLE_JEFE } from '@/src/utils/roles';

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtFecha(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

type Draft = {
  id: string | null;
  node_id: string | null;
  grupo: string;
  descripcion: string;
  pie: string;
  fecha: string;
  image: string | null; // data URL de la foto NUEVA (null = conservar la actual al editar)
  preview: string | null; // lo que se muestra: la foto nueva o la vigente
};

const emptyDraft = (): Draft => ({
  id: null, node_id: null, grupo: '', descripcion: '', pie: '', fecha: hoyISO(), image: null, preview: null,
});

export default function ControlCalidadScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEscribir = user?.role !== ROLE_JEFE;
  const puedeBorrarTodo = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<ControlCalidad[]>([]);
  const [nodes, setNodes] = useState<LocationNode[]>([]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingFoto, setLoadingFoto] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, list, nodeList] = await Promise.all([
        api.getProject(projectId), api.listControlCalidad(projectId), api.listNodes(projectId),
      ]);
      setProject(proj);
      setItems(list);
      setNodes(nodeList);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el control de calidad.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Agrupa por estación/intertramo o por el texto libre `grupo` — igual que el
  // export, que imprime un bloque de diapositivas por cada grupo.
  const grupos = useMemo(() => {
    const nombre = new Map(nodes.map((n) => [n.id, n.name]));
    const out = new Map<string, ControlCalidad[]>();
    for (const it of items) {
      const titulo = (it.node_id && nombre.get(it.node_id)) || (it.grupo || '').trim() || 'General';
      if (!out.has(titulo)) out.set(titulo, []);
      out.get(titulo)!.push(it);
    }
    return Array.from(out.entries());
  }, [items, nodes]);

  async function openEdit(it: ControlCalidad) {
    setDraft({
      id: it.id, node_id: it.node_id || null, grupo: it.grupo || '', descripcion: it.descripcion || '',
      pie: it.pie || '', fecha: it.fecha, image: null, preview: it.thumb ? `data:image/jpeg;base64,${it.thumb}` : null,
    });
    // La miniatura sirve de vista previa; la foto completa se baja en segundo plano.
    try {
      setLoadingFoto(true);
      const full = await api.getControlCalidad(projectId, it.id);
      setDraft((d) => (d && d.id === it.id && !d.image ? { ...d, preview: full.foto || d.preview } : d));
    } catch {
      // se queda la miniatura
    } finally {
      setLoadingFoto(false);
    }
  }

  async function pickPhoto(source: 'camera' | 'library') {
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
      // Se reduce en el dispositivo (ancho 1800 px); el backend la normaliza otra vez.
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, [{ resize: { width: 1800 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) throw new Error('No se pudo leer la imagen.');
      const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
      setDraft((d) => (d ? { ...d, image: dataUrl, preview: dataUrl } : d));
    } catch (e: any) {
      Alert.alert('No se pudo cargar la foto', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function onSave() {
    if (!draft) return;
    if (!draft.id && !draft.image) {
      Alert.alert('Falta la foto', 'Toma o elige una foto de la actividad.');
      return;
    }
    if (!fechaTecleadaOk(draft.fecha)) {
      Alert.alert('Fecha inválida', FECHA_AYUDA);
      return;
    }
    const texto = { node_id: draft.node_id, grupo: draft.grupo, descripcion: draft.descripcion, pie: draft.pie, fecha: draft.fecha.trim() };
    try {
      setSaving(true);
      if (draft.id) await api.updateControlCalidad(projectId, draft.id, draft.image ? { ...texto, image: draft.image } : texto);
      else await api.createControlCalidad(projectId, { ...texto, image: draft.image as string });
      setDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(it: ControlCalidad) {
    const ok = await confirm('Eliminar registro', `¿Eliminar este registro de control de calidad del ${fmtFecha(it.fecha)}?`, {
      confirmText: 'Eliminar', destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteControlCalidad(projectId, it.id);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    }
  }

  function field(label: string, key: 'grupo' | 'descripcion' | 'pie' | 'fecha', placeholder: string, multiline = false) {
    return (
      <>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          value={draft ? draft[key] : ''}
          onChangeText={(t) => setDraft((d) => (d ? { ...d, [key]: t } : d))}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, multiline && { minHeight: 64, textAlignVertical: 'top' }]}
          multiline={multiline}
          autoCapitalize={key === 'fecha' ? 'none' : 'sentences'}
        />
      </>
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
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Control de Calidad</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Registro fotográfico</Text>
          {puedeEscribir ? (
            <Pressable onPress={() => setDraft(emptyDraft())} style={styles.addBtn}>
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={styles.addBtnTxt}>Nueva foto</Text>
            </Pressable>
          ) : null}
        </View>

        {grupos.length === 0 ? (
          <View style={[styles.card, styles.empty]}>
            <Ionicons name="camera-outline" size={22} color={colors.textMuted} />
            <Text style={styles.emptyTxt}>
              {puedeEscribir
                ? 'Aún no hay fotos. Registra cada actividad de control de calidad con su foto, descripción y pie de foto.'
                : 'Aún no hay registros de control de calidad.'}
            </Text>
          </View>
        ) : (
          grupos.map(([titulo, rows]) => (
            <View key={titulo} style={{ marginBottom: spacing.md }}>
              <Text style={styles.groupTitle}>{titulo}</Text>
              {rows.map((it) => {
                const puedeBorrar = puedeEscribir && (puedeBorrarTodo || it.created_by === user?.id);
                return (
                  <Pressable
                    key={it.id} style={[styles.card, styles.row]}
                    onPress={puedeEscribir ? () => openEdit(it) : undefined}
                  >
                    {it.thumb ? (
                      <Image source={{ uri: `data:image/jpeg;base64,${it.thumb}` }} style={styles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbEmpty]}>
                        <Ionicons name="image-outline" size={22} color={colors.textMuted} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fecha}>{fmtFecha(it.fecha)}</Text>
                      <Text style={styles.desc} numberOfLines={3}>{it.descripcion || 'Sin descripción'}</Text>
                      {it.pie ? <Text style={styles.pie} numberOfLines={2}>{it.pie}</Text> : null}
                    </View>
                    {puedeBorrar ? (
                      <Pressable hitSlop={8} onPress={() => onDelete(it)}>
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '92%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{draft?.id ? 'Editar registro' : 'Nueva foto de control de calidad'}</Text>

              {draft?.preview ? (
                <Image source={{ uri: draft.preview }} style={styles.preview} resizeMode="contain" />
              ) : (
                <View style={[styles.preview, styles.thumbEmpty]}>
                  <Ionicons name="camera-outline" size={28} color={colors.textMuted} />
                  <Text style={styles.emptyTxt}>Sin foto todavía</Text>
                </View>
              )}
              {loadingFoto ? <ActivityIndicator color={colors.primary} style={{ marginTop: 4 }} /> : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <Button
                  label={draft?.preview ? 'Cambiar (galería)' : 'Elegir de galería'}
                  variant="secondary" onPress={() => pickPhoto('library')} style={{ flex: 1 }}
                />
                <Button
                  label={draft?.preview ? 'Cambiar (cámara)' : 'Tomar foto'}
                  onPress={() => pickPhoto('camera')} style={{ flex: 1 }}
                />
              </View>

              <Text style={styles.fieldLabel}>Estación / intertramo</Text>
              <EstacionPicker
                nodes={nodes} value={draft?.node_id ?? null}
                onChange={(id) => setDraft((d) => (d ? { ...d, node_id: id } : d))}
              />
              {draft && !draft.node_id ? field('Grupo (si no es una estación)', 'grupo', 'Ej. Suministro Gefsa-Puebla') : null}
              {field('Actividades de control de calidad', 'descripcion', 'Ej. Verificación de hincado de pila habilitada de acuerdo a especificación', true)}
              {field('Pie de foto', 'pie', 'Ej. Se verifica proceso de habilitado de acuerdo a plano')}
              {field('Fecha (AAAA-MM-DD)', 'fecha', '2026-06-26')}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label="Cancelar" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
                <Button label="Guardar" loading={saving} onPress={onSave} style={{ flex: 1 }} />
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
  groupTitle: { fontSize: 12, fontWeight: '800', color: colors.text, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
  thumbEmpty: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  fecha: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  desc: { fontSize: 13, fontWeight: '600', color: colors.text },
  pie: { fontSize: 12, color: colors.textMuted },
  preview: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.bg },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md,
    paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
