// Selector de jerarquía (a qué informe llega) para los registros de los módulos
// de captura. Misma regla que los reportes de actividad: cada registro llega a
// UN solo informe — Diario, Semanal o Mensual — o a ninguno (Informativo).
// Los registros anteriores a esta regla no traen jerarquía y salen en todos los
// informes donde el módulo esté encendido (ver backend `_jerarquia_q`).
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { JerarquiaInforme } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

export const JERARQUIA_DEFAULT: JerarquiaInforme = 'diario';

const OPCIONES: { key: JerarquiaInforme; label: string; ayuda: string }[] = [
  { key: 'diario', label: 'Diario', ayuda: 'Sale solo en el informe diario.' },
  { key: 'semanal', label: 'Semanal', ayuda: 'Sale solo en el informe semanal.' },
  { key: 'mensual', label: 'Mensual', ayuda: 'Sale solo en el informe mensual.' },
  { key: 'informativo', label: 'Informativo', ayuda: 'No sale en ningún informe; solo queda registrado.' },
];

export function jerarquiaLabel(j?: JerarquiaInforme | null): string {
  return OPCIONES.find((o) => o.key === j)?.label || '';
}

export function JerarquiaInformePicker({
  value, onChange,
}: {
  value?: JerarquiaInforme | null;
  onChange: (j: JerarquiaInforme) => void;
}) {
  // Un registro anterior sin jerarquía se muestra como "Diario" (la opción por
  // defecto); al guardar queda con la jerarquía elegida.
  const actual = value || JERARQUIA_DEFAULT;
  const ayuda = OPCIONES.find((o) => o.key === actual)?.ayuda;
  return (
    <View>
      <Text style={styles.label}>Informe al que llega</Text>
      <View style={styles.row}>
        {OPCIONES.map((o) => {
          const on = o.key === actual;
          return (
            <Pressable key={o.key} onPress={() => onChange(o.key)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {ayuda ? <Text style={styles.ayuda}>{ayuda}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.sm, marginBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  chipTxtOn: { color: '#fff' },
  ayuda: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
});
