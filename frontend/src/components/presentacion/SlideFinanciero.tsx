// Slide "Financiero" — tarjetas de PV/EV/AC/SPI/CPI + presupuesto total y
// variaciones, mismos datos que Dashboard EVM (api.analisisPeriodo /
// analisisPeriodoPresupuestoTotal), ventana de la semana que cierra en la
// fecha de la Presentación (ver weekStart en PresentacionPreview.tsx).
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors, radius, spacing } from '@/src/theme';
import { formatMoney } from '@/src/utils/money';
import type { AnalisisPeriodo } from '@/src/api';
import { t } from '@/src/i18n';

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

export function SlideFinanciero({
  analisis, presupuestoTotal, colorTema,
}: {
  analisis: AnalisisPeriodo | null;
  presupuestoTotal: string | null;
  colorTema: string;
}) {
  if (!analisis) {
    return (
      <View style={[styles.wrap, styles.empty]}>
        <Text style={styles.emptyTxt}>Sin datos financieros (EVM) disponibles para este periodo.</Text>
      </View>
    );
  }
  const spi = analisis.spi != null ? Number(analisis.spi) : null;
  const cpi = analisis.cpi != null ? Number(analisis.cpi) : null;
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.scroll}>
      <Text style={[styles.header, { color: colorTema }]}>FINANCIERO</Text>
      <View style={styles.grid}>
        <Kpi label={t('evm.bac')} value={presupuestoTotal ? formatMoney(presupuestoTotal) : '—'} />
        <Kpi label="Valor Planeado (PV)" value={formatMoney(analisis.pv)} />
        <Kpi label={t('evm.evContractual')} value={formatMoney(analisis.ev_contractual ?? analisis.ev)} />
        <Kpi label={t('evm.evTotal')} value={formatMoney(analisis.ev_total ?? analisis.ev)} />
        <Kpi label="Costo Real (AC)" value={formatMoney(analisis.ac)} />
        <Kpi label="SPI" value={spi != null ? spi.toFixed(2) : '—'} tone={spi != null ? (spi >= 1 ? colors.success : colors.error) : undefined} />
        <Kpi label="CPI" value={cpi != null ? cpi.toFixed(2) : '—'} tone={cpi != null ? (cpi >= 1 ? colors.success : colors.error) : undefined} />
        <Kpi label="Variación cronograma" value={formatMoney(analisis.variacion_cronograma)} />
        <Kpi label="Variación costo" value={formatMoney(analisis.variacion_costo)} />
        <Kpi label={t('evm.eac')} value={analisis.eac != null ? formatMoney(analisis.eac) : '—'} />
        <Kpi label={t('evm.etc')} value={analisis.etc != null ? formatMoney(analisis.etc) : '—'} />
        <Kpi
          label={t('evm.vac')}
          value={analisis.vac != null ? formatMoney(analisis.vac) : '—'}
          tone={analisis.vac != null ? (Number(analisis.vac) >= 0 ? colors.success : colors.error) : undefined}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  header: { fontSize: 16, fontWeight: '800', letterSpacing: 0.5, marginBottom: spacing.md, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  kpiCard: {
    width: '46%', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, alignItems: 'center',
  },
  kpiLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', textAlign: 'center', marginBottom: 4 },
  kpiValue: { fontSize: 15, fontWeight: '800', color: colors.text },
});
