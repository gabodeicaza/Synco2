// SynCo v2.0 _ Tab "Mensajes" con canales tipo Slack/WhatsApp.
// Vista 1 (Lista): canales del proyecto agrupados (General _ Areas _ Directos).
// Vista 2 (Chat): mensajes del canal seleccionado con polling 6s.
// Single-file state machine para evitar restructurar el routing del tab.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, AppStateStatus, FlatList,
  KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl,
  StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import { api, Channel, Message, User } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { dayjs, CDMX_TZ, fmtTimeCDMX } from '@/src/utils/tz';
import { a11y } from '@/src/i18n';

const POLL_MS = 6000;

type ScreenView = { kind: 'list' } | { kind: 'chat'; channel: Channel };

export default function MensajesScreen() {
  const { user } = useAuth();
  const projectId = (user?.project_ids || [])[0] || '';
  return <MensajesView projectId={projectId} />;
}

export function MensajesView({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [view, setView] = useState<ScreenView>({ kind: 'list' });

  // ---- Lista de canales -----------------------------------------------------
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [errorList, setErrorList] = useState<string | null>(null);
  const [refreshingList, setRefreshingList] = useState(false);
  const [showDmPicker, setShowDmPicker] = useState(false);
  const listPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadChannels = useCallback(async (silent = false) => {
    if (!projectId) { setLoadingList(false); setErrorList('Sin proyecto asignado'); return; }
    try {
      if (!silent) setLoadingList(true);
      setErrorList(null);
      const data = await api.listChannels(projectId);
      setChannels(data);
    } catch (e: any) {
      setErrorList(e?.message || 'No se pudieron cargar los canales');
    } finally {
      setLoadingList(false);
      setRefreshingList(false);
    }
  }, [projectId]);

  useEffect(() => { loadChannels(false); }, [loadChannels]);

  // Polling de la lista de canales solo cuando estamos en vista de lista
  useEffect(() => {
    function start() {
      if (listPollRef.current) return;
      listPollRef.current = setInterval(() => { loadChannels(true); }, 30000);
    }
    function stop() {
      if (listPollRef.current) { clearInterval(listPollRef.current); listPollRef.current = null; }
    }
    if (view.kind === 'list') start(); else stop();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active' && view.kind === 'list') { loadChannels(true); start(); } else { stop(); }
    });
    return () => { stop(); sub.remove(); };
  }, [loadChannels, view.kind]);

  if (view.kind === 'chat') {
    return (
      <ChatView
        channel={view.channel}
        userId={user?.id || ''}
        userRole={user?.role || ''}
        onBack={() => { setView({ kind: 'list' }); loadChannels(true); }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.blueTop, { height: 140 + insets.top }]} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerIcon}>
          <Ionicons name="chatbubbles" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Mensajes</Text>
          <Text style={styles.headerSubtitle}>Canales del proyecto</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('actualizar')} onPress={() => loadChannels(false)} hitSlop={10} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={18} color="#fff" />
        </Pressable>
      </View>

      {loadingList ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : errorList ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={22} color={colors.error} />
          <Text style={styles.errorTxt}>{errorList}</Text>
          <Pressable accessibilityRole="button" onPress={() => loadChannels(false)} style={styles.retryBtn}>
            <Text style={styles.retryTxt}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={channelsWithSeparators(channels)}
          keyExtractor={(it) => (it.kind === 'sep' ? `sep-${it.label}` : `ch-${it.channel.id}`)}
          contentContainerStyle={{ paddingBottom: 96, paddingHorizontal: spacing.md }}
          refreshControl={
            <RefreshControl
              refreshing={refreshingList}
              onRefresh={() => { setRefreshingList(true); loadChannels(true); }}
              tintColor="#fff"
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Ionicons name="chatbubbles-outline" size={28} color={colors.primary} /></View>
              <Text style={styles.emptyTitle}>Sin canales aun</Text>
              <Text style={styles.emptyMsg}>El canal General se crea automaticamente al primer ingreso.</Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'sep') {
              return <Text style={styles.sectionLabel}>{item.label}</Text>;
            }
            return (
              <ChannelRow
                channel={item.channel}
                onPress={() => setView({ kind: 'chat', channel: item.channel })}
              />
            );
          }}
        />
      )}

      <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} hitSlop={8} onPress={() => setShowDmPicker(true)} style={[styles.fab, { bottom: insets.bottom + 16 }]}>
        <Ionicons name="person-add" size={22} color="#fff" />
      </Pressable>

      <DMPicker
        visible={showDmPicker}
        projectId={projectId}
        currentUserId={user?.id || ''}
        existingChannels={channels}
        onClose={() => setShowDmPicker(false)}
        onCreated={(ch) => {
          setShowDmPicker(false);
          setView({ kind: 'chat', channel: ch });
          loadChannels(true);
        }}
      />
    </View>
  );
}

// ============================================================================
// Lista de canales con separadores de seccion
// ============================================================================
type ChannelListItem =
  | { kind: 'sep'; label: string }
  | { kind: 'channel'; channel: Channel };

function channelsWithSeparators(items: Channel[]): ChannelListItem[] {
  const result: ChannelListItem[] = [];
  const general = items.filter((c) => c.type === 'general');
  const areas = items.filter((c) => c.type === 'area');
  const direct = items.filter((c) => c.type === 'direct');
  if (general.length) {
    result.push({ kind: 'sep', label: 'CANAL GENERAL' });
    general.forEach((c) => result.push({ kind: 'channel', channel: c }));
  }
  if (areas.length) {
    result.push({ kind: 'sep', label: 'POR AREA' });
    areas.forEach((c) => result.push({ kind: 'channel', channel: c }));
  }
  if (direct.length) {
    result.push({ kind: 'sep', label: 'MENSAJES DIRECTOS' });
    direct.forEach((c) => result.push({ kind: 'channel', channel: c }));
  }
  return result;
}

function ChannelRow({ channel, onPress }: { channel: Channel; onPress: () => void }) {
  const last = channel.last_message;
  const lastTxt = last?.text || 'Sin mensajes aun';
  const lastWhen = last?.created_at ? formatRelative(last.created_at) : '';
  const iconName = channel.type === 'direct' ? 'person-circle' : channel.type === 'area' ? 'pricetag' : 'megaphone';
  const tint = channel.type === 'direct' ? colors.textBody : colors.primary;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={[styles.rowIcon, channel.type === 'general' && { backgroundColor: colors.primary }]}>
        <Ionicons
          name={iconName as any}
          size={22}
          color={channel.type === 'general' ? '#fff' : tint}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.rowTopLine}>
          <Text style={styles.rowName} numberOfLines={1}>
            {channel.type === 'general' ? '# General' : channel.type === 'area' ? `# ${channel.name}` : channel.name}
          </Text>
          <Text style={styles.rowTime}>{lastWhen}</Text>
        </View>
        <View style={styles.rowBottomLine}>
          {last?.user_name ? (
            <Text style={styles.rowAuthor} numberOfLines={1}>{last.user_name}: </Text>
          ) : null}
          <Text style={styles.rowPreview} numberOfLines={1}>{lastTxt}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ============================================================================
// Vista de Chat (canal seleccionado)
// ============================================================================
function ChatView({
  channel, userId, userRole, onBack,
}: {
  channel: Channel;
  userId: string;
  userRole: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSinceRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  const initialLoad = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listChannelMessages(channel.id, { limit: 100 });
      setItems(data);
      if (data.length) lastSinceRef.current = data[data.length - 1].created_at;
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los mensajes');
    } finally {
      setLoading(false);
    }
  }, [channel.id]);

  const fetchDelta = useCallback(async () => {
    try {
      if (!lastSinceRef.current) { await initialLoad(); return; }
      const fresh = await api.listChannelMessages(channel.id, { since: lastSinceRef.current, limit: 100 });
      if (fresh.length) {
        setItems((prev) => [...prev, ...fresh]);
        lastSinceRef.current = fresh[fresh.length - 1].created_at;
      }
    } catch {
      // silencioso en delta
    }
  }, [channel.id, initialLoad]);

  useEffect(() => { initialLoad(); }, [initialLoad]);

  useEffect(() => {
    function start() {
      if (pollRef.current) return;
      pollRef.current = setInterval(fetchDelta, POLL_MS);
    }
    function stop() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    start();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { fetchDelta(); start(); } else { stop(); }
    });
    return () => { stop(); sub.remove(); };
  }, [fetchDelta]);

  // Auto-scroll al final cuando cambia items
  useEffect(() => {
    if (items.length) {
      requestAnimationFrame(() => {
        try { listRef.current?.scrollToEnd({ animated: true }); } catch {}
      });
    }
  }, [items.length]);

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const msg = await api.sendChannelMessage(channel.id, t);
      setItems((prev) => [...prev, msg]);
      lastSinceRef.current = msg.created_at;
      setText('');
    } catch (e: any) {
      Alert.alert('No se pudo enviar', e?.message || 'Intenta de nuevo');
    } finally {
      setSending(false);
    }
  }

  function onDeleteMessage(m: Message) {
    const confirm = () => {
      api.deleteMessage(m.id).then(() => {
        setItems((prev) => prev.filter((x) => x.id !== m.id));
      }).catch((e) => Alert.alert('Error', e?.message || 'No se pudo eliminar'));
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('?Eliminar este mensaje?')) confirm();
    } else {
      Alert.alert('Eliminar mensaje', '?Seguro?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: confirm },
      ]);
    }
  }

  const headerTitle = channel.type === 'general'
    ? '# General'
    : channel.type === 'area'
      ? `# ${channel.name}`
      : channel.name;
  const headerSub = channel.type === 'general'
    ? 'Visible para todo el equipo del proyecto'
    : channel.type === 'area'
      ? 'Solo asignados a esta disciplina'
      : 'Conversacion privada 1 a 1';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.blueTop, { height: 130 + insets.top }]} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')} onPress={onBack} hitSlop={10} style={styles.refreshBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{headerTitle}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{headerSub}</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        style={{ flex: 1 }}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.error} />
            <Text style={styles.errorTxt}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={initialLoad} style={styles.retryBtn}>
              <Text style={styles.retryTxt}>Reintentar</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: spacing.md, gap: 8 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.emptyIcon}><Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.primary} /></View>
                <Text style={styles.emptyTitle}>Aun no hay mensajes</Text>
                <Text style={styles.emptyMsg}>Se el primero en escribir.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <MessageBubble
                m={item}
                isMine={item.user_id === userId}
                canDelete={item.user_id === userId || userRole === 'coordinador_general'}
                onDelete={() => onDeleteMessage(item)}
              />
            )}
          />
        )}
        <View style={[styles.composer, { paddingBottom: insets.bottom + 6 }]}>
          <TextInput
            value={text} onChangeText={setText}
            placeholder="Escribe un mensaje_"
            placeholderTextColor={colors.textMuted}
            style={styles.composerInput}
            multiline
            editable={!sending}
            maxLength={2000}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('enviar')} hitSlop={8} onPress={send} disabled={sending || !text.trim()} style={[styles.sendBtn, (sending || !text.trim()) && { opacity: 0.5 }]}>
            {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function MessageBubble({
  m, isMine, canDelete, onDelete,
}: {
  m: Message;
  isMine: boolean;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <View style={[styles.bubbleRow, isMine && { justifyContent: 'flex-end' }]}>
      <Pressable accessibilityRole="button" onLongPress={canDelete ? onDelete : undefined} delayLongPress={400}
        style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
        {!isMine ? (
          <Text style={styles.bubbleAuthor} numberOfLines={1}>{m.user_name}</Text>
        ) : null}
        <Text style={[styles.bubbleText, isMine && { color: '#fff' }]}>{m.text}</Text>
        <Text style={[styles.bubbleTime, isMine && { color: 'rgba(255,255,255,0.75)' }]}>
          {formatHourMinute(m.created_at)}
        </Text>
      </Pressable>
    </View>
  );
}

// ============================================================================
// Modal selector de miembros para iniciar DM
// ============================================================================
function DMPicker({
  visible, projectId, currentUserId, existingChannels, onClose, onCreated,
}: {
  visible: boolean;
  projectId: string;
  currentUserId: string;
  existingChannels: Channel[];
  onClose: () => void;
  onCreated: (ch: Channel) => void;
}) {
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true); setError(null);
    api.listProjectMembers(projectId)
      .then((data) => setMembers(data.filter((u) => u.id !== currentUserId)))
      .catch((e) => setError(e?.message || 'No se pudieron cargar los miembros'))
      .finally(() => setLoading(false));
  }, [visible, projectId, currentUserId]);

  async function startDM(target: User) {
    setBusyId(target.id);
    try {
      const ch = await api.createDirectChannel(projectId, target.id);
      onCreated(ch);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo iniciar el chat');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { paddingBottom: insets.bottom + spacing.md, maxHeight: '75%' }]}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Nuevo mensaje directo</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={colors.textBody} /></Pressable>
          </View>
          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
          ) : error ? (
            <Text style={styles.errorTxt}>{error}</Text>
          ) : (
            <FlatList
              data={members}
              keyExtractor={(u) => u.id}
              ListEmptyComponent={<Text style={styles.emptyMsg}>No hay otros miembros aun en este proyecto.</Text>}
              renderItem={({ item }) => {
                const exists = existingChannels.find(
                  (c) => c.type === 'direct' && (c.member_ids || []).includes(item.id),
                );
                return (
                  <Pressable accessibilityRole="button" onPress={() => startDM(item)} style={styles.memberRow} disabled={busyId === item.id}>
                    <View style={styles.memberAvatar}>
                      <Ionicons name="person" size={20} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{item.name}</Text>
                      <Text style={styles.memberRole}>{prettyRole(item.role)}{item.area ? ` _ ${item.area}` : ''}</Text>
                    </View>
                    {busyId === item.id ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : exists ? (
                      <Text style={styles.memberExists}>Existente</Text>
                    ) : (
                      <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
                    )}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function prettyRole(role: string): string {
  if (role === 'coordinador_general') return 'Coord. General';
  if (role === 'sub_coordinador') return 'Sub-Coordinador';
  if (role === 'especialista') return 'Especialista';
  return role;
}

function formatRelative(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const dy = Math.floor(h / 24);
  if (dy < 7) return `${dy}d`;
  return dayjs.utc(iso).tz(CDMX_TZ).format('DD MMM');
}

function formatHourMinute(iso: string): string {
  return fmtTimeCDMX(iso);
}

const styles = StyleSheet.create({
  blueTop: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.primary },
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

  sectionLabel: {
    fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 1,
    marginTop: spacing.sm, marginBottom: 4, paddingHorizontal: 4,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.sm + 2, marginBottom: 6,
    borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  rowIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowName: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.text },
  rowTime: { fontSize: 10, color: colors.textMuted, fontWeight: '700' },
  rowBottomLine: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  rowAuthor: { fontSize: 12, color: colors.textBody, fontWeight: '700' },
  rowPreview: { flex: 1, fontSize: 12, color: colors.textMuted },

  center: { padding: spacing.xl, alignItems: 'center' },
  errorBox: {
    margin: spacing.md, padding: spacing.lg, alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  errorTxt: { textAlign: 'center', color: colors.textBody, fontSize: 13 },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md },
  retryTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  empty: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
    alignItems: 'center', gap: 6, ...shadow.card, margin: spacing.md,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyMsg: { fontSize: 12, color: colors.textBody, textAlign: 'center', lineHeight: 18 },

  // FAB para crear DM
  fab: {
    position: 'absolute', right: 18, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    ...shadow.card,
  },

  // Chat _ burbujas
  bubbleRow: { flexDirection: 'row' },
  bubble: {
    maxWidth: '78%', padding: 10, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  bubbleOther: { backgroundColor: colors.surface },
  bubbleMine: { backgroundColor: colors.primary, borderColor: colors.primary },
  bubbleAuthor: { fontSize: 11, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  bubbleText: { fontSize: 14, color: colors.text, lineHeight: 19 },
  bubbleTime: { fontSize: 10, color: colors.textMuted, marginTop: 4, alignSelf: 'flex-end' },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    paddingHorizontal: spacing.md, paddingTop: 8,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
  composerInput: {
    flex: 1, maxHeight: 110, minHeight: 40,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.text,
    backgroundColor: colors.bg,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },

  // Modal DM picker
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.md, gap: spacing.sm,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  memberAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  memberName: { fontSize: 14, fontWeight: '800', color: colors.text },
  memberRole: { fontSize: 11, color: colors.textBody, marginTop: 1 },
  memberExists: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.6 },
});
