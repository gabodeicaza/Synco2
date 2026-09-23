// SynCo v2.0 _ Tab "Noticias" del Especialista / Sub-Coord.
// Cualquier miembro del proyecto puede crear noticias. El autor o el Coord
// pueden editar/eliminar/fijar. Toda noticia (fijada o no) desaparece sola
// 24h despues de publicada _ el backend deja de listarla pasado ese plazo.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, AppStateStatus, KeyboardAvoidingView,
  Modal, Platform, Pressable, RefreshControl, ScrollView, StatusBar,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import { api, Announcement, Area, LocationNode } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { a11y } from '@/src/i18n';

const POLL_MS = 60000;

const JERARQUIA_COLORS: Record<string, { bg: string; bd: string; fg: string; label: string; icon: any }> = {
  urgente: { bg: '#FEE2E2', bd: '#EF4444', fg: '#991B1B', label: 'Urgente', icon: 'flame' },
  importante: { bg: '#FEF3C7', bd: '#F59E0B', fg: '#92400E', label: 'Importante', icon: 'warning' },
  informativo: { bg: '#DBEAFE', bd: '#3B82F6', fg: '#1E40AF', label: 'Informativo', icon: 'information-circle' },
};

type EditorState =
  | { kind: 'create' }
  | { kind: 'edit'; item: Announcement }
  | null;

export default function NoticiasScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const projectId = (user?.project_ids || [])[0] || '';
  const isCoord = user?.role === 'coordinador_general';

  const [items, setItems] = useState<Announcement[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!projectId) { setLoading(false); setError('Sin proyecto asignado'); return; }
    try {
      if (!silent) setLoading(true);
      setError(null);
      const data = await api.listAnnouncements(projectId);
      setItems(data);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar las noticias');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    if (!projectId) return;
    api.listAreas(projectId).then(setAreas).catch(() => setAreas([]));
    api.listNodes(projectId).then(setNodes).catch(() => setNodes([]));
  }, [projectId]);

  useEffect(() => {
    function start() {
      if (pollRef.current) return;
      pollRef.current = setInterval(() => { load(true); }, POLL_MS);
    }
    function stop() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    start();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') { load(true); start(); } else { stop(); }
    });
    return () => { stop(); sub.remove(); };
  }, [load]);

  const onDelete = useCallback((it: Announcement) => {
    const confirm = () => {
      api.deleteAnnouncement(it.id).then(() => load(true)).catch((e) => {
        Alert.alert('Error', e?.message || 'No se pudo eliminar');
      });
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('?Eliminar esta noticia? Esta accion no se puede deshacer.')) confirm();
    } else {
      Alert.alert('Eliminar noticia', '?Seguro que deseas eliminarla?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: confirm },
      ]);
    }
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.blueTop, { height: 140 + insets.top }]} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerIcon}>
          <Ionicons name="newspaper" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Noticias</Text>
          <Text style={styles.headerSubtitle}>Anuncios del equipo del proyecto</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('actualizar')} onPress={() => load(false)} hitSlop={10} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={18} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 96, gap: spacing.sm }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(true); }}
            tintColor="#fff"
            colors={[colors.primary]}
          />
        }
      >
        {loading ? (
          <View style={styles.centerPad}><ActivityIndicator color={colors.primary} /></View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.error} />
            <Text style={styles.errorTxt}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => load(false)} style={styles.retryBtn}>
              <Text style={styles.retryTxt}>Reintentar</Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIcon}>
              <Ionicons name="newspaper-outline" size={28} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>Aun no hay noticias</Text>
            <Text style={styles.emptyMsg}>
              Toca el boton "+" para publicar el primer anuncio del proyecto.
            </Text>
          </View>
        ) : (
          items.map((a) => (
            <AnnouncementCard
              key={a.id}
              item={a}
              areas={areas}
              canEdit={isCoord || a.author_id === user?.id}
              onEdit={() => setEditor({ kind: 'edit', item: a })}
              onDelete={() => onDelete(a)}
              onTogglePin={
                (isCoord || a.author_id === user?.id)
                  ? () => {
                      api.updateAnnouncement(a.id, { pinned: !a.pinned })
                        .then(() => load(true))
                        .catch((e) => Alert.alert('Error', e?.message || 'No se pudo actualizar'));
                    }
                  : undefined
              }
            />
          ))
        )}
      </ScrollView>

      <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} hitSlop={8} onPress={() => setEditor({ kind: 'create' })} style={[styles.fab, { bottom: insets.bottom + 16 }]}>
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>

      <AnnouncementEditor
        visible={!!editor}
        editor={editor}
        canPin={isCoord || editor?.kind === 'create' || (editor?.kind === 'edit' && editor.item.author_id === user?.id)}
        areas={areas}
        nodes={nodes}
        onClose={() => setEditor(null)}
        onSaved={() => { setEditor(null); load(true); }}
        projectId={projectId}
      />
    </View>
  );
}

function AnnouncementCard({
  item, areas, canEdit, onEdit, onDelete, onTogglePin,
}: {
  item: Announcement;
  areas: Area[];
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin?: () => void;
}) {
  const jq = (item.jerarquia || '').toString().toLowerCase();
  const jStyle = JERARQUIA_COLORS[jq];
  const audKey = (item.audiencia || '').toString().toLowerCase();
  const audArea = areas.find(a => a.name.toLowerCase() === audKey);
  const audLabel = item.audiencia
    ? (audArea ? audArea.name : item.audiencia)
    : null;
  const audColor = audArea?.color || colors.primary;
  return (
    <View style={[
      styles.card,
      item.pinned && styles.cardPinned,
      jStyle && { borderLeftWidth: 4, borderLeftColor: jStyle.bd, backgroundColor: jStyle.bg },
    ]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {item.pinned ? (
          <View style={styles.pinnedRow}>
            <Ionicons name="pin" size={11} color={colors.primary} />
            <Text style={styles.pinnedTxt}>Fijado</Text>
          </View>
        ) : null}
        {item.expires_at ? (
          <Text style={styles.expiresTxt}>{formatExpiry(item.expires_at)}</Text>
        ) : null}
        {jStyle ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: jStyle.bd, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
            <Ionicons name={jStyle.icon} size={11} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>{jStyle.label.toUpperCase()}</Text>
          </View>
        ) : null}
        {audLabel ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: audColor + '22', borderColor: audColor, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
            <Ionicons name="people" size={11} color={audColor} />
            <Text style={{ color: audColor, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>{audLabel.toUpperCase()}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.cardBody}>{item.body}</Text>
      <View style={styles.cardMeta}>
        <Ionicons name="person-circle-outline" size={13} color={colors.textMuted} />
        <Text style={styles.cardMetaTxt}>{item.author_name}</Text>
        <Text style={styles.cardMetaDot}>_</Text>
        <Ionicons name="time-outline" size={12} color={colors.textMuted} />
        <Text style={styles.cardMetaTxt}>{formatDate(item.created_at)}</Text>
        <View style={{ flex: 1 }} />
        {onTogglePin ? (
          <Pressable accessibilityRole="button" accessibilityLabel={a11y(item.pinned ? 'desfijar' : 'fijar')} hitSlop={8} onPress={onTogglePin} style={styles.iconBtn}>
            <Ionicons name={item.pinned ? 'pin' : 'pin-outline'} size={16} color={colors.primary} />
          </Pressable>
        ) : null}
        {canEdit ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('editar')} hitSlop={8} onPress={onEdit} style={styles.iconBtn}>
              <Ionicons name="create-outline" size={16} color={colors.primary} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} hitSlop={8} onPress={onDelete} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={16} color={colors.error} />
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

function AnnouncementEditor({
  visible, editor, canPin, areas, nodes, onClose, onSaved, projectId,
}: {
  visible: boolean;
  editor: EditorState;
  canPin: boolean;
  areas: Area[];
  nodes: LocationNode[];
  onClose: () => void;
  onSaved: () => void;
  projectId: string;
}) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [jerarquia, setJerarquia] = useState<'urgente' | 'importante' | 'informativo' | null>(null);
  const [audiencia, setAudiencia] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (editor?.kind === 'edit') {
      setTitle(editor.item.title);
      setBody(editor.item.body);
      setPinned(!!editor.item.pinned);
      const j = (editor.item.jerarquia || '').toString().toLowerCase();
      setJerarquia((['urgente', 'importante', 'informativo'].includes(j) ? j : null) as any);
      setAudiencia(editor.item.audiencia || null);
      setNodeId((editor.item as any).node_id || null);
    } else {
      setTitle(''); setBody(''); setPinned(false); setJerarquia(null); setAudiencia(null); setNodeId(null);
    }
    setErr(null);
  }, [visible, editor]);

  async function submit() {
    setErr(null);
    const t = title.trim();
    const b = body.trim();
    if (!t) { setErr('Titulo obligatorio'); return; }
    if (!b) { setErr('Cuerpo obligatorio'); return; }
    setBusy(true);
    try {
      const payload: any = { title: t, body: b, jerarquia, audiencia, node_id: nodeId };
      if (canPin) payload.pinned = pinned;

      if (editor?.kind === 'edit') {
        await api.updateAnnouncement(editor.item.id, payload);
      } else {
        await api.createAnnouncement(projectId, payload);
      }
      // [FIX 2026-07] Notificacion local inmediata
      const { triggerLocalNotification } = await import('@/src/utils/pushNotifications');
      triggerLocalNotification('__ Nueva Noticia', `Se ha publicado: ${t.trim()}`);
      onSaved();
    } catch (e: any) {
      setErr(e?.message || 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>
                {editor?.kind === 'edit' ? 'Editar noticia' : 'Nueva noticia'}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textBody} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: spacing.sm }}>
              <Text style={styles.modalLabel}>Titulo</Text>
              <TextInput
                value={title} onChangeText={setTitle}
                placeholder="Ej. Suspension de actividades 18-jul"
                placeholderTextColor={colors.textMuted}
                style={styles.modalInput} editable={!busy} maxLength={140}
              />
              <Text style={styles.modalLabel}>Cuerpo</Text>
              <TextInput
                value={body} onChangeText={setBody}
                placeholder="Contenido completo del anuncio_"
                placeholderTextColor={colors.textMuted}
                style={[styles.modalInput, { minHeight: 120, textAlignVertical: 'top' }]}
                multiline editable={!busy} maxLength={4000}
              />
              <Text style={styles.modalLabel}>Jerarquia (opcional)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[
                  { key: null, label: 'Ninguna', bd: colors.textMuted },
                  { key: 'urgente', label: 'Urgente', bd: '#EF4444' },
                  { key: 'importante', label: 'Importante', bd: '#F59E0B' },
                  { key: 'informativo', label: 'Informativo', bd: '#3B82F6' },
                ].map((opt) => {
                  const active = jerarquia === opt.key;
                  return (
                    <Pressable accessibilityRole="button"
                      key={String(opt.key)}
                      onPress={() => setJerarquia(opt.key as any)}
                      disabled={busy}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                        borderWidth: 1.5, borderColor: opt.bd,
                        backgroundColor: active ? opt.bd : 'transparent',
                      }}
                    >
                      <Text style={{ color: active ? '#fff' : opt.bd, fontWeight: '700', fontSize: 12 }}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.modalLabel}>Audiencia (opcional)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Pressable accessibilityRole="button"
                  onPress={() => setAudiencia(null)}
                  disabled={busy}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                    borderWidth: 1.5, borderColor: colors.textMuted,
                    backgroundColor: audiencia === null ? colors.textMuted : 'transparent',
                  }}
                >
                  <Text style={{ color: audiencia === null ? '#fff' : colors.textMuted, fontWeight: '700', fontSize: 12 }}>Todos</Text>
                </Pressable>
                {areas.map((a) => {
                  const active = (audiencia || '').toLowerCase() === a.name.toLowerCase();
                  return (
                    <Pressable accessibilityRole="button"
                      key={a.id}
                      onPress={() => setAudiencia(a.name)}
                      disabled={busy}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                        borderWidth: 1.5, borderColor: a.color,
                        backgroundColor: active ? a.color : 'transparent',
                      }}
                    >
                      <Text style={{ color: active ? '#fff' : a.color, fontWeight: '700', fontSize: 12 }}>{a.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {canPin ? (
                <View style={styles.pinRow}>
                  <Ionicons name="pin" size={14} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pinLabel}>Fijar al inicio del feed</Text>
                    <Text style={styles.pinHint}>La noticia dura maximo 24h, fijada o no</Text>
                  </View>
                  <Switch value={pinned} onValueChange={setPinned} disabled={busy} />
                </View>
              ) : null}
              <Text style={styles.modalLabel}>Vincular a Nodo / Ubicacion (opcional)</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: -4 }}>
                Si la noticia es <Text style={{ fontWeight: '800' }}>Importante</Text> o <Text style={{ fontWeight: '800' }}>Urgente</Text>, aparecera como nota dentro de la seccion del nodo en las exportaciones.
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
                <Pressable accessibilityRole="button"
                  onPress={() => setNodeId(null)}
                  disabled={busy}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                    borderWidth: 1.5, borderColor: colors.textMuted,
                    backgroundColor: nodeId === null ? colors.textMuted : 'transparent',
                  }}
                >
                  <Ionicons name="remove-circle-outline" size={12} color={nodeId === null ? '#fff' : colors.textMuted} />
                  <Text style={{ color: nodeId === null ? '#fff' : colors.textMuted, fontWeight: '700', fontSize: 12 }}>Sin nodo</Text>
                </Pressable>
                {nodes.map((nd) => {
                  const active = nodeId === nd.id;
                  return (
                    <Pressable accessibilityRole="button"
                      key={nd.id}
                      onPress={() => setNodeId(nd.id)}
                      disabled={busy}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                        borderWidth: 1.5, borderColor: colors.primary,
                        backgroundColor: active ? colors.primary : 'transparent',
                        maxWidth: 240,
                      }}
                    >
                      <Ionicons name="git-branch-outline" size={12} color={active ? '#fff' : colors.primary} />
                      <Text
                        numberOfLines={1}
                        style={{ color: active ? '#fff' : colors.primary, fontWeight: '700', fontSize: 12 }}
                      >
                        {nd.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {err ? (
                <View style={styles.errInline}>
                  <Ionicons name="alert-circle" size={14} color={colors.error} />
                  <Text style={styles.errInlineTxt}>{err}</Text>
                </View>
              ) : null}
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={submit} style={[styles.saveBtn, busy && { opacity: 0.7 }]} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>{editor?.kind === 'edit' ? 'Guardar cambios' : 'Publicar'}</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '_';
  const now = Date.now();
  const diff = now - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Hace instantes';
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  const dy = Math.floor(h / 24);
  if (dy < 7) return `Hace ${dy} d`;
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  blueTop: {
    position: 'absolute', top: 0, left: 0, right: 0,
    backgroundColor: colors.primary,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  headerIcon: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 1 },
  refreshBtn: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: 6, ...shadow.card,
  },
  cardPinned: { borderColor: colors.primary, borderWidth: 1.5 },
  pinnedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  pinnedTxt: { fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 0.6, textTransform: 'uppercase' },
  expiresTxt: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  cardBody: { fontSize: 13, color: colors.textBody, lineHeight: 20 },
  cardMeta: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
    paddingTop: 8, borderTopColor: colors.border, borderTopWidth: 1,
  },
  cardMetaTxt: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  cardMetaDot: { fontSize: 11, color: colors.textMuted, marginHorizontal: 2 },
  iconBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  centerPad: { padding: spacing.xl, alignItems: 'center' },
  errorBox: {
    padding: spacing.lg, alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  errorTxt: { textAlign: 'center', color: colors.textBody, fontSize: 13 },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md },
  retryTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  emptyBox: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
    alignItems: 'center', gap: 6, ...shadow.card,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyMsg: { fontSize: 12, color: colors.textBody, textAlign: 'center', lineHeight: 18 },
  // FAB
  fab: {
    position: 'absolute', right: 18, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    ...shadow.card,
  },
  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.md, gap: spacing.sm,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  modalLabel: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginTop: 4 },
  modalInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text,
    backgroundColor: colors.bg,
  },
  pinRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primaryLight, padding: 10, borderRadius: radius.md,
  },
  pinLabel: { fontSize: 12, fontWeight: '700', color: colors.primary },
  pinHint: { fontSize: 10, color: colors.primary, opacity: 0.8, marginTop: 1 },
  errInline: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.errorBg, padding: 8, borderRadius: radius.sm,
  },
  errInlineTxt: { color: colors.error, fontSize: 12, fontWeight: '700' },
  saveBtn: {
    backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs,
  },
  saveTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
