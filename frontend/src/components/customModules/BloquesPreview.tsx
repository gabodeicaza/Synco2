// Vista previa en pantalla de los bloques imprimibles (summary / table / list /
// fotos) tal como los consumirán los informes PDF/DOCX/PPTX.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import type { CustomBloque } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

export function BloquesPreview({ titulo, blocks }: { titulo: string; blocks: CustomBloque[] }) {
  return (
    <View style={styles.page}>
      <Text style={styles.pageTitle}>{titulo}</Text>
      {blocks.map((b, i) => <Bloque key={i} b={b} />)}
    </View>
  );
}

function Bloque({ b }: { b: CustomBloque }) {
  if (b.type === 'summary') return <Text style={styles.summary}>{b.text}</Text>;
  if (b.type === 'list') {
    return (
      <View style={{ marginBottom: spacing.sm }}>
        {b.heading ? <Text style={styles.heading}>{b.heading}</Text> : null}
        {b.items.length === 0 ? <Text style={styles.empty}>{b.empty_text || 'Sin datos.'}</Text> : null}
        {b.items.map((it, i) => (
          <View key={i} style={{ marginBottom: 8 }}>
            {it.title ? <Text style={styles.itemTitle}>{it.title}</Text> : null}
            {it.body ? <Text style={styles.itemBody}>{it.body}</Text> : null}
            {it.meta ? <Text style={styles.itemMeta}>{it.meta}</Text> : null}
          </View>
        ))}
      </View>
    );
  }
  if (b.type === 'table') {
    const ancho = (i: number) => Math.max(72, Math.round((b.col_widths?.[i] ?? 1 / b.headers.length) * 620));
    return (
      <View style={{ marginBottom: spacing.sm }}>
        {b.heading ? <Text style={styles.heading}>{b.heading}</Text> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={[styles.tr, styles.thRow]}>
              {b.headers.map((h, i) => (
                <Text key={i} style={[styles.cell, styles.th, { width: ancho(i) }]} numberOfLines={2}>{h}</Text>
              ))}
            </View>
            {b.rows.length === 0 ? <Text style={styles.empty}>{b.empty_text || 'Sin datos.'}</Text> : null}
            {b.rows.map((r, ri) => (
              <View key={ri} style={[styles.tr, ri % 2 === 1 && { backgroundColor: colors.bg }]}>
                {r.map((c, ci) => <Text key={ci} style={[styles.cell, { width: ancho(ci) }]}>{c}</Text>)}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }
  if (b.type === 'fotos_comparativa') {
    return (
      <View style={{ marginBottom: spacing.sm }}>
        {b.items.map((it: any, i: number) => (
          <View key={i} style={styles.fotoRow}>
            {[['original', 'desc_original', 'etiqueta_original'], ['actual', 'desc_actual', 'etiqueta_actual']].map(([k, dk, ek]) => (
              it[k] ? (
                <View key={k} style={styles.fotoCol}>
                  <Image source={{ uri: it[k] }} style={styles.foto} resizeMode="cover" />
                  {it[dk] ? <Text style={styles.itemBody} numberOfLines={2}>{it[dk]}</Text> : null}
                  {it[ek] ? <Text style={styles.itemMeta} numberOfLines={2}>{it[ek]}</Text> : null}
                </View>
              ) : <View key={k} style={styles.fotoCol} />
            ))}
          </View>
        ))}
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, padding: spacing.md },
  pageTitle: { fontSize: 18, fontWeight: '800', color: colors.primary, marginBottom: spacing.sm },
  summary: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  heading: { fontSize: 12, fontWeight: '800', color: colors.primary, marginBottom: 4 },
  empty: { fontSize: 12, fontStyle: 'italic', color: colors.textMuted, paddingVertical: 6 },
  itemTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  itemBody: { fontSize: 12, color: colors.textBody, marginTop: 1 },
  itemMeta: { fontSize: 11, fontStyle: 'italic', color: colors.textMuted, marginTop: 1 },
  tr: { flexDirection: 'row' },
  thRow: { backgroundColor: colors.primaryLight },
  cell: { fontSize: 11, color: colors.text, paddingHorizontal: 6, paddingVertical: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong },
  th: { fontWeight: '800', color: colors.primaryDark },
  fotoRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  fotoCol: { flex: 1 },
  foto: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm, backgroundColor: colors.border, marginBottom: 4 },
});
