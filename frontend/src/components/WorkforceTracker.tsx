// Fuerza de Trabajo — lista derivada 100% de los reportes de campo
// (personnel/equipment ya capturados en cada reporte). Sin captura manual.
// Una fila por reporte: Quien reporto | Ubicacion | cuantas personas y/o
// maquinaria subio. Al tocar la fila se despliega todo el detalle capturado.
//
// Agrupacion: Diario y Semanal agrupan por dia; Mensual agrupa por semana
// natural.
//
// Coordinador General y Sub-Coordinador pueden editar/eliminar cada entrada
// del detalle desplegado directamente sobre el reporte original.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, FeedItem } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';
import { a11y } from '@/src/i18n';
import {
  dayjs, CDMX_TZ,
  getStartOfTodayCDMX, getStartOfNaturalWeekCDMX, getStartOfNaturalMonthCDMX,
} from '@/src/utils/tz';

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

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

interface EntryRow {
  id: string;
  reportId: string;
  field: Field;
  index: number;
  autor: string;
  ubicacion: string;
  texto: string;
  // Posible doble reporte: misma entrada, mismo dia y misma ubicacion en otro
  // reporte (o repetida dentro del mismo).
  dup?: boolean;
}

// Un reporte de campo = una fila de la lista (autor + ubicacion + totales).
interface ReportRow {
  id: string;
  autor: string;
  ubicacion: string;
  hora: string;
  personas: number;
  maquinas: number;
  personal: EntryRow[];
  maquinaria: EntryRow[];
  dupCount: number;
}

interface Group {
  key: string;
  label: string;
  rows: ReportRow[];
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

function sumQty(rows: EntryRow[]): number {
  return rows.reduce((acc, r) => acc + parseQtyDesc(r.texto).qty, 0);
}

function normTexto(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Marca como `dup` las entradas que aparentan haberse reportado dos veces:
// mismo dia (CDMX), misma ubicacion (nodo), mismo tipo y mismo texto
// (cantidad + descripcion), ya sea en reportes distintos o repetida dentro de
// un mismo reporte. Solo advierte: puede ser legitimo (dos turnos), asi que
// nunca borra nada por su cuenta.
function markDuplicates(reports: FeedItem[]): Set<string> {
  const seen = new Map<string, string[]>();
  for (const r of reports) {
    if (!r.created_at) continue;
    const day = dayjs.utc(r.created_at).tz(CDMX_TZ).format('YYYY-MM-DD');
    for (const field of ['personnel', 'equipment'] as Field[]) {
      (((r as any)[field] || []) as string[]).forEach((texto, i) => {
        const t = normTexto(texto);
        if (!t) return;
        const k = `${day}|${r.node_id}|${field}|${t}`;
        const ids = seen.get(k) || [];
        ids.push(`${r.id}-${field}-${i}`);
        seen.set(k, ids);
      });
    }
  }
  const dups = new Set<string>();
  seen.forEach((ids) => { if (ids.length > 1) ids.forEach((id) => dups.add(id)); });
  return dups;
}

function buildGroups(reports: FeedItem[], groupBy: GroupBy): Group[] {
  const dups = markDuplicates(reports);
  const byGroup = new Map<string, Group>();
  for (const r of reports) {
    // Último nodo de la ruta = el nodo hijo (hoja) elegido al capturar, no el Tramo raíz.
    const path = r.node_path_names || [];
    const ubicacion = path.length ? path[path.length - 1] : '—';
    const autor = r.captured_by_name || 'Especialista';
    const toRows = (field: Field): EntryRow[] =>
      (((r as any)[field] || []) as string[]).map((texto, i) => ({
        id: `${r.id}-${field}-${i}`, reportId: r.id, field, index: i, autor, ubicacion, texto,
        dup: dups.has(`${r.id}-${field}-${i}`),
      }));
    const personal = toRows('personnel');
    const maquinaria = toRows('equipment');
    if (!personal.length && !maquinaria.length) continue;

    const created = dayjs.utc(r.created_at).tz(CDMX_TZ);
    const { key, label } = groupKeyLabel(created, groupBy);
    if (!byGroup.has(key)) byGroup.set(key, { key, label, rows: [] });
    byGroup.get(key)!.rows.push({
      id: r.id, autor, ubicacion, hora: created.format('HH:mm'),
      personas: sumQty(personal), maquinas: sumQty(maquinaria), personal, maquinaria,
      dupCount: personal.filter((e) => e.dup).length + maquinaria.filter((e) => e.dup).length,
    });
  }
  return Array.from(byGroup.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
}

function EntryList({
  title, icon, rows, canEdit, onEditRow, onDeleteRow, deletingId,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  rows: EntryRow[];
  canEdit: boolean;
  onEditRow: (row: EntryRow) => void;
  onDeleteRow: (row: EntryRow) => void;
  deletingId: string | null;
}) {
  if (!rows.length) return null;
  return (
    <View style={styles.detailBlock}>
      <View style={styles.detailTitleRow}>
        <Ionicons name={icon} size={13} color={colors.textMuted} />
        <Text style={styles.detailTitle}>{title}</Text>
      </View>
      {rows.map((r) => (
        <View key={r.id} style={styles.detailRow}>
          <Text style={[styles.detailTxt, r.dup && styles.detailTxtDup]}>{'•'} {r.texto}{r.dup ? '  · posible doble reporte' : ''}</Text>
          {canEdit && (
            <View style={styles.rowActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('editar')} onPress={() => onEditRow(r)} style={styles.editBtn} hitSlop={8}>
                <Ionicons name="pencil-outline" size={14} color={colors.primary} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')}
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
    </View>
  );
}

function ReportItem({
  row, canEdit, onEditRow, onDeleteRow, deletingId,
}: {
  row: ReportRow;
  canEdit: boolean;
  onEditRow: (row: EntryRow) => void;
  onDeleteRow: (row: EntryRow) => void;
  deletingId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const resumen = [
    row.personas > 0 ? `${row.personas} ${row.personas === 1 ? 'persona' : 'personas'}` : '',
    row.maquinas > 0 ? `${row.maquinas} ${row.maquinas === 1 ? 'maquinaria' : 'maquinarias'}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${row.autor}, ${row.ubicacion}, ${resumen}`}
        onPress={() => setOpen((v) => !v)}
        style={styles.dataRow}
      >
        <View style={styles.colAutor}>
          <Text style={styles.autorTxt} numberOfLines={2}>{row.autor}</Text>
          <Text style={styles.horaTxt}>{row.hora}</Text>
          {row.dupCount > 0 && (
            <View style={styles.dupBadge}>
              <Ionicons name="warning-outline" size={11} color="#B45309" />
              <Text style={styles.dupBadgeTxt}>Posible doble</Text>
            </View>
          )}
        </View>
        <Text style={[styles.dataCell, styles.colUbic]} numberOfLines={2}>{row.ubicacion}</Text>
        <Text style={[styles.dataCell, styles.colVal, styles.resumenTxt]} numberOfLines={2}>{resumen}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>
      {open && (
        <View style={styles.detailWrap}>
          <EntryList title="Personal" icon="people-outline" rows={row.personal}
            canEdit={canEdit} onEditRow={onEditRow} onDeleteRow={onDeleteRow} deletingId={deletingId} />
          <EntryList title="Maquinaria y Equipo" icon="construct-outline" rows={row.maquinaria}
            canEdit={canEdit} onEditRow={onEditRow} onDeleteRow={onDeleteRow} deletingId={deletingId} />
        </View>
      )}
    </View>
  );
}

function WorkforceList({
  groups, canEdit, onEditRow, onDeleteRow, deletingId,
}: {
  groups: Group[];
  canEdit: boolean;
  onEditRow: (row: EntryRow) => void;
  onDeleteRow: (row: EntryRow) => void;
  deletingId: string | null;
}) {
  if (groups.length === 0) {
    return <Text style={styles.emptyTxt}>Ningún reporte capturado en este periodo.</Text>;
  }
  const dupReports = groups.reduce((n, g) => n + g.rows.filter((r) => r.dupCount > 0).length, 0);
  return (
    <View>
      {dupReports > 0 && (
        <View style={styles.dupBanner}>
          <Ionicons name="warning-outline" size={16} color="#B45309" />
          <Text style={styles.dupBannerTxt}>
            {dupReports} {dupReports === 1 ? 'reporte tiene' : 'reportes tienen'} entradas que parecen reportadas dos veces
            (mismo dia, ubicacion y cantidad). Revisalas antes de exportar.
          </Text>
        </View>
      )}
    <View style={styles.table}>
      <View style={styles.headerRowTable}>
        <Text style={[styles.headerCell, styles.colAutor]}>REPORTÓ</Text>
        <Text style={[styles.headerCell, styles.colUbic]}>UBICACIÓN</Text>
        <Text style={[styles.headerCell, styles.colVal]}>CANTIDAD</Text>
        <View style={styles.colChevronHeader} />
      </View>
      {groups.map((g) => (
        <View key={g.key}>
          <View style={styles.dayBand}>
            <Text style={styles.dayBandTxt}>{g.label.toUpperCase()}</Text>
          </View>
          {g.rows.map((r) => (
            <ReportItem key={r.id} row={r} canEdit={canEdit}
              onEditRow={onEditRow} onDeleteRow={onDeleteRow} deletingId={deletingId} />
          ))}
        </View>
      ))}
    </View>
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
          <Pressable accessibilityRole="button" onPress={onDelete} disabled={saving} style={[styles.modalBtn, styles.modalBtnDanger]}>
            <Text style={styles.modalBtnDangerTxt}>Eliminar</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} disabled={saving} style={[styles.modalBtn, styles.modalBtnGhost]}>
            <Text style={styles.modalBtnGhostTxt}>Cancelar</Text>
          </Pressable>
          <Pressable accessibilityRole="button"
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

export function WorkforceTracker({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canEdit = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [period, setPeriod] = useState<Period>('day');
  const [reports, setReports] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<EntryRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      setError(null);
      const res = await api.feed(projectId, 'month', 200);
      setReports(res?.reports || []);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar la fuerza de trabajo');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const groupBy: GroupBy = period === 'month' ? 'week' : 'day';

  const filteredReports = useMemo(() => {
    const start = period === 'day'
      ? getStartOfTodayCDMX()
      : period === 'week'
      ? getStartOfNaturalWeekCDMX()
      : getStartOfNaturalMonthCDMX();
    return reports
      .filter((r) => r.created_at && dayjs.utc(r.created_at).tz(CDMX_TZ).isSameOrAfter(start))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  }, [reports, period]);

  const groups = useMemo(() => buildGroups(filteredReports, groupBy), [filteredReports, groupBy]);

  async function saveEdit(value: string) {
    if (!editRow) return;
    try {
      setSaving(true);
      await api.updateWorkforceEntry(editRow.reportId, editRow.field, editRow.index, value.trim());
      setEditRow(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteEdit() {
    if (!editRow) return;
    try {
      setSaving(true);
      await api.updateWorkforceEntry(editRow.reportId, editRow.field, editRow.index, null);
      setEditRow(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  // Basurero directo en la fila (sin pasar por el modal de edicion) para
  // corregir capturas equivocadas con un solo tap + confirmacion.
  async function deleteRow(row: EntryRow) {
    try {
      setDeletingId(row.id);
      await api.updateWorkforceEntry(row.reportId, row.field, row.index, null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Inténtalo nuevamente.');
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
          <Text style={styles.subtitle}>Personal y maquinaria reportados en campo</Text>
        </View>
      </View>

      <View style={styles.chipRow}>
        {PERIODS.map((p) => {
          const active = period === p.value;
          return (
            <Pressable accessibilityRole="button"
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
          <Pressable accessibilityRole="button" onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryTxt}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.lastSection}>
          <WorkforceList
            groups={groups}
            canEdit={canEdit}
            onEditRow={setEditRow}
            onDeleteRow={confirmDeleteRow}
            deletingId={deletingId}
          />
        </View>
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
  colChevronHeader: { width: 16 },

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
  autorTxt: { fontSize: 11, color: colors.text, fontWeight: '700', lineHeight: 15, paddingRight: 4 },
  horaTxt: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
  resumenTxt: { fontWeight: '700' },
  detailWrap: {
    backgroundColor: colors.bg, paddingHorizontal: 12, paddingVertical: 8, gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  detailBlock: { gap: 2 },
  detailTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  detailTitle: { fontSize: 10, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  detailTxtDup: { color: '#B45309', fontWeight: '700' },
  dupBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  dupBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#B45309' },
  dupBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: spacing.sm,
    padding: spacing.sm, borderRadius: radius.sm, backgroundColor: '#FEF3C7',
  },
  dupBannerTxt: { flex: 1, fontSize: 11, color: '#92400E', lineHeight: 16, fontWeight: '600' },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  detailTxt: { flex: 1, fontSize: 12, color: colors.text, lineHeight: 17 },
  rowActions: { flexDirection: 'row', width: 52, alignItems: 'center', justifyContent: 'flex-end' },
  editBtn: { width: 26, alignItems: 'center', justifyContent: 'center' },

  dayBand: { backgroundColor: '#EEF2FF', paddingHorizontal: 10, paddingVertical: 7 },
  dayBandTxt: { fontSize: 10, fontWeight: '800', color: '#3730A3', letterSpacing: 0.3 },

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
});
