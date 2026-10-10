// Selector del periodo del análisis financiero (A-05): los mismos 3 periodos del tablero EVM.
// Lo usa la Presentación (al crearla y al editarla) para que su sección Financiero mida
// exactamente la misma ventana que el tablero.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PeriodoFinanciero } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { t } from '@/src/i18n';
import { etiquetaPeriodo, PERIODOS_FINANCIEROS } from '@/src/utils/finanzas';

export function PeriodoFinancieroSelector({
  value, onChange, disabled,
}: {
  value: PeriodoFinanciero;
  onChange: (periodo: PeriodoFinanciero) => void;
  disabled?: boolean;
}) {
  return (
    <View>
      <Text style={styles.label}>{t('finanzas.periodoTitulo')}</Text>
      <Text style={styles.ayuda}>{t('finanzas.periodoAyuda')}</Text>
      <View style={styles.fila}>
        {PERIODOS_FINANCIEROS.map((p) => {
          const activo = value === p;
          return (
            <Pressable
              key={p}
              accessibilityRole="button"
              accessibilityState={{ selected: activo, disabled: !!disabled }}
              disabled={disabled}
              onPress={() => onChange(p)}
              style={[styles.chip, activo && styles.chipActivo, disabled && { opacity: 0.6 }]}
            >
              <Text style={[styles.chipTxt, activo && styles.chipTxtActivo]}>{etiquetaPeriodo(p)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.sm },
  ayuda: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.xs },
  fila: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, minHeight: 36, justifyContent: 'center',
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  chipActivo: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  chipTxtActivo: { color: colors.textInverse },
});
