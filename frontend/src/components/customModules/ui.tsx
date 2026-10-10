// Piezas de UI compartidas por el Creador de módulos (constructor, captura y
// administración): chips, filas con interruptor, secciones y cabecera.
import React from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';

export function Chip({
  label, on, onPress, icon, tone, disabled,
}: {
  label: string; on?: boolean; onPress?: () => void; icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'danger'; disabled?: boolean;
}) {
  const color = on ? '#fff' : tone === 'danger' ? colors.error : colors.text;
  return (
    <Pressable accessibilityRole="button"
      onPress={onPress} disabled={disabled}
      style={[styles.chip, on && styles.chipOn, disabled && { opacity: 0.45 }]}
    >
      {icon ? <Ionicons name={icon} size={14} color={color} /> : null}
      <Text style={[styles.chipTxt, { color }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

export function SwitchRow({
  label, hint, value, onChange, disabled,
}: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={[styles.switchRow, disabled && { opacity: 0.45 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.switchLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value} onValueChange={onChange} disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
    </View>
  );
}

export function Section({ title, children, hint }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      {hint ? <Text style={[styles.hint, { marginBottom: spacing.xs }]}>{hint}</Text> : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function Header({
  title, color, onBack, right, icon = 'chevron-back',
}: {
  title: string; color: string; onBack: () => void; right?: React.ReactNode; icon?: keyof typeof Ionicons.glyphMap;
}) {
  const insets = useSafeAreaInsets();
  const fg = contrastText(color);
  return (
    <View style={[styles.header, { backgroundColor: color, paddingTop: insets.top + spacing.xs }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={onBack} hitSlop={10} style={styles.headerBtn}>
        <Ionicons name={icon} size={22} color={fg} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: fg }]} numberOfLines={1}>{title}</Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

export const inputStyle = {
  borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md,
  paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.bg,
} as const;

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  switchLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
  sectionTitle: {
    fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, ...shadow.card,
  },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  headerRight: { minWidth: 32, alignItems: 'flex-end' },
});
