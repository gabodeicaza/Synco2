// Caja de búsqueda para los selectores de personas (responsable e involucrados de minuta,
// asistentes de reunión, informes diarios). La lógica de coincidencia vive en utils/buscarPersonas.
import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius } from '@/src/theme';

export function BuscadorPersonas({
  value, onChangeText, placeholder = 'Buscar persona por nombre, puesto o área', autoFocus,
}: { value: string; onChangeText: (t: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <View style={styles.caja}>
      <Ionicons name="search" size={18} color={colors.textMuted} />
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textMuted}
        style={styles.input} autoFocus={autoFocus} autoCorrect={false} autoCapitalize="none"
        accessibilityLabel={placeholder} returnKeyType="search"
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Borrar búsqueda" hitSlop={10} onPress={() => onChangeText('')}>
          <Ionicons name="close-circle" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caja: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 8, marginVertical: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.bg,
  },
  input: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: 2 },
});
