// Fuerza de Trabajo — tabla derivada 100% de los reportes de campo
// (personnel/equipment ya capturados en cada reporte). Sin captura manual:
// 3 columnas (Autor | Ubicacion | Personal o Maquinaria).
//
// Cascada de agregacion (regla de negocio):
//   Diario  -> base absoluta (reportes crudos de ese dia).
//   Semanal -> resume EXCLUSIVAMENTE los reportes diarios de esa semana
//              (un grupo por dia, con subtotal por dia).
//   Mensual -> resume EXCLUSIVAMENTE los reportes semanales de ese mes
//              (un grupo por semana natural, con subtotal por semana).
//
// Coordinador General y Sub-Coordinador pueden editar/eliminar cada entrada
// (fila) directamente sobre el reporte original.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, FeedItem } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';
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

function buildTableData(reports: FeedItem[], field: Field, groupBy: GroupBy): TableData {
  const byGroup = new Map<string, { label: string; rows: EntryRow[]; subtotal: Map<string, number> }>();
  for (const r of reports) {
    const entries = ((r as any)[field] || []) as string[];
    if (!entries.length) continue;
    const created = dayjs.utc(r.created_at).tz(CDMX_TZ);
    const { key, label } = groupKeyLabel(created, groupBy);
    if (!byGroup.has(key)) byGroup.set(key, { label, rows: [], subtotal: new Map() });
    const bucket = byGroup.get(key)!;
    // Último nodo de la ruta = el nodo hijo (hoja) elegido al capturar, no el Tramo raíz.
    const path = r.node_path_names || [];
    const ubicacion = path.length ? path[path.length - 1] : '—';
    const autor = r.captured_by_name || 'Especialista';
    entries.forEach((texto, i) => {
      bucket.rows.push({ id: `${r.id}-${field}-${i}`, reportId: r.id, field, index: i, autor, ubicacion, texto });
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
    return <Text style={styles.emptyTxt}>Ningún reporte capturado en este periodo.</Text>;
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

  const personalData = useMemo(() => buildTableData(filteredReports, 'personnel', groupBy), [filteredReports, groupBy]);
  const maquinariaData = useMemo(() => buildTableData(filteredReports, 'equipment', groupBy), [filteredReports, groupBy]);

  async function saveEdit(value: string) {
    if (!editRow) return;
    try {
      setSaving(true);
      await api.updateWorkforceEntry(editRow.reportId, editRow.field, editRow.index, value.trim());
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
      await api.updateWorkforceEntry(editRow.reportId, editRow.field, editRow.index, null);
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
      await api.updateWorkforceEntry(row.reportId, row.field, row.index, null);
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
          <Text style={styles.subtitle}>Personal y maquinaria reportados en campo</Text>
        </View>
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
});
