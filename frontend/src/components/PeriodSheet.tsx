import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@/src/theme';

// `custom_YYYYMMDD_YYYYMMDD` = rango elegido a mano (ver rangoFechas.ts).
export type ReportPeriod = 'today' | 'yesterday' | 'week' | 'last_week' | 'month' | `custom_${string}`;

/**
 * Traduce el periodo elegido en el wizard de exportacion al `period_type`
 * que el backend usa para rutear reportes a su informe correspondiente
 * segun la jerarquia (severidad) con la que se capturaron:
 *   - Hoy         -> informe Diario   (solo severidad "diario").
 *   - Esta semana -> informe Semanal  (solo severidad "importante").
 *   - Este mes    -> informe Mensual  (solo severidad "urgente").
 *   - Ayer no tiene informe categorizado propio -> `undefined` (comportamiento
 *     clasico: excluye "informativo", incluye el resto).
 * "Informativo" NUNCA llega a ningun informe categorizado.
 */
export function periodToInformeType(period: ReportPeriod): 'diario' | 'semanal' | 'mensual' | undefined {
  if (period === 'today') return 'diario';
  if (period === 'week' || period === 'last_week') return 'semanal';
  if (period === 'month') return 'mensual';
  return undefined;
}

const OPTIONS: { value: ReportPeriod; label: string; sub: string; icon: any }[] = [
  { value: 'today', label: 'Hoy', sub: 'Reportes capturados hoy (UTC)', icon: 'today-outline' },
  { value: 'yesterday', label: 'Ayer', sub: 'Reportes del día anterior', icon: 'calendar-clear-outline' },
  { value: 'week', label: 'Última semana', sub: 'Últimos 7 días', icon: 'calendar-outline' },
  { value: 'last_week', label: 'Semana pasada', sub: 'Lunes a domingo de la semana anterior', icon: 'calendar-outline' },
  { value: 'month', label: 'Último mes', sub: 'Últimos 30 días', icon: 'calendar-number-outline' },
];

export function PeriodSheet({
  visible,
  title = 'Selecciona el periodo',
  onClose,
  onSelect,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onSelect: (p: ReportPeriod) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable accessibilityRole="button" style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>Generaremos un PDF horizontal con la jerarquía completa</Text>
          {OPTIONS.map((o) => (
            <Pressable accessibilityRole="button"
              key={o.value}
              onPress={() => { onSelect(o.value); }}
              style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.primaryLight }]}
            >
              <View style={styles.optionIcon}>
                <Ionicons name={o.icon} size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{o.label}</Text>
                <Text style={styles.optionSub}>{o.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.lg + 16,
    gap: 6,
    ...Platform.select({
      web: { maxWidth: 520, alignSelf: 'center', width: '100%', borderRadius: 20, marginBottom: 20 },
      default: {},
    }),
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    marginTop: 8,
  },
  optionIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  optionTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  optionSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  cancel: { alignItems: 'center', padding: spacing.md, marginTop: spacing.sm },
  cancelText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
});
