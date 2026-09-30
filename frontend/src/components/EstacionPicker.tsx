// Selector de Estación/Intertramo (nodos de profundidad 1 del árbol) en forma
// de chips — usado para ligar un plano de Tapial y un registro de Fotos LiDAR
// a la misma estación, de modo que el export arme la diapositiva TAPIAL +
// VUELO DRON de esa estación. Opcional: "Sin estación" deja el vínculo vacío.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { LocationNode } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

export function estacionesDe(nodes: LocationNode[]): LocationNode[] {
  return nodes
    .filter((n) => n.depth === 1)
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
}

export function EstacionPicker({
  nodes, value, onChange,
}: {
  nodes: LocationNode[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const items = estacionesDe(nodes);
  if (items.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Chip label="Sin estación" active={value === null} onPress={() => onChange(null)} />
      {items.map((n) => (
        <Chip key={n.id} label={n.name} active={value === n.id} onPress={() => onChange(n.id)} />
      ))}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipTxt, active && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.primary, backgroundColor: colors.surface, maxWidth: '100%',
  },
  chipActive: { backgroundColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
});
