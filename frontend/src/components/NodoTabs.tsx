// Pestañas de la vista de un nodo del catálogo (C-11): "Estructura" (subniveles) y
// "Conceptos". Los nombres salen de la configuración del proyecto, no son fijos.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '@/src/theme';
import { NodoTab } from '@/src/utils/navegacionCatalogo';

export interface PestanaNodo {
  clave: NodoTab;
  etiqueta: string;
  /** Número de elementos (o "…" mientras cargan). */
  conteo: string;
}

export function NodoTabs({
  pestanas, activa, onCambiar,
}: {
  pestanas: PestanaNodo[];
  activa: NodoTab;
  onCambiar: (tab: NodoTab) => void;
}) {
  return (
    <View style={styles.fila} accessibilityRole="tablist">
      {pestanas.map((p) => {
        const seleccionada = p.clave === activa;
        return (
          <Pressable
            key={p.clave}
            accessibilityRole="tab"
            accessibilityLabel={`${p.etiqueta} (${p.conteo})`}
            accessibilityState={{ selected: seleccionada }}
            onPress={() => onCambiar(p.clave)}
            style={[styles.pestana, seleccionada && styles.pestanaActiva]}
          >
            <Text style={[styles.texto, seleccionada && styles.textoActivo]} numberOfLines={1}>
              {p.etiqueta}
            </Text>
            <View style={[styles.conteo, seleccionada && styles.conteoActivo]}>
              <Text style={[styles.conteoTxt, seleccionada && styles.conteoTxtActivo]}>{p.conteo}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fila: {
    flexDirection: 'row', marginHorizontal: spacing.md, marginTop: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 3, gap: 3,
  },
  pestana: {
    flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: radius.sm, paddingHorizontal: 8,
  },
  pestanaActiva: { backgroundColor: colors.primary },
  texto: { fontSize: 13, fontWeight: '700', color: colors.textBody, flexShrink: 1 },
  textoActivo: { color: colors.textInverse },
  conteo: {
    minWidth: 24, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full,
    backgroundColor: colors.primaryLight, alignItems: 'center',
  },
  conteoActivo: { backgroundColor: colors.textInverse },
  conteoTxt: { fontSize: 11, fontWeight: '800', color: colors.primary },
  conteoTxtActivo: { color: colors.primary },
});
