// Captura y consulta de los registros de UN módulo personalizado (creado con el
// Creador de módulos). El formulario se arma solo a partir de los campos del
// módulo: respeta campos obligatorios, condicionales (visible_si), calculados y
// fotos. Abierto a cualquier rol de escritura; si el módulo es «solo
// coordinación», solo Coordinador/Sub-Coordinador capturan.
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
import { api, CustomModule, CustomRecord, JerarquiaInforme, Project } from '@/src/api';
import { JerarquiaInformePicker, JERARQUIA_DEFAULT } from '@/src/components/JerarquiaInformePicker';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { fechaCorta, fechaTecleadaOk, FECHA_AYUDA } from '@/src/utils/fecha';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB, ROLE_JEFE } from '@/src/utils/roles';
import {
  campoVisible, detalleRegistro, fmtNumeroCampo, parseNumero, recalcular, tituloRegistro, validarCaptura,
  valoresIniciales, esNumerico,
} from '@/src/utils/customModules';
import { CampoInput } from './CampoInput';
import { Header, inputStyle } from './ui';

type Borrador = {
  id: string | null;
  fecha: string;
  valores: Record<string, any>;
  jerarquia: JerarquiaInforme;
  previews: Record<string, string>; // foto visible por campo (miniatura o la recién elegida)
  nuevas: Record<string, string | null>; // fotos cambiadas: data URL nuevo, o null = quitar
};

const hoyISO = () => new Date().toISOString().slice(0, 10);

export default function CustomModuleScreen({ projectId, moduloId }: { projectId: string; moduloId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const esCoordSub = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [modulo, setModulo] = useState<CustomModule | null>(null);
  const [items, setItems] = useState<CustomRecord[]>([]);
  const [busca, setBusca] = useState('');
  const [draft, setDraft] = useState<Borrador | null>(null);
  const [saving, setSaving] = useState(false);

  const puedeEscribir = !!modulo && user?.role !== ROLE_JEFE && (!modulo.solo_coordinacion || esCoordSub);
  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

  const load = useCallback(async () => {
    if (!projectId || !moduloId) return;
    try {
      const [proj, mod, regs] = await Promise.all([
        api.getProject(projectId), api.getCustomModule(projectId, moduloId), api.listCustomRecords(projectId, moduloId),
      ]);
      setProject(proj);
      setModulo(mod);
      setItems(regs);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el módulo.');
    } finally {
      setLoading(false);
    }
  }, [projectId, moduloId]);

  useEffect(() => { load(); }, [load]);

  const campos = useMemo(() => modulo?.campos || [], [modulo]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) => {
      const txt = `${tituloRegistro(campos, r)} ${detalleRegistro(campos, r, 20)} ${r.created_by_name || ''} ${fechaCorta(r.fecha)}`.toLowerCase();
      return txt.includes(q);
    });
  }, [items, busca, campos]);

  // Totales de los campos que el módulo totaliza (sobre lo que se está viendo).
  const totales = useMemo(() => {
    const out: { id: string; label: string; valor: string }[] = [];
    for (const f of campos) {
      const agg = f.agregacion || 'ninguna';
      if (agg === 'ninguna' || f.tipo === 'foto') continue;
      const vals = filtrados.map((r) => r.valores[f.id]);
      let res: number | null = null;
      if (agg === 'conteo') res = vals.filter((v) => (f.tipo === 'interruptor' ? !!v : v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))).length;
      else {
        const nums = vals.filter((v) => typeof v === 'number' && Number.isFinite(v)) as number[];
        if (nums.length) {
          res = agg === 'suma' ? nums.reduce((a, b) => a + b, 0)
            : agg === 'promedio' ? nums.reduce((a, b) => a + b, 0) / nums.length
              : agg === 'minimo' ? Math.min(...nums) : Math.max(...nums);
        }
      }
      if (res === null) continue;
      const rot = { suma: 'Total', promedio: 'Promedio', minimo: 'Mínimo', maximo: 'Máximo', conteo: 'Cuenta' }[agg];
      out.push({ id: f.id, label: `${rot} · ${f.etiqueta}`, valor: agg === 'conteo' ? String(res) : fmtNumeroCampo(f, res) });
    }
    return out;
  }, [campos, filtrados]);

  const puedeEditar = (r: CustomRecord) => puedeEscribir && (esCoordSub || r.created_by === user?.id);

  function nuevo() {
    if (!modulo) return;
    setDraft({
      id: null, fecha: hoyISO(), valores: valoresIniciales(campos), jerarquia: JERARQUIA_DEFAULT, previews: {}, nuevas: {},
    });
  }

  function abrir(r: CustomRecord) {
    const previews: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.thumbs || {})) previews[k] = v.startsWith('data:') ? v : `data:image/jpeg;base64,${v}`;
    setDraft({
      id: r.id, fecha: r.fecha, valores: recalcular(campos, { ...r.valores }),
      jerarquia: (r.jerarquia as JerarquiaInforme) || JERARQUIA_DEFAULT, previews, nuevas: {},
    });
  }

  function setValor(id: string, v: any) {
    setDraft((d) => (d ? { ...d, valores: recalcular(campos, { ...d.valores, [id]: v }) } : d));
  }

  async function pickPhoto(campoId: string, source: 'camera' | 'library') {
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
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, [{ resize: { width: 1800 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) throw new Error('No se pudo leer la imagen.');
      const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
      setDraft((d) => (d ? { ...d, previews: { ...d.previews, [campoId]: dataUrl }, nuevas: { ...d.nuevas, [campoId]: dataUrl } } : d));
    } catch (e: any) {
      Alert.alert('No se pudo cargar la foto', e?.message || 'Inténtalo nuevamente.');
    }
  }

  function quitarFoto(campoId: string) {
    setDraft((d) => {
      if (!d) return d;
      const previews = { ...d.previews };
      delete previews[campoId];
      return { ...d, previews, nuevas: { ...d.nuevas, [campoId]: null } };
    });
  }

  async function guardar() {
    if (!draft || !modulo) return;
    if (!fechaTecleadaOk(draft.fecha)) { Alert.alert('Fecha inválida', FECHA_AYUDA); return; }
    const error = validarCaptura(campos, draft.valores, draft.previews);
    if (error) { Alert.alert('Falta información', error); return; }
    const valores: Record<string, any> = {};
    for (const f of campos) {
      if (f.tipo === 'calculado') continue;
      if (f.tipo === 'foto') {
        if (f.id in draft.nuevas) valores[f.id] = draft.nuevas[f.id];
        continue;
      }
      const v = draft.valores[f.id];
      valores[f.id] = esNumerico(f.tipo) && v !== '' && v !== null && v !== undefined ? parseNumero(v) : v;
    }
    const cuerpo = { fecha: draft.fecha.trim(), valores, ...(modulo.usar_jerarquia ? { jerarquia: draft.jerarquia } : {}) };
    try {
      setSaving(true);
      if (draft.id) await api.updateCustomRecord(projectId, modulo.id, draft.id, cuerpo);
      else await api.createCustomRecord(projectId, modulo.id, cuerpo);
      setDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function borrar(r: CustomRecord) {
    if (!modulo) return;
    const ok = await confirm('Eliminar registro', `¿Eliminar el registro del ${fechaCorta(r.fecha)}?`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deleteCustomRecord(projectId, modulo.id, r.id);
      setDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Inténtalo nuevamente.');
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!modulo) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header title="Módulo" color={headerColor} onBack={() => router.back()} />
        <View style={styles.center}><Text style={styles.emptyTxt}>Este módulo ya no está disponible.</Text></View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={modulo.nombre} color={headerColor} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 96 }]} keyboardShouldPersistTaps="handled">
        {modulo.descripcion ? <Text style={styles.desc}>{modulo.descripcion}</Text> : null}
        {!modulo.activo ? <Text style={styles.aviso}>Este módulo está apagado: solo se consulta.</Text> : null}
        {modulo.solo_coordinacion && !esCoordSub ? <Text style={styles.aviso}>Solo la coordinación captura en este módulo.</Text> : null}

        {items.length > 4 ? (
          <TextInput
            value={busca} onChangeText={setBusca} placeholder="Buscar en los registros…" placeholderTextColor={colors.textMuted}
            style={[inputStyle, { marginBottom: spacing.sm }]}
          />
        ) : null}

        {totales.length > 0 ? (
          <View style={styles.totales}>
            {totales.map((t) => (
              <View key={t.id} style={styles.totalCell}>
                <Text style={styles.totalLabel} numberOfLines={1}>{t.label}</Text>
                <Text style={styles.totalVal}>{t.valor}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {filtrados.length === 0 ? (
          <View style={[styles.card, styles.empty]}>
            <Ionicons name="file-tray-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTxt}>{items.length ? 'Ningún registro coincide con la búsqueda.' : 'Aún no hay registros.'}</Text>
          </View>
        ) : filtrados.map((r) => {
          const thumbs = Object.values(r.thumbs || {});
          return (
            <Pressable key={r.id} style={styles.card} onPress={() => (puedeEditar(r) ? abrir(r) : undefined)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={2}>{tituloRegistro(campos, r)}</Text>
                <Text style={styles.fecha}>{fechaCorta(r.fecha)}</Text>
              </View>
              {detalleRegistro(campos, r) ? <Text style={styles.meta} numberOfLines={5}>{detalleRegistro(campos, r)}</Text> : null}
              {thumbs.length ? (
                <View style={styles.thumbs}>
                  {thumbs.slice(0, 4).map((t, i) => (
                    <Image key={i} source={{ uri: t.startsWith('data:') ? t : `data:image/jpeg;base64,${t}` }} style={styles.thumb} resizeMode="cover" />
                  ))}
                </View>
              ) : null}
              <View style={styles.cardBottom}>
                <Text style={styles.meta}>{r.created_by_name ? `Registró: ${r.created_by_name}` : ''}</Text>
                {modulo.usar_jerarquia && r.jerarquia ? <Text style={styles.badge}>{r.jerarquia}</Text> : null}
                {puedeEditar(r) ? (
                  <Pressable hitSlop={8} onPress={() => borrar(r)}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {puedeEscribir && modulo.activo ? (
        <Pressable onPress={nuevo} style={[styles.fab, { bottom: insets.bottom + spacing.md }]}>
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={styles.fabTxt}>Nuevo registro</Text>
        </Pressable>
      ) : null}

      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{draft?.id ? 'Editar' : 'Nuevo'} registro · {modulo.nombre}</Text>
              <Pressable onPress={() => setDraft(null)} hitSlop={10}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.md }}>
              {draft ? (
                <>
                  <Text style={styles.fieldLabel}>Fecha</Text>
                  <TextInput
                    value={draft.fecha} onChangeText={(t) => setDraft((d) => (d ? { ...d, fecha: t } : d))}
                    placeholder="AAAA-MM-DD" placeholderTextColor={colors.textMuted} style={inputStyle} autoCapitalize="none"
                  />
                  {campos.map((f) => (campoVisible(f, draft.valores) ? (
                    <CampoInput
                      key={f.id} campo={f} value={draft.valores[f.id]} onChange={(v) => setValor(f.id, v)}
                      fotoUri={draft.previews[f.id]} onPickFoto={(s) => pickPhoto(f.id, s)} onClearFoto={() => quitarFoto(f.id)}
                    />
                  ) : null))}
                  {modulo.usar_jerarquia ? (
                    <JerarquiaInformePicker value={draft.jerarquia} onChange={(j) => setDraft((d) => (d ? { ...d, jerarquia: j } : d))} />
                  ) : null}
                </>
              ) : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={guardar} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.md },
  desc: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm, lineHeight: 18 },
  aviso: { backgroundColor: colors.warningBg, color: '#92400E', fontSize: 12, fontWeight: '700', padding: spacing.sm, borderRadius: radius.md, marginBottom: spacing.sm, overflow: 'hidden' },
  totales: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  totalCell: { flexGrow: 1, minWidth: '45%', backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.sm },
  totalLabel: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  totalVal: { fontSize: 16, fontWeight: '800', color: colors.primaryDark, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.sm, padding: spacing.md },
  empty: { alignItems: 'center', gap: 6, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.text },
  fecha: { fontSize: 12, fontWeight: '700', color: colors.primary },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 3, lineHeight: 17, flex: 1 },
  thumbs: { flexDirection: 'row', gap: 6, marginTop: 8 },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.border },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 },
  badge: { fontSize: 11, fontWeight: '800', color: colors.primaryDark, backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden', textTransform: 'capitalize' },
  fab: {
    position: 'absolute', right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary,
    paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.full, ...shadow.lg,
  },
  fabTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '92%', width: '100%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs, gap: spacing.sm },
  sheetTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
});
