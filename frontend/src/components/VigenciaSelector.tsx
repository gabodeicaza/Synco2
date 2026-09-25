// Selector de vigencia de una noticia (G-05): chips 6 h / 24 h / 48 h / 7 días y texto de ayuda dinámico.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '@/src/i18n';
import { colors } from '@/src/theme';
import {
  ayudaVigencia, etiquetaVigencia, VIGENCIAS_HORAS, VigenciaHoras,
} from '@/src/utils/vigenciaNoticias';

export function VigenciaSelector({
  value, onChange, disabled, edicion,
}: {
  value: VigenciaHoras;
  onChange: (v: VigenciaHoras) => void;
  disabled?: boolean;
  /** true al editar: avisa que el plazo se cuenta desde el momento de guardar. */
  edicion?: boolean;
}) {
  return (
    <View>
      <Text style={styles.label}>{t('noticiasVigencia.titulo')}</Text>
      <View style={styles.fila} accessibilityRole="radiogroup">
        {VIGENCIAS_HORAS.map((h) => {
          const activo = value === h;
          return (
            <Pressable
              key={h}
              accessibilityRole="radio"
              accessibilityState={{ selected: activo, disabled: !!disabled }}
              accessibilityLabel={etiquetaVigencia(h)}
              onPress={() => onChange(h)}
              disabled={disabled}
              style={[styles.chip, activo && styles.chipActivo]}
            >
              <Text style={[styles.chipTxt, activo && styles.chipTxtActivo]}>{etiquetaVigencia(h)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.ayuda}>
        {ayudaVigencia(value)} {t('noticiasVigencia.ayudaFijado')}
        {edicion ? ` ${t('noticiasVigencia.ayudaEdicion')}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginTop: 4 },
  fila: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: {
    minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'transparent',
  },
  chipActivo: { backgroundColor: colors.primary },
  chipTxt: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  chipTxtActivo: { color: colors.textInverse },
  ayuda: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
});
