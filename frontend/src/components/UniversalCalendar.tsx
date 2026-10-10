// Dirac · UniversalCalendar
// Componente universal de calendario (Especialista / Sub-coordinador / Coordinador General).
// - Calendario visual mensual (react-native-calendars) con LocaleConfig en espanol.
// - Multi-dot por disciplina/area usando areaTone() para reflejar la jerarquia de colores.
// - El alta y edición de eventos usa el formulario común EventoForm.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Calendar, LocaleConfig } from 'react-native-calendars';

import { api, Area, ProjectEvent, User } from '@/src/api';
import { EventoForm } from '@/src/components/EventoForm';
import { colors, radius, shadow, spacing, areaTone, calendarioColores } from '@/src/theme';
import { dayjs, CDMX_TZ, fmtTimeCDMX } from '@/src/utils/tz';
import { diaDelEvento, esDiaCompleto } from '@/src/utils/fechas';
import { a11y } from '@/src/i18n';

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
    'Domingo', 'Lunes', 'Martes', 'Miércoles',
    'Jueves', 'Viernes', 'Sábado',
  ],
  dayNamesShort: ['D', 'L', 'M', 'M', 'J', 'V', 'S'],
  today: 'Hoy',
};
LocaleConfig.defaultLocale = 'es';

// ---------------------------------------------------------------------------
// Utilidades de fecha
// ---------------------------------------------------------------------------
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
      const day = diaDelEvento(e);
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
      .filter((e) => diaDelEvento(e) === selectedDate)
      .sort((a, b) => Number(esDiaCompleto(b)) - Number(esDiaCompleto(a)) || (a.start_at || '').localeCompare(b.start_at || ''));
  }, [items, selectedDate]);

  function canEdit(e: ProjectEvent): boolean {
    // Los "Inicio de X" / "Fin de X" y "Minuta: X" son virtuales (calculados
    // desde el concepto o la minuta real, ver server.py list_events) — no
    // existen en db.events, así que nunca son editables/eliminables desde
    // aquí (la minuta se edita desde su propia pantalla).
    if (e.id.startsWith('concepto-inicio:') || e.id.startsWith('concepto-fin:') || e.id.startsWith('minuta:')) return false;
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
      if (typeof window !== 'undefined' && window.confirm('¿Eliminar este evento?')) exec();
    } else {
      Alert.alert('Eliminar evento', '¿Seguro que deseas eliminarlo?', [
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
                  backgroundColor: calendarioColores.fondoCalendario,
                  calendarBackground: calendarioColores.fondoCalendario,
                  textSectionTitleColor: calendarioColores.textoSeccion,
                  selectedDayBackgroundColor: calendarioColores.seleccionadoFondo,
                  selectedDayTextColor: calendarioColores.seleccionadoTexto,
                  todayTextColor: calendarioColores.hoy,
                  dayTextColor: calendarioColores.textoDia,
                  textDisabledColor: calendarioColores.deshabilitado,
                  monthTextColor: calendarioColores.textoMes,
                  arrowColor: calendarioColores.flecha,
                  indicatorColor: calendarioColores.hoy,
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
                <Text style={styles.emptyTitle}>Sin eventos en este día</Text>
                <Text style={styles.emptyMsg}>Pulsa el botón + para programar uno.</Text>
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

      <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} hitSlop={8} onPress={() => setEditor({ kind: 'create' })} style={styles.fab}>
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>

      <EventoForm
        visible={!!editor}
        evento={editor?.kind === 'edit' ? editor.item : null}
        projectId={projectId}
        areas={areas}
        members={members}
        fechaInicial={selectedDate}
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
  const todoElDia = esDiaCompleto(item);
  const start = todoElDia ? 'Todo el día' : fmtHora(item.start_at);
  const end = !todoElDia && item.end_at ? fmtHora(item.end_at) : null;
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
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('editar')} hitSlop={8} onPress={onEdit} style={styles.iconBtn}>
                <Ionicons name="create-outline" size={15} color={colors.primary} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} hitSlop={8} onPress={onDelete} style={styles.iconBtn}>
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
    fontSize: 13, fontWeight: '800', color: calendarioColores.tituloDia,
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
});
