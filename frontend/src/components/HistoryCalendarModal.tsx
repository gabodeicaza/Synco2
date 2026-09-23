// Modal de calendario historico para filtrar reportes por fecha.
import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { FeedItem } from '@/src/api';
import { toISODateCDMX } from '@/src/utils/tz';
import { a11y } from '@/src/i18n';

// Localizacion a espanol.
LocaleConfig.locales['es'] = {
  monthNames: [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ],
  monthNamesShort: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  dayNames: ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'],
  dayNamesShort: ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'],
  today: 'Hoy',
};
LocaleConfig.defaultLocale = 'es';

export type HistoryCalendarProps = {
  visible: boolean;
  reports: FeedItem[];
  selectedDate: string | null; // YYYY-MM-DD
  onClose: () => void;
  onPickDate: (date: string | null) => void;
};

export function HistoryCalendarModal({
  visible, reports, selectedDate, onClose, onPickDate,
}: HistoryCalendarProps) {
  const marked = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of reports) {
      if (!r.created_at) continue;
      const d = toISODateCDMX(r.created_at);
      if (!m[d]) {
        m[d] = { marked: true, dotColor: colors.primary };
      }
    }
    if (selectedDate) {
      m[selectedDate] = {
        ...(m[selectedDate] || {}),
        selected: true,
        selectedColor: colors.primary,
      };
    }
    return m;
  }, [reports, selectedDate]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="calendar" size={16} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Historial por fecha</Text>
              <Text style={styles.subtitle}>
                {selectedDate ? `Filtrando: ${formatDate(selectedDate)}` : 'Toca un dia para filtrar reportes'}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <Calendar
            markedDates={marked}
            onDayPress={(d) => onPickDate(d.dateString)}
            // Domingo primero — misma convención de semana natural que el resto de la app
            firstDay={0}
            enableSwipeMonths
            theme={{
              backgroundColor: colors.surface,
              calendarBackground: colors.surface,
              textSectionTitleColor: colors.textMuted,
              selectedDayBackgroundColor: colors.primary,
              selectedDayTextColor: '#fff',
              todayTextColor: colors.primary,
              dayTextColor: colors.text,
              textDisabledColor: colors.border,
              dotColor: colors.primary,
              selectedDotColor: '#fff',
              arrowColor: colors.primary,
              monthTextColor: colors.text,
              textMonthFontWeight: '800',
              textDayFontWeight: '600',
              textDayHeaderFontWeight: '700',
              textDayFontSize: 13,
              textMonthFontSize: 15,
              textDayHeaderFontSize: 11,
            }}
          />

          <View style={styles.actions}>
            <Pressable accessibilityRole="button"
              onPress={() => onPickDate(null)}
              style={({ pressed }) => [
                styles.btnGhost,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="refresh" size={16} color={colors.primary} />
              <Text style={styles.btnGhostTxt}>Quitar filtro</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.btnPrimary,
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={styles.btnPrimaryTxt}>Aplicar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatDate(iso: string): string {
  try {
    const [y, m, d] = iso.split('-');
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.5)' },
  wrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  sheet: {
    width: '100%', maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadow.card,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerIcon: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontWeight: '600' },
  closeBtn: {
    width: 32, height: 32, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  btnGhost: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  btnGhostTxt: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  btnPrimary: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  btnPrimaryTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
