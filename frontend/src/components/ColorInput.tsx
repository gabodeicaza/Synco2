// Selector de color con vista previa (P-02). Escribe #RRGGBB o elige de la paleta;
// la vista previa muestra EXACTAMENTE lo escrito (si es inválido queda vacía y el
// error aparece junto al campo: nunca se pinta otro color a escondidas).
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { InlineError } from '@/src/components/InlineError';
import { t } from '@/src/i18n';
import { colors, paletaIdentidad, radius, spacing } from '@/src/theme';
import { errorDeColor, esColorHexValido, normalizarColorHex } from '@/src/utils/color';

export function ColorInput({
  label, ayuda, value, onChange, placeholder, error, editable = true,
}: {
  label: string;
  ayuda?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Error de fuera (p. ej. la respuesta del servidor); si no hay, se valida el formato aquí. */
  error?: string | null;
  editable?: boolean;
}) {
  const errorFormato = errorDeColor(value);
  const mensaje = error || errorFormato;
  const valido = esColorHexValido(value);
  const actual = normalizarColorHex(value);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {ayuda ? <Text style={styles.ayuda}>{ayuda}</Text> : null}
      <View style={styles.fila}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder || t('color.placeholder')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          editable={editable}
          style={[styles.input, mensaje ? styles.inputError : null]}
          accessibilityLabel={label}
        />
        <View
          style={[styles.muestra, valido ? { backgroundColor: value.trim() } : styles.muestraVacia]}
          accessible
          accessibilityLabel={valido ? t('color.vistaPrevia', { valor: value.trim().toUpperCase() }) : t('color.sinVistaPrevia')}
        />
      </View>
      <View style={styles.paleta}>
        {paletaIdentidad.map((c) => (
          <Pressable
            key={c}
            onPress={() => onChange(c)}
            disabled={!editable}
            accessibilityRole="button"
            accessibilityLabel={t('color.elegir', { valor: c })}
            accessibilityState={{ selected: actual === c }}
            hitSlop={6}
            style={[styles.chip, { backgroundColor: c }, actual === c && styles.chipOn]}
          />
        ))}
      </View>
      <InlineError message={mensaje} style={{ marginTop: spacing.xs }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  ayuda: { fontSize: 11, color: colors.textMuted },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 15, color: colors.text, backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.error },
  muestra: { width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong },
  muestraVacia: { backgroundColor: colors.surface, borderStyle: 'dashed' },
  paleta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  chip: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.borderStrong },
  chipOn: { borderWidth: 3, borderColor: colors.text },
});
