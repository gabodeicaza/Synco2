// Slide "Seguimiento a Estudios y Análisis" — barras de % por disciplina
// (catálogo fijo de 10, ver src/utils/estudioDisciplinas.ts), con tabs
// Global / por Estación. Representación simplificada (barras verticales en
// lista) de la infografía de línea de tiempo del ejemplo original — la
// exportación PPTX (Fase 5) puede acercarse más al layout exacto.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { colors, radius, spacing } from '@/src/theme';
import { ESTUDIO_DISCIPLINA_AVANCE_KEYS, ESTUDIO_DISCIPLINA_AVANCE_LABEL, EstudioDisciplinaAvanceKey } from '@/src/utils/estudioDisciplinas';
import type { EstudioDisciplinaAvance, LocationNode } from '@/src/api';

export function SlideSeguimientoEstudios({
  rows, nodesById, colorTema,
}: {
  rows: EstudioDisciplinaAvance[];
  nodesById: Record<string, LocationNode>;
  colorTema: string;
}) {
  const estacionesConDatos = useMemo(() => {
    const ids = new Set<string>();
    rows.forEach((r) => { if (r.node_id) ids.add(r.node_id); });
    return Array.from(ids).filter((id) => nodesById[id]).sort((a, b) => (nodesById[a]?.name || '').localeCompare(nodesById[b]?.name || ''));
  }, [rows, nodesById]);

  const [tab, setTab] = useState<string>('__global__');

  const rowsPorTab = useMemo(() => {
    const nodeId = tab === '__global__' ? null : tab;
    const byDisciplina = new Map<string, EstudioDisciplinaAvance>();
    rows.filter((r) => r.node_id === nodeId).forEach((r) => byDisciplina.set(r.disciplina, r));
    return byDisciplina;
  }, [rows, tab]);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.header, { color: colorTema }]}>SEGUIMIENTO A ESTUDIOS Y ANÁLISIS</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm, flexGrow: 0 }}>
        <View style={styles.tabsRow}>
          <Pressable onPress={() => setTab('__global__')} style={[styles.tabBtn, tab === '__global__' && styles.tabBtnActive]}>
            <Text style={[styles.tabTxt, tab === '__global__' && styles.tabTxtActive]}>Global</Text>
          </Pressable>
          {estacionesConDatos.map((id) => (
            <Pressable key={id} onPress={() => setTab(id)} style={[styles.tabBtn, tab === id && styles.tabBtnActive]}>
              <Text style={[styles.tabTxt, tab === id && styles.tabTxtActive]} numberOfLines={1}>{nodesById[id]?.name || id}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.md }}>
        {ESTUDIO_DISCIPLINA_AVANCE_KEYS.map((k: EstudioDisciplinaAvanceKey) => {
          const row = rowsPorTab.get(k);
          const pct = row?.porcentaje ?? 0;
          const estatus = row?.estatus === 'terminado' ? 'Terminado' : 'En proceso';
          return (
            <View key={k} style={styles.discRow}>
              <Text style={styles.discLabel} numberOfLines={1}>{ESTUDIO_DISCIPLINA_AVANCE_LABEL[k]}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: pct >= 100 ? colors.success : colorTema }]} />
              </View>
              <Text style={styles.discPct}>{pct}%</Text>
              <Text style={styles.discEstatus}>{row ? estatus : 'Sin datos'}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  header: { fontSize: 15, fontWeight: '800', letterSpacing: 0.5, marginBottom: spacing.sm, textAlign: 'center' },
  tabsRow: { flexDirection: 'row', gap: 6 },
  tabBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, maxWidth: 140 },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { fontSize: 11, fontWeight: '700', color: colors.text },
  tabTxtActive: { color: '#fff' },
  discRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  discLabel: { width: 92, fontSize: 10, fontWeight: '700', color: colors.text },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  discPct: { width: 34, fontSize: 11, fontWeight: '800', color: colors.text, textAlign: 'right' },
  discEstatus: { width: 68, fontSize: 9, color: colors.textMuted, textAlign: 'right' },
});
