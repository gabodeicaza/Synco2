// Dashboard EVM (Valor Ganado) — pantalla completa, mismo patrón "screen
// dueña de su propio header" que CatalogoConceptosScreen.tsx / RegistrarAvanceScreen.tsx
// (las rutas en app/(subcoord|spec|coord)/... solo resuelven projectId).
//
// 3 tarjetas de KPI (SPI/CPI/Variación de Costo), Curva S (Planeado/Ganado/
// Real) y Lista por Excepción — ver server.py, sección "Etapa EVM: Análisis
// de Periodos". Curva S se dibuja con react-native-svg (YA es dependencia
// del proyecto) en vez de una librería de charts nueva: victory-native
// moderno depende de @shopify/react-native-skia (nativo, exige rebuild EAS
// completo) y tiene soporte débil en el export a Web que este proyecto
// también usa — react-native-svg funciona igual en Android/iOS/Web sin
// tocar una sola dependencia nueva.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Line as SvgLine } from 'react-native-svg';

import { api, AnalisisPeriodo, CurvaS, ExcepcionEvm } from '@/src/api';
import { colors, spacing, radius } from '@/src/theme';
import { formatMoney } from '@/src/utils/money';
import { dayjs, CDMX_TZ } from '@/src/utils/tz';

type RangoRapido = 'mes_actual' | 'ultimos_3_meses' | 'proyecto_completo';

function rangoDesde(rango: RangoRapido, curva: CurvaS | null): { start: string; end: string } {
  const hoy = dayjs().tz(CDMX_TZ);
  if (rango === 'mes_actual') {
    return { start: hoy.startOf('month').format('YYYY-MM-DD'), end: hoy.format('YYYY-MM-DD') };
  }
  if (rango === 'ultimos_3_meses') {
    return { start: hoy.subtract(3, 'month').startOf('month').format('YYYY-MM-DD'), end: hoy.format('YYYY-MM-DD') };
  }
  // proyecto_completo: desde el primer mes con datos en la Curva S hasta hoy.
  const primerMes = curva && curva.meses.length ? `${curva.meses[0]}-01` : hoy.startOf('year').format('YYYY-MM-DD');
  return { start: primerMes, end: hoy.format('YYYY-MM-DD') };
}

/** SPI/CPI vienen como string decimal (ver server.py: quantize a 4
 * decimales, nunca la división cruda) — Number() aquí es seguro porque es
 * solo para decidir el color del semáforo, no para volver a calcular ni
 * guardar nada (la regla de "nunca float" es sobre dinero persistido). */
function colorIndice(valor: string | null): string {
  if (valor === null) return colors.textMuted;
  const n = Number(valor);
  if (n >= 1) return colors.success;
  if (n >= 0.9) return colors.warning;
  return colors.error;
}

function KpiCard({ label, valor, sub, color }: { label: string; valor: string; sub?: string; color: string }) {
  return (
    <View style={[styles.kpiCard, { borderColor: color }]}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValor, { color }]}>{valor}</Text>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

/** Curva S de 3 líneas (Planeado/Ganado/Real) dibujada a mano con
 * react-native-svg — los 3 arreglos de CurvaS ya vienen acumulados y en el
 * mismo orden de meses, así que solo hay que normalizar a coordenadas de
 * pantalla. Los valores de dinero se parsean a Number SOLO para geometría
 * del gráfico (posición de un punto en píxeles), nunca se recalculan ni se
 * guardan — no es el caso que la regla de Decimal-siempre está protegiendo. */
function CurvaSChart({ curva }: { curva: CurvaS }) {
  const width = 320;
  const height = 160;
  const padding = 24;

  const series = useMemo(() => {
    const planeado = curva.planeado_acumulado.map(Number);
    const ganado = curva.ganado_acumulado.map(Number);
    const real = curva.real_acumulado.map(Number);
    const max = Math.max(1, ...planeado, ...ganado, ...real);
    const n = curva.meses.length;
    const puntos = (serie: number[]) =>
      serie
        .map((v, i) => {
          const x = n <= 1 ? padding : padding + (i / (n - 1)) * (width - 2 * padding);
          const y = height - padding - (v / max) * (height - 2 * padding);
          return `${x},${y}`;
        })
        .join(' ');
    return { planeado: puntos(planeado), ganado: puntos(ganado), real: puntos(real) };
  }, [curva]);

  if (!curva.meses.length) {
    return (
      <View style={styles.curvaVacia}>
        <Text style={styles.curvaVaciaTxt}>Todavía no hay conceptos con fechas de inicio/fin capturadas para trazar la Curva S.</Text>
      </View>
    );
  }

  return (
    <View>
      <Svg width={width} height={height}>
        <SvgLine x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke={colors.border} strokeWidth={1} />
        <Polyline points={series.planeado} fill="none" stroke={colors.textMuted} strokeWidth={2} />
        <Polyline points={series.ganado} fill="none" stroke={colors.primary} strokeWidth={2} />
        <Polyline points={series.real} fill="none" stroke={colors.error} strokeWidth={2} />
      </Svg>
      <View style={styles.leyendaRow}>
        <LeyendaItem color={colors.textMuted} label="Planeado" />
        <LeyendaItem color={colors.primary} label="Ganado" />
        <LeyendaItem color={colors.error} label="Real" />
      </View>
      <View style={styles.ejeMesesRow}>
        <Text style={styles.ejeMesTxt}>{curva.meses[0]}</Text>
        <Text style={styles.ejeMesTxt}>{curva.meses[curva.meses.length - 1]}</Text>
      </View>
    </View>
  );
}

function LeyendaItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.leyendaItem}>
      <View style={[styles.leyendaDot, { backgroundColor: color }]} />
      <Text style={styles.leyendaTxt}>{label}</Text>
    </View>
  );
}

function ExcepcionRow({ item }: { item: ExcepcionEvm }) {
  const esFueraDeVentana = item.tipo === 'fuera_de_ventana';
  return (
    <View style={styles.excepcionRow}>
      <Ionicons
        name={esFueraDeVentana ? 'time-outline' : 'trending-up-outline'}
        size={18}
        color={esFueraDeVentana ? colors.warning : colors.error}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.excepcionClave}>{item.clave} · {item.descripcion}</Text>
        <Text style={styles.excepcionDetalle}>{item.detalle}</Text>
      </View>
    </View>
  );
}

export default function DashboardEVM({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rango, setRango] = useState<RangoRapido>('mes_actual');
  const [analisis, setAnalisis] = useState<AnalisisPeriodo | null>(null);
  const [curva, setCurva] = useState<CurvaS | null>(null);
  const [excepciones, setExcepciones] = useState<ExcepcionEvm[]>([]);

  const cargar = useCallback(async (rangoActual: RangoRapido, curvaPrevia: CurvaS | null) => {
    if (!projectId) return;
    setError(null);
    try {
      // La Curva S se pide primero porque "proyecto completo" necesita su
      // primer mes para saber desde dónde arrancar la ventana de analisisPeriodo.
      const curvaResp = await api.analisisPeriodoCurvaS(projectId);
      setCurva(curvaResp);
      const { start, end } = rangoDesde(rangoActual, curvaResp || curvaPrevia);
      const [analisisResp, excepcionesResp] = await Promise.all([
        api.analisisPeriodo(projectId, start, end),
        api.analisisPeriodoExcepciones(projectId),
      ]);
      setAnalisis(analisisResp);
      setExcepciones(excepcionesResp);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el dashboard EVM');
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    cargar(rango, curva).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, rango]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await cargar(rango, curva);
    setRefreshing(false);
  }, [cargar, rango, curva]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { paddingTop: insets.top + spacing.xs, backgroundColor: colors.primary }]}>
        <Text style={styles.headerTitle}>Control de Obra — Valor Ganado</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
      >
        <View style={styles.rangoRow}>
          {(['mes_actual', 'ultimos_3_meses', 'proyecto_completo'] as RangoRapido[]).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRango(r)}
              style={[styles.rangoChip, rango === r && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={[styles.rangoChipTxt, rango === r && { color: '#fff' }]}>
                {r === 'mes_actual' ? 'Mes actual' : r === 'ultimos_3_meses' ? 'Últimos 3 meses' : 'Proyecto completo'}
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.error} />
            <Text style={styles.errorTxt}>{error}</Text>
          </View>
        ) : null}

        {analisis ? (
          <>
            <View style={styles.kpiRow}>
              <KpiCard
                label="SPI (tiempo)"
                valor={analisis.spi ?? '—'}
                sub={analisis.spi === null ? 'Sin planeado en el periodo' : undefined}
                color={colorIndice(analisis.spi)}
              />
              <KpiCard
                label="CPI (costo)"
                valor={analisis.cpi ?? '—'}
                sub={analisis.cpi === null ? 'Sin gasto real capturado' : undefined}
                color={colorIndice(analisis.cpi)}
              />
              <KpiCard
                label="Variación de costo"
                valor={formatMoney(analisis.variacion_costo)}
                sub="Ganado − Real"
                color={Number(analisis.variacion_costo) >= 0 ? colors.success : colors.error}
              />
            </View>

            <View style={styles.pvEvAcRow}>
              <Text style={styles.pvEvAcTxt}>PV {formatMoney(analisis.pv)}</Text>
              <Text style={styles.pvEvAcTxt}>EV {formatMoney(analisis.ev)}</Text>
              <Text style={styles.pvEvAcTxt}>AC {formatMoney(analisis.ac)}</Text>
            </View>
          </>
        ) : null}

        <Text style={styles.seccionTitulo}>Curva S</Text>
        {curva ? <CurvaSChart curva={curva} /> : null}

        <Text style={styles.seccionTitulo}>Lista por excepción ({excepciones.length})</Text>
        {excepciones.length === 0 ? (
          <Text style={styles.sinExcepciones}>Sin anomalías: ningún avance fuera de ventana ni concepto sobre meta.</Text>
        ) : (
          <FlatList
            data={excepciones}
            keyExtractor={(item, idx) => `${item.concepto_id}-${item.tipo}-${idx}`}
            renderItem={({ item }) => <ExcepcionRow item={item} />}
            scrollEnabled={false}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  rangoRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.md },
  rangoChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  rangoChipTxt: { fontSize: 12, fontWeight: '600', color: colors.text },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg,
    borderRadius: radius.full, padding: 10, marginBottom: spacing.md,
  },
  errorTxt: { color: colors.error, flex: 1, fontSize: 13 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.md },
  kpiCard: {
    flex: 1, borderWidth: 1.5, borderRadius: 12, padding: 10, backgroundColor: colors.surface,
  },
  kpiLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  kpiValor: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  kpiSub: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  pvEvAcRow: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface,
    borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: spacing.md,
  },
  pvEvAcTxt: { fontSize: 12, fontWeight: '600', color: colors.textBody },
  seccionTitulo: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: 8 },
  curvaVacia: { padding: 16, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  curvaVaciaTxt: { color: colors.textMuted, fontSize: 12 },
  leyendaRow: { flexDirection: 'row', gap: 16, marginTop: 6, justifyContent: 'center' },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leyendaDot: { width: 8, height: 8, borderRadius: 4 },
  leyendaTxt: { fontSize: 11, color: colors.textMuted },
  ejeMesesRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, marginTop: 2 },
  ejeMesTxt: { fontSize: 10, color: colors.textMuted },
  sinExcepciones: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  excepcionRow: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  excepcionClave: { fontSize: 13, fontWeight: '700', color: colors.text },
  excepcionDetalle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
