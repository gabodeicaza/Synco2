// Módulo "Supervisión Ambiental" — sección AMBIENTAL del reporte semanal
// integral. TODO es editable (nada viene fijo): informes de cumplimiento con su
// % y fecha de cierre, autorizaciones, arbolado autorizado vs ejecutado por
// autorización/afectación, resarcimiento con fotos y tabla resumen de estudios;
// más la referencia de las medidas y el total de árboles a restituir. Una
// pantalla declarativa (cada sección = lista de campos) + un formulario
// genérico; ver `_AMBIENTAL_SECCIONES` en backend/server.py. Captura abierta a
// cualquier rol de escritura; borrar: Coordinador/Sub-Coordinador o quien lo
// capturó.
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
import { api, AmbientalConfig, AmbientalItem, AmbientalSeccion, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { fechaTecleadaOk, FECHA_AYUDA } from '@/src/utils/fecha';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB, ROLE_JEFE } from '@/src/utils/roles';

type Campo = {
  key: string; label: string; placeholder?: string;
  tipo?: 'texto' | 'numero' | 'entero' | 'fecha';
  multiline?: boolean;
};
type SeccionDef = {
  key: AmbientalSeccion; titulo: string; ayuda: string; nuevo: string; campos: Campo[]; foto?: boolean;
  resumen: (i: AmbientalItem) => { titulo: string; detalle?: string };
};

const ent = (v?: number | null) => (v === null || v === undefined ? '-' : String(v));
const fmtFecha = (iso?: string | null) => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

const SECCIONES: SeccionDef[] = [
  {
    key: 'informe', titulo: 'Informes de cumplimiento', nuevo: 'Nuevo informe',
    ayuda: 'Seguimiento a las medidas de impacto ambiental: cada informe con su avance y fecha de cierre (sale como dona).',
    campos: [
      { key: 'nombre', label: 'Informe', placeholder: '3er Informe Trimestral' },
      { key: 'avance', label: 'Avance (%)', placeholder: '98', tipo: 'numero' },
      { key: 'fecha_cierre', label: 'Fecha de cierre (AAAA-MM-DD o DD/MM/AAAA)', placeholder: '2026-09-17', tipo: 'fecha' },
    ],
    resumen: (i) => ({ titulo: i.nombre || '-', detalle: `${i.avance ?? 0}%${i.fecha_cierre ? ` · cierre ${fmtFecha(i.fecha_cierre)}` : ''}` }),
  },
  {
    key: 'autorizacion', titulo: 'Autorizaciones', nuevo: 'Nueva autorización',
    ayuda: 'Oficios, acuerdos o manifestaciones que amparan la intervención de arbolado.',
    campos: [
      { key: 'tipo', label: 'Tipo', placeholder: 'SEDEMA / Acuerdo de facilidades / MIA' },
      { key: 'folio', label: 'Folio u oficio', placeholder: 'SEDEMA/DGEIRA/DEIAR/05134/2026' },
    ],
    resumen: (i) => ({ titulo: i.folio || '-', detalle: i.tipo || undefined }),
  },
  {
    key: 'arbolado', titulo: 'Arbolado por autorización', nuevo: 'Nuevo grupo',
    ayuda: 'Un grupo por autorización o afectación. Captura lo AUTORIZADO y lo EJECUTADO de cada acción.',
    campos: [
      { key: 'nombre', label: 'Grupo', placeholder: 'MIA-E / Nueva afectación, en proceso de autorización' },
      { key: 'poda_aut', label: 'Podas autorizadas', tipo: 'entero' },
      { key: 'poda_ej', label: 'Podas ejecutadas', tipo: 'entero' },
      { key: 'trasplante_aut', label: 'Trasplantes autorizados', tipo: 'entero' },
      { key: 'trasplante_ej', label: 'Trasplantes ejecutados', tipo: 'entero' },
      { key: 'derribo_aut', label: 'Derribos autorizados', tipo: 'entero' },
      { key: 'derribo_ej', label: 'Derribos ejecutados', tipo: 'entero' },
    ],
    resumen: (i) => ({
      titulo: i.nombre || '-',
      detalle: `Podas ${ent(i.poda_ej)}/${ent(i.poda_aut)} · Trasplantes ${ent(i.trasplante_ej)}/${ent(i.trasplante_aut)} · Derribos ${ent(i.derribo_ej)}/${ent(i.derribo_aut)}`,
    }),
  },
  {
    key: 'resarcimiento', titulo: 'Resarcimiento de arbolado', nuevo: 'Nueva plantación', foto: true,
    ayuda: 'Plantaciones de reposición: lugar, cantidad y foto con su pie.',
    campos: [
      { key: 'lugar', label: 'Plantación / lugar', placeholder: 'Plantaciones en Parque Cantera' },
      { key: 'cantidad', label: 'Cantidad restituida', tipo: 'entero' },
      { key: 'pie', label: 'Pie de foto', placeholder: 'Se plantan 30 ejemplares' },
    ],
    resumen: (i) => ({ titulo: i.lugar || '-', detalle: `${ent(i.cantidad)} ejemplares${i.pie ? ` · ${i.pie}` : ''}` }),
  },
  {
    key: 'avance_estudio', titulo: 'Tabla resumen general', nuevo: 'Nueva actividad',
    ayuda: 'Estudios y trámites ambientales con su avance semanal (%).',
    campos: [
      { key: 'actividad', label: 'Actividad', placeholder: 'Dictamen técnico forestal' },
      { key: 'avance', label: 'Avance semanal (%)', placeholder: '100', tipo: 'numero' },
    ],
    resumen: (i) => ({ titulo: i.actividad || '-', detalle: i.avance === null || i.avance === undefined ? undefined : `${i.avance}%` }),
  },
];

type Draft = {
  seccion: SeccionDef; id: string | null; valores: Record<string, string>;
  image: string | null; preview: string | null;
};

export default function SupervisionAmbientalScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEscribir = user?.role !== ROLE_JEFE;
  const puedeBorrarTodo = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<AmbientalItem[]>([]);
  const [config, setConfig] = useState<AmbientalConfig>({ referencia: null, total_a_restituir: null });
  const [cfgDraft, setCfgDraft] = useState<{ referencia: string; total: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, data] = await Promise.all([api.getProject(projectId), api.getAmbiental(projectId)]);
      setProject(proj);
      setItems(data.items);
      setConfig(data.config);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar la supervisión ambiental.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function nuevo(seccion: SeccionDef) {
    setDraft({ seccion, id: null, valores: {}, image: null, preview: null });
  }

  function editar(seccion: SeccionDef, it: AmbientalItem) {
    const valores: Record<string, string> = {};
    for (const c of seccion.campos) {
      const v = (it as any)[c.key];
      valores[c.key] = v === null || v === undefined ? '' : String(v);
    }
    setDraft({ seccion, id: it.id, valores, image: null, preview: it.thumb ? `data:image/jpeg;base64,${it.thumb}` : null });
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
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled || !result.assets?.[0]) return;
      const m = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, [{ resize: { width: 1800 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!m.base64) throw new Error('No se pudo leer la imagen.');
      const dataUrl = `data:image/jpeg;base64,${m.base64}`;
      setDraft((d) => (d ? { ...d, image: dataUrl, preview: dataUrl } : d));
    } catch (e: any) {
      Alert.alert('No se pudo cargar la foto', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function onSave() {
    if (!draft) return;
    const body: Record<string, any> = {};
    for (const c of draft.seccion.campos) {
      const raw = (draft.valores[c.key] || '').trim();
      if (c.tipo === 'numero' || c.tipo === 'entero') {
        if (!raw) { body[c.key] = null; continue; }
        const n = Number(raw.replace(',', '.'));
        if (!Number.isFinite(n) || (c.tipo === 'entero' && !Number.isInteger(n))) {
          Alert.alert('Valor inválido', `"${c.label}" debe ser un ${c.tipo === 'entero' ? 'número entero' : 'número'}.`);
          return;
        }
        body[c.key] = n;
      } else if (c.tipo === 'fecha') {
        if (raw && !fechaTecleadaOk(raw)) { Alert.alert('Fecha inválida', FECHA_AYUDA); return; }
        body[c.key] = raw;
      } else {
        body[c.key] = raw;
      }
    }
    const primero = draft.seccion.campos[draft.seccion.key === 'autorizacion' ? 1 : 0];
    if (!(draft.valores[primero.key] || '').trim()) {
      Alert.alert('Falta información', `Indica: ${primero.label}.`);
      return;
    }
    if (draft.image) body.image = draft.image;
    try {
      setSaving(true);
      if (draft.id) await api.updateAmbiental(projectId, draft.id, body);
      else await api.createAmbiental(projectId, { ...body, seccion: draft.seccion.key });
      setDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(it: AmbientalItem) {
    const ok = await confirm('Eliminar registro', '¿Eliminar este registro?', { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deleteAmbiental(projectId, it.id);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function onSaveConfig() {
    if (!cfgDraft) return;
    const t = cfgDraft.total.trim();
    const total = t ? Number(t) : null;
    if (total !== null && (!Number.isInteger(total) || total < 0)) {
      Alert.alert('Valor inválido', 'El total a restituir debe ser un número entero.');
      return;
    }
    try {
      setSaving(true);
      setConfig(await api.setAmbientalConfig(projectId, { referencia: cfgDraft.referencia, total_a_restituir: total }));
      setCfgDraft(null);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Supervisión Ambiental</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Pressable accessibilityRole="button"
          style={[styles.card, { padding: spacing.md }]}
          onPress={puedeEscribir ? () => setCfgDraft({ referencia: config.referencia || '', total: config.total_a_restituir === null ? '' : String(config.total_a_restituir) }) : undefined}
        >
          <Text style={styles.cardTitle}>Datos generales</Text>
          <Text style={styles.meta}>Resolución / referencia: {config.referencia || 'sin capturar'}</Text>
          <Text style={styles.meta}>Total de árboles a restituir: {config.total_a_restituir ?? 'sin capturar'}</Text>
        </Pressable>

        {SECCIONES.map((sec) => {
          const rows = items.filter((i) => i.seccion === sec.key);
          return (
            <View key={sec.key} style={{ marginBottom: spacing.lg }}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>{sec.titulo}</Text>
                {puedeEscribir ? (
                  <Pressable accessibilityRole="button" onPress={() => nuevo(sec)} style={styles.addBtn}>
                    <Ionicons name="add" size={16} color={colors.primary} />
                    <Text style={styles.addBtnTxt}>{sec.nuevo}</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.ayuda}>{sec.ayuda}</Text>
              {rows.length === 0 ? (
                <View style={[styles.card, styles.empty]}><Text style={styles.emptyTxt}>Sin registros.</Text></View>
              ) : rows.map((it) => {
                const r = sec.resumen(it);
                const puedeBorrar = puedeBorrarTodo || it.created_by === user?.id;
                return (
                  <Pressable accessibilityRole="button" key={it.id} style={[styles.card, styles.itemRow]} onPress={puedeEscribir ? () => editar(sec, it) : undefined}>
                    {it.thumb ? <Image source={{ uri: `data:image/jpeg;base64,${it.thumb}` }} style={styles.thumb} /> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{r.titulo}</Text>
                      {r.detalle ? <Text style={styles.meta}>{r.detalle}</Text> : null}
                    </View>
                    {puedeEscribir && puedeBorrar ? (
                      <Pressable accessibilityRole="button" accessibilityLabel="Eliminar" hitSlop={8} onPress={() => onDelete(it)}>
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '92%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{draft?.id ? 'Editar' : 'Nuevo'} · {draft?.seccion.titulo}</Text>
              {draft?.seccion.campos.map((c) => (
                <View key={c.key}>
                  <Text style={styles.fieldLabel}>{c.label}</Text>
                  <TextInput
                    value={draft.valores[c.key] || ''}
                    onChangeText={(t) => setDraft((d) => (d ? { ...d, valores: { ...d.valores, [c.key]: t } } : d))}
                    placeholder={c.placeholder}
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    keyboardType={c.tipo === 'numero' ? 'decimal-pad' : c.tipo === 'entero' ? 'number-pad' : 'default'}
                    autoCapitalize="none"
                  />
                </View>
              ))}
              {draft?.seccion.foto ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={styles.fieldLabel}>Foto</Text>
                  {draft.preview ? <Image source={{ uri: draft.preview }} style={styles.preview} resizeMode="cover" /> : null}
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                    <Button label="Cámara" variant="secondary" onPress={() => pickPhoto('camera')} style={{ flex: 1 }} />
                    <Button label="Galería" variant="secondary" onPress={() => pickPhoto('library')} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label="Cancelar" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
                <Button label="Guardar" loading={saving} onPress={onSave} style={{ flex: 1 }} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!cfgDraft} transparent animationType="slide" onRequestClose={() => setCfgDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Datos generales</Text>
            <Text style={styles.fieldLabel}>Resolución / referencia de las medidas</Text>
            <TextInput
              value={cfgDraft?.referencia || ''} multiline
              onChangeText={(t) => setCfgDraft((d) => (d ? { ...d, referencia: t } : d))}
              placeholder="Anexo 1 del Acuerdo… y Resolución Admva. 05134/2026" placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
            />
            <Text style={styles.fieldLabel}>Total de árboles a restituir</Text>
            <TextInput
              value={cfgDraft?.total || ''} keyboardType="number-pad"
              onChangeText={(t) => setCfgDraft((d) => (d ? { ...d, total: t } : d))}
              placeholder="46" placeholderTextColor={colors.textMuted} style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setCfgDraft(null)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={onSaveConfig} style={{ flex: 1 }} />
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
  titleBar: { fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  scroll: { padding: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  ayuda: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.xs },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  thumb: { width: 44, height: 44, borderRadius: radius.md },
  empty: { alignItems: 'center', padding: spacing.md },
  emptyTxt: { color: colors.textMuted, fontSize: 13 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md,
    paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  preview: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.border },
});
