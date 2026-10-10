/**
 * AnnouncementsView — Componente reutilizable de Noticias (Coordinador General).
 * -----------------------------------------------------------------------------
 * Se usa tanto en la pantalla scoped al proyecto (`/projects/[id]/announcements`)
 * como en el tab de nivel raiz (`/noticias`) — mismo patrón que MinutasView.
 *
 * Props:
 *   pid            — id del proyecto (obligatorio; el caller decide con qué proyecto).
 *   embedded       — true = sin flecha de "back" (uso en tabs de nivel raíz).
 *   headerTitle    — override del título del header (default "Noticias").
 *   headerSubtitle — override del subtítulo (default "Anuncios visibles para todo el proyecto").
 *   topPadding     — padding-top extra (útil cuando el caller ya renderiza cabecera).
 *
 * CRUD completo con fijado, editar y eliminar — misma lógica que tenía la
 * pantalla original, solo con el projectId como prop en vez de leerlo del
 * route.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Announcement, Area, LocationNode } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { fmtDateTimeCDMX } from '@/src/utils/tz';
import { a11y, t as tr } from '@/src/i18n';
import { VigenciaSelector } from '@/src/components/VigenciaSelector';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import {
  etiquetaVigencia, textoTiempoRestante, VigenciaHoras, vigenciaParaGuardar, vigenciaValida, VIGENCIA_POR_DEFECTO,
} from '@/src/utils/vigenciaNoticias';

type Jerarquia = 'urgente' | 'importante' | 'informativo' | null;
type Editing = {
  id?: string;
  title: string;
  body: string;
  pinned: boolean;
  jerarquia: Jerarquia;
  audiencia: string; // 'general' o area_id
  node_id: string | null; // Vincula la noticia a un nodo especifico
  vigencia: VigenciaHoras;
  /** Vigencia con la que se abrió la edición (null al crear): solo se envía si cambia. */
  vigenciaOriginal: VigenciaHoras | null;
} | null;

const JERARQUIA_COLORS: Record<string, { bg: string; bd: string; fg: string; icon: any }> = {
  urgente: { bg: '#FEE2E2', bd: '#EF4444', fg: '#991B1B', icon: 'flame' },
  importante: { bg: '#FEF3C7', bd: '#F59E0B', fg: '#92400E', icon: 'warning' },
  informativo: { bg: '#DBEAFE', bd: '#3B82F6', fg: '#1E40AF', icon: 'information-circle' },
};

function jerarquiaLabel(clave: string): string {
  if (clave === 'urgente') return tr('noticias.urgente');
  if (clave === 'importante') return tr('noticias.importante');
  return tr('noticias.informativo');
}

interface AnnouncementsViewProps {
  pid: string;
  embedded?: boolean;
  headerTitle?: string;
  headerSubtitle?: string;
  topPadding?: number;
}

export default function AnnouncementsView({
  pid,
  embedded = false,
  headerTitle,
  headerSubtitle,
  topPadding,
}: AnnouncementsViewProps) {
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<Announcement[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!pid) return;
    try {
      if (!silent) setLoading(true);
      setError(null);
      const [data, ars, nds] = await Promise.all([
        api.listAnnouncements(pid),
        api.listAreas(pid).catch(() => [] as Area[]),
        api.listNodes(pid).catch(() => [] as LocationNode[]),
      ]);
      setItems(data);
      setAreas(ars || []);
      setNodes(nds || []);
    } catch (e: any) {
      setError(e?.message || tr('noticias.errorCargar'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pid]);

  useFocusEffect(useCallback(() => { load(false); }, [load]));

  async function onSave() {
    if (!editing) return;
    const t = editing.title.trim();
    const b = editing.body.trim();
    if (!t) { setError(tr('noticias.tituloRequerido')); return; }
    if (!b) { setError(tr('noticias.contenidoRequerido')); return; }
    try {
      setSaving(true);
      setError(null);
      const aud = editing.audiencia || 'general';
      if (editing.id) {
        await api.updateAnnouncement(editing.id, {
          title: t, body: b, pinned: editing.pinned,
          jerarquia: editing.jerarquia,
          severidad: editing.jerarquia,
          audiencia: aud,
          node_id: editing.node_id,
          // Cambiar la vigencia reinicia el plazo desde este momento; si no cambió, no se envía.
          ...vigenciaParaGuardar(editing.vigencia, editing.vigenciaOriginal),
        });
      } else {
        await api.createAnnouncement(pid, {
          title: t, body: b, pinned: editing.pinned,
          jerarquia: editing.jerarquia,
          severidad: editing.jerarquia,
          audiencia: aud,
          node_id: editing.node_id,
          vigencia_horas: editing.vigencia,
        });
      }
      setEditing(null);
      await load(true);
    } catch (e: any) {
      setError(e?.message || tr('noticias.noSeGuardo'));
    } finally {
      setSaving(false);
    }
  }

  async function onTogglePin(a: Announcement) {
    try {
      await api.updateAnnouncement(a.id, { pinned: !a.pinned });
      await load(true);
    } catch (e: any) {
      setError(e?.message || tr('noticias.noSeActualizo'));
    }
  }

  async function onDelete(a: Announcement) {
    const ok = await confirm(
      tr('noticias.eliminarTitulo'),
      tr('noticias.eliminarConNombre', { titulo: a.title }),
      { confirmText: tr('noticias.eliminar'), destructive: true },
    );
    if (!ok) return;
    try {
      await api.deleteAnnouncement(a.id);
      await load(true);
    } catch (e: any) {
      setError(e?.message || tr('noticias.noSeElimino'));
    }
  }

  const tituloVista = headerTitle || tr('noticias.titulo');
  const subtituloVista = headerSubtitle || tr('noticias.vistaSubtitulo');
  const botonNueva = (
    <Pressable accessibilityRole="button"
      onPress={() => setEditing({ title: '', body: '', pinned: false, jerarquia: null, audiencia: 'general', node_id: null, vigencia: VIGENCIA_POR_DEFECTO, vigenciaOriginal: null })}
      style={styles.newBtn}
    >
      <Ionicons name="add" size={18} color="#fff" />
      <Text style={styles.newBtnTxt}>{tr('noticias.nuevaCorta')}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.flex, { paddingTop: embedded ? (topPadding !== undefined ? topPadding : insets.top) : (topPadding ?? 0) }]}>
      {embedded ? (
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{tituloVista}</Text>
            <Text style={styles.subtitle}>{subtituloVista}</Text>
          </View>
          {botonNueva}
        </View>
      ) : (
        <ScreenHeader title={tituloVista} subtitle={subtituloVista} safeArea={topPadding === undefined} right={botonNueva} />
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="newspaper-outline" size={26} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>{tr('noticias.sinPublicadas')}</Text>
            <Text style={styles.emptyMsg}>{tr('noticias.sinPublicadasMensaje')}</Text>
            <Pressable accessibilityRole="button" style={styles.emptyBtn} onPress={() => setEditing({ title: '', body: '', pinned: false, jerarquia: null, audiencia: 'general', node_id: null, vigencia: VIGENCIA_POR_DEFECTO, vigenciaOriginal: null })}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.emptyBtnTxt}>{tr('noticias.publicarPrimera')}</Text>
            </Pressable>
          </View>
        ) : (
          items.map((a) => {
            const j = (a.jerarquia || '').toLowerCase();
            const jCfg = JERARQUIA_COLORS[j];
            const audName = a.audiencia && a.audiencia !== 'general'
              ? (areas.find((ar) => ar.id === a.audiencia)?.name || tr('noticias.areaEspecifica'))
              : tr('noticias.todoProyecto');
            return (
            <View
              key={a.id}
              style={[
                styles.card,
                a.pinned && styles.cardPinned,
                jCfg && { borderLeftColor: jCfg.bd, borderLeftWidth: 4, backgroundColor: jCfg.bg + '40' },
              ]}
            >
              <View style={styles.cardTopRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                  <Pressable accessibilityRole="button" style={styles.pinChip} onPress={() => onTogglePin(a)}>
                    <Ionicons
                      name={a.pinned ? 'pin' : 'pin-outline'}
                      size={12}
                      color={a.pinned ? colors.primary : colors.textMuted}
                    />
                    <Text style={[styles.pinChipTxt, a.pinned && { color: colors.primary }]}>
                      {a.pinned ? tr('noticias.fijado') : tr('noticias.fijar')}
                    </Text>
                  </Pressable>
                  {jCfg ? (
                    <View style={[styles.jerChip, { backgroundColor: jCfg.bg, borderColor: jCfg.bd }]}>
                      <Ionicons name={jCfg.icon} size={11} color={jCfg.fg} />
                      <Text style={[styles.jerChipTxt, { color: jCfg.fg }]}>{jerarquiaLabel(j)}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('editar')} hitSlop={8}
                    onPress={() => setEditing({
                      id: a.id,
                      title: a.title,
                      body: a.body,
                      pinned: a.pinned,
                      jerarquia: (j === 'urgente' || j === 'importante' || j === 'informativo') ? (j as Jerarquia) : null,
                      audiencia: a.audiencia || 'general',
                      node_id: (a as any).node_id || null,
                      vigencia: vigenciaValida(a.vigencia_horas),
                      vigenciaOriginal: vigenciaValida(a.vigencia_horas),
                    })}
                    style={styles.iconAction}
                  >
                    <Ionicons name="create-outline" size={16} color={colors.primary} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} hitSlop={8} onPress={() => onDelete(a)} style={[styles.iconAction, { backgroundColor: colors.errorBg }]}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                  </Pressable>
                </View>
              </View>
              <Text style={styles.cardTitle}>{a.title}</Text>
              <Text style={styles.cardBody}>{a.body}</Text>
              <View style={styles.cardMeta}>
                <Ionicons name="person-outline" size={11} color={colors.textMuted} />
                <Text style={styles.cardMetaTxt}>{a.author_name}</Text>
                <Text style={styles.cardMetaDot}>·</Text>
                <Ionicons name="people-outline" size={11} color={colors.textMuted} />
                <Text style={styles.cardMetaTxt}>{audName}</Text>
                <Text style={styles.cardMetaDot}>·</Text>
                <Ionicons name="time-outline" size={11} color={colors.textMuted} />
                <Text style={styles.cardMetaTxt}>{fmtDateTimeCDMX(a.created_at)}</Text>
                {a.expires_at ? (
                  <>
                    <Text style={styles.cardMetaDot}>·</Text>
                    <Text style={[styles.cardMetaTxt, { color: colors.textMuted }]}>
                      {`${tr('noticiasVigencia.vigenciaCorta', { vigencia: etiquetaVigencia(vigenciaValida(a.vigencia_horas)) })} · ${textoTiempoRestante(a.expires_at)}`}
                    </Text>
                  </>
                ) : null}
              </View>
            </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalRoot}
        >
          <View style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {editing?.id ? tr('noticias.editar') : tr('noticias.nueva')}
            </Text>
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }} keyboardShouldPersistTaps="handled">
              <View>
                <Text style={styles.label}>{tr('noticias.tituloEtiqueta')}</Text>
                <TextInput
                  value={editing?.title || ''}
                  onChangeText={(t) => setEditing((e) => e ? { ...e, title: t } : e)}
                  placeholder={tr('noticias.tituloEjemploVista')}
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  maxLength={140}
                />
                <Text style={styles.helper}>{(editing?.title || '').length} / 140</Text>
              </View>
              <View>
                <Text style={styles.label}>{tr('noticias.contenidoEtiqueta')}</Text>
                <TextInput
                  value={editing?.body || ''}
                  onChangeText={(t) => setEditing((e) => e ? { ...e, body: t } : e)}
                  placeholder={tr('noticias.contenidoAyuda')}
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.inputArea]}
                  multiline
                  maxLength={4000}
                  textAlignVertical="top"
                />
                <Text style={styles.helper}>{(editing?.body || '').length} / 4000</Text>
              </View>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{tr('noticias.fijarAlInicio')}</Text>
                  <Text style={styles.helper}>{tr('noticias.fijarAyuda')}</Text>
                </View>
                <Switch
                  value={!!editing?.pinned}
                  onValueChange={(v) => setEditing((e) => e ? { ...e, pinned: v } : e)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>

              <VigenciaSelector
                value={editing?.vigencia ?? VIGENCIA_POR_DEFECTO}
                onChange={(v) => setEditing((e) => e ? { ...e, vigencia: v } : e)}
                disabled={saving}
                edicion={!!editing?.id}
              />

              <View>
                <Text style={styles.label}>{tr('noticias.jerarquia')}</Text>
                <View style={styles.chipsRow}>
                  <Pressable accessibilityRole="button"
                    onPress={() => setEditing((e) => e ? { ...e, jerarquia: null } : e)}
                    style={[styles.audChip, !editing?.jerarquia && styles.audChipActive]}
                  >
                    <Text style={[styles.audChipTxt, !editing?.jerarquia && styles.audChipTxtActive]}>{tr('noticias.sinNivel')}</Text>
                  </Pressable>
                  {(['urgente', 'importante', 'informativo'] as const).map((k) => {
                    const cfg = JERARQUIA_COLORS[k];
                    const active = editing?.jerarquia === k;
                    return (
                      <Pressable accessibilityRole="button"
                        key={k}
                        onPress={() => setEditing((e) => e ? { ...e, jerarquia: k } : e)}
                        style={[
                          styles.audChip,
                          { borderColor: cfg.bd },
                          active && { backgroundColor: cfg.bg, borderWidth: 1.5 },
                        ]}
                      >
                        <Ionicons name={cfg.icon} size={12} color={cfg.fg} />
                        <Text style={[styles.audChipTxt, { color: cfg.fg, fontWeight: '800' }]}>{jerarquiaLabel(k)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View>
                <Text style={styles.label}>{tr('noticias.audiencia')}</Text>
                <Text style={styles.helper}>{tr('noticias.audienciaAyuda')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
                  <Pressable accessibilityRole="button"
                    onPress={() => setEditing((e) => e ? { ...e, audiencia: 'general' } : e)}
                    style={[styles.audChip, (editing?.audiencia || 'general') === 'general' && styles.audChipActive]}
                  >
                    <Ionicons name="globe-outline" size={12} color={(editing?.audiencia || 'general') === 'general' ? '#fff' : colors.textMuted} />
                    <Text style={[styles.audChipTxt, (editing?.audiencia || 'general') === 'general' && styles.audChipTxtActive]}>{tr('noticias.todoProyecto')}</Text>
                  </Pressable>
                  {areas.map((ar) => {
                    const active = editing?.audiencia === ar.id;
                    return (
                      <Pressable accessibilityRole="button"
                        key={ar.id}
                        onPress={() => setEditing((e) => e ? { ...e, audiencia: ar.id } : e)}
                        style={[styles.audChip, active && styles.audChipActive]}
                      >
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ar.color || colors.primary }} />
                        <Text style={[styles.audChipTxt, active && styles.audChipTxtActive]}>{ar.name}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View>
                <Text style={styles.label}>{tr('noticias.vincularNodoOpcional')}</Text>
                <Text style={styles.helper}>{tr('noticias.vincularAyuda')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
                  <Pressable accessibilityRole="button"
                    onPress={() => setEditing((e) => e ? { ...e, node_id: null } : e)}
                    style={[styles.audChip, !editing?.node_id && styles.audChipActive]}
                  >
                    <Ionicons name="remove-circle-outline" size={12} color={!editing?.node_id ? '#fff' : colors.textMuted} />
                    <Text style={[styles.audChipTxt, !editing?.node_id && styles.audChipTxtActive]}>{tr('noticias.sinNodo')}</Text>
                  </Pressable>
                  {nodes.map((nd) => {
                    const active = editing?.node_id === nd.id;
                    return (
                      <Pressable accessibilityRole="button"
                        key={nd.id}
                        onPress={() => setEditing((e) => e ? { ...e, node_id: nd.id } : e)}
                        style={[styles.audChip, active && styles.audChipActive]}
                      >
                        <Ionicons name="git-branch-outline" size={12} color={active ? '#fff' : colors.textMuted} />
                        <Text style={[styles.audChipTxt, active && styles.audChipTxtActive]} numberOfLines={1}>
                          {nd.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
              {error ? <Text style={[styles.errorText, { textAlign: 'center' }]}>{error}</Text> : null}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" onPress={() => { setEditing(null); setError(null); }} style={[styles.btn, styles.btnGhost]}>
                <Text style={styles.btnGhostTxt}>{tr('noticias.cancelar')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={onSave} disabled={saving} style={[styles.btn, styles.btnPrimary, saving && { opacity: 0.6 }]}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryTxt}>{editing?.id ? tr('noticias.guardar') : tr('noticias.publicar')}</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full,
  },
  newBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
  scroll: { paddingHorizontal: spacing.md, gap: spacing.sm },
  center: { padding: spacing.xl, alignItems: 'center' },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: 6, ...shadow.card,
  },
  cardPinned: { borderColor: colors.primary, borderWidth: 1.5 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pinChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  pinChipTxt: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  iconAction: {
    width: 28, height: 28, borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  cardBody: { fontSize: 13, color: colors.textBody, lineHeight: 20 },
  cardMeta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 4, paddingTop: 8, borderTopColor: colors.border, borderTopWidth: 1,
  },
  cardMetaTxt: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  cardMetaDot: { fontSize: 11, color: colors.textMuted, marginHorizontal: 2 },

  empty: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyMsg: { fontSize: 12, color: colors.textBody, textAlign: 'center', lineHeight: 18 },
  emptyBtn: {
    marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md,
  },
  emptyBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md,
  },
  errorText: { color: colors.error, fontSize: 12, fontWeight: '700', flex: 1 },

  // Modal
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.md,
    paddingBottom: spacing.lg,
    maxHeight: '90%',
  },
  modalHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, marginBottom: spacing.sm,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  label: { fontSize: 11, fontWeight: '800', color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text,
  },
  inputArea: { minHeight: 120 },
  helper: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  btnGhostTxt: { color: colors.text, fontWeight: '800', fontSize: 14 },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // Chips de jerarquia y audiencia
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  jerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full, borderWidth: 1,
  },
  jerChipTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  audChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
  },
  audChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  audChipTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  audChipTxtActive: { color: '#fff' },
});
