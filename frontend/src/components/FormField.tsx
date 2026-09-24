// Campo de formulario común (X-03): etiqueta, entrada y error en línea junto al campo.
// Los campos numéricos (`numero`) abren el teclado numérico, aceptan "1,500" y "1500"
// según el separador del proyecto y se reformatean al salir del campo (45,000).
import React from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { InlineError } from '@/src/components/InlineError';
import { colors, radius } from '@/src/theme';
import { formatoNumero, parseNumeroEntrada, SeparadorDecimal, DECIMALES_CANTIDAD } from '@/src/utils/numeros';

export interface OpcionesCampoNumerico {
  separador?: SeparadorDecimal;
  maxDecimales?: number;
  permitirNegativo?: boolean;
  /** Decimales mínimos al reformatear (importes: 2). */
  minDecimales?: number;
}

export interface FormFieldProps extends Omit<TextInputProps, 'onChangeText' | 'value' | 'style'> {
  label: string;
  value: string;
  onChangeText: (valor: string) => void;
  error?: string | null;
  ayuda?: string;
  obligatorio?: boolean;
  numero?: OpcionesCampoNumerico;
  style?: any;
  inputStyle?: any;
}

export function FormField({
  label, value, onChangeText, error, ayuda, obligatorio, numero, style, inputStyle, onBlur, editable = true, ...resto
}: FormFieldProps) {
  const teclado = numero
    ? numero.permitirNegativo ? 'numbers-and-punctuation' : 'decimal-pad'
    : resto.keyboardType;

  function alSalir(e: any) {
    if (numero && value.trim()) {
      const r = parseNumeroEntrada(value, {
        separador: numero.separador,
        maxDecimales: numero.maxDecimales ?? DECIMALES_CANTIDAD,
        permitirNegativo: numero.permitirNegativo,
      });
      if (r.ok) {
        const texto = formatoNumero(r.valor, {
          separador: numero.separador,
          minDecimales: numero.minDecimales,
          maxDecimales: numero.maxDecimales ?? DECIMALES_CANTIDAD,
        });
        if (texto && texto !== value) onChangeText(texto);
      }
    }
    onBlur?.(e);
  }

  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.label}>
        {label}
        {obligatorio ? <Text style={styles.asterisco}> *</Text> : null}
      </Text>
      {ayuda ? <Text style={styles.ayuda}>{ayuda}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        {...resto}
        value={value}
        onChangeText={onChangeText}
        onBlur={alSalir}
        editable={editable}
        keyboardType={teclado}
        inputMode={numero ? 'decimal' : resto.inputMode}
        style={[styles.input, !editable && styles.inputInactivo, error ? styles.inputError : null, inputStyle]}
      />
      <InlineError message={error} style={styles.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  asterisco: { color: colors.error },
  ayuda: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: colors.text, backgroundColor: colors.bg, minHeight: 44,
  },
  inputInactivo: { opacity: 0.6 },
  inputError: { borderColor: colors.error },
  error: { marginTop: 6 },
});
