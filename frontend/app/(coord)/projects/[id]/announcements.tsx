// SynCo v2.0 _ Administracion de Noticias (Coordinador General).
// CRUD completo con fijado, editar y eliminar.
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Announcement, Area, LocationNode } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { fmtDateTimeCDMX } from '@/src/utils/tz';

type Jerarquia = 'urgente' | 'importante' | 'informativo' | null;
type Editing = {
  id?: string;
  title: string;
  body: string;
  pinned: boolean;
  jerarquia: Jerarquia;
  audiencia: string; // 'general' o area_id
  node_id: string | null; // Vincula la noticia a un nodo especifico
} | null;

const JERARQUIA_COLORS: Record<string, { bg: string; bd: string; fg: string; label: string; icon: any }> = {
  urgente: { bg: '#FEE2E2', bd: '#EF4444', fg: '#991B1B', label: 'Urgente', icon: 'flame' },
  importante: { bg: '#FEF3C7', bd: '#F59E0B', fg: '#92400E', label: 'Importante', icon: 'warning' },
  informativo: { bg: '#DBEAFE', bd: '#3B82F6', fg: '#1E40AF', label: 'Informativo', icon: 'information-circle' },
};

export default function CoordAnnouncementsScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';

  const [items, setItems] = useState<Announcement[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
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
      setError(e?.message || 'Error al cargar');
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
    if (!t) { setError('Titulo requerido'); return; }
    if (!b) { setError('Cuerpo requerido'); return; }
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
        });
      } else {
        await api.createAnnouncement(pid, {
          title: t, body: b, pinned: editing.pinned,
          jerarquia: editing.jerarquia,
          severidad: editing.jerarquia,
          audiencia: aud,
          node_id: editing.node_id,
        });
      }
      setEditing(null);
      await load(true);
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function onTogglePin(a: Announcement) {
    try {
      await api.updateAnnouncement(a.id, { pinned: !a.pinned });
      await load(true);
    } catch (e: any) {
      setError(e?.message || 'No se pudo actualizar');
    }
  }

  async function onDelete(a: Announcement) {
    const ok = await confirm(
      'Eliminar noticia',
      `?Eliminar "${a.title}"? Esta accion no se puede deshacer.`,
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    try {
      await api.deleteAnnouncement(a.id);
      await load(true);
    } catch (e: any) {
      setError(e?.message || 'No se pudo eliminar');
    }
  }

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>Noticias</Text>
          <Text style={styles.subtitle}>Anuncios visibles para todo el proyecto</Text>
        </View>
        <Pressable
          onPress={() => setEditing({ title: '', body: '', pinned: false, jerarquia: null, audiencia: 'general', node_id: null })}
          style={styles.newBtn}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.newBtnTxt}>Nueva</Text>
        </Pressable>
      </View>

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
            <Text style={styles.emptyTitle}>Sin noticias publicadas</Text>
            <Text style={styles.emptyMsg}>
              Publica anuncios visibles para Sub-Coordinadores y Especialistas del proyecto.
            </Text>
            <Pressable style={styles.emptyBtn} onPress={() => setEditing({ title: '', body: '', pinned: false, jerarquia: null, audiencia: 'general', node_id: null })}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.emptyBtnTxt}>Publicar primera</Text>
            </Pressable>
          </View>
        ) : (
          items.map((a) => {
            const j = (a.jerarquia || '').toLowerCase();
            const jCfg = JERARQUIA_COLORS[j];
            const audName = a.audiencia && a.audiencia !== 'general'
              ? (areas.find((ar) => ar.id === a.audiencia)?.name || 'Area especifica')
              : 'Todo el proyecto';
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
                  <Pressable style={styles.pinChip} onPress={() => onTogglePin(a)}>
                    <Ionicons
                      name={a.pinned ? 'pin' : 'pin-outline'}
                      size={12}
                      color={a.pinned ? colors.primary : colors.textMuted}
                    />
                    <Text style={[styles.pinChipTxt, a.pinned && { color: colors.primary }]}>
                      {a.pinned ? 'Fijado' : 'Fijar'}
                    </Text>
                  </Pressable>
                  {jCfg ? (
                    <View style={[styles.jerChip, { backgroundColor: jCfg.bg, borderColor: jCfg.bd }]}>
                      <Ionicons name={jCfg.icon} size={11} color={jCfg.fg} />
                      <Text style={[styles.jerChipTxt, { color: jCfg.fg }]}>{jCfg.label}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable
                    onPress={() => setEditing({
                      id: a.id,
                      title: a.title,
                      body: a.body,
                      pinned: a.pinned,
                      jerarquia: (j === 'urgente' || j === 'importante' || j === 'informativo') ? (j as Jerarquia) : null,
                      audiencia: a.audiencia || 'general',
                      node_id: (a as any).node_id || null,
                    })}
                    style={styles.iconAction}
                  >
                    <Ionicons name="create-outline" size={16} color={colors.primary} />
                  </Pressable>
                  <Pressable onPress={() => onDelete(a)} style={[styles.iconAction, { backgroundColor: colors.errorBg }]}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                  </Pressable>
                </View>
              </View>
              <Text style={styles.cardTitle}>{a.title}</Text>
              <Text style={styles.cardBody}>{a.body}</Text>
              <View style={styles.cardMeta}>
                <Ionicons name="person-outline" size={11} color={colors.textMuted} />
                <Text style={styles.cardMetaTxt}>{a.author_name}</Text>
                <Text style={styles.cardMetaDot}>_</Text>
                <Ionicons name="people-outline" size={11} color={colors.textMuted} />
                <Text style={styles.cardMetaTxt}>{audName}</Text>
                <Text style={styles.cardMetaDot}>_</Text>
                <Ionicons name="time-outline" size={11} color={colors.textMuted} />
                <Text style={styles.cardMetaTxt}>{fmtDateTimeCDMX(a.created_at)}</Text>
                {a.expires_at ? (
                  <>
                    <Text style={styles.cardMetaDot}>_</Text>
                    <Text style={[styles.cardMetaTxt, { color: colors.textMuted }]}>{formatExpiry(a.expires_at)}</Text>
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
              {editing?.id ? 'Editar noticia' : 'Nueva noticia'}
            </Text>
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }} keyboardShouldPersistTaps="handled">
              <View>
                <Text style={styles.label}>Titulo</Text>
                <TextInput
                  value={editing?.title || ''}
                  onChangeText={(t) => setEditing((e) => e ? { ...e, title: t } : e)}
                  placeholder="Ej. Cierre Tramo 2 sabado"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  maxLength={140}
                />
                <Text style={styles.helper}>{(editing?.title || '').length} / 140</Text>
              </View>
              <View>
                <Text style={styles.label}>Contenido</Text>
                <TextInput
                  value={editing?.body || ''}
                  onChangeText={(t) => setEditing((e) => e ? { ...e, body: t } : e)}
                  placeholder="Describe la noticia. Las saltos de linea se respetan."
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
                  <Text style={styles.label}>Fijar al inicio</Text>
                  <Text style={styles.helper}>Aparecera arriba del feed para todos los miembros del proyecto.</Text>
                </View>
                <Switch
                  value={!!editing?.pinned}
                  onValueChange={(v) => setEditing((e) => e ? { ...e, pinned: v } : e)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>

              <View>
                <Text style={styles.label}>Jerarquia</Text>
                <View style={styles.chipsRow}>
                  <Pressable
                    onPress={() => setEditing((e) => e ? { ...e, jerarquia: null } : e)}
                    style={[styles.audChip, !editing?.jerarquia && styles.audChipActive]}
                  >
                    <Text style={[styles.audChipTxt, !editing?.jerarquia && styles.audChipTxtActive]}>Sin nivel</Text>
                  </Pressable>
                  {(['urgente', 'importante', 'informativo'] as const).map((k) => {
                    const cfg = JERARQUIA_COLORS[k];
                    const active = editing?.jerarquia === k;
                    return (
                      <Pressable
                        key={k}
                        onPress={() => setEditing((e) => e ? { ...e, jerarquia: k } : e)}
                        style={[
                          styles.audChip,
                          { borderColor: cfg.bd },
                          active && { backgroundColor: cfg.bg, borderWidth: 1.5 },
                        ]}
                      >
                        <Ionicons name={cfg.icon} size={12} color={cfg.fg} />
                        <Text style={[styles.audChipTxt, { color: cfg.fg, fontWeight: '800' }]}>{cfg.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View>
                <Text style={styles.label}>Audiencia</Text>
                <Text style={styles.helper}>Elige a quien va dirigida la noticia.</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
                  <Pressable
                    onPress={() => setEditing((e) => e ? { ...e, audiencia: 'general' } : e)}
                    style={[styles.audChip, (editing?.audiencia || 'general') === 'general' && styles.audChipActive]}
                  >
                    <Ionicons name="globe-outline" size={12} color={(editing?.audiencia || 'general') === 'general' ? '#fff' : colors.textMuted} />
                    <Text style={[styles.audChipTxt, (editing?.audiencia || 'general') === 'general' && styles.audChipTxtActive]}>Todo el proyecto</Text>
                  </Pressable>
                  {areas.map((ar) => {
                    const active = editing?.audiencia === ar.id;
                    return (
                      <Pressable
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

              {/* P0 Mega-Feature: vinculacion opcional a un nodo del arbol */}
              <View>
                <Text style={styles.label}>Vincular a Nodo (opcional)</Text>
                <Text style={styles.helper}>
                  Si lo seleccionas, esta noticia aparecera en la seccion del nodo al exportar reportes (solo si es Importante o Urgente).
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
                  <Pressable
                    onPress={() => setEditing((e) => e ? { ...e, node_id: null } : e)}
                    style={[styles.audChip, !editing?.node_id && styles.audChipActive]}
                  >
                    <Ionicons name="remove-circle-outline" size={12} color={!editing?.node_id ? '#fff' : colors.textMuted} />
                    <Text style={[styles.audChipTxt, !editing?.node_id && styles.audChipTxtActive]}>Sin nodo</Text>
                  </Pressable>
                  {nodes.map((nd) => {
                    const active = editing?.node_id === nd.id;
                    return (
                      <Pressable
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
              <Pressable onPress={() => { setEditing(null); setError(null); }} style={[styles.btn, styles.btnGhost]}>
                <Text style={styles.btnGhostTxt}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={onSave} disabled={saving} style={[styles.btn, styles.btnPrimary, saving && { opacity: 0.6 }]}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryTxt}>{editing?.id ? 'Guardar' : 'Publicar'}</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return 'Por expirar';
  const m = Math.round(diff / 60000);
  if (m < 60) return `Vence en ${m} min`;
  const h = Math.round(m / 60);
  return `Vence en ${h} h`;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
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
