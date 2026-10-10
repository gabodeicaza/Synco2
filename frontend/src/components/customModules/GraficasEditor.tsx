// Editor de las gráficas del módulo: cada una agrupa los registros por un campo
// (o por fecha), suma / promedia / cuenta y sale como imagen en los informes
// elegidos (Diario / Semanal / Mensual).
import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CustomCampo, CustomGrafica, ModuloCategoria } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { CM_CATEGORIAS, GRAFICA_TIPOS, esNumericoOCalc, graficaNueva } from '@/src/utils/customModules';
import { Chip, ChipRow, FieldLabel, inputStyle } from './ui';

const CATEGORIZABLES = ['texto', 'seleccion', 'interruptor', 'fecha', 'ubicacion'];

export function GraficasEditor({
  campos, graficas, onChange,
}: {
  campos: CustomCampo[];
  graficas: CustomGrafica[];
  onChange: (g: CustomGrafica[]) => void;
}) {
  const categorias = campos.filter((c) => CATEGORIZABLES.includes(c.tipo));
  const numericos = campos.filter((c) => esNumericoOCalc(c.tipo));
  const set = (id: string, patch: Partial<CustomGrafica>) => onChange(graficas.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  return (
    <View>
      {graficas.length === 0 ? (
        <Text style={styles.hint}>
          Sin gráficas. Agrega una para ver, por ejemplo, los registros por estatus (pastel) o la suma de cantidades por estación (barras).
        </Text>
      ) : null}
      {graficas.map((g, i) => (
        <View key={g.id} style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.headTxt}>Gráfica {i + 1}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Eliminar" hitSlop={8} onPress={() => onChange(graficas.filter((x) => x.id !== g.id))}>
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </Pressable>
          </View>
          <FieldLabel>Título</FieldLabel>
          <TextInput
            value={g.titulo} onChangeText={(t) => set(g.id, { titulo: t })} placeholder="Ej. Registros por estatus"
            placeholderTextColor={colors.textMuted} style={inputStyle}
          />
          <FieldLabel>Tipo</FieldLabel>
          <ChipRow>
            {GRAFICA_TIPOS.map((t) => <Chip key={t.tipo} label={t.label} icon={t.icon} on={g.tipo === t.tipo} onPress={() => set(g.id, { tipo: t.tipo })} />)}
          </ChipRow>
          <FieldLabel>Agrupar por</FieldLabel>
          <ChipRow>
            <Chip label="Fecha del registro" on={g.categoria === '__fecha'} onPress={() => set(g.id, { categoria: '__fecha' })} />
            {categorias.map((c) => <Chip key={c.id} label={c.etiqueta} on={g.categoria === c.id} onPress={() => set(g.id, { categoria: c.id })} />)}
          </ChipRow>
          <FieldLabel>Qué se mide</FieldLabel>
          <ChipRow>
            <Chip label="Cantidad de registros" on={!g.valor} onPress={() => set(g.id, { valor: null, agregacion: 'conteo' })} />
            {numericos.map((c) => (
              <Chip key={c.id} label={c.etiqueta} on={g.valor === c.id} onPress={() => set(g.id, { valor: c.id, agregacion: g.agregacion === 'conteo' ? 'suma' : g.agregacion })} />
            ))}
          </ChipRow>
          {g.valor ? (
            <>
              <FieldLabel>Cómo se combina</FieldLabel>
              <ChipRow>
                <Chip label="Suma" on={g.agregacion === 'suma'} onPress={() => set(g.id, { agregacion: 'suma' })} />
                <Chip label="Promedio" on={g.agregacion === 'promedio'} onPress={() => set(g.id, { agregacion: 'promedio' })} />
              </ChipRow>
            </>
          ) : null}
          <FieldLabel>Sale en los informes</FieldLabel>
          <ChipRow>
            {CM_CATEGORIAS.map(({ cat, label }) => {
              const on = g.informes.includes(cat);
              return (
                <Chip
                  key={cat} label={label} on={on} icon={on ? 'checkmark' : undefined}
                  onPress={() => set(g.id, { informes: on ? g.informes.filter((x: ModuloCategoria) => x !== cat) : [...g.informes, cat] })}
                />
              );
            })}
          </ChipRow>
        </View>
      ))}
      <Chip label="Agregar gráfica" icon="add" onPress={() => onChange([...graficas, graficaNueva(campos)])} />
      <Text style={styles.hint}>La gráfica solo se imprime donde el módulo se imprime (no en «No imprimir») y si hay registros.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.bg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headTxt: { fontSize: 13, fontWeight: '800', color: colors.text },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 6, lineHeight: 16 },
});
