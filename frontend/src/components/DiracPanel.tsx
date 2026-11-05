import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';
import { api } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

const money = (n: number | null | undefined) =>
  '$' + (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
const millones = (n: number) => `${(n / 1e6).toLocaleString('es-MX', { maximumFractionDigits: 1 })} M`;
const pct = (n: number | null | undefined) => `${(Number(n) || 0).toFixed(1)}%`;
const num = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });

// Solo el proyecto de Dirac (Cablebús) recibe datos: para los demás `datos` queda en null.
function useDirac(projectId: string) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    if (!projectId) { setLoading(false); return; }
    try {
      setError(null);
      const r = await api.diracProyecto(projectId, refresh);
      setData(r.aplica ? r.datos : null);
    } catch (e: any) {
      setError(e?.message || 'No se pudo consultar Dirac');
    } finally {
      setLoading(false);
    }
  }, [projectId]);
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

/** Barra dividida en segmentos proporcionales con leyenda (valor y color). */
function Segmentos({ items, formato }: { items: { label: string; valor: number; color: string }[]; formato: (v: number) => string }) {
  const total = items.reduce((a, i) => a + i.valor, 0) || 1;
  return (
    <View>
      <View style={s.segBar}>
        {items.filter((i) => i.valor > 0).map((i) => (
          <View key={i.label} style={{ flex: i.valor / total, backgroundColor: i.color }} />
        ))}
      </View>
      <View style={s.legend}>
        {items.map((i) => (
          <View key={i.label} style={s.legendItem}>
            <View style={[s.dot, { backgroundColor: i.color }]} />
            <Text style={s.muted}>{i.label}: {formato(i.valor)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const ts = (d: string) => new Date(d + 'T00:00:00').getTime();
type Pt = { t: number; pct: number };

/** Curva S: programado acumulado vs real (estimaciones acumuladas), eje de tiempo real. */
function CurvaS({ prog, real, hoy }: { prog: Pt[]; real: Pt[]; hoy: number }) {
  const [w, setW] = useState(0);
  const H = 190, L = 34, R = 10, T = 10, B = 22;
  const all = [...prog, ...real];
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * Math.max(1, w - L - R);
  const y = (v: number) => T + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - T - B);
  const line = (a: Pt[]) => a.map((p) => `${x(p.t)},${y(p.pct)}`).join(' ');
  const yr = (t: number) => new Date(t).getFullYear();
  const years: number[] = [];
  for (let yy = yr(t0); yy <= yr(t1); yy++) years.push(yy);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={H}>
          {[0, 25, 50, 75, 100].map((g) => (
            <React.Fragment key={g}>
              <Line x1={L} x2={w - R} y1={y(g)} y2={y(g)} stroke={colors.border} strokeWidth={1} />
              <SvgText x={L - 4} y={y(g) + 3} fontSize={9} fill={colors.textMuted} textAnchor="end">{g}%</SvgText>
            </React.Fragment>
          ))}
          {years.map((yy) => {
            const tx = ts(`${yy}-01-01`);
            if (tx < t0 || tx > t1) return null;
            return <SvgText key={yy} x={x(tx)} y={H - 6} fontSize={9} fill={colors.textMuted} textAnchor="middle">{yy}</SvgText>;
          })}
          {hoy >= t0 && hoy <= t1 && <Line x1={x(hoy)} x2={x(hoy)} y1={T} y2={H - B} stroke={colors.warning} strokeDasharray="4 3" strokeWidth={1} />}
          <Polyline points={line(prog)} fill="none" stroke={colors.borderStrong} strokeWidth={2.5} />
          {real.length > 0 && <Polyline points={line(real)} fill="none" stroke={colors.primary} strokeWidth={2.5} />}
          {real.map((p, i) => <Circle key={i} cx={x(p.t)} cy={y(p.pct)} r={3} fill={colors.primary} />)}
        </Svg>
      )}
    </View>
  );
}

/** Tarjeta compacta del proyecto de Dirac (Cablebús): no se pinta en ningún otro proyecto. */
export function DiracSummaryCard({ route, projectId }: { route: string; projectId?: string | null }) {
  const { data, loading, load } = useDirac(projectId || '');
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!projectId || loading || !data) return null;
  const t = data.totales || {};
  const av = t.importe ? ((t.importe_ejecutado || 0) / t.importe) * 100 : 0;
  const pend = (data.estimaciones || []).filter((e: any) => e.estatus === 'Pendiente de autorizar').length;
  return (
    <Pressable
      style={s.card}
      onPress={() => router.push({ pathname: route as any, params: { project_id: projectId, id: projectId } })}
    >
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

/** Pantalla completa: KPIs, curva S, gráficas por frente y estimaciones, y detalle de frentes. */
export default function DiracPanel() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ project_id?: string; id?: string }>();
  const pidRaw = params.project_id || params.id;
  const projectId = (Array.isArray(pidRaw) ? pidRaw[0] : pidRaw) || '';
  const { data, loading, error, load } = useDirac(projectId);
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
        <Text style={[s.muted, { padding: spacing.md }]}>{error || 'Este proyecto no tiene datos de Dirac.'}</Text>
        {error ? <Pressable style={s.btn} onPress={() => load(true)}><Text style={s.btnText}>Reintentar</Text></Pressable> : null}
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
  const ests: any[] = data.estimaciones || [];
  const frentes: any[] = data.frentes || [];
  let acc = 0;
  const curvaProg: Pt[] = prog.map((p: any) => { acc += p.importe || 0; return { t: ts(p.fecha), pct: t.importe ? (acc / t.importe) * 100 : 0 }; });
  let accR = 0;
  const curvaReal: Pt[] = [];
  if (curvaProg.length) curvaReal.push({ t: curvaProg[0].t, pct: 0 });
  ests.slice().sort((a: any, b: any) => a.fecha_fin.localeCompare(b.fecha_fin)).forEach((e: any) => {
    accR += e.importe || 0;
    curvaReal.push({ t: ts(e.fecha_fin), pct: t.importe ? (accR / t.importe) * 100 : 0 });
  });
  const maxEst = Math.max(...ests.map((e) => e.importe || 0), 1);
  const porEstatus = (nombre: string) => ests.filter((e) => e.estatus === nombre).reduce((a, e) => a + (e.importe || 0), 0);
  const conceptos = frentes.flatMap((f) => f.conceptos || []);
  const cuenta = (est: string) => conceptos.filter((k) => (k.estado_ejecucion || {}).estatus === est).length;

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
          <Text style={s.cardTitle}>Curva S: programado vs real (acumulado %)</Text>
          <CurvaS prog={curvaProg} real={curvaReal} hoy={Date.now()} />
          <View style={s.legend}>
            <View style={s.legendItem}><View style={[s.dot, { backgroundColor: colors.borderStrong }]} /><Text style={s.muted}>Programado</Text></View>
            <View style={s.legendItem}><View style={[s.dot, { backgroundColor: colors.primary }]} /><Text style={s.muted}>Real (estimaciones)</Text></View>
            <View style={s.legendItem}><View style={[s.dot, { backgroundColor: colors.warning }]} /><Text style={s.muted}>Hoy</Text></View>
          </View>
          <Text style={s.muted}>Real: {pct(avFin)} · Programado a hoy: {pct(avProg)} · Diferencia: {desv >= 0 ? '+' : ''}{desv.toFixed(1)} pts</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Avance por frente</Text>
          {frentes.map((f) => {
            const tt = f.totales || {};
            return (
              <View key={f.id} style={{ marginTop: 6 }}>
                <Text style={s.conceptoTitle}>{f.frente}</Text>
                <View style={s.row}><Text style={[s.muted, s.lblW]}>Físico</Text><View style={{ flex: 1 }}><ProgressBar value={tt.porcentaje_avance_fisico} /></View><Text style={[s.muted, s.valW]}>{pct(tt.porcentaje_avance_fisico)}</Text></View>
                <View style={s.row}><Text style={[s.muted, s.lblW]}>Financ.</Text><View style={{ flex: 1 }}><ProgressBar value={tt.porcentaje_avance_financiero} color={colors.success} /></View><Text style={[s.muted, s.valW]}>{pct(tt.porcentaje_avance_financiero)}</Text></View>
              </View>
            );
          })}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Importe por frente (millones)</Text>
          {frentes.map((f) => {
            const tt = f.totales || {};
            const maxF = Math.max(...frentes.map((x) => (x.totales || {}).importe || 0), 1);
            const eje = tt.importe_ejecutado || 0;
            const resto = Math.max((tt.importe || 0) - eje, 0);
            return (
              <View key={f.id} style={[s.row, { marginTop: 6 }]}>
                <Text style={[s.muted, s.lblW]}>{f.frente}</Text>
                <View style={[s.stackBar, { flex: 1 }]}>
                  <View style={{ flex: Math.max(eje, 0.0001) / maxF, backgroundColor: colors.success }} />
                  <View style={{ flex: Math.max(resto, 0.0001) / maxF, backgroundColor: colors.borderStrong }} />
                  <View style={{ flex: Math.max(1 - (tt.importe || 0) / maxF, 0.0001) }} />
                </View>
                <Text style={[s.muted, { width: 64, textAlign: 'right' }]}>{millones(tt.importe || 0)}</Text>
              </View>
            );
          })}
          <View style={s.legend}>
            <View style={s.legendItem}><View style={[s.dot, { backgroundColor: colors.success }]} /><Text style={s.muted}>Ejecutado</Text></View>
            <View style={s.legendItem}><View style={[s.dot, { backgroundColor: colors.borderStrong }]} /><Text style={s.muted}>Por ejecutar</Text></View>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Estimaciones por periodo (millones)</Text>
          <View style={s.estBars}>
            {ests.map((e) => (
              <View key={e.id} style={s.estCol}>
                <Text style={s.estVal}>{((e.importe || 0) / 1e6).toFixed(1)}</Text>
                <View style={[s.estBar, { height: Math.max(4, ((e.importe || 0) / maxEst) * 90), backgroundColor: estColor(e.estatus) }]} />
                <Text style={s.estLbl}>E{e.numero_estimacion}</Text>
              </View>
            ))}
          </View>
          <View style={s.legend}>
            {['Pagada', 'Autorizada', 'Pendiente de autorizar'].map((n) => (
              <View key={n} style={s.legendItem}><View style={[s.dot, { backgroundColor: estColor(n) }]} /><Text style={s.muted}>{n}</Text></View>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Importe estimado por estatus</Text>
          <Segmentos
            formato={millones}
            items={[
              { label: 'Pagada', valor: porEstatus('Pagada'), color: colors.success },
              { label: 'Autorizada', valor: porEstatus('Autorizada'), color: colors.primary },
              { label: 'Pendiente de autorizar', valor: porEstatus('Pendiente de autorizar'), color: colors.warning },
            ]}
          />
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Conceptos por estado ({conceptos.length})</Text>
          <Segmentos
            formato={(v) => String(v)}
            items={[
              { label: 'Terminado', valor: cuenta('terminado'), color: colors.success },
              { label: 'En ejecución', valor: cuenta('en_ejecucion'), color: colors.primary },
              { label: 'Pendiente', valor: cuenta('pendiente'), color: colors.borderStrong },
            ]}
          />
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

        <Text style={s.section}>Frentes y conceptos ({frentes.length})</Text>
        {frentes.map((f: any) => {
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
  dot: { width: 10, height: 10, borderRadius: 5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  segBar: { flexDirection: 'row', height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.border, marginTop: 6 },
  stackBar: { flexDirection: 'row', height: 14, borderRadius: 4, overflow: 'hidden' },
  lblW: { width: 44 },
  valW: { width: 46, textAlign: 'right' },
  estBars: { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 4, marginTop: 6 },
  estCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  estBar: { width: '70%', borderRadius: 3 },
  estVal: { fontSize: 9, color: colors.textMuted },
  estLbl: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  concepto: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 8, gap: 2 },
  conceptoTitle: { fontSize: 12, fontWeight: '600', color: colors.textBody },
  btn: { margin: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: 12, alignItems: 'center' },
  btnText: { color: colors.textInverse, fontWeight: '700' },
});
