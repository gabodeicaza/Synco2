// Selector del género gramatical de un nombre de nivel (C-14): Automático / Masculino / Femenino.
// "Automático" deja que el sistema lo deduzca de la palabra; los otros dos lo fuerzan.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '@/src/i18n';
import { colors, radius, spacing } from '@/src/theme';
import type { GeneroNivel } from '@/src/utils/generoNiveles';

const OPCIONES: Array<{ valor: GeneroNivel; texto: () => string }> = [
  { valor: 'auto', texto: () => t('proyectoPantalla.generoAutomatico') },
  { valor: 'm', texto: () => t('proyectoPantalla.generoMasculino') },
  { valor: 'f', texto: () => t('proyectoPantalla.generoFemenino') },
];

export function SelectorGeneroNivel({
  nombre, valor, onChange, disabled = false,
}: {
  nombre: string;
  valor: GeneroNivel;
  onChange: (genero: GeneroNivel) => void;
  disabled?: boolean;
}) {
  const etiqueta = t('proyectoPantalla.generoDeNivel', { nombre });
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{etiqueta}</Text>
      <View style={styles.fila} accessibilityRole="radiogroup" accessibilityLabel={etiqueta}>
        {OPCIONES.map((o) => {
          const activo = o.valor === valor;
          const texto = o.texto();
          return (
            <Pressable
              key={o.valor}
              accessibilityRole="radio"
              accessibilityLabel={`${etiqueta}: ${texto}`}
              accessibilityState={{ selected: activo, disabled }}
              disabled={disabled}
              onPress={() => onChange(o.valor)}
              style={[styles.chip, activo && styles.chipActivo]}
            >
              <Text style={[styles.chipTxt, activo && styles.chipTxtActivo]}>{texto}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  fila: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
  },
  chipActivo: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipTxt: { fontSize: 13, fontWeight: '700', color: colors.text },
  chipTxtActivo: { color: colors.textInverse },
});
