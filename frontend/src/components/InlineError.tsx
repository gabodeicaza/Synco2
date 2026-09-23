// Mensaje de error en línea (junto al campo o formulario). Alert.alert no hace
// nada en web, así que los formularios muestran sus errores con este componente.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '@/src/theme';

export function InlineError({ message, style }: { message?: string | null; style?: any }) {
  if (!message) return null;
  return (
    <View style={[styles.box, style]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={16} color={colors.error} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md },
  text: { color: colors.error, fontSize: 13, flex: 1, fontWeight: '600' },
});
