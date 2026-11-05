import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

const money = (n: number | null | undefined) =>
  '$' + (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
const pct = (n: number | null | undefined) => `${(Number(n) || 0).toFixed(1)}%`;
const num = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });

function useDirac() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    try {
      setError(null);
      setData(await api.diracConceptos(refresh));
    } catch (e: any) {
      setError(e?.message || 'No se pudo consultar Dirac');
    } finally {
      setLoading(false);
    }
  }, []);
  return { data, loading, error, load };
}

function ProgressBar({ value, color = colors.primary }: { value: number; color?: string }) {
  const w = Math.max(0, Math.min(100, value || 0));
  return (
    <View style={s.barBg}>
      <View style={[s.barFill, { width: `${w}%`, backgroundColor: color }]} />
    </View>
  );
}

const estColor = (e: string) =>
  e === 'Pagada' ? colors.success : e === 'Autorizada' ? colors.primary : colors.warning;

/** Tarjeta compacta para el inicio de cada rol; abre la pantalla completa. */
export function DiracSummaryCard({ route }: { route: string }) {
  const { data, loading, error, load } = useDirac();
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (loading) return <View style={s.card}><ActivityIndicator color={colors.primary} /></View>;
  if (error || !data) return null; // si Dirac no responde no estorba al inicio
  const t = data.totales || {};
  const av = t.importe ? ((t.importe_ejecutado || 0) / t.importe) * 100 : 0;
  const pend = (data.estimaciones || []).filter((e: any) => e.estatus === 'Pendiente de autorizar').length;
  return (
    <Pressable style={s.card} onPress={() => router.push(route as any)}>
      <View style={s.row}>
        <Ionicons name="analytics-outline" size={20} color={colors.primary} />
        <Text style={[s.cardTitle, { flex: 1 }]}>Avance del contrato (Dirac)</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
      <Text style={s.muted} numberOfLines={1}>{data.contrato?.id_contrato} · {data.contrato?.contrato}</Text>
      <Text style={s.big}>{pct(av)}</Text>
      <ProgressBar value={av} />
      <Text style={s.muted}>
        {money(t.importe_ejecutado)} de {money(t.importe)} · {pend} estimaciones por autorizar
      </Text>
    </Pressable>
  );
}

/** Pantalla completa: KPIs, curva programada, estimaciones y frentes. */
export default function DiracPanel() {
  const insets = useSafeAreaInsets();
  const { data, loading, error, load } = useDirac();
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const header = (
    <View style={s.header}>
      <Pressable onPress={() => router.back()} hitSlop={10}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
      <Text style={s.title}>Avances y estimaciones</Text>
    </View>
  );

  if (loading) return <View style={[s.flex, { paddingTop: insets.top }]}>{header}<ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /></View>;
  if (error || !data) {
    return (
      <View style={[s.flex, { paddingTop: insets.top }]}>
        {header}
        <Text style={[s.muted, { padding: spacing.md }]}>{error || 'Sin datos'}</Text>
        <Pressable style={s.btn} onPress={() => load(true)}><Text style={s.btnText}>Reintentar</Text></Pressable>
      </View>
    );
  }

  const c = data.contrato || {};
  const t = data.totales || {};
  const avFin = t.importe ? ((t.importe_ejecutado || 0) / t.importe) * 100 : 0;
  const hoy = new Date().toISOString().slice(0, 10);
  const prog = (data.avance_programado_del_contrato || []).slice().sort((a: any, b: any) => a.fecha.localeCompare(b.fecha));
  const progAcum = prog.filter((p: any) => p.fecha <= hoy).reduce((a: number, p: any) => a + (p.importe || 0), 0);
  const avProg = t.importe ? (progAcum / t.importe) * 100 : 0;
  const desv = avFin - avProg;
  let acc = 0;
  const curva = prog.map((p: any) => { acc += p.importe || 0; return { fecha: p.fecha, pct: t.importe ? (acc / t.importe) * 100 : 0 }; });
  const ests: any[] = data.estimaciones || [];

  return (
    <View style={[s.flex, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} tintColor={colors.primary} />}
      >
        <View style={s.card}>
          <Text style={s.cardTitle}>{c.id_contrato}</Text>
          <Text style={s.muted}>{c.obra}</Text>
          <Text style={s.muted}>{c.contratista} · {c.cliente}</Text>
          <Text style={s.muted}>{c.fecha_inicio} → {c.fecha_final}</Text>
          {data._desactualizado ? <Text style={[s.muted, { color: colors.warning }]}>Dirac no respondió: mostrando el último dato guardado</Text> : null}
        </View>

        <View style={s.kpis}>
          <View style={s.kpi}><Text style={s.kpiLabel}>Importe contrato</Text><Text style={s.kpiVal}>{money(t.importe)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Ejecutado</Text><Text style={s.kpiVal}>{money(t.importe_ejecutado)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Estimado</Text><Text style={s.kpiVal}>{money(t.importe_estimado)}</Text></View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Real vs programado</Text>
            <Text style={[s.kpiVal, { color: desv >= 0 ? colors.success : colors.error }]}>{pct(avFin)} / {pct(avProg)}</Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Curva programada (acumulado %)</Text>
          <View style={s.curva}>
            {curva.map((p: any) => (
              <View key={p.fecha} style={s.curvaCol}>
                <View style={[s.curvaBar, { height: Math.max(2, p.pct * 0.9), backgroundColor: p.fecha <= hoy ? colors.primary : colors.borderStrong }]} />
              </View>
            ))}
          </View>
          <Text style={s.muted}>Azul: periodos al corte de hoy. Avance real: {pct(avFin)} · Programado a hoy: {pct(avProg)}</Text>
        </View>

        <Text style={s.section}>Estimaciones ({ests.length})</Text>
        {ests.map((e) => (
          <View key={e.id} style={s.card}>
            <View style={s.row}>
              <Text style={[s.cardTitle, { flex: 1 }]}>Estimación {e.numero_estimacion}</Text>
              <Text style={[s.badge, { color: estColor(e.estatus), borderColor: estColor(e.estatus) }]}>{e.estatus}</Text>
            </View>
            <Text style={s.muted}>{e.fecha_inicio} → {e.fecha_fin}</Text>
            <Text style={s.kpiVal}>{money(e.importe)}</Text>
            <Text style={s.muted}>
              Subtotal {money(e.subtotal)} · IVA {money(e.impuesto_iva)} · Deducciones {money(e.total_deducciones)} · Líquido {money(e.alcance_liquido)}
            </Text>
            {e.pagado && e.fecha_pago ? <Text style={s.muted}>Pagada el {e.fecha_pago}</Text> : null}
          </View>
        ))}

        <Text style={s.section}>Frentes y conceptos ({(data.frentes || []).length})</Text>
        {(data.frentes || []).map((f: any) => {
          const tt = f.totales || {};
          const isOpen = !!open[f.id];
          return (
            <View key={f.id} style={s.card}>
              <Pressable onPress={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))}>
                <View style={s.row}>
                  <Text style={[s.cardTitle, { flex: 1 }]}>{f.frente}</Text>
                  <Text style={s.muted}>{pct(tt.porcentaje_avance_financiero)}</Text>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                </View>
                <Text style={s.muted} numberOfLines={isOpen ? undefined : 2}>{f.descripcion}</Text>
                <ProgressBar value={tt.porcentaje_avance_financiero} />
                <Text style={s.muted}>{money(tt.importe_ejecutado)} de {money(tt.importe)} · {tt.conceptos} conceptos</Text>
              </Pressable>
              {isOpen && (f.conceptos || []).map((k: any) => {
                const fis = k.avance_fisico || {};
                const ee = k.estado_ejecucion || {};
                return (
                  <View key={k.id} style={s.concepto}>
                    <Text style={s.conceptoTitle}>{k.inciso} · {k.descripcion}</Text>
                    <ProgressBar value={fis.porcentaje} color={ee.dias_atraso > 0 ? colors.error : colors.success} />
                    <Text style={s.muted}>
                      {num(fis.acumulado)} / {num(k.cantidad)} {k.unidad} ({pct(fis.porcentaje)}) · PU {money(k.pu)} · {ee.estatus}
                      {ee.dias_atraso > 0 ? ` · ${ee.dias_atraso} días de atraso` : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })}
        <Text style={[s.muted, { textAlign: 'center', marginTop: spacing.md }]}>Actualizado en Dirac: {data.actualizado_en}</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted },
  big: { fontSize: 28, fontWeight: '800', color: colors.primary },
  section: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  kpi: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  kpiLabel: { fontSize: 11, color: colors.textMuted },
  kpiVal: { fontSize: 16, fontWeight: '700', color: colors.text },
  barBg: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden', marginVertical: 4 },
  barFill: { height: 8, borderRadius: 4 },
  badge: { fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  curva: { flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 2, marginVertical: 8 },
  curvaCol: { flex: 1, justifyContent: 'flex-end' },
  curvaBar: { width: '100%', borderRadius: 2 },
  concepto: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 8, gap: 2 },
  conceptoTitle: { fontSize: 12, fontWeight: '600', color: colors.textBody },
  btn: { margin: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: 12, alignItems: 'center' },
  btnText: { color: colors.textInverse, fontWeight: '700' },
});
