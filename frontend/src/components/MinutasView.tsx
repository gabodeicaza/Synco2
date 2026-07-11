/**
 * MinutasView — Componente reutilizable del Hub de Minutas.
 * -----------------------------------------------------------------------------
 * Se usa tanto en la pantalla scoped al proyecto (`/projects/[id]/minutas`)
 * como en el tab de nivel raíz (`/minutas`) para Coord/Sub/Especialista.
 *
 * Props:
 *   pid          → id del proyecto (obligatorio; el caller decide con qué proyecto).
 *   embedded     → true = sin flecha de "back" (uso en tabs de nivel raíz).
 *   headerTitle  → override del título del header (default "Minutas").
 *   headerSubtitle → override del subtítulo (default "Acuerdos y seguimiento de obra").
 *   topPadding   → padding-top extra (útil cuando el caller ya renderiza cabecera).
 *
 * Reglas clave:
 *   • Crear: Coord General / Jefe / Sub-Coord.
 *   • Marcar acuerdo como concluido: SOLO autor (server-side lo refuerza).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
  Modal,
  Platform,
  KeyboardAvoidingView,
  RefreshControl,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, Area, LocationNode, Minuta, User } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';

// ---------- utilidades semáforo -------------------------------------------
type Urgency = 'red' | 'yellow' | 'green' | 'gray';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Devuelve el estado y semáforo global de una minuta a partir de sus acuerdos. */
function urgencyOfMinuta(m: Minuta): { urgency: Urgency; done: number; total: number; allDone: boolean } {
  const acs = m.acuerdos || [];
  const total = acs.length;
  const done = acs.filter((a) => a.estado).length;
  const allDone = total > 0 && done === total;
  if (allDone) return { urgency: 'gray', done, total, allDone };

  const today = todayISO();
  const in3 = new Date();
  in3.setDate(in3.getDate() + 3);
  const in3ISO = in3.toISOString().slice(0, 10);

  let worst: Urgency = 'green';
  for (const a of acs) {
    if (a.estado) continue;
    const fl = (a.fecha_limite || '').slice(0, 10);
    if (!fl) continue;
    if (fl <= today) {
      worst = 'red';
      break;
    }
    if (fl <= in3ISO && worst !== 'red') {
      worst = 'yellow';
    }
  }
  return { urgency: worst, done, total, allDone };
}

function urgencyMeta(u: Urgency) {
  switch (u) {
    case 'red':
      return { color: '#DC2626', label: 'Urgente', icon: 'alert-circle' as const };
    case 'yellow':
      return { color: '#D97706', label: 'Próximo', icon: 'time-outline' as const };
    case 'green':
      return { color: '#059669', label: 'En plazo', icon: 'checkmark-circle-outline' as const };
    case 'gray':
    default:
      return { color: '#6B7280', label: 'Concluida', icon: 'checkmark-done-outline' as const };
  }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

const MINUTA_CREATORS = new Set(['coordinador_general', 'jefe_proyecto', 'sub_coordinador']);

// =============================================================================
// Screen
// =============================================================================
export interface MinutasViewProps {
  pid: string;
  embedded?: boolean;
  headerTitle?: string;
  headerSubtitle?: string;
  topPadding?: number;
}

export default function MinutasView({
  pid,
  embedded = false,
  headerTitle,
  headerSubtitle,
  topPadding,
}: MinutasViewProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const canCreate = !!user && MINUTA_CREATORS.has(user.role);

  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  // Filtro por ubicación (nodo del proyecto) — 2026-07.
  const [ubicacionFilter, setUbicacionFilter] = useState<string[]>([]);

  const [minutas, setMinutas] = useState<Minuta[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!pid) return;
      if (!opts?.silent) setLoading(true);
      try {
        const [ms, ars, mbs, nds] = await Promise.all([
          api.listMinutas(pid, {
            status: tab,
            mine,
            q,
            area_ids: areaFilter,
            ubicacion_ids: ubicacionFilter,
          }),
          areas.length ? Promise.resolve(areas) : api.listAreas(pid),
          members.length ? Promise.resolve(members) : api.listProjectMembers(pid),
          nodes.length ? Promise.resolve(nodes) : api.listNodes(pid),
        ]);
        setMinutas(ms);
        if (!areas.length) setAreas(ars);
        if (!members.length) setMembers(mbs);
        if (!nodes.length) setNodes(nds);
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'No se pudo cargar el módulo de minutas');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pid, tab, mine, q, areaFilter.join(','), ubicacionFilter.join(',')],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, mine, areaFilter.join(','), ubicacionFilter.join(',')]);

  useFocusEffect(
    useCallback(() => {
      load({ silent: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pid]),
  );

  // Debounce de búsqueda (300ms).
  useEffect(() => {
    const t = setTimeout(() => load({ silent: true }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const onToggleArea = (aid: string) => {
    setAreaFilter((prev) => (prev.includes(aid) ? prev.filter((x) => x !== aid) : [...prev, aid]));
  };
  const onToggleUbicacion = (nid: string) => {
    setUbicacionFilter((prev) =>
      prev.includes(nid) ? prev.filter((x) => x !== nid) : [...prev, nid],
    );
  };

  const onToggleAcuerdo = async (m: Minuta, aid: string, next: boolean) => {
    if (m.author_id !== user?.id) {
      Alert.alert(
        'Sin permiso',
        'Solo el autor de la minuta puede marcar acuerdos como concluidos.',
      );
      return;
    }
    // Optimista
    setMinutas((prev) =>
      prev.map((x) =>
        x.id === m.id
          ? {
              ...x,
              acuerdos: x.acuerdos.map((a) => (a.id === aid ? { ...a, estado: next } : a)),
            }
          : x,
      ),
    );
    try {
      const updated = await api.toggleAcuerdo(m.id, aid, next);
      setMinutas((prev) => prev.map((x) => (x.id === m.id ? updated : x)));
    } catch (e: any) {
      // Rollback
      setMinutas((prev) =>
        prev.map((x) =>
          x.id === m.id
            ? {
                ...x,
                acuerdos: x.acuerdos.map((a) => (a.id === aid ? { ...a, estado: !next } : a)),
              }
            : x,
        ),
      );
      Alert.alert('Error', e?.message || 'No se pudo actualizar el acuerdo');
    }
  };

  const onDelete = async (m: Minuta) => {
    const ok = await confirm(
      'Eliminar minuta',
      `¿Eliminar "${m.titulo}"? Esta acción no se puede deshacer.`,
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    try {
      await api.deleteMinuta(m.id);
      setMinutas((prev) => prev.filter((x) => x.id !== m.id));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo eliminar la minuta');
    }
  };

  return (
    <View style={[styles.flex, { paddingTop: topPadding !== undefined ? topPadding : insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {!embedded && (
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.hTitle}>{headerTitle || 'Minutas'}</Text>
          <Text style={styles.hSub}>{headerSubtitle || 'Acuerdos y seguimiento de obra'}</Text>
        </View>
        {canCreate && (
          <Pressable onPress={() => setCreateOpen(true)} style={styles.newBtn}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.newBtnTxt}>Nueva</Text>
          </Pressable>
        )}
      </View>

      {/* Filtros */}
      <View style={styles.filtersWrap}>
        <View style={styles.tabsRow}>
          <TabBtn
            active={tab === 'pending'}
            label="Pendientes"
            icon="alert-circle-outline"
            onPress={() => setTab('pending')}
          />
          <TabBtn
            active={tab === 'done'}
            label="Concluidas"
            icon="checkmark-done-outline"
            onPress={() => setTab('done')}
          />
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Buscar por título, acuerdo o responsable…"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {q.length > 0 && (
              <Pressable onPress={() => setQ('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => setMine((v) => !v)}
            style={[styles.mineBtn, mine && styles.mineBtnOn]}
          >
            <Ionicons
              name="person"
              size={14}
              color={mine ? '#fff' : colors.primary}
            />
            <Text style={[styles.mineTxt, mine && { color: '#fff' }]}>Mis Minutas</Text>
          </Pressable>
        </View>

        {areas.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}
            style={{ marginTop: 8 }}
          >
            {areas.map((a) => {
              const active = areaFilter.includes(a.id);
              return (
                <Pressable
                  key={a.id}
                  onPress={() => onToggleArea(a.id)}
                  style={[
                    styles.chip,
                    active && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                >
                  <View
                    style={[
                      styles.chipDot,
                      { backgroundColor: active ? '#fff' : a.color || colors.primary },
                    ]}
                  />
                  <Text
                    style={[
                      styles.chipTxt,
                      active && { color: '#fff', fontWeight: '800' },
                    ]}
                  >
                    {a.name}
                  </Text>
                </Pressable>
              );
            })}
            {areaFilter.length > 0 && (
              <Pressable onPress={() => setAreaFilter([])} style={[styles.chip, styles.chipClear]}>
                <Ionicons name="close" size={12} color={colors.textMuted} />
                <Text style={[styles.chipTxt, { color: colors.textMuted }]}>Limpiar</Text>
              </Pressable>
            )}
          </ScrollView>
        )}

        {/* Filtro por Ubicación (nodos del proyecto) — 2026-07 */}
        {nodes.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {nodes.map((n) => {
              const active = ubicacionFilter.includes(n.id);
              return (
                <Pressable
                  key={n.id}
                  onPress={() => onToggleUbicacion(n.id)}
                  style={[
                    styles.chip,
                    active && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                >
                  <Ionicons
                    name="location-outline"
                    size={12}
                    color={active ? '#fff' : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.chipTxt,
                      active && { color: '#fff', fontWeight: '800' },
                    ]}
                    numberOfLines={1}
                  >
                    {n.name}
                  </Text>
                </Pressable>
              );
            })}
            {ubicacionFilter.length > 0 && (
              <Pressable
                onPress={() => setUbicacionFilter([])}
                style={[styles.chip, styles.chipClear]}
              >
                <Ionicons name="close" size={12} color={colors.textMuted} />
                <Text style={[styles.chipTxt, { color: colors.textMuted }]}>Limpiar</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </View>

      {/* Lista */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : minutas.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="clipboard-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Sin minutas {tab === 'pending' ? 'pendientes' : 'concluidas'}</Text>
          <Text style={styles.emptySub}>
            {canCreate
              ? 'Crea la primera minuta con el botón "Nueva".'
              : 'Aún no hay minutas registradas en este proyecto.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load({ silent: true });
              }}
              tintColor={colors.primary}
            />
          }
        >
          {minutas.map((m) => (
            <MinutaCard
              key={m.id}
              minuta={m}
              expanded={!!expandedIds[m.id]}
              onToggleExpand={() =>
                setExpandedIds((prev) => ({ ...prev, [m.id]: !prev[m.id] }))
              }
              onToggleAcuerdo={onToggleAcuerdo}
              onDelete={onDelete}
              currentUserId={user?.id || ''}
              currentUserRole={user?.role || ''}
            />
          ))}
        </ScrollView>
      )}

      {/* Modal de creación */}
      {createOpen && (
        <CreateMinutaModal
          visible={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            load();
          }}
          projectId={pid}
          areas={areas}
          nodes={nodes}
          members={members}
        />
      )}
    </View>
  );
}

// =============================================================================
// Sub-components
// =============================================================================
function TabBtn({
  active,
  label,
  icon,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: any;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabBtn, active && styles.tabBtnActive]}
    >
      <Ionicons name={icon} size={14} color={active ? '#fff' : colors.text} />
      <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>{label}</Text>
    </Pressable>
  );
}

function MinutaCard({
  minuta,
  expanded,
  onToggleExpand,
  onToggleAcuerdo,
  onDelete,
  currentUserId,
  currentUserRole,
}: {
  minuta: Minuta;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleAcuerdo: (m: Minuta, aid: string, next: boolean) => void;
  onDelete: (m: Minuta) => void;
  currentUserId: string;
  currentUserRole: string;
}) {
  const { urgency, done, total } = urgencyOfMinuta(minuta);
  const meta = urgencyMeta(urgency);
  const isAuthor = minuta.author_id === currentUserId;
  const canDelete = isAuthor || currentUserRole === 'coordinador_general';

  return (
    <View style={styles.card}>
      <Pressable style={styles.cardHead} onPress={onToggleExpand}>
        <View style={[styles.badge, { backgroundColor: meta.color }]}>
          <Ionicons name={meta.icon} size={12} color="#fff" />
          <Text style={styles.badgeTxt}>{meta.label}</Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {minuta.titulo}
        </Text>
        {minuta.ubicacion_name ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              marginTop: 4,
            }}
          >
            <Ionicons name="location" size={11} color={colors.primary} />
            <Text
              numberOfLines={1}
              style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}
            >
              {minuta.ubicacion_path_names && minuta.ubicacion_path_names.length > 0
                ? minuta.ubicacion_path_names.join(' › ')
                : minuta.ubicacion_name}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {minuta.area_names.map((n, i) => (
            <View key={i} style={styles.areaChip}>
              <Text style={styles.areaChipTxt}>{n}</Text>
            </View>
          ))}
        </View>
        {(minuta.involved_names && minuta.involved_names.length > 0) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            <Ionicons name="people-outline" size={11} color={colors.primary} style={{ marginTop: 3 }} />
            {minuta.involved_names.slice(0, 4).map((n, i) => (
              <View key={i} style={styles.involvedCardChip}>
                <Text style={styles.involvedCardChipTxt}>{n}</Text>
              </View>
            ))}
            {minuta.involved_names.length > 4 && (
              <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 3 }}>
                +{minuta.involved_names.length - 4} más
              </Text>
            )}
          </View>
        )}
        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Ionicons name="person-circle-outline" size={13} color={colors.textMuted} />
            <Text style={styles.metaTxt} numberOfLines={1}>
              {minuta.author_name}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
            <Text style={styles.metaTxt}>{fmtDate(minuta.fecha_reunion)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Ionicons name="list-outline" size={13} color={colors.textMuted} />
            <Text style={styles.metaTxt}>
              {done}/{total} acuerdos
            </Text>
          </View>
        </View>
        <View style={{ position: 'absolute', top: 10, right: 10, flexDirection: 'row', gap: 6 }}>
          {canDelete && (
            <Pressable
              onPress={() => onDelete(minuta)}
              hitSlop={8}
              style={styles.iconGhost}
            >
              <Ionicons name="trash-outline" size={16} color="#DC2626" />
            </Pressable>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.cardBody}>
          {minuta.descripcion ? (
            <Text style={styles.desc}>{minuta.descripcion}</Text>
          ) : null}
          {minuta.acuerdos.map((a) => (
            <AcuerdoRow
              key={a.id}
              acuerdo={a}
              isAuthor={isAuthor}
              onToggle={(next) => onToggleAcuerdo(minuta, a.id, next)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function AcuerdoRow({
  acuerdo,
  isAuthor,
  onToggle,
}: {
  acuerdo: any;
  isAuthor: boolean;
  onToggle: (next: boolean) => void;
}) {
  const today = todayISO();
  const in3 = new Date();
  in3.setDate(in3.getDate() + 3);
  const in3ISO = in3.toISOString().slice(0, 10);
  const fl = (acuerdo.fecha_limite || '').slice(0, 10);
  let u: Urgency = 'green';
  if (acuerdo.estado) u = 'gray';
  else if (fl && fl <= today) u = 'red';
  else if (fl && fl <= in3ISO) u = 'yellow';
  const meta = urgencyMeta(u);

  return (
    <View style={[styles.acuerdoRow, acuerdo.estado && { opacity: 0.6 }]}>
      <Pressable
        onPress={() => onToggle(!acuerdo.estado)}
        disabled={!isAuthor}
        hitSlop={8}
        style={[
          styles.check,
          acuerdo.estado && { backgroundColor: colors.primary, borderColor: colors.primary },
          !isAuthor && !acuerdo.estado && { opacity: 0.5 },
        ]}
      >
        {acuerdo.estado && <Ionicons name="checkmark" size={14} color="#fff" />}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.acuerdoTxt,
            acuerdo.estado && { textDecorationLine: 'line-through', color: colors.textMuted },
          ]}
        >
          {acuerdo.descripcion}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          <View style={styles.metaCell}>
            <Ionicons name="person-outline" size={11} color={colors.textMuted} />
            <Text style={styles.acuerdoMeta}>{acuerdo.responsable_name}</Text>
          </View>
          <View style={styles.metaCell}>
            <Ionicons name={meta.icon} size={11} color={meta.color} />
            <Text style={[styles.acuerdoMeta, { color: meta.color, fontWeight: '700' }]}>
              {fmtDate(acuerdo.fecha_limite)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// =============================================================================
// Create Modal
// =============================================================================
type DraftAcuerdo = { descripcion: string; responsable_id: string; fecha_limite: string };

function CreateMinutaModal({
  visible,
  onClose,
  onCreated,
  projectId,
  areas,
  nodes,
  members,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  projectId: string;
  areas: Area[];
  nodes: LocationNode[];
  members: User[];
}) {
  const insets = useSafeAreaInsets();
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fechaReunion, setFechaReunion] = useState(todayISO());
  const [selAreas, setSelAreas] = useState<string[]>([]);
  // Ubicación (nodo del proyecto) — obligatorio. Un solo nodo por minuta.
  const [ubicacionId, setUbicacionId] = useState<string>('');
  const [ubicacionPickerOpen, setUbicacionPickerOpen] = useState(false);
  const [involvedIds, setInvolvedIds] = useState<string[]>([]);
  const [involvedPickerOpen, setInvolvedPickerOpen] = useState(false);
  const [acuerdos, setAcuerdos] = useState<DraftAcuerdo[]>([
    { descripcion: '', responsable_id: '', fecha_limite: todayISO() },
  ]);
  const [saving, setSaving] = useState(false);
  const [respPickerFor, setRespPickerFor] = useState<number | null>(null);

  const toggleArea = (aid: string) =>
    setSelAreas((p) => (p.includes(aid) ? p.filter((x) => x !== aid) : [...p, aid]));

  const toggleInvolved = (uid: string) =>
    setInvolvedIds((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : [...p, uid]));

  const setAcuerdoField = (i: number, patch: Partial<DraftAcuerdo>) =>
    setAcuerdos((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  const addAcuerdo = () =>
    setAcuerdos((p) => [...p, { descripcion: '', responsable_id: '', fecha_limite: todayISO() }]);

  const removeAcuerdo = (i: number) =>
    setAcuerdos((p) => (p.length === 1 ? p : p.filter((_, idx) => idx !== i)));

  const onSave = async () => {
    if (!titulo.trim()) {
      Alert.alert('Falta el título', 'La minuta requiere un título.');
      return;
    }
    if (!ubicacionId) {
      Alert.alert('Falta la ubicación', 'Selecciona la ubicación (nodo del proyecto).');
      return;
    }
    if (acuerdos.length === 0) {
      Alert.alert('Sin acuerdos', 'Registra al menos un acuerdo.');
      return;
    }
    for (let i = 0; i < acuerdos.length; i++) {
      const a = acuerdos[i];
      if (!a.descripcion.trim()) {
        Alert.alert(`Acuerdo #${i + 1}`, 'La descripción es obligatoria.');
        return;
      }
      if (!a.responsable_id) {
        Alert.alert(`Acuerdo #${i + 1}`, 'Selecciona un responsable.');
        return;
      }
      if (!a.fecha_limite) {
        Alert.alert(`Acuerdo #${i + 1}`, 'Selecciona la fecha límite.');
        return;
      }
    }
    setSaving(true);
    try {
      await api.createMinuta(projectId, {
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        area_ids: selAreas,
        involved_ids: involvedIds,
        fecha_reunion: fechaReunion,
        ubicacion_id: ubicacionId,
        acuerdos: acuerdos.map((a) => ({
          descripcion: a.descripcion.trim(),
          responsable_id: a.responsable_id,
          fecha_limite: a.fecha_limite,
        })),
      });
      onCreated();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo crear la minuta');
    } finally {
      setSaving(false);
    }
  };

  const memberName = (uid: string) =>
    members.find((m) => m.id === uid)?.name || 'Seleccionar responsable';

  const ubicacionLabel = ubicacionId
    ? nodes.find((n) => n.id === ubicacionId)?.name || 'Ubicación'
    : 'Seleccionar ubicación…';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nueva minuta</Text>
              <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 32 }}>
              <Text style={styles.label}>Título *</Text>
              <TextInput
                style={styles.input}
                value={titulo}
                onChangeText={setTitulo}
                placeholder="Ej. Reunión de arranque de obra"
                placeholderTextColor={colors.textMuted}
                maxLength={200}
              />

              <Text style={styles.label}>Descripción</Text>
              <TextInput
                style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                value={descripcion}
                onChangeText={setDescripcion}
                placeholder="Contexto y notas de la reunión (opcional)"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={4000}
              />

              <Text style={styles.label}>Fecha de reunión *</Text>
              <TextInput
                style={styles.input}
                value={fechaReunion}
                onChangeText={setFechaReunion}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
              />

              {/* Ubicación (nodo del proyecto) — obligatorio 2026-07 */}
              <Text style={styles.label}>Ubicación *</Text>
              <Pressable
                onPress={() => setUbicacionPickerOpen(true)}
                style={[
                  styles.input,
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                  <Ionicons
                    name="location-outline"
                    size={16}
                    color={ubicacionId ? colors.primary : colors.textMuted}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    numberOfLines={1}
                    style={{
                      color: ubicacionId ? colors.text : colors.textMuted,
                      flexShrink: 1,
                    }}
                  >
                    {ubicacionLabel}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
              </Pressable>

              <Text style={styles.label}>Áreas involucradas</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {areas.map((a) => {
                  const on = selAreas.includes(a.id);
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => toggleArea(a.id)}
                      style={[
                        styles.chip,
                        on && { backgroundColor: colors.primary, borderColor: colors.primary },
                      ]}
                    >
                      <View
                        style={[
                          styles.chipDot,
                          { backgroundColor: on ? '#fff' : a.color || colors.primary },
                        ]}
                      />
                      <Text style={[styles.chipTxt, on && { color: '#fff', fontWeight: '800' }]}>
                        {a.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.sepRow}>
                <Text style={styles.label}>Involucrados</Text>
                <Pressable
                  onPress={() => setInvolvedPickerOpen(true)}
                  style={styles.addRow}
                >
                  <Ionicons name="person-add-outline" size={16} color={colors.primary} />
                  <Text style={styles.addRowTxt}>
                    {involvedIds.length > 0 ? `Editar (${involvedIds.length})` : 'Añadir personas'}
                  </Text>
                </Pressable>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: -2, marginBottom: 6 }}>
                Verán esta minuta en su filtro “Mis Minutas”.
              </Text>
              {involvedIds.length === 0 ? (
                <Text style={{ color: colors.textMuted, fontSize: 12, fontStyle: 'italic' }}>
                  Sin involucrados adicionales.
                </Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {involvedIds.map((uid) => {
                    const u = members.find((m) => m.id === uid);
                    if (!u) return null;
                    return (
                      <View key={uid} style={styles.involvedChip}>
                        <Ionicons name="person" size={11} color={colors.primary} />
                        <Text style={styles.involvedChipTxt}>{u.name}</Text>
                        <Pressable onPress={() => toggleInvolved(uid)} hitSlop={8}>
                          <Ionicons name="close" size={12} color={colors.textMuted} />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={styles.sepRow}>
                <Text style={styles.label}>Acuerdos *</Text>
                <Pressable onPress={addAcuerdo} style={styles.addRow}>
                  <Ionicons name="add" size={16} color={colors.primary} />
                  <Text style={styles.addRowTxt}>Añadir</Text>
                </Pressable>
              </View>

              {acuerdos.map((a, i) => (
                <View key={i} style={styles.acuerdoDraft}>
                  <View style={styles.acuerdoDraftHead}>
                    <Text style={styles.acuerdoDraftIdx}>#{i + 1}</Text>
                    {acuerdos.length > 1 && (
                      <Pressable onPress={() => removeAcuerdo(i)} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color="#DC2626" />
                      </Pressable>
                    )}
                  </View>
                  <TextInput
                    style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                    value={a.descripcion}
                    onChangeText={(v) => setAcuerdoField(i, { descripcion: v })}
                    placeholder="Descripción del acuerdo…"
                    placeholderTextColor={colors.textMuted}
                    multiline
                    maxLength={1200}
                  />
                  <Pressable
                    onPress={() => setRespPickerFor(i)}
                    style={[styles.input, styles.selectRow]}
                  >
                    <Ionicons name="person-outline" size={14} color={colors.textMuted} />
                    <Text
                      style={{
                        color: a.responsable_id ? colors.text : colors.textMuted,
                        flex: 1,
                      }}
                      numberOfLines={1}
                    >
                      {a.responsable_id ? memberName(a.responsable_id) : 'Seleccionar responsable'}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
                  </Pressable>
                  <TextInput
                    style={styles.input}
                    value={a.fecha_limite}
                    onChangeText={(v) => setAcuerdoField(i, { fecha_limite: v })}
                    placeholder="Fecha límite (YYYY-MM-DD)"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={onClose} style={styles.btnGhost} disabled={saving}>
                <Text style={styles.btnGhostTxt}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={onSave} style={styles.btnPrimary} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryTxt}>Guardar minuta</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>

        {/* Picker de responsable */}
        {respPickerFor !== null && (
          <Modal
            transparent
            animationType="fade"
            visible={respPickerFor !== null}
            onRequestClose={() => setRespPickerFor(null)}
          >
            <Pressable
              style={styles.pickerBackdrop}
              onPress={() => setRespPickerFor(null)}
            >
              <View style={styles.pickerSheet}>
                <Text style={styles.pickerTitle}>Selecciona responsable</Text>
                <ScrollView style={{ maxHeight: 380 }}>
                  {members.length === 0 ? (
                    <Text style={{ padding: 16, color: colors.textMuted }}>
                      No hay miembros en el proyecto.
                    </Text>
                  ) : (
                    members.map((m) => (
                      <Pressable
                        key={m.id}
                        onPress={() => {
                          setAcuerdoField(respPickerFor!, { responsable_id: m.id });
                          setRespPickerFor(null);
                        }}
                        style={styles.pickerRow}
                      >
                        <Ionicons name="person-circle" size={22} color={colors.primary} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontWeight: '700', color: colors.text }}>{m.name}</Text>
                          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                            {m.role.replace('_', ' ')}
                          </Text>
                        </View>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </View>
            </Pressable>
          </Modal>
        )}

        {/* Picker de involucrados (multi-selección) */}
        {involvedPickerOpen && (
          <Modal
            transparent
            animationType="fade"
            visible={involvedPickerOpen}
            onRequestClose={() => setInvolvedPickerOpen(false)}
          >
            <View style={styles.pickerBackdrop}>
              <View style={styles.pickerSheet}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
                }}>
                  <Text style={styles.pickerTitle}>Involucrados ({involvedIds.length})</Text>
                  <Pressable onPress={() => setInvolvedPickerOpen(false)} hitSlop={8}>
                    <Text style={{ color: colors.primary, fontWeight: '800' }}>Listo</Text>
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 420 }}>
                  {members.length === 0 ? (
                    <Text style={{ padding: 16, color: colors.textMuted }}>
                      No hay miembros en el proyecto.
                    </Text>
                  ) : (
                    members.map((m) => {
                      const on = involvedIds.includes(m.id);
                      return (
                        <Pressable
                          key={m.id}
                          onPress={() => toggleInvolved(m.id)}
                          style={[styles.pickerRow, on && { backgroundColor: colors.bg }]}
                        >
                          <View style={[
                            styles.check,
                            { marginTop: 0 },
                            on && { backgroundColor: colors.primary, borderColor: colors.primary },
                          ]}>
                            {on && <Ionicons name="checkmark" size={14} color="#fff" />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: '700', color: colors.text }}>{m.name}</Text>
                            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                              {m.role.replace('_', ' ')}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
        )}

        {/* Picker de Ubicación (selección única entre nodos del proyecto) */}
        {ubicacionPickerOpen && (
          <Modal
            transparent
            animationType="fade"
            visible={ubicacionPickerOpen}
            onRequestClose={() => setUbicacionPickerOpen(false)}
          >
            <View style={styles.pickerBackdrop}>
              <View style={styles.pickerSheet}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
                }}>
                  <Text style={styles.pickerTitle}>Ubicación</Text>
                  <Pressable onPress={() => setUbicacionPickerOpen(false)} hitSlop={8}>
                    <Text style={{ color: colors.primary, fontWeight: '800' }}>Cerrar</Text>
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 420 }}>
                  {nodes.length === 0 ? (
                    <Text style={{ padding: 16, color: colors.textMuted }}>
                      El proyecto aún no tiene ubicaciones. Pídele al coordinador que las cree.
                    </Text>
                  ) : (
                    nodes.map((n) => {
                      const on = ubicacionId === n.id;
                      return (
                        <Pressable
                          key={n.id}
                          onPress={() => {
                            setUbicacionId(n.id);
                            setUbicacionPickerOpen(false);
                          }}
                          style={[styles.pickerRow, on && { backgroundColor: colors.bg }]}
                        >
                          <Ionicons
                            name="location"
                            size={16}
                            color={on ? colors.primary : colors.textMuted}
                            style={{ marginRight: 8 }}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: '700', color: colors.text }}>{n.name}</Text>
                          </View>
                          {on && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
        )}
      </View>
    </Modal>
  );
}

// =============================================================================
// Styles
// =============================================================================
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  emptySub: { marginTop: 4, color: colors.textMuted, textAlign: 'center', fontSize: 13 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  hSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  newBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  filtersWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.bg,
    padding: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  tabBtnActive: { backgroundColor: colors.primary },
  tabTxt: { fontSize: 13, fontWeight: '700', color: colors.text },
  tabTxtActive: { color: '#fff' },

  searchRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    height: 38,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, padding: 0 },
  mineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  mineBtnOn: { backgroundColor: colors.primary },
  mineTxt: { color: colors.primary, fontWeight: '700', fontSize: 12 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  chipClear: { backgroundColor: colors.surface },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    ...shadow.sm,
    overflow: 'hidden',
  },
  cardHead: {
    padding: 14,
    paddingRight: 40,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 6,
  },
  badgeTxt: { color: '#fff', fontWeight: '800', fontSize: 10 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  areaChip: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  areaChipTxt: { fontSize: 10, color: colors.textMuted, fontWeight: '700' },
  involvedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.bg,
  },
  involvedChipTxt: { fontSize: 11, color: colors.text, fontWeight: '700' },
  involvedCardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
  },
  involvedCardChipTxt: { fontSize: 10, color: colors.primary, fontWeight: '700' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  metaCell: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaTxt: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  iconGhost: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },

  cardBody: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 14,
    gap: 10,
    backgroundColor: colors.bg,
  },
  desc: { fontSize: 13, color: colors.text, lineHeight: 18 },
  acuerdoRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  acuerdoTxt: { fontSize: 13, color: colors.text, fontWeight: '600' },
  acuerdoMeta: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  label: { fontSize: 12, fontWeight: '800', color: colors.textMuted, marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 14,
  },
  sepRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  addRowTxt: { color: colors.primary, fontWeight: '800', fontSize: 12 },

  acuerdoDraft: {
    marginTop: 10,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 8,
  },
  acuerdoDraftHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  acuerdoDraftIdx: { fontSize: 12, fontWeight: '800', color: colors.textMuted },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  modalFooter: {
    flexDirection: 'row',
    gap: 8,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  btnGhost: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostTxt: { color: colors.text, fontWeight: '700' },
  btnPrimary: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  btnPrimaryTxt: { color: '#fff', fontWeight: '800' },

  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  pickerSheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 12,
  },
  pickerTitle: { fontSize: 14, fontWeight: '800', color: colors.text, padding: 8 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
