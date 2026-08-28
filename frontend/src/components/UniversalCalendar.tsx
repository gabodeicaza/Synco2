// SynCo v2.0 _ UniversalCalendar
// Componente universal de calendario (Especialista / Sub-coordinador / Coordinador General).
// - Calendario visual mensual (react-native-calendars) con LocaleConfig en espanol.
// - Multi-dot por disciplina/area usando areaTone() para reflejar la jerarquia de colores.
// - Modal "Nuevo / Editar evento" con @react-native-community/datetimepicker nativo (iOS/Android).
//   En web (sin soporte nativo del picker en este SDK), se ofrece fallback con TextInput.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { api, Area, ProjectEvent, User } from '@/src/api';
import { colors, radius, shadow, spacing, areaTone } from '@/src/theme';
import { dayjs, CDMX_TZ, fmtTimeCDMX } from '@/src/utils/tz';

// ---------------------------------------------------------------------------
// LocaleConfig en espanol (meses, dias, etiquetas).
// ---------------------------------------------------------------------------
LocaleConfig.locales['es'] = {
  monthNames: [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ],
  monthNamesShort: [
    'Ene.', 'Feb.', 'Mar.', 'Abr.', 'May.', 'Jun.',
    'Jul.', 'Ago.', 'Sep.', 'Oct.', 'Nov.', 'Dic.',
  ],
  dayNames: [
    'Domingo', 'Lunes', 'Martes', 'Miercoles',
    'Jueves', 'Viernes', 'Sabado',
  ],
  dayNamesShort: ['D', 'L', 'M', 'M', 'J', 'V', 'S'],
  today: 'Hoy',
};
LocaleConfig.defaultLocale = 'es';

// ---------------------------------------------------------------------------
// Utilidades de fecha
// ---------------------------------------------------------------------------
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// [FIX] `new Date()` refleja la zona horaria del dispositivo, no CDMX — el
// día pre-seleccionado del calendario podía no coincidir con el día
// calendario real en CDMX (mismo bug de raíz que RangoFechasPicker).
function todayYmd(): string { return dayjs().tz(CDMX_TZ).format('YYYY-MM-DD'); }

function fmtDayHeader(ymdStr: string): string {
  try {
    const [y, m, d] = ymdStr.split('-').map((x) => parseInt(x, 10));
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    return ymdStr;
  }
}

// [FIX] Antes usaba `new Date(iso).getHours()/getMinutes()`, que leen la hora
// en la zona del DISPOSITIVO. El backend guarda start_at/end_at en UTC — si
// el dispositivo no está en CDMX (p.ej. UTC/GMT), se mostraba la hora UTC
// cruda como si fuera CDMX (+6h). Mismo bug de raíz documentado en tz.ts.
function fmtHora(iso?: string | null): string {
  return fmtTimeCDMX(iso);
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
type EditorState =
  | { kind: 'create' }
  | { kind: 'edit'; item: ProjectEvent }
  | null;

interface Props {
  projectId: string;
  userId?: string;
  isCoord?: boolean; // permite editar/eliminar cualquier evento
}

// ===========================================================================
// Componente principal
// ===========================================================================
export default function UniversalCalendar({ projectId, userId, isCoord }: Props) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [items, setItems] = useState<ProjectEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayYmd());
  const [editor, setEditor] = useState<EditorState>(null);

  const load = useCallback(async (silent = false) => {
    if (!projectId) { setLoading(false); setError('Sin proyecto asignado'); return; }
    try {
      if (!silent) setLoading(true);
      setError(null);
      const [evs, ars, mbs] = await Promise.all([
        api.listEvents(projectId, 'all', 1000),
        api.listAreas(projectId).catch(() => [] as Area[]),
        api.listProjectMembers(projectId).catch(() => [] as User[]),
      ]);
      setItems(evs);
      setAreas(ars);
      setMembers(mbs);
    } catch (e: any) {
      setError(e?.message || 'Error al cargar');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => { load(false); }, [load]);

  // Construye markedDates con sistema multi-dot.
  // Un dia con eventos de varias disciplinas muestra varios puntos.
  const markedDates = useMemo(() => {
    const map: Record<string, { dots: Array<{ key: string; color: string }>; selected?: boolean; selectedColor?: string }> = {};
    items.forEach((e) => {
      const day = (e.start_at || '').slice(0, 10);
      if (!day) return;
      const color = e.area_color || colors.primary;
      const key = e.area_id || 'general';
      if (!map[day]) map[day] = { dots: [] };
      if (!map[day].dots.find((d) => d.key === key)) {
        map[day].dots.push({ key, color });
      }
    });
    if (map[selectedDate]) {
      map[selectedDate].selected = true;
      map[selectedDate].selectedColor = colors.primary;
    } else {
      map[selectedDate] = { dots: [], selected: true, selectedColor: colors.primary };
    }
    return map;
  }, [items, selectedDate]);

  // Eventos del dia seleccionado (ordenados por hora).
  const dayEvents = useMemo(() => {
    return items
      .filter((e) => (e.start_at || '').slice(0, 10) === selectedDate)
      .sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''));
  }, [items, selectedDate]);

  function canEdit(e: ProjectEvent): boolean {
    // Los "Inicio de X" / "Fin de X" son virtuales (calculados desde las
    // fechas del concepto, ver server.py list_events) — no existen en
    // db.events, así que nunca son editables/eliminables desde aquí.
    if (e.id.startsWith('concepto-inicio:') || e.id.startsWith('concepto-fin:')) return false;
    return Boolean(isCoord || (userId && e.author_id === userId));
  }

  const onDelete = useCallback((e: ProjectEvent) => {
    const exec = () => {
      api.deleteEvent(e.id).then(() => load(true)).catch((err) => {
        Alert.alert('Error', err?.message || 'No se pudo eliminar');
      });
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm('?Eliminar este evento?')) exec();
    } else {
      Alert.alert('Eliminar evento', '?Seguro que deseas eliminarlo?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: exec },
      ]);
    }
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 96, paddingHorizontal: spacing.md, gap: spacing.sm }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(true); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.errorTxt}>{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <>
            {/* Calendario visual */}
            <View style={styles.calCard}>
              <Calendar
                current={selectedDate}
                onDayPress={(d) => setSelectedDate(d.dateString)}
                markingType="multi-dot"
                markedDates={markedDates}
                // Domingo primero — misma convención de semana natural que el resto de la app
                firstDay={0}
                enableSwipeMonths
                theme={{
                  backgroundColor: '#ffffff',
                  calendarBackground: '#ffffff',
                  textSectionTitleColor: '#1e293b',
                  selectedDayBackgroundColor: '#2563eb',
                  selectedDayTextColor: '#ffffff',
                  todayTextColor: '#2563eb',
                  dayTextColor: '#1e293b',
                  textDisabledColor: '#cbd5e1',
                  monthTextColor: '#1e293b',
                  arrowColor: '#2563eb',
                  indicatorColor: '#2563eb',
                  textDayFontWeight: '600',
                  textMonthFontWeight: '800',
                  textDayHeaderFontWeight: '700',
                  textDayFontSize: 13,
                  textMonthFontSize: 16,
                  textDayHeaderFontSize: 11,
                }}
              />
            </View>

            {/* Leyenda de disciplinas */}
            {areas.length > 0 ? (
              <View style={styles.legend}>
                {areas.map((a) => {
                  const tone = areaTone(a.color);
                  return (
                    <View key={a.id} style={[styles.legendChip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                      <View style={[styles.legendDot, { backgroundColor: a.color || colors.primary }]} />
                      <Text style={[styles.legendTxt, { color: tone.text }]} numberOfLines={1}>{a.name}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Encabezado del dia seleccionado */}
            <Text style={styles.dayHeader}>{fmtDayHeader(selectedDate)}</Text>

            {/* Eventos del dia */}
            {dayEvents.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="calendar-outline" size={24} color={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>Sin eventos en este dia</Text>
                <Text style={styles.emptyMsg}>Pulsa el boton + para programar uno.</Text>
              </View>
            ) : (
              dayEvents.map((e) => (
                <EventRow
                  key={e.id}
                  item={e}
                  canEdit={canEdit(e)}
                  onEdit={() => setEditor({ kind: 'edit', item: e })}
                  onDelete={() => onDelete(e)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      <Pressable onPress={() => setEditor({ kind: 'create' })} style={styles.fab}>
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>

      <EventEditor
        visible={!!editor}
        editor={editor}
        projectId={projectId}
        areas={areas}
        members={members}
        defaultDate={selectedDate}
        onClose={() => setEditor(null)}
        onSaved={() => { setEditor(null); load(true); }}
      />
    </View>
  );
}

// ===========================================================================
// Tarjeta de evento (fila bajo el calendario)
// ===========================================================================
function EventRow({
  item, canEdit, onEdit, onDelete,
}: {
  item: ProjectEvent;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const baseColor = item.area_color || colors.primary;
  const tone = areaTone(baseColor);
  const start = fmtHora(item.start_at);
  const end = item.end_at ? fmtHora(item.end_at) : null;
  return (
    <View style={[styles.eventCard, { borderLeftColor: baseColor }]}>
      <View style={styles.timeBlock}>
        <Text style={styles.timeTxt}>{start}</Text>
        {end ? <Text style={styles.timeEndTxt}>{end}</Text> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.eventTitle} numberOfLines={2}>{item.title}</Text>
        {item.area_name ? (
          <View style={[styles.areaChip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <View style={[styles.areaDot, { backgroundColor: baseColor }]} />
            <Text style={[styles.areaChipTxt, { color: tone.text }]} numberOfLines={1}>{item.area_name}</Text>
          </View>
        ) : null}
        {item.location ? (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={12} color={colors.textMuted} />
            <Text style={styles.metaTxt} numberOfLines={1}>{item.location}</Text>
          </View>
        ) : null}
        {item.description ? (
          <Text style={styles.descTxt} numberOfLines={3}>{item.description}</Text>
        ) : null}
        {(item.attendee_names && item.attendee_names.length > 0) ? (
          <View style={styles.attendeesWrap}>
            {item.attendee_names.slice(0, 4).map((n, i) => (
              <View key={i} style={styles.attendeeChip}>
                <Ionicons name="person" size={9} color={colors.primary} />
                <Text style={styles.attendeeChipTxt} numberOfLines={1}>{n}</Text>
              </View>
            ))}
            {item.attendee_names.length > 4 ? (
              <Text style={styles.attendeeMoreTxt}>+{item.attendee_names.length - 4} más</Text>
            ) : null}
          </View>
        ) : null}
        <View style={styles.authorRow}>
          <Ionicons name="person-circle-outline" size={11} color={colors.textMuted} />
          <Text style={styles.authorTxt}>{item.author_name}</Text>
          <View style={{ flex: 1 }} />
          {canEdit ? (
            <>
              <Pressable hitSlop={8} onPress={onEdit} style={styles.iconBtn}>
                <Ionicons name="create-outline" size={15} color={colors.primary} />
              </Pressable>
              <Pressable hitSlop={8} onPress={onDelete} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={15} color={colors.error} />
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ===========================================================================
// Editor de evento _ modal con DateTimePicker NATIVO
// ===========================================================================
type PickerField = 'startDate' | 'startTime' | 'endTime' | null;

function defaultStartForDate(ymdStr: string): Date {
  const [y, m, d] = ymdStr.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1, 9, 0, 0, 0);
  return dt;
}

// El DateTimePicker nativo solo entiende `Date` en la zona del DISPOSITIVO
// -- no hay forma de pedirle que opere "en CDMX". Para que la hora que el
// usuario ve/elige sea SIEMPRE hora de pared CDMX (sin importar en qué
// zona esté el dispositivo), estos dos helpers tratan los campos del
// `Date` (año/mes/día/hora/minuto) como dígitos CDMX puros, nunca como el
// instante real que ese `Date` representaría en el dispositivo. Mismo
// criterio que ya usa `(coord)/projects/[id]/events.tsx` (combineIso/
// toLocalDateInput), solo que aquí con `Date` en vez de strings porque el
// picker nativo lo exige.
function cdmxIsoToPickerDate(iso: string): Date {
  const m = dayjs.utc(iso).tz(CDMX_TZ);
  return new Date(m.year(), m.month(), m.date(), m.hour(), m.minute(), 0, 0);
}

function pickerDateToCdmxIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const wallClock = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return dayjs.tz(wallClock, CDMX_TZ).utc().toISOString();
}

function nowAsCdmxPickerDate(): Date {
  const m = dayjs().tz(CDMX_TZ);
  return new Date(m.year(), m.month(), m.date(), m.hour(), m.minute(), 0, 0);
}

function EventEditor({
  visible, editor, projectId, areas, members, defaultDate, onClose, onSaved,
}: {
  visible: boolean;
  editor: EditorState;
  projectId: string;
  areas: Area[];
  members: User[];
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [loc, setLoc] = useState('');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [attendeesPickerOpen, setAttendeesPickerOpen] = useState(false);
  const [startDate, setStartDate] = useState<Date>(defaultStartForDate(defaultDate));
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [picker, setPicker] = useState<PickerField>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset al abrir
  useEffect(() => {
    if (!visible) return;
    setErr(null);
    setPicker(null);
    setAttendeesPickerOpen(false);
    if (editor?.kind === 'edit') {
      const it = editor.item;
      setTitle(it.title || '');
      setDesc(it.description || '');
      setLoc(it.location || '');
      setAreaId(it.area_id || null);
      setAttendeeIds(it.attendee_ids || []);
      setStartDate(cdmxIsoToPickerDate(it.start_at));
      setEndDate(it.end_at ? cdmxIsoToPickerDate(it.end_at) : null);
    } else {
      const d = defaultStartForDate(defaultDate);
      // Si el dia seleccionado es hoy (CDMX), sugerir proxima hora redonda
      const now = nowAsCdmxPickerDate();
      if (ymd(d) === ymd(now)) {
        d.setHours(now.getHours() + 1, 0, 0, 0);
      }
      setStartDate(d);
      setEndDate(null);
      setTitle('');
      setDesc('');
      setLoc('');
      setAreaId(null);
      setAttendeeIds([]);
    }
  }, [visible, editor, defaultDate]);

  function toggleAttendee(uid: string) {
    setAttendeeIds((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));
  }

  function applyDateChange(field: PickerField, ev: DateTimePickerEvent, sel?: Date) {
    // En Android se cierra automaticamente; en iOS hay que cerrarlo manualmente.
    if (Platform.OS === 'android') setPicker(null);
    if (ev.type === 'dismissed') {
      setPicker(null);
      return;
    }
    if (!sel) return;
    if (field === 'startDate') {
      const next = new Date(startDate);
      next.setFullYear(sel.getFullYear(), sel.getMonth(), sel.getDate());
      setStartDate(next);
      if (endDate) {
        const ne = new Date(endDate);
        ne.setFullYear(sel.getFullYear(), sel.getMonth(), sel.getDate());
        setEndDate(ne);
      }
    } else if (field === 'startTime') {
      const next = new Date(startDate);
      next.setHours(sel.getHours(), sel.getMinutes(), 0, 0);
      setStartDate(next);
    } else if (field === 'endTime') {
      const base = endDate ? new Date(endDate) : new Date(startDate);
      base.setHours(sel.getHours(), sel.getMinutes(), 0, 0);
      setEndDate(base);
    }
  }

  async function submit() {
    setErr(null);
    const t = title.trim();
    if (!t) { setErr('Titulo obligatorio'); return; }
    if (endDate && endDate.getTime() < startDate.getTime()) {
      setErr('La hora de fin no puede ser anterior al inicio');
      return;
    }
    setBusy(true);
    try {
      const payload: any = {
        title: t,
        description: desc.trim() || null,
        location: loc.trim() || null,
        start_at: pickerDateToCdmxIso(startDate),
        end_at: endDate ? pickerDateToCdmxIso(endDate) : null,
        area_id: areaId || null,
        attendee_ids: attendeeIds,
      };
      if (editor?.kind === 'edit') {
        await api.updateEvent(editor.item.id, payload);
      } else {
        await api.createEvent(projectId, payload);
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message || 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  const dateLabel = `${pad2(startDate.getDate())}/${pad2(startDate.getMonth() + 1)}/${startDate.getFullYear()}`;
  const startTimeLabel = `${pad2(startDate.getHours())}:${pad2(startDate.getMinutes())}`;
  const endTimeLabel = endDate ? `${pad2(endDate.getHours())}:${pad2(endDate.getMinutes())}` : '_ sin definir _';

  const isWeb = Platform.OS === 'web';

  // Para web: TextInputs simples (formato YYYY-MM-DD / HH:MM)
  function webDateValue(): string { return ymd(startDate); }
  function webTimeValue(d: Date): string { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  function parseWebDate(s: string) {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return;
    const next = new Date(startDate);
    next.setFullYear(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    setStartDate(next);
    if (endDate) {
      const ne = new Date(endDate);
      ne.setFullYear(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
      setEndDate(ne);
    }
  }
  function parseWebTime(s: string, isEnd: boolean) {
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return;
    const h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    if (isEnd) {
      const base = endDate ? new Date(endDate) : new Date(startDate);
      base.setHours(h, mi, 0, 0);
      setEndDate(base);
    } else {
      const next = new Date(startDate);
      next.setHours(h, mi, 0, 0);
      setStartDate(next);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalRoot}
      >
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{editor?.kind === 'edit' ? 'Editar evento' : 'Nuevo evento'}</Text>

          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }} keyboardShouldPersistTaps="handled">
            <Field label="Titulo">
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Ej. Junta de obra"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                editable={!busy}
                maxLength={140}
              />
            </Field>

            {/* Selector de disciplina/area */}
            {areas.length > 0 ? (
              <Field label="Disciplina">
                <View style={styles.areasWrap}>
                  <Pressable
                    onPress={() => setAreaId(null)}
                    style={[styles.areaSelectChip, !areaId && styles.areaSelectChipActive]}
                  >
                    <Text style={[styles.areaSelectTxt, !areaId && styles.areaSelectTxtActive]}>Sin disciplina</Text>
                  </Pressable>
                  {areas.map((a) => {
                    const active = areaId === a.id;
                    const tone = areaTone(a.color);
                    return (
                      <Pressable
                        key={a.id}
                        onPress={() => setAreaId(a.id)}
                        style={[
                          styles.areaSelectChip,
                          {
                            backgroundColor: active ? (a.color || colors.primary) : tone.bg,
                            borderColor: active ? (a.color || colors.primary) : tone.border,
                          },
                        ]}
                      >
                        <View style={[styles.areaDot, { backgroundColor: active ? '#fff' : (a.color || colors.primary) }]} />
                        <Text style={[styles.areaSelectTxt, { color: active ? '#fff' : tone.text }]} numberOfLines={1}>{a.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>
            ) : null}

            {/* Fecha y horas */}
            {isWeb ? (
              <>
                <Field label="Fecha (YYYY-MM-DD)">
                  <TextInput
                    value={webDateValue()}
                    onChangeText={parseWebDate}
                    placeholder="2026-06-20"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    editable={!busy}
                    maxLength={10}
                  />
                </Field>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Hora inicio">
                      <TextInput
                        value={webTimeValue(startDate)}
                        onChangeText={(s) => parseWebTime(s, false)}
                        placeholder="09:00"
                        placeholderTextColor={colors.textMuted}
                        style={styles.input}
                        editable={!busy}
                        maxLength={5}
                      />
                    </Field>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Hora fin (opc.)">
                      <TextInput
                        value={endDate ? webTimeValue(endDate) : ''}
                        onChangeText={(s) => {
                          if (!s.trim()) { setEndDate(null); return; }
                          parseWebTime(s, true);
                        }}
                        placeholder="11:00"
                        placeholderTextColor={colors.textMuted}
                        style={styles.input}
                        editable={!busy}
                        maxLength={5}
                      />
                    </Field>
                  </View>
                </View>
              </>
            ) : (
              <>
                <Field label="Fecha">
                  <Pressable onPress={() => setPicker('startDate')} style={styles.pickerBtn} disabled={busy}>
                    <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                    <Text style={styles.pickerTxt}>{dateLabel}</Text>
                  </Pressable>
                </Field>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Hora inicio">
                      <Pressable onPress={() => setPicker('startTime')} style={styles.pickerBtn} disabled={busy}>
                        <Ionicons name="time-outline" size={16} color={colors.primary} />
                        <Text style={styles.pickerTxt}>{startTimeLabel}</Text>
                      </Pressable>
                    </Field>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Hora fin (opc.)">
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        <Pressable onPress={() => setPicker('endTime')} style={[styles.pickerBtn, { flex: 1 }]} disabled={busy}>
                          <Ionicons name="time-outline" size={16} color={colors.primary} />
                          <Text style={styles.pickerTxt} numberOfLines={1}>{endTimeLabel}</Text>
                        </Pressable>
                        {endDate ? (
                          <Pressable onPress={() => setEndDate(null)} style={styles.clearBtn} disabled={busy}>
                            <Ionicons name="close" size={14} color={colors.error} />
                          </Pressable>
                        ) : null}
                      </View>
                    </Field>
                  </View>
                </View>

                {picker ? (
                  <DateTimePicker
                    value={picker === 'endTime' ? (endDate || startDate) : startDate}
                    mode={picker === 'startDate' ? 'date' : 'time'}
                    is24Hour
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant="light"
                    textColor="#000000"
                    onChange={(ev, sel) => applyDateChange(picker, ev, sel)}
                  />
                ) : null}
              </>
            )}

            <Field label="Ubicacion (opcional)">
              <TextInput
                value={loc}
                onChangeText={setLoc}
                placeholder="Ej. Caseta principal _ Tramo 2"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                editable={!busy}
                maxLength={200}
              />
            </Field>

            <Field label="Descripcion (opcional)">
              <TextInput
                value={desc}
                onChangeText={setDesc}
                placeholder="Detalles, agenda, asistentes esperados_"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
                multiline
                editable={!busy}
                maxLength={2000}
              />
            </Field>

            <View style={styles.sepRow}>
              <Text style={styles.label}>Asistentes</Text>
              <Pressable onPress={() => setAttendeesPickerOpen(true)} style={styles.addRow} disabled={busy}>
                <Ionicons name="person-add-outline" size={16} color={colors.primary} />
                <Text style={styles.addRowTxt}>
                  {attendeeIds.length > 0 ? `Editar (${attendeeIds.length})` : 'Anadir personas'}
                </Text>
              </Pressable>
            </View>
            {attendeeIds.length === 0 ? (
              <Text style={styles.attendeesEmptyTxt}>Sin asistentes adicionales.</Text>
            ) : (
              <View style={styles.attendeesFormWrap}>
                {attendeeIds.map((uid) => {
                  const u = members.find((m) => m.id === uid);
                  if (!u) return null;
                  return (
                    <View key={uid} style={styles.attendeeFormChip}>
                      <Ionicons name="person" size={11} color={colors.primary} />
                      <Text style={styles.attendeeFormChipTxt}>{u.name}</Text>
                      <Pressable onPress={() => toggleAttendee(uid)} hitSlop={8}>
                        <Ionicons name="close" size={12} color={colors.textMuted} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            {err ? (
              <View style={styles.errInline}>
                <Ionicons name="alert-circle" size={14} color={colors.error} />
                <Text style={styles.errInlineTxt}>{err}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.modalActions}>
            <Pressable onPress={onClose} style={[styles.btn, styles.btnGhost]} disabled={busy}>
              <Text style={styles.btnGhostTxt}>Cancelar</Text>
            </Pressable>
            <Pressable onPress={submit} style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.6 }]} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.btnPrimaryTxt}>{editor?.kind === 'edit' ? 'Guardar' : 'Crear evento'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {attendeesPickerOpen ? (
        <Modal
          transparent
          animationType="fade"
          visible={attendeesPickerOpen}
          onRequestClose={() => setAttendeesPickerOpen(false)}
        >
          <View style={styles.pickerBackdrop}>
            <View style={styles.pickerSheet}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Asistentes ({attendeeIds.length})</Text>
                <Pressable onPress={() => setAttendeesPickerOpen(false)} hitSlop={8}>
                  <Text style={styles.pickerDoneTxt}>Listo</Text>
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 420 }}>
                {members.length === 0 ? (
                  <Text style={styles.pickerEmptyTxt}>No hay miembros en el proyecto.</Text>
                ) : (
                  members.map((m) => {
                    const on = attendeeIds.includes(m.id);
                    return (
                      <Pressable key={m.id} onPress={() => toggleAttendee(m.id)} style={styles.pickerRow}>
                        <Ionicons
                          name={on ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={on ? colors.primary : colors.textMuted}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pickerRowName}>{m.name}</Text>
                          <Text style={styles.pickerRowRole}>{(m.role || '').replace('_', ' ')}</Text>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

// ===========================================================================
// Estilos
// ===========================================================================
const styles = StyleSheet.create({
  center: { padding: spacing.xl, alignItems: 'center' },

  calCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xs,
    marginTop: spacing.sm,
    ...shadow.card,
    overflow: 'hidden',
  },

  legend: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4,
  },
  legendChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full,
    borderWidth: 1,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { fontSize: 11, fontWeight: '700' },

  dayHeader: {
    fontSize: 13, fontWeight: '800', color: '#fff',
    textTransform: 'capitalize', marginTop: spacing.sm, paddingHorizontal: 4,
  },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  emptyIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  emptyMsg: { fontSize: 12, color: colors.textBody, textAlign: 'center' },

  eventCard: {
    flexDirection: 'row', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.sm + 2, alignItems: 'flex-start',
    borderLeftWidth: 4, borderLeftColor: colors.primary,
    borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  timeBlock: {
    width: 56, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryLight, borderRadius: radius.md,
    paddingVertical: 8,
  },
  timeTxt: { fontSize: 14, fontWeight: '800', color: colors.primary, lineHeight: 18 },
  timeEndTxt: { fontSize: 10, fontWeight: '700', color: colors.primary, marginTop: 2, opacity: 0.7 },

  eventTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 4 },
  areaChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full,
    borderWidth: 1, marginBottom: 4,
  },
  areaDot: { width: 8, height: 8, borderRadius: 4 },
  areaChipTxt: { fontSize: 10, fontWeight: '800' },

  attendeesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6, alignItems: 'center' },
  attendeeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.primaryLight, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.full,
  },
  attendeeChipTxt: { fontSize: 10, color: colors.primary, fontWeight: '700', maxWidth: 100 },
  attendeeMoreTxt: { fontSize: 10, color: colors.textMuted, fontWeight: '700' },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaTxt: { fontSize: 12, color: colors.textBody, flex: 1 },
  descTxt: { fontSize: 12, color: colors.textBody, marginTop: 6, lineHeight: 17 },
  authorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, paddingTop: 6,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  authorTxt: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
  iconBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md,
  },
  errorTxt: { color: colors.error, fontSize: 12, fontWeight: '700', flex: 1 },

  fab: {
    position: 'absolute', right: 18, bottom: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    ...shadow.card,
  },

  // Modal
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.md, paddingBottom: spacing.lg, maxHeight: '92%',
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

  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12,
  },
  pickerTxt: { fontSize: 14, color: colors.text, fontWeight: '700', flex: 1 },
  clearBtn: {
    width: 38, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.errorBg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.error + '55',
  },

  areasWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  areaSelectChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  areaSelectChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  areaSelectTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  areaSelectTxtActive: { color: '#fff' },

  errInline: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.errorBg, padding: 8, borderRadius: radius.sm,
  },
  errInlineTxt: { color: colors.error, fontSize: 12, fontWeight: '700' },

  sepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addRowTxt: { fontSize: 12, fontWeight: '800', color: colors.primary },
  attendeesEmptyTxt: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  attendeesFormWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  attendeeFormChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.full,
  },
  attendeeFormChipTxt: { fontSize: 11, color: colors.text, fontWeight: '700' },

  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: spacing.lg },
  pickerSheet: {
    backgroundColor: colors.surface, borderRadius: radius.lg, maxHeight: '80%',
    ...shadow.card,
  },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  pickerDoneTxt: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  pickerEmptyTxt: { padding: 16, color: colors.textMuted },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pickerRowName: { fontWeight: '700', color: colors.text, fontSize: 14 },
  pickerRowRole: { color: colors.textMuted, fontSize: 12, textTransform: 'capitalize' },

  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  btnGhostTxt: { color: colors.text, fontWeight: '800', fontSize: 14 },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
