/**
 * MinutasView _ Componente reutilizable del Hub de Minutas.
 * -----------------------------------------------------------------------------
 * Se usa tanto en la pantalla scoped al proyecto (`/projects/[id]/minutas`)
 * como en el tab de nivel raiz (`/minutas`) para Coord/Sub/Especialista.
 *
 * Props:
 *   pid          _ id del proyecto (obligatorio; el caller decide con que proyecto).
 *   embedded     _ true = sin flecha de "back" (uso en tabs de nivel raiz).
 *   headerTitle  _ override del titulo del header (default "Minutas").
 *   headerSubtitle _ override del subtitulo (default "Acuerdos y seguimiento de obra").
 *   topPadding   _ padding-top extra (util cuando el caller ya renderiza cabecera).
 *
 * Reglas clave:
 *   _ Crear: Coord General / Jefe / Sub-Coord / Especialista.
 *   _ Marcar acuerdo como concluido: SOLO autor (server-side lo refuerza).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
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
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { api, Area, LocationNode, Minuta, Project, User } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_JEFE, ROLE_SUB, ROLE_ESP } from '@/src/utils/roles';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { dayjs } from '@/src/utils/tz';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { a11y, t } from '@/src/i18n';
import { fmtFecha, hoyProyecto } from '@/src/utils/fechas';
import {
  claveAcuerdo, hayErroresMinuta, primerCampoConError, reindexarErroresAcuerdos, validarMinuta,
} from '@/src/utils/validacionMinuta';
import { InlineError } from '@/src/components/InlineError';
import { FormField } from '@/src/components/FormField';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { useEnvio } from '@/src/hooks/useEnvio';
import { showToast } from '@/src/utils/toast';

// ---------- utilidades semaforo -------------------------------------------
type Urgency = 'red' | 'yellow' | 'green' | 'gray';

function todayISO(): string {
  // Hoy en la zona del proyecto (CDMX por defecto), nunca el día UTC ni el del dispositivo.
  return hoyProyecto();
}

/** Devuelve el estado y semaforo global de una minuta a partir de sus acuerdos. */
function urgencyOfMinuta(m: Minuta): { urgency: Urgency; done: number; total: number; allDone: boolean } {
  const acs = m.acuerdos || [];
  const total = acs.length;
  const done = acs.filter((a) => a.estado).length;
  const allDone = total > 0 && done === total;
  if (allDone) return { urgency: 'gray', done, total, allDone };

  const today = todayISO();
  // [FIX] `new Date()` + `.toISOString()` mezclaba fecha-de-dispositivo con
  // corte UTC -- inconsistente con `today` (CDMX). De noche en CDMX, UTC ya
  // es el día siguiente, corriendo el umbral rojo/amarillo/verde un día.
  const in3ISO = dayjs().tz().add(3, 'day').format('YYYY-MM-DD');

  let worst: Urgency = 'green';
  for (const a of acs) {
    if (a.estado) continue;
    const fl = (a.fecha_limite || '').slice(0, 10);
    if (!fl) continue;
    if (fl <= today) {
      worst = 'red';
      break;
    }
    if (fl <= in3ISO) {
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
      return { color: '#D97706', label: 'Proximo', icon: 'time-outline' as const };
    case 'green':
      return { color: '#059669', label: 'En plazo', icon: 'checkmark-circle-outline' as const };
    case 'gray':
    default:
      return { color: '#6B7280', label: 'Concluida', icon: 'checkmark-done-outline' as const };
  }
}

// Un solo formato de fecha en toda la app: "23 sep 2026" (ver src/utils/fechas.ts).
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return fmtFecha(iso.slice(0, 10));
}

interface MinutasViewProps {
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

  // Permite crear minutas a cualquier usuario logueado, sin importar el rol.
  const canCreate = !!user;
  if (__DEV__) console.log('[MinutasView] user.role:', user?.role, 'canCreate:', canCreate);

  // Codigo institucional de minutas: prefijo (2 palabras, ej. "CL4 OBRA") a
  // nivel proyecto. Solo Coordinador General puede editarlo; Sub-coordinador
  // y Especialista lo ven en modo solo-lectura.
  const canEditCodigoPrefix = user?.role === ROLE_COORD;
  const [project, setProject] = useState<Project | null>(null);
  const [prefixEditing, setPrefixEditing] = useState(false);
  const [prefixDraft, setPrefixDraft] = useState('');
  const [prefixSaving, setPrefixSaving] = useState(false);

  useEffect(() => {
    if (!pid) return;
    let alive = true;
    api.getProject(pid).then((p) => { if (alive) setProject(p); }).catch(() => {});
    return () => { alive = false; };
  }, [pid]);

  async function onSavePrefix() {
    if (!pid || prefixSaving) return;
    try {
      setPrefixSaving(true);
      const upd = await api.updateProject(pid, { minuta_code_prefix: prefixDraft.trim() || null } as any);
      setProject((p) => (p ? { ...p, ...upd } : upd));
      setPrefixEditing(false);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setPrefixSaving(false);
    }
  }

  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  // Filtro por ubicacion (nodo del proyecto) _ 2026-07.
  const [ubicacionFilter, setUbicacionFilter] = useState<string[]>([]);
  // Filtro por tipo: Informativas vs Compromisos.
  const [tipoFilter, setTipoFilter] = useState<'all' | 'informativo' | 'compromiso'>('all');

  const [minutas, setMinutas] = useState<Minuta[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);

  // --- Filtrado Reforzado en Cliente (Fix 2026-07) -------------------------
  // El servidor a veces devuelve la lista completa o falla al filtrar por IDs
  // multiples. Este useMemo garantiza que la UI siempre respete los filtros.
  const filteredMinutas = useMemo(() => {
    if (!ubicacionFilter.length && !areaFilter.length && tipoFilter === 'all') return minutas;
    return minutas.filter((m) => {
      const matchesUbicacion =
        !ubicacionFilter.length || (m.ubicacion_id && ubicacionFilter.includes(m.ubicacion_id));
      const matchesArea =
        !areaFilter.length || m.area_ids.some((id) => areaFilter.includes(id));
      const matchesTipo =
        tipoFilter === 'all' || (m.tipo || 'compromiso') === tipoFilter;
      return matchesUbicacion && matchesArea && matchesTipo;
    });
  }, [minutas, ubicacionFilter, areaFilter, tipoFilter]);

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
            tipo: tipoFilter,
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
        Alert.alert('Error', e?.message || 'No se pudo cargar el modulo de minutas');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pid, tab, mine, q, areaFilter.join(','), ubicacionFilter.join(','), tipoFilter],
  );

  // [PERF 2026-08-07] `useFocusEffect` de abajo tambien corre en el montaje
  // inicial (ademas de en cada refoco), asi que sin esta guarda se disparaban
  // 2x las 4 peticiones en paralelo (minutas/areas/miembros/nodos) justo al
  // entrar a la pantalla. La guarda deja pasar unicamente la carga inicial de
  // este efecto y salta la primera invocacion redundante de useFocusEffect;
  // refocos posteriores y cambios de `pid` en una instancia ya montada siguen
  // disparando `load` con normalidad.
  const didInitialLoadRef = useRef(false);

  useEffect(() => {
    load();
    didInitialLoadRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, mine, areaFilter.join(','), ubicacionFilter.join(','), tipoFilter]);

  useFocusEffect(
    useCallback(() => {
      if (!didInitialLoadRef.current) return;
      load({ silent: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pid]),
  );

  // Debounce de busqueda (300ms).
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
    // Permite a cualquier usuario marcar acuerdos como concluidos (el backend validara si es necesario)
    // O si prefieres mantener la logica de autor, al menos no bloquees a especialistas si son autores.
    // Eliminada restricción de roles en frontend: Cualquier usuario puede marcar acuerdos.
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
      `?Eliminar "${m.titulo}"? Esta accion no se puede deshacer.`,
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

  const onPdfChanged = useCallback((updated: Minuta) => {
    setMinutas((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }, []);

  return (
    <View style={[styles.flex, { paddingTop: topPadding !== undefined ? topPadding : insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {!embedded && (
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')} onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.hTitle}>{headerTitle || 'Minutas'}</Text>
          <Text style={styles.hSub}>{headerSubtitle || 'Acuerdos y seguimiento de obra'}</Text>
        </View>
        {canCreate && (
          <Pressable accessibilityRole="button" onPress={() => setCreateOpen(true)} style={styles.newBtn}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.newBtnTxt}>Nueva</Text>
          </Pressable>
        )}
      </View>

      {/* Codigo institucional de minutas (prefijo) */}
      <View style={styles.codePrefixRow}>
        <Ionicons name="pricetag-outline" size={14} color={colors.textMuted} />
        {prefixEditing ? (
          <>
            <TextInput
              value={prefixDraft}
              onChangeText={setPrefixDraft}
              placeholder="Ej. CL4 OBRA"
              placeholderTextColor={colors.textMuted}
              style={styles.codePrefixInput}
              autoCapitalize="characters"
              autoFocus
              editable={!prefixSaving}
              onSubmitEditing={onSavePrefix}
              returnKeyType="done"
            />
            {prefixSaving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('confirmar')} onPress={onSavePrefix} hitSlop={8}>
                  <Ionicons name="checkmark" size={18} color={colors.primary} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')}
                  onPress={() => { setPrefixEditing(false); setPrefixDraft(project?.minuta_code_prefix || ''); }}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </Pressable>
              </>
            )}
          </>
        ) : (
          <>
            <Text style={styles.codePrefixTxt} numberOfLines={1}>
              Codigo de minutas: <Text style={styles.codePrefixVal}>{project?.minuta_code_prefix || 'Sin definir'}</Text>
            </Text>
            {canEditCodigoPrefix ? (
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('editar')}
                onPress={() => { setPrefixDraft(project?.minuta_code_prefix || ''); setPrefixEditing(true); }}
                hitSlop={8}
              >
                <Ionicons name="pencil-outline" size={14} color={colors.primary} />
              </Pressable>
            ) : (
              <View style={styles.readOnlyBadge}>
                <Ionicons name="eye-outline" size={10} color={colors.textMuted} />
                <Text style={styles.readOnlyBadgeTxt}>Solo lectura</Text>
              </View>
            )}
          </>
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
              placeholder="Buscar por titulo, acuerdo o responsable_"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {q.length > 0 && (
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} onPress={() => setQ('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
          <Pressable accessibilityRole="button"
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

        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
          {([
            { key: 'all', label: 'Todas' },
            { key: 'compromiso', label: 'Compromisos' },
            { key: 'informativo', label: 'Informativas' },
          ] as const).map((opt) => {
            const active = tipoFilter === opt.key;
            return (
              <Pressable accessibilityRole="button"
                key={opt.key}
                onPress={() => setTipoFilter(opt.key)}
                style={[styles.chip, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              >
                <Text style={[styles.chipTxt, active && { color: '#fff', fontWeight: '800' }]}>{opt.label}</Text>
              </Pressable>
            );
          })}
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
                <Pressable accessibilityRole="button"
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
              <Pressable accessibilityRole="button" onPress={() => setAreaFilter([])} style={[styles.chip, styles.chipClear]}>
                <Ionicons name="close" size={12} color={colors.textMuted} />
                <Text style={[styles.chipTxt, { color: colors.textMuted }]}>Limpiar</Text>
              </Pressable>
            )}
          </ScrollView>
        )}

        {/* Filtro por Ubicacion (nodos del proyecto) _ 2026-07 */}
        {nodes.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {nodes.map((n) => {
              const active = ubicacionFilter.includes(n.id);
              return (
                <Pressable accessibilityRole="button"
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
              <Pressable accessibilityRole="button"
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
      ) : (
        <FlatList
          data={filteredMinutas}
          keyExtractor={(item) => item.id}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          renderItem={({ item }) => (
            <MinutaCard
              minuta={item}
              expanded={!!expandedIds[item.id]}
              onToggleExpand={() =>
                setExpandedIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
              }
              onToggleAcuerdo={onToggleAcuerdo}
              onDelete={onDelete}
              onPdfChanged={onPdfChanged}
              currentUserId={user?.id || ''}
              currentUserRole={user?.role || ''}
            />
          )}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 48 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="clipboard-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Sin minutas {tab === 'pending' ? 'pendientes' : 'concluidas'}</Text>
              <Text style={styles.emptySub}>
                {canCreate
                  ? 'Crea la primera minuta con el boton "Nueva".'
                  : 'Aun no hay minutas registradas en este proyecto.'}
              </Text>
            </View>
          }
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
        />
      )}

      {/* Modal de creacion */}
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
    <Pressable accessibilityRole="button"
      onPress={onPress}
      style={[styles.tabBtn, active && styles.tabBtnActive]}
    >
      <Ionicons name={icon} size={14} color={active ? '#fff' : colors.text} />
      <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>{label}</Text>
    </Pressable>
  );
}

const MinutaCard = memo(({
  minuta,
  expanded,
  onToggleExpand,
  onToggleAcuerdo,
  onDelete,
  onPdfChanged,
  currentUserId,
  currentUserRole,
}: {
  minuta: Minuta;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleAcuerdo: (m: Minuta, aid: string, next: boolean) => void;
  onDelete: (m: Minuta) => void;
  onPdfChanged: (m: Minuta) => void;
  currentUserId: string;
  currentUserRole: string;
}) => {
  const isInformativa = (minuta.tipo || 'compromiso') === 'informativo';
  const { urgency, done, total } = urgencyOfMinuta(minuta);
  const meta = isInformativa
    ? { color: '#2563EB', label: 'Informativa', icon: 'information-circle' as const }
    : urgencyMeta(urgency);
  const isAuthor = minuta.author_id === currentUserId;
  // Cualquier usuario puede intentar borrar si es el autor, o si es coordinador.
  const canDelete = true;

  return (
    <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: meta.color }]}>
      <Pressable accessibilityRole="button" style={styles.cardHead} onPress={onToggleExpand}>
        <View style={[styles.badge, { backgroundColor: meta.color }]}>
          <Ionicons name={meta.icon} size={12} color="#fff" />
          <Text style={styles.badgeTxt}>{meta.label}</Text>
        </View>
        {!!minuta.codigo && (
          <Text style={styles.codigoTxt}>{minuta.codigo}</Text>
        )}
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
                ? minuta.ubicacion_path_names.join(' _ ')
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
                +{minuta.involved_names.length - 4} mas
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
          {!isInformativa && (
            <View style={styles.metaCell}>
              <Ionicons name="list-outline" size={13} color={colors.textMuted} />
              <Text style={styles.metaTxt}>
                {done}/{total} acuerdos
              </Text>
            </View>
          )}
          {!!minuta.pdf_file_id && (
            <View style={styles.metaCell}>
              <Ionicons name="document-attach-outline" size={13} color={colors.textMuted} />
              <Text style={styles.metaTxt}>PDF</Text>
            </View>
          )}
        </View>
        <View style={{ position: 'absolute', top: 10, right: 10, flexDirection: 'row', gap: 6 }}>
          {canDelete && (
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')}
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
              userRole={currentUserRole}
              onToggle={(next) => onToggleAcuerdo(minuta, a.id, next)}
            />
          ))}
          {/* Solo se monta/renderiza cuando la tarjeta esta expandida _ cero
              costo para la lista colapsada (que es el caso comun). */}
          <MinutaPdfBlock minuta={minuta} onChanged={onPdfChanged} />
        </View>
      )}
    </View>
  );
});

// PDF escaneado de la minuta (una sola hoja). [PERF] No se renderiza el PDF
// en la app -- no hay libreria de render/thumbnail de PDF en el proyecto.
// Solo se sube/reemplaza/quita el archivo y, al tocar "ver", se descarga y se
// delega al visor del sistema operativo (mismo patron que "Archivos de
// consulta" via downloadBlob) -- nunca se pinta un PDF dentro de la app.
const MinutaPdfBlock = memo(({ minuta, onChanged }: { minuta: Minuta; onChanged: (m: Minuta) => void }) => {
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);

  async function pickAndUpload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setBusy(true);
      const updated = await api.uploadMinutaPdf(minuta.id, {
        uri: asset.uri,
        name: asset.name || 'minuta.pdf',
        mimeType: asset.mimeType || 'application/pdf',
      });
      onChanged(updated);
    } catch (e: any) {
      Alert.alert('No se pudo subir el PDF', e?.message || 'Intentalo nuevamente.');
    } finally {
      setBusy(false);
    }
  }

  async function openPdf() {
    try {
      setOpening(true);
      const { blob, filename, mime } = await api.downloadMinutaPdf(
        minuta.id,
        minuta.pdf_original_name || 'minuta.pdf',
      );
      await downloadBlob(blob, filename, mime || 'application/pdf');
    } catch (e: any) {
      Alert.alert('No se pudo abrir el PDF', e?.message || 'Revisa tu conexion.');
    } finally {
      setOpening(false);
    }
  }

  async function removePdf() {
    const ok = await confirm(
      'Quitar PDF',
      'Se eliminara el PDF escaneado de esta minuta.',
      { confirmText: 'Quitar', destructive: true },
    );
    if (!ok) return;
    try {
      setBusy(true);
      const updated = await api.deleteMinutaPdf(minuta.id);
      onChanged(updated);
    } catch (e: any) {
      Alert.alert('No se pudo quitar el PDF', e?.message || 'Intentalo nuevamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.pdfBlock}>
      {minuta.pdf_file_id ? (
        <>
          <Pressable accessibilityRole="button" onPress={openPdf} disabled={opening} style={styles.pdfRow}>
            <Ionicons name="document-attach" size={16} color={colors.primary} />
            <Text style={styles.pdfRowTxt} numberOfLines={1}>
              {minuta.pdf_original_name || 'minuta.pdf'}
            </Text>
            {opening ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="open-outline" size={14} color={colors.primary} />
            )}
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
            <Pressable accessibilityRole="button" onPress={pickAndUpload} disabled={busy} hitSlop={8}>
              <Text style={styles.pdfActionTxt}>Reemplazar</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={removePdf} disabled={busy} hitSlop={8}>
              <Text style={[styles.pdfActionTxt, { color: '#DC2626' }]}>Quitar</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Pressable accessibilityRole="button" onPress={pickAndUpload} disabled={busy} style={styles.pdfAttachBtn}>
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="attach-outline" size={16} color={colors.primary} />
          )}
          <Text style={styles.pdfAttachTxt}>Anexar PDF escaneado</Text>
        </Pressable>
      )}
    </View>
  );
});

const AcuerdoRow = memo(({
  acuerdo,
  isAuthor,
  userRole,
  onToggle,
}: {
  acuerdo: any;
  isAuthor: boolean;
  userRole: string;
  onToggle: (next: boolean) => void;
}) => {
  const today = todayISO();
  // [FIX] `new Date()` + `.toISOString()` mezclaba fecha-de-dispositivo con
  // corte UTC -- inconsistente con `today` (CDMX). De noche en CDMX, UTC ya
  // es el día siguiente, corriendo el umbral rojo/amarillo/verde un día.
  const in3ISO = dayjs().tz().add(3, 'day').format('YYYY-MM-DD');
  const fl = (acuerdo.fecha_limite || '').slice(0, 10);
  let u: Urgency = 'green';
  if (acuerdo.estado) u = 'gray';
  else if (fl && fl <= today) u = 'red';
  else if (fl && fl <= in3ISO) u = 'yellow';
  const meta = urgencyMeta(u);

  const canToggle = true;

  return (
    <View style={[styles.acuerdoRow, acuerdo.estado && { opacity: 0.6 }]}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={a11y('acuerdoCumplido')} accessibilityState={{ checked: !!acuerdo.estado, disabled: !canToggle }}
        onPress={() => onToggle(!acuerdo.estado)}
        disabled={!canToggle}
        hitSlop={8}
        style={[
          styles.check,
          acuerdo.estado && { backgroundColor: colors.primary, borderColor: colors.primary },
          !canToggle && !acuerdo.estado && { opacity: 0.5 },
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
});

// =============================================================================
// Create Modal
// =============================================================================
type DraftAcuerdo = { descripcion: string; responsable_id: string; fecha_limite: string };

export function CreateMinutaModal({
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
  const [tipo, setTipo] = useState<'informativo' | 'compromiso'>('compromiso');
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fechaReunion, setFechaReunion] = useState(todayISO());
  const { errores, errorGeneral, limpiar, ponerTodos, alCambiar, errorDeGuardado, setErrorGeneral } = useFormErrors<string>();
  const { guardando: saving, ejecutar } = useEnvio();
  // Scroll hasta el primer campo con error: posición (y) de cada campo dentro del ScrollView.
  const scrollRef = useRef<ScrollView>(null);
  const posiciones = useRef<Record<string, number>>({});
  const marcarPosicion = (clave: string) => (e: { nativeEvent: { layout: { y: number } } }) => {
    posiciones.current[clave] = e.nativeEvent.layout.y;
  };
  const [selAreas, setSelAreas] = useState<string[]>([]);
  // Ubicacion (nodo del proyecto) _ obligatorio. Un solo nodo por minuta.
  const [ubicacionId, setUbicacionId] = useState<string>('');
  const [ubicacionPickerOpen, setUbicacionPickerOpen] = useState(false);
  const [involvedIds, setInvolvedIds] = useState<string[]>([]);
  const [involvedPickerOpen, setInvolvedPickerOpen] = useState(false);
  const [acuerdos, setAcuerdos] = useState<DraftAcuerdo[]>([
    { descripcion: '', responsable_id: '', fecha_limite: todayISO() },
  ]);
  const [pdfAsset, setPdfAsset] = useState<{ uri: string; name: string; mimeType?: string | null } | null>(null);
  const [respPickerFor, setRespPickerFor] = useState<number | null>(null);

  async function pickPdf() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setPdfAsset({ uri: asset.uri, name: asset.name || 'minuta.pdf', mimeType: asset.mimeType || 'application/pdf' });
    } catch (e: any) {
      setErrorGeneral(e?.message || t('minuta.errores.noSePudoElegirPdf'));
    }
  }

  const toggleArea = (aid: string) =>
    setSelAreas((p) => (p.includes(aid) ? p.filter((x) => x !== aid) : [...p, aid]));

  const toggleInvolved = (uid: string) =>
    setInvolvedIds((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : [...p, uid]));

  const setAcuerdoField = (i: number, patch: Partial<DraftAcuerdo>) =>
    setAcuerdos((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  const addAcuerdo = () =>
    setAcuerdos((p) => [...p, { descripcion: '', responsable_id: '', fecha_limite: todayISO() }]);

  const removeAcuerdo = (i: number) => {
    if (acuerdos.length === 1) return;
    setAcuerdos((p) => p.filter((_, idx) => idx !== i));
    ponerTodos(reindexarErroresAcuerdos(errores, i));
  };

  // Cambiar la fecha de la reunión invalida los mensajes de "límite anterior a la reunión".
  const alCambiarFechaReunion = (v: string) => {
    setFechaReunion(v);
    limpiar('reunion');
    acuerdos.forEach((_, i) => limpiar(claveAcuerdo(i, 'fecha')));
  };

  const onSave = () => ejecutar(guardar);

  async function guardar() {
    // K-04 / K-03: se validan TODOS los campos y se resaltan junto a cada uno.
    const ev = validarMinuta({ tipo, titulo, ubicacionId, fechaReunion, acuerdos });
    if (hayErroresMinuta(ev)) {
      ponerTodos(ev);
      setErrorGeneral(t('formulario.revisaCampos'));
      const primero = primerCampoConError(ev);
      const y = primero ? posiciones.current[primero.startsWith('acuerdo.') ? primero.split('.').slice(0, 2).join('.') : primero] : undefined;
      if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
      return;
    }
    ponerTodos({});
    try {
      const created = await api.createMinuta(projectId, {
        tipo,
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        area_ids: selAreas,
        involved_ids: involvedIds,
        fecha_reunion: fechaReunion,
        ubicacion_id: ubicacionId,
        acuerdos: tipo === 'compromiso' ? acuerdos.map((a) => ({
          descripcion: a.descripcion.trim(),
          responsable_id: a.responsable_id,
          fecha_limite: a.fecha_limite,
        })) : [],
      });

      // El PDF se sube en una segunda llamada (la minuta ya existe con `id`)
      // -- si falla, la minuta ya quedo creada; se puede reintentar el anexo
      // despues desde la tarjeta ("Anexar PDF escaneado").
      if (pdfAsset) {
        try {
          await api.uploadMinutaPdf(created.id, pdfAsset);
        } catch {
          showToast(t('minuta.form.pdfNoSubido'));
        }
      }

      // [FIX 2026-07] Notificaciones locales y programadas. La minuta ya existe: un fallo
      // aquí no debe verse como "no se pudo crear" (el usuario reintentaría y la duplicaría).
      try {
        const { triggerLocalNotification, scheduleMinuteReminder } = await import('@/src/utils/pushNotifications');
        triggerLocalNotification('__ Minuta Creada', `Se ha registrado la minuta: ${titulo.trim()}`);

        // Programar recordatorios para cada acuerdo (24h antes) — solo aplica a compromisos.
        if (tipo === 'compromiso') {
          for (const a of acuerdos) {
            if (a.descripcion && a.fecha_limite) {
              await scheduleMinuteReminder(Math.random().toString(36).slice(2), a.descripcion, a.fecha_limite);
            }
          }
        }
      } catch {
        // los recordatorios locales son un extra
      }

      onCreated();
    } catch (e: any) {
      errorDeGuardado(e, t('minuta.errores.noSePudoCrear'));
    }
  }

  const memberName = (uid: string) =>
    uid === 'contratista' ? 'Contratista' : members.find((m) => m.id === uid)?.name || 'Seleccionar responsable';

  const ubicacionLabel = ubicacionId
    ? nodes.find((n) => n.id === ubicacionId)?.name || t('minuta.form.ubicacion')
    : t('minuta.form.seleccionarUbicacion');

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
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} hitSlop={12} style={styles.iconBtn}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView
              ref={scrollRef}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: spacing.md, paddingBottom: 32 }}
            >
              <Text style={styles.label}>Tipo de minuta *</Text>
              <View style={styles.tipoRow}>
                <Pressable accessibilityRole="button"
                  onPress={() => setTipo('compromiso')}
                  style={[styles.tipoBtn, tipo === 'compromiso' && styles.tipoBtnActive]}
                >
                  <Ionicons name="checkbox-outline" size={16} color={tipo === 'compromiso' ? '#fff' : colors.text} />
                  <Text style={[styles.tipoBtnTxt, tipo === 'compromiso' && styles.tipoBtnTxtActive]}>Compromiso</Text>
                </Pressable>
                <Pressable accessibilityRole="button"
                  onPress={() => setTipo('informativo')}
                  style={[styles.tipoBtn, tipo === 'informativo' && styles.tipoBtnActive]}
                >
                  <Ionicons name="information-circle-outline" size={16} color={tipo === 'informativo' ? '#fff' : colors.text} />
                  <Text style={[styles.tipoBtnTxt, tipo === 'informativo' && styles.tipoBtnTxtActive]}>Informativa</Text>
                </Pressable>
              </View>
              <Text style={styles.tipoHint}>
                {tipo === 'compromiso'
                  ? 'Genera acuerdos con responsable y fecha limite de seguimiento.'
                  : 'Solo texto — avisa un cambio o acuerdo, sin generar compromisos de seguimiento.'}
              </Text>

              <View onLayout={marcarPosicion('titulo')}>
                <FormField
                  label={t('minuta.form.titulo')}
                  obligatorio
                  value={titulo}
                  onChangeText={alCambiar<string>('titulo', setTitulo)}
                  placeholder={t('minuta.form.tituloPlaceholder')}
                  maxLength={200}
                  error={errores.titulo}
                />
              </View>

              <Text style={styles.label}>Descripcion</Text>
              <TextInput
                style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                value={descripcion}
                onChangeText={setDescripcion}
                placeholder="Contexto y notas de la reunion (opcional)"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={4000}
              />

              <View onLayout={marcarPosicion('reunion')}>
                <FormField
                  label={t('minuta.form.fechaReunion')}
                  obligatorio
                  value={fechaReunion}
                  onChangeText={alCambiarFechaReunion}
                  placeholder="AAAA-MM-DD"
                  error={errores.reunion}
                />
              </View>

              {/* Ubicacion (nodo del proyecto) _ obligatorio 2026-07 */}
              <View onLayout={marcarPosicion('ubicacion')}>
              <Text style={styles.label}>
                {t('minuta.form.ubicacion')}
                <Text style={{ color: colors.error }}> *</Text>
              </Text>
              <Pressable accessibilityRole="button"
                accessibilityLabel={t('minuta.form.ubicacion')}
                onPress={() => setUbicacionPickerOpen(true)}
                style={[
                  styles.input,
                  errores.ubicacion ? { borderColor: colors.error } : null,
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
              <InlineError message={errores.ubicacion} style={{ marginTop: 6 }} />
              </View>

              <Text style={styles.label}>Areas involucradas</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {areas.map((a) => {
                  const on = selAreas.includes(a.id);
                  return (
                    <Pressable accessibilityRole="button"
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
                <Pressable accessibilityRole="button"
                  onPress={() => setInvolvedPickerOpen(true)}
                  style={styles.addRow}
                >
                  <Ionicons name="person-add-outline" size={16} color={colors.primary} />
                  <Text style={styles.addRowTxt}>
                    {involvedIds.length > 0 ? `Editar (${involvedIds.length})` : 'Anadir personas'}
                  </Text>
                </Pressable>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: -2, marginBottom: 6 }}>
                Veran esta minuta en su filtro "Mis Minutas".
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
                        <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={() => toggleInvolved(uid)} hitSlop={8}>
                          <Ionicons name="close" size={12} color={colors.textMuted} />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={styles.sepRow}>
                <Text style={styles.label}>PDF escaneado (opcional)</Text>
              </View>
              {pdfAsset ? (
                <View style={styles.pdfRow}>
                  <Ionicons name="document-attach" size={16} color={colors.primary} />
                  <Text style={styles.pdfRowTxt} numberOfLines={1}>{pdfAsset.name}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={() => setPdfAsset(null)} hitSlop={8}>
                    <Ionicons name="close" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              ) : (
                <Pressable accessibilityRole="button" onPress={pickPdf} style={styles.pdfAttachBtn}>
                  <Ionicons name="attach-outline" size={16} color={colors.primary} />
                  <Text style={styles.pdfAttachTxt}>Seleccionar PDF (una hoja)</Text>
                </Pressable>
              )}

              {tipo === 'compromiso' && (
                <>
                  <View style={styles.sepRow} onLayout={marcarPosicion('acuerdos')}>
                    <Text style={styles.label}>Acuerdos *</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => { limpiar('acuerdos'); addAcuerdo(); }}
                      style={styles.addRow}
                    >
                      <Ionicons name="add" size={16} color={colors.primary} />
                      <Text style={styles.addRowTxt}>Anadir</Text>
                    </Pressable>
                  </View>
                  <InlineError message={errores.acuerdos} style={{ marginBottom: 6 }} />

                  {acuerdos.map((a, i) => (
                    <View key={i} style={styles.acuerdoDraft} onLayout={marcarPosicion(`acuerdo.${i}`)}>
                      <View style={styles.acuerdoDraftHead}>
                        <Text style={styles.acuerdoDraftIdx}>#{i + 1}</Text>
                        {acuerdos.length > 1 && (
                          <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} onPress={() => removeAcuerdo(i)} hitSlop={8}>
                            <Ionicons name="close-circle" size={18} color="#DC2626" />
                          </Pressable>
                        )}
                      </View>
                      <FormField
                        label={t('minuta.form.acuerdoLabel', { n: i + 1 })}
                        value={a.descripcion}
                        onChangeText={(v) => { limpiar(claveAcuerdo(i, 'descripcion')); setAcuerdoField(i, { descripcion: v }); }}
                        placeholder={t('minuta.form.acuerdoPlaceholder')}
                        multiline
                        maxLength={1200}
                        inputStyle={{ minHeight: 60, textAlignVertical: 'top' }}
                        error={errores[claveAcuerdo(i, 'descripcion')]}
                      />
                      <Pressable accessibilityRole="button"
                        accessibilityLabel={t('minuta.form.seleccionarResponsable')}
                        onPress={() => setRespPickerFor(i)}
                        style={[
                          styles.input,
                          styles.selectRow,
                          { marginTop: 8 },
                          errores[claveAcuerdo(i, 'responsable')] ? { borderColor: colors.error } : null,
                        ]}
                      >
                        <Ionicons name="person-outline" size={14} color={colors.textMuted} />
                        <Text
                          style={{
                            color: a.responsable_id ? colors.text : colors.textMuted,
                            flex: 1,
                          }}
                          numberOfLines={1}
                        >
                          {a.responsable_id ? memberName(a.responsable_id) : t('minuta.form.seleccionarResponsable')}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
                      </Pressable>
                      <InlineError message={errores[claveAcuerdo(i, 'responsable')]} style={{ marginTop: 6 }} />
                      <FormField
                        label={t('minuta.form.fechaLimite', { n: i + 1 })}
                        value={a.fecha_limite}
                        onChangeText={(v) => { limpiar(claveAcuerdo(i, 'fecha')); setAcuerdoField(i, { fecha_limite: v }); }}
                        placeholder={t('minuta.form.fechaLimitePlaceholder')}
                        error={errores[claveAcuerdo(i, 'fecha')]}
                      />
                    </View>
                  ))}
                </>
              )}
            </ScrollView>

            <InlineError message={errorGeneral} style={{ marginHorizontal: spacing.md, marginBottom: 8 }} />
            <View style={styles.modalFooter}>
              <Pressable accessibilityRole="button" onPress={onClose} style={styles.btnGhost} disabled={saving}>
                <Text style={styles.btnGhostTxt}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('minuta.form.guardar')}
                accessibilityState={{ disabled: saving, busy: saving }}
                onPress={onSave}
                style={[styles.btnPrimary, saving && { opacity: 0.6 }]}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryTxt}>{t('minuta.form.guardar')}</Text>
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
                  {/* "Contratista" siempre disponible: no es una cuenta de usuario,
                      representa a la empresa contratista del proyecto. */}
                  <Pressable accessibilityRole="button"
                    onPress={() => {
                      limpiar(claveAcuerdo(respPickerFor!, 'responsable'));
                      setAcuerdoField(respPickerFor!, { responsable_id: 'contratista' });
                      setRespPickerFor(null);
                    }}
                    style={styles.pickerRow}
                  >
                    <Ionicons name="business" size={22} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', color: colors.text }}>Contratista</Text>
                      <Text style={{ color: colors.textMuted, fontSize: 12 }}>Empresa contratista</Text>
                    </View>
                  </Pressable>
                  {members.length === 0 ? (
                    <Text style={{ padding: 16, color: colors.textMuted }}>
                      No hay miembros en el proyecto.
                    </Text>
                  ) : (
                    members.map((m) => (
                      <Pressable accessibilityRole="button"
                        key={m.id}
                        onPress={() => {
                          limpiar(claveAcuerdo(respPickerFor!, 'responsable'));
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

        {/* Picker de involucrados (multi-seleccion) */}
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
                  <Pressable accessibilityRole="button" onPress={() => setInvolvedPickerOpen(false)} hitSlop={8}>
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
                        <Pressable accessibilityRole="button"
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

        {/* Picker de Ubicacion (seleccion unica entre nodos del proyecto) */}
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
                  <Text style={styles.pickerTitle}>Ubicacion</Text>
                  <Pressable accessibilityRole="button" onPress={() => setUbicacionPickerOpen(false)} hitSlop={8}>
                    <Text style={{ color: colors.primary, fontWeight: '800' }}>Cerrar</Text>
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 420 }}>
                  {nodes.length === 0 ? (
                    <Text style={{ padding: 16, color: colors.textMuted }}>
                      El proyecto aun no tiene ubicaciones. Pidele al coordinador que las cree.
                    </Text>
                  ) : (
                    [...nodes]
                      .sort((a, b) => (a.order || 0) - (b.order || 0))
                      .map((n) => {
                      const on = ubicacionId === n.id;
                      return (
                        <Pressable accessibilityRole="button"
                          key={n.id}
                          onPress={() => {
                            setUbicacionId(n.id);
                            limpiar('ubicacion');
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

  codePrefixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  codePrefixTxt: { flex: 1, fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  codePrefixVal: { color: colors.text, fontWeight: '800', letterSpacing: 0.5 },
  codePrefixInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.surface,
  },
  readOnlyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full,
  },
  readOnlyBadgeTxt: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.4 },

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

  chipsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 2, marginTop: 8 },
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
  codigoTxt: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.6, marginBottom: 2 },
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
  pdfBlock: {
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingTop: 10, marginTop: 2,
  },
  pdfRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 9,
  },
  pdfRowTxt: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  pdfActionTxt: { fontSize: 12, fontWeight: '800', color: colors.primary },
  pdfAttachBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed',
    borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 9,
  },
  pdfAttachTxt: { fontSize: 13, fontWeight: '800', color: colors.primary },
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
  tipoRow: { flexDirection: 'row', gap: 8 },
  tipoBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  tipoBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tipoBtnTxt: { fontSize: 13, fontWeight: '700', color: colors.text },
  tipoBtnTxtActive: { color: '#fff' },
  tipoHint: { fontSize: 11, color: colors.textMuted, marginTop: 6, lineHeight: 15 },
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
