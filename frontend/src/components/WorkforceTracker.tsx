// Fuerza de Trabajo — captura independiente de los reportes de actividad
// (ver "Fuerza de Trabajo — captura independiente" en server.py). Antes esta
// pantalla era SOLO LECTURA, derivada de `report.personnel`/`equipment`; si
// nadie subía un reporte narrativo ese día, la tabla quedaba vacía. Ahora
// tiene su propio flujo de captura (nodo hoja + personal/maquinaria) vía
// `resource_logs`, y la tabla se llena con eso, exista o no un reporte de
// actividad — el export PDF/PPTX usa la misma fuente (ver
// `_gather_export_data`/`resource_logs_by_node` en server.py).
//
// Cascada de agregacion (regla de negocio), igual que antes:
//   Diario  -> base absoluta (cortes crudos de ese dia).
//   Semanal -> resume EXCLUSIVAMENTE los cortes diarios de esa semana
//              (un grupo por dia, con subtotal por dia).
//   Mensual -> resume EXCLUSIVAMENTE los cortes semanales de ese mes
//              (un grupo por semana natural, con subtotal por semana).
//
// Coordinador General y Sub-Coordinador pueden editar/eliminar cada entrada
// (fila) directamente sobre el corte original.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, LocationNodeTree, Project, ResourceLog } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';
import {
  dayjs, CDMX_TZ,
  getStartOfTodayCDMX, getStartOfNaturalWeekCDMX, getStartOfNaturalMonthCDMX,
} from '@/src/utils/tz';
import {
  PersonalEquipoItem, PersonalEquipoSection, itemsToEntries, mergeCatalog, mergeCatalogEquipo,
} from '@/src/components/PersonalEquipoEditor';

type Period = 'day' | 'week' | 'month';
type Field = 'personnel' | 'equipment';
type GroupBy = 'day' | 'week';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Diario' },
  { value: 'week', label: 'Semanal' },
  { value: 'month', label: 'Mensual' },
];

function parseQtyDesc(s: string): { qty: number; desc: string } {
  const m = /^\s*(\d+)\s+(.*)$/.exec(s || '');
  return m ? { qty: parseInt(m[1], 10), desc: m[2].trim() } : { qty: 1, desc: (s || '').trim() };
}

// Inverso de `itemsToEntries` — reconstruye items editables a partir de las
// entradas "qty desc" ya guardadas (para precargar el formulario cuando el
// nodo elegido ya tiene un corte capturado hoy).
function entriesToItems(entries: string[]): PersonalEquipoItem[] {
  return (entries || []).map((s, i) => {
    const { qty, desc } = parseQtyDesc(s);
    return { id: `${i}-${Math.random().toString(36).slice(2, 7)}`, desc, qty };
  });
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

interface EntryRow {
  id: string;
  logId: string;
  field: Field;
  index: number;
  autor: string;
  ubicacion: string;
  texto: string;
}

interface Group {
  key: string;
  label: string;
  rows: EntryRow[];
  subtotal: { desc: string; qty: number }[];
}

interface TableData {
  groups: Group[];
  total: { desc: string; qty: number }[];
}

function groupKeyLabel(created: dayjs.Dayjs, groupBy: GroupBy): { key: string; label: string } {
  if (groupBy === 'week') {
    const start = created.startOf('day').day(0);
    const end = start.add(6, 'day');
    const key = start.format('YYYY-MM-DD');
    const label = start.month() === end.month()
      ? `Semana del ${start.format('DD')} al ${end.format('DD MMM')}`
      : `Semana del ${start.format('DD MMM')} al ${end.format('DD MMM')}`;
    return { key, label };
  }
  return { key: created.format('YYYY-MM-DD'), label: capitalize(created.format('dddd DD MMM')) };
}

function buildTableData(logs: ResourceLog[], field: Field, groupBy: GroupBy): TableData {
  const byGroup = new Map<string, { label: string; rows: EntryRow[]; subtotal: Map<string, number> }>();
  for (const r of logs) {
    const entries = (r[field] || []) as string[];
    if (!entries.length) continue;
    const created = dayjs.utc(r.created_at).tz(CDMX_TZ);
    const { key, label } = groupKeyLabel(created, groupBy);
    if (!byGroup.has(key)) byGroup.set(key, { label, rows: [], subtotal: new Map() });
    const bucket = byGroup.get(key)!;
    const path = r.node_path_names || [];
    const ubicacion = path.length ? path[path.length - 1] : (r.node_name || '—');
    const autor = r.captured_by_name || 'Especialista';
    entries.forEach((texto, i) => {
      bucket.rows.push({ id: `${r.id}-${field}-${i}`, logId: r.id, field, index: i, autor, ubicacion, texto });
      const { qty, desc } = parseQtyDesc(texto);
      if (!desc) return;
      bucket.subtotal.set(desc, (bucket.subtotal.get(desc) || 0) + qty);
    });
  }

  const keys = Array.from(byGroup.keys()).sort();
  const totalMap = new Map<string, number>();
  const groups: Group[] = keys.map((key) => {
    const b = byGroup.get(key)!;
    const subtotal = Array.from(b.subtotal.entries())
      .sort((a, b2) => a[0].localeCompare(b2[0]))
      .map(([desc, qty]) => ({ desc, qty }));
    subtotal.forEach(({ desc, qty }) => totalMap.set(desc, (totalMap.get(desc) || 0) + qty));
    return { key, label: b.label, rows: b.rows, subtotal };
  });
  const total = Array.from(totalMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([desc, qty]) => ({ desc, qty }));
  return { groups, total };
}

function WorkforceTable({
  data, col3Header, canEdit, onEditRow, onDeleteRow, deletingId,
}: {
  data: TableData;
  col3Header: string;
  canEdit: boolean;
  onEditRow: (row: EntryRow) => void;
  onDeleteRow: (row: EntryRow) => void;
  deletingId: string | null;
}) {
  if (data.groups.length === 0) {
    return <Text style={styles.emptyTxt}>Nada capturado en este periodo todavía.</Text>;
  }
  return (
    <View style={styles.table}>
      <View style={styles.headerRowTable}>
        <Text style={[styles.headerCell, styles.colAutor]}>AUTOR</Text>
        <Text style={[styles.headerCell, styles.colUbic]}>UBICACIÓN</Text>
        <Text style={[styles.headerCell, styles.colVal]}>{col3Header}</Text>
        {canEdit && <View style={styles.colActionsHeader} />}
      </View>
      {data.groups.map((g) => (
        <View key={g.key}>
          <View style={styles.dayBand}>
            <Text style={styles.dayBandTxt}>{g.label.toUpperCase()}</Text>
          </View>
          {g.rows.map((r) => (
            <View key={r.id} style={styles.dataRow}>
              <Text style={[styles.dataCell, styles.colAutor]} numberOfLines={2}>{r.autor}</Text>
              <Text style={[styles.dataCell, styles.colUbic]} numberOfLines={2}>{r.ubicacion}</Text>
              <Text style={[styles.dataCell, styles.colVal]} numberOfLines={2}>{r.texto}</Text>
              {canEdit && (
                <View style={styles.rowActions}>
                  <Pressable onPress={() => onEditRow(r)} style={styles.editBtn} hitSlop={8}>
                    <Ionicons name="pencil-outline" size={14} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={() => onDeleteRow(r)}
                    disabled={deletingId === r.id}
                    style={styles.editBtn}
                    hitSlop={8}
                  >
                    {deletingId === r.id ? (
                      <ActivityIndicator size="small" color="#DC2626" />
                    ) : (
                      <Ionicons name="trash-outline" size={14} color="#DC2626" />
                    )}
                  </Pressable>
                </View>
              )}
            </View>
          ))}
          <View style={styles.subtotalBand}>
            <Text style={styles.subtotalLabel}>SUBTOTAL — {g.label.toUpperCase()}</Text>
            <View style={styles.bandList}>
              {g.subtotal.map(({ desc, qty }) => (
                <Text key={desc} style={styles.bandListItem} numberOfLines={2}>{'•'} {qty} {desc}</Text>
              ))}
            </View>
          </View>
        </View>
      ))}
      {data.groups.length > 1 && (
        <View style={styles.totalBand}>
          <Text style={styles.totalLabel}>TOTAL DEL PERÍODO</Text>
          <View style={styles.bandList}>
            {data.total.map(({ desc, qty }) => (
              <Text key={desc} style={styles.totalListItem} numberOfLines={2}>{'•'} {qty} {desc}</Text>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function EditEntryModal({
  row, saving, onSave, onDelete, onClose,
}: {
  row: EntryRow;
  saving: boolean;
  onSave: (value: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(row.texto);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>Editar entrada</Text>
        <Text style={styles.modalSub}>{row.autor} · {row.ubicacion}</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          style={styles.modalInput}
          placeholder='Ej. "3 Ayudante (S2)"'
          placeholderTextColor={colors.textMuted}
          autoFocus
        />
        <View style={styles.modalActions}>
          <Pressable onPress={onDelete} disabled={saving} style={[styles.modalBtn, styles.modalBtnDanger]}>
            <Text style={styles.modalBtnDangerTxt}>Eliminar</Text>
          </Pressable>
          <Pressable onPress={onClose} disabled={saving} style={[styles.modalBtn, styles.modalBtnGhost]}>
            <Text style={styles.modalBtnGhostTxt}>Cancelar</Text>
          </Pressable>
          <Pressable
            onPress={() => onSave(value)}
            disabled={saving || !value.trim()}
            style={[styles.modalBtn, styles.modalBtnPrimary, (saving || !value.trim()) && { opacity: 0.6 }]}
          >
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalBtnPrimaryTxt}>Guardar</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// === Modal de captura: elegir nodo hoja + personal/maquinaria de HOY =====
function CaptureModal({
  visible, tree, project, onClose, onSaved,
}: {
  visible: boolean;
  tree: LocationNodeTree[];
  project: Project | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [path, setPath] = useState<LocationNodeTree[]>([]);
  const [node, setNode] = useState<LocationNodeTree | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [personal, setPersonal] = useState<PersonalEquipoItem[]>([]);
  const [equipo, setEquipo] = useState<PersonalEquipoItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPath([]);
      setNode(null);
      setPersonal([]);
      setEquipo([]);
    }
  }, [visible]);

  const currentOptions = useMemo(() => {
    const list = path.length === 0 ? tree : (path[path.length - 1].children || []);
    return [...list].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [tree, path]);

  const catalogPersonal = useMemo(() => mergeCatalog(project?.categorias_personal, []), [project]);
  const catalogEquipo = useMemo(() => mergeCatalogEquipo(project?.categorias_equipo, []), [project]);

  async function onSelect(n: LocationNodeTree) {
    if (!n.is_leaf) {
      setPath([...path, n]);
      return;
    }
    setNode(n);
    setLoadingExisting(true);
    try {
      const existing = project ? await api.getResourceLog(project.id, n.id) : null;
      setPersonal(entriesToItems(existing?.personnel || []));
      setEquipo(entriesToItems(existing?.equipment || []));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el corte de hoy para este nodo');
    } finally {
      setLoadingExisting(false);
    }
  }

  async function onSave() {
    if (!node || !project || saving) return;
    setSaving(true);
    try {
      await api.upsertResourceLog(project.id, {
        node_id: node.id,
        personnel: itemsToEntries(personal),
        equipment: itemsToEntries(equipo),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.captureFlex}>
        <View style={styles.captureHeader}>
          <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
          <Text style={styles.captureTitle}>Capturar Fuerza de Trabajo</Text>
          <View style={{ width: 22 }} />
        </View>

        {!node ? (
          <View style={{ flex: 1 }}>
            {path.length > 0 && (
              <View style={styles.breadcrumbRow}>
                <Pressable onPress={() => setPath([])} hitSlop={6}>
                  <Text style={styles.breadcrumbTxt}>Raíz</Text>
                </Pressable>
                {path.map((p, i) => (
                  <React.Fragment key={p.id}>
                    <Text style={styles.breadcrumbSep}>›</Text>
                    <Pressable onPress={() => setPath(path.slice(0, i + 1))} hitSlop={6}>
                      <Text style={styles.breadcrumbTxt}>{p.name}</Text>
                    </Pressable>
                  </React.Fragment>
                ))}
              </View>
            )}
            <View style={{ padding: spacing.md, gap: 4, flex: 1 }}>
              {currentOptions.length === 0 ? (
                <Text style={styles.empty}>Este nodo no tiene hijos.</Text>
              ) : currentOptions.map((n) => (
                <Pressable key={n.id} onPress={() => onSelect(n)} style={styles.nodeRow}>
                  <Ionicons name={n.is_leaf ? 'location-outline' : 'git-network-outline'} size={16} color={colors.textMuted} />
                  <Text style={styles.nodeRowTxt}>{n.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={styles.selectedNodeBar}>
              <Text style={styles.selectedNodeTxt} numberOfLines={1}>{node.name}</Text>
              <Pressable onPress={() => setNode(null)} hitSlop={8}>
                <Text style={styles.changeNodeTxt}>Cambiar</Text>
              </Pressable>
            </View>
            {loadingExisting ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <View style={{ flex: 1, padding: spacing.md }}>
                <PersonalEquipoSection
                  title="PERSONAL"
                  items={personal}
                  onAdd={() => setPersonal([...personal, { id: Math.random().toString(36).slice(2, 9), desc: '', qty: 1 }])}
                  onRemove={(id) => setPersonal(personal.filter((x) => x.id !== id))}
                  onUpdate={(id, p) => setPersonal((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)))}
                  catalog={catalogPersonal}
                />
                <PersonalEquipoSection
                  title="EQUIPO"
                  items={equipo}
                  onAdd={() => setEquipo([...equipo, { id: Math.random().toString(36).slice(2, 9), desc: '', qty: 1 }])}
                  onRemove={(id) => setEquipo(equipo.filter((x) => x.id !== id))}
                  onUpdate={(id, p) => setEquipo((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)))}
                  catalog={catalogEquipo}
                  isEquipo
                />
                <Pressable onPress={onSave} disabled={saving} style={[styles.saveBigBtn, saving && { opacity: 0.7 }]}>
                  {saving ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="save-outline" size={18} color="#fff" />
                      <Text style={styles.saveBigBtnTxt}>Guardar corte de hoy</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

export function WorkforceTracker({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canEdit = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [period, setPeriod] = useState<Period>('day');
  const [logs, setLogs] = useState<ResourceLog[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<LocationNodeTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<EntryRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      setError(null);
      const [res, proj, t] = await Promise.all([
        api.feedResourceLogs(projectId, 'month', 200),
        api.getProject(projectId),
        api.getTree(projectId),
      ]);
      setLogs(res?.logs || []);
      setProject(proj);
      setTree(t || []);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar la fuerza de trabajo');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const groupBy: GroupBy = period === 'month' ? 'week' : 'day';

  const filteredLogs = useMemo(() => {
    const start = period === 'day'
      ? getStartOfTodayCDMX()
      : period === 'week'
      ? getStartOfNaturalWeekCDMX()
      : getStartOfNaturalMonthCDMX();
    return logs
      .filter((r) => r.created_at && dayjs.utc(r.created_at).tz(CDMX_TZ).isSameOrAfter(start))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  }, [logs, period]);

  const personalData = useMemo(() => buildTableData(filteredLogs, 'personnel', groupBy), [filteredLogs, groupBy]);
  const maquinariaData = useMemo(() => buildTableData(filteredLogs, 'equipment', groupBy), [filteredLogs, groupBy]);

  async function saveEdit(value: string) {
    if (!editRow) return;
    try {
      setSaving(true);
      await api.updateResourceLogEntry(editRow.logId, editRow.field, editRow.index, value.trim());
      setEditRow(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteEdit() {
    if (!editRow) return;
    try {
      setSaving(true);
      await api.updateResourceLogEntry(editRow.logId, editRow.field, editRow.index, null);
      setEditRow(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  // Basurero directo en la fila (sin pasar por el modal de edicion) para
  // corregir capturas equivocadas con un solo tap + confirmacion.
  async function deleteRow(row: EntryRow) {
    try {
      setDeletingId(row.id);
      await api.updateResourceLogEntry(row.logId, row.field, row.index, null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setDeletingId(null);
    }
  }

  function confirmDeleteRow(row: EntryRow) {
    Alert.alert(
      'Eliminar registro',
      `¿Eliminar "${row.texto}"? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => deleteRow(row) },
      ],
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <Ionicons name="people" size={16} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Fuerza de Trabajo</Text>
          <Text style={styles.subtitle}>Personal y maquinaria del día — captura independiente de los reportes</Text>
        </View>
        <Pressable onPress={() => setCaptureOpen(true)} style={styles.captureBtn}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.captureBtnTxt}>Capturar</Text>
        </Pressable>
      </View>

      <View style={styles.chipRow}>
        {PERIODS.map((p) => {
          const active = period === p.value;
          return (
            <Pressable
              key={p.value}
              onPress={() => setPeriod(p.value)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.errBox}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
          <Text style={styles.errTxt}>{error}</Text>
          <Pressable onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryTxt}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="people-outline" size={15} color={colors.text} />
              <Text style={styles.sectionTitle}>Personal</Text>
            </View>
            <WorkforceTable
              data={personalData}
              col3Header="PERSONAL"
              canEdit={canEdit}
              onEditRow={setEditRow}
              onDeleteRow={confirmDeleteRow}
              deletingId={deletingId}
            />
          </View>

          <View style={[styles.section, styles.lastSection]}>
            <View style={styles.sectionHeader}>
              <Ionicons name="construct-outline" size={15} color={colors.text} />
              <Text style={styles.sectionTitle}>Maquinaria y Equipo</Text>
            </View>
            <WorkforceTable
              data={maquinariaData}
              col3Header="MAQUINARIA"
              canEdit={canEdit}
              onEditRow={setEditRow}
              onDeleteRow={confirmDeleteRow}
              deletingId={deletingId}
            />
          </View>
        </>
      )}

      {editRow && (
        <EditEntryModal
          row={editRow}
          saving={saving}
          onSave={saveEdit}
          onDelete={deleteEdit}
          onClose={() => setEditRow(null)}
        />
      )}

      <CaptureModal
        visible={captureOpen}
        tree={tree}
        project={project}
        onClose={() => setCaptureOpen(false)}
        onSaved={load}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginBottom: spacing.xl },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerIcon: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: '#B45309',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontWeight: '600' },
  captureBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md,
  },
  captureBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },

  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: '#6B7280' },
  chipTextActive: { color: '#fff' },

  center: { paddingVertical: spacing.lg, alignItems: 'center' },
  errBox: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.sm },
  errTxt: { color: colors.textBody, fontSize: 12, flex: 1 },
  retryBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.primary, borderRadius: radius.sm },
  retryTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },

  section: { gap: 6 },
  lastSection: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  sectionTitle: {
    fontSize: 13, fontWeight: '800', color: colors.text,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  emptyTxt: { fontSize: 12, color: colors.textMuted, lineHeight: 17, paddingVertical: 4 },

  table: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', backgroundColor: colors.surface,
  },
  colAutor: { flex: 0.9 },
  colUbic: { flex: 1 },
  colVal: { flex: 1.3 },
  colActionsHeader: { width: 52 },

  headerRowTable: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  headerCell: { fontSize: 10, fontWeight: '800', color: '#fff', paddingRight: 4 },

  dataRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  dataCell: { fontSize: 11, color: colors.text, paddingRight: 4, lineHeight: 15 },
  rowActions: { flexDirection: 'row', width: 52, alignItems: 'center', justifyContent: 'flex-end' },
  editBtn: { width: 26, alignItems: 'center', justifyContent: 'center' },

  dayBand: { backgroundColor: '#EEF2FF', paddingHorizontal: 10, paddingVertical: 7 },
  dayBandTxt: { fontSize: 10, fontWeight: '800', color: '#3730A3', letterSpacing: 0.3 },

  // Subtotal / Total: mucho padding + lista con viñetas (una categoría por
  // línea) en vez de un párrafo corrido, para que no se amontone el texto.
  subtotalBand: {
    backgroundColor: '#FEF3C7', paddingHorizontal: 12, paddingVertical: 10,
    gap: 4,
  },
  subtotalLabel: { fontSize: 9.5, fontWeight: '800', color: '#92400E', letterSpacing: 0.3 },

  totalBand: {
    backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 12,
    gap: 4, marginBottom: 2,
  },
  totalLabel: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },

  bandList: { gap: 3 },
  bandListItem: { fontSize: 11.5, fontWeight: '700', color: '#78350F', lineHeight: 16 },
  totalListItem: { fontSize: 12, fontWeight: '700', color: '#fff', lineHeight: 17 },

  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  modalCard: {
    position: 'absolute', left: 20, right: 20, top: '30%',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, gap: 10,
  },
  modalTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  modalSub: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  modalInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text,
  },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  modalBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  modalBtnDanger: { backgroundColor: '#FEE2E2' },
  modalBtnDangerTxt: { color: '#DC2626', fontWeight: '800', fontSize: 12 },
  modalBtnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  modalBtnGhostTxt: { color: colors.text, fontWeight: '800', fontSize: 12 },
  modalBtnPrimary: { backgroundColor: colors.primary },
  modalBtnPrimaryTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },

  // --- Modal de captura ---
  captureFlex: { flex: 1, backgroundColor: colors.bg },
  captureHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  captureTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  breadcrumbRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
  },
  breadcrumbTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  breadcrumbSep: { fontSize: 12, color: colors.textMuted },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontStyle: 'italic' },
  nodeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12,
    paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  nodeRowTxt: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  selectedNodeBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.primaryLight,
  },
  selectedNodeTxt: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.primary },
  changeNodeTxt: { fontSize: 12, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  saveBigBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm,
  },
  saveBigBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
