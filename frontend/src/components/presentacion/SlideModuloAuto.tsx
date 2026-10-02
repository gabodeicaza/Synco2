// Slide de una sección AUTOMÁTICA (Ambiental / Social / Seguridad): lista el
// esquema de las láminas que saldrán al exportar. El contenido real (tablas,
// gráficas, fotos) se arma en el PPTX con los datos de los módulos de la semana.
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ModuloAutoOutline } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

const TIPO_LABEL: Record<string, string> = {
  table: 'Tabla', imagen: 'Gráfica', list: 'Lista', summary: 'Dato destacado',
  fotos_comparativa: 'Fotos comparativas', seguridad_accidentes: 'Registro de accidentes',
  seguridad_indicadores: 'Acciones pendientes', estudios_avances: 'Avances por disciplina',
};

export function SlideModuloAuto({ titulo, outline, colorTema, loading }: {
  titulo: string; outline: ModuloAutoOutline[] | null; colorTema: string; loading: boolean;
}) {
  const vacio = !loading && (!outline || outline.every((m) => !m.bloques.length));
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      <Text style={[styles.kicker, { color: colorTema }]}>{titulo.toUpperCase()} · AUTOMÁTICO</Text>
      {loading ? <Text style={styles.muted}>Cargando…</Text> : null}
      {vacio ? (
        <View style={styles.box}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <Text style={styles.muted}>
            Sin información esta semana (o el módulo está apagado para el informe semanal). Esta sección no imprimirá láminas.
          </Text>
        </View>
      ) : null}
      {(outline || []).map((m) => (
        <View key={m.modulo} style={styles.box}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.modulo, { color: colorTema }]}>{m.modulo}</Text>
            {m.bloques.map((b, i) => (
              <Text key={i} style={styles.item} numberOfLines={2}>
                • {TIPO_LABEL[b.type || ''] || b.type}{b.heading ? `: ${b.heading}` : ''}{b.n ? ` (${b.n})` : ''}
              </Text>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  muted: { color: colors.textMuted, fontSize: 12, flex: 1 },
  box: { flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface },
  modulo: { fontSize: 13, fontWeight: '800', marginBottom: 4 },
  item: { fontSize: 12, color: colors.text, marginTop: 2 },
});
