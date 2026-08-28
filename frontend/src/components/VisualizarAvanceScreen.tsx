// Visualizar avance — reporte por periodo (uso de oficina). Lista los
// registros de avance del proyecto en un rango de fechas, con filtro por
// partida y totales agrupados por concepto.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, StatusBar, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, AvancesResumen, Concepto, Partida, Project, RegistroAvance } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { APP_BRAND } from '@/src/utils/roles';
import { formatCantidad, formatMoney } from '@/src/utils/money';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { RangoFechasPicker } from '@/src/components/RangoFechasPicker';
import {
  RangoFechas, rangoEstaSemana, rangoEsteMes, rangoMesAnterior, formatearRangoLegible,
} from '@/src/utils/rangoFechas';

type AtajoRango = 'esta_semana' | 'este_mes' | 'mes_anterior' | 'todo' | 'personalizado';
const ATAJO_LABELS: Record<AtajoRango, string> = {
  esta_semana: 'Esta semana', este_mes: 'Este mes', mes_anterior: 'Mes anterior',
  todo: 'Todo el proyecto', personalizado: 'Personalizado',
};

export default function VisualizarAvanceScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [project, setProject] = useState<Project | null>(null);
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [conceptosById, setConceptosById] = useState<Record<string, Concepto>>({});
  const [partidaFiltro, setPartidaFiltro] = useState<string | null>(null);

  // null = "Todo el proyecto" (sin filtro de fecha). El atajo activo es
  // independiente del rango resultante: "Personalizado" también puede
  // coincidir por casualidad con lo que ya había, así que se guarda aparte
  // en vez de inferirlo de las fechas.
  const [atajo, setAtajo] = useState<AtajoRango>('esta_semana');
  const [rango, setRango] = useState<RangoFechas | null>(rangoEstaSemana());
  const [calendarioAbierto, setCalendarioAbierto] = useState(false);

  const [avances, setAvances] = useState<RegistroAvance[]>([]);
  const [resumen, setResumen] = useState<AvancesResumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [exportandoXlsx, setExportandoXlsx] = useState(false);

  function elegirAtajo(a: AtajoRango) {
    if (a === 'personalizado') { setCalendarioAbierto(true); return; }
    setAtajo(a);
    if (a === 'esta_semana') setRango(rangoEstaSemana());
    else if (a === 'este_mes') setRango(rangoEsteMes());
    else if (a === 'mes_anterior') setRango(rangoMesAnterior());
    else setRango(null); // todo
  }

  function confirmarRangoPersonalizado(desde: string, hasta: string) {
    setAtajo('personalizado');
    setRango({ desde, hasta });
    setCalendarioAbierto(false);
  }

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setError(null);
      setLoading(true);
      const filtro = { desde: rango?.desde, hasta: rango?.hasta, partida_id: partidaFiltro || undefined };
      const [proj, parts, lista, resumenPeriodo] = await Promise.all([
        api.getProject(projectId),
        api.listPartidas(projectId),
        api.listAvances(projectId, filtro),
        api.avancesResumen(projectId, filtro),
      ]);
      setProject(proj);
      setPartidas(parts);
      setAvances(lista);
      setResumen(resumenPeriodo);

      const conceptoIds = Array.from(new Set(lista.map((a) => a.concepto_id)));
      const missing = conceptoIds.filter((id) => !conceptosById[id]);
      if (missing.length > 0) {
        const byPartida = await Promise.all(parts.map((p) => api.listConceptos(p.id, true)));
        const flat = byPartida.flat();
        const map: Record<string, Concepto> = {};
        flat.forEach((c) => { map[c.id] = c; });
        setConceptosById((prev) => ({ ...prev, ...map }));
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el avance');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, partidaFiltro, rango?.desde, rango?.hasta]);

  useEffect(() => { load(); }, [load]);

  const exportarPdf = useCallback(async () => {
    if (!projectId || exportando) return;
    setExportando(true);
    try {
      const { blob, filename } = await api.downloadAvancePeriodoPdf(projectId, {
        desde: rango?.desde,
        hasta: rango?.hasta,
        partida_id: partidaFiltro || undefined,
      });
      await downloadBlob(blob, filename, 'application/pdf');
    } catch (e: any) {
      Alert.alert('No se pudo generar el PDF', e?.message || 'Intentalo nuevamente.');
    } finally {
      setExportando(false);
    }
  }, [projectId, rango?.desde, rango?.hasta, partidaFiltro, exportando]);

  const exportarXlsx = useCallback(async () => {
    if (!projectId || exportandoXlsx) return;
    setExportandoXlsx(true);
    try {
      const { blob, filename } = await api.downloadAvancePeriodoXlsx(projectId, {
        desde: rango?.desde,
        hasta: rango?.hasta,
        partida_id: partidaFiltro || undefined,
      });
      await downloadBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e: any) {
      Alert.alert('No se pudo generar el Excel', e?.message || 'Intentalo nuevamente.');
    } finally {
      setExportandoXlsx(false);
    }
  }, [projectId, rango?.desde, rango?.hasta, partidaFiltro, exportandoXlsx]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.brand}>{APP_BRAND}</Text>
        <View style={{ width: 32 }} />
      </View>
      <Text style={styles.titleBar}>VISUALIZAR AVANCE — {(project?.name || '').toUpperCase()}</Text>
      <View style={styles.rangoRow}>
        <Text style={styles.rangoTxt}>
          {rango ? formatearRangoLegible(rango.desde, rango.hasta) : 'Todo el proyecto'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {atajo === 'personalizado' ? (
            <Pressable onPress={() => elegirAtajo('todo')} style={styles.limpiarFiltroBtn} hitSlop={8}>
              <Ionicons name="close-circle-outline" size={13} color={colors.primary} />
              <Text style={styles.limpiarFiltroTxt}>Limpiar filtro</Text>
            </Pressable>
          ) : null}
          {avances.length > 0 ? (
            <>
              <Pressable
                onPress={exportarXlsx}
                disabled={exportandoXlsx}
                style={[styles.exportXlsxBtn, exportandoXlsx && { opacity: 0.6 }]}
                hitSlop={8}
              >
                {exportandoXlsx ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="grid-outline" size={13} color="#fff" />
                )}
                <Text style={styles.exportXlsxTxt}>Exportar Excel</Text>
              </Pressable>
              <Pressable
                onPress={exportarPdf}
                disabled={exportando}
                style={[styles.exportPdfBtn, exportando && { opacity: 0.6 }]}
                hitSlop={8}
              >
                {exportando ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="document-text-outline" size={13} color={colors.primary} />
                )}
                <Text style={styles.exportPdfTxt}>PDF</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow} contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.md }}>
        {(['esta_semana', 'este_mes', 'mes_anterior', 'todo', 'personalizado'] as AtajoRango[]).map((a) => {
          const active = atajo === a;
          return (
            <Pressable key={a} onPress={() => elegirAtajo(a)} style={[styles.chip, active && styles.chipActive]}>
              {a === 'personalizado' ? <Ionicons name="calendar-outline" size={13} color={active ? '#fff' : colors.textBody} /> : null}
              <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{ATAJO_LABELS[a]}</Text>
            </Pressable>
          );
        })}
        <View style={styles.chipDivider} />
        {partidas.map((p) => {
          const active = partidaFiltro === p.id;
          return (
            <Pressable key={p.id} onPress={() => setPartidaFiltro(active ? null : p.id)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipTxt, active && styles.chipTxtActive]} numberOfLines={1}>{p.clave}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={16} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {avances.length === 0 ? (
            <Text style={styles.empty}>Sin registros de avance en este periodo.</Text>
          ) : (
            avances.map((a) => {
              const c = conceptosById[a.concepto_id];
              return (
                <View key={a.id} style={styles.avanceCard}>
                  <View style={styles.avanceHeaderRow}>
                    <Text style={styles.avanceFecha}>{a.fecha}</Text>
                    {!a.sincronizado ? (
                      <View style={styles.pendingBadge}>
                        <Ionicons name="cloud-offline-outline" size={11} color={colors.warning} />
                        <Text style={styles.pendingTxt}>Pendiente de sincronizar</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.avanceConcepto} numberOfLines={1}>
                    {c ? `${c.clave} — ${c.descripcion}` : a.concepto_id}
                  </Text>
                  <Text style={styles.avanceCantidad}>
                    {formatCantidad(a.cantidad_ejecutada)} {c?.unidad || ''} · {a.capturado_por_nombre || 'Usuario'}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <View style={styles.footerFixed}>
        <View>
          <Text style={styles.footerLabel}>REGISTROS EN EL PERIODO</Text>
          <Text style={styles.footerValue}>{avances.length}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.footerLabel}>IMPORTE DEL PERIODO</Text>
          <Text style={styles.footerValue}>{formatMoney(resumen?.importe_total ?? '0')}</Text>
        </View>
      </View>

      <RangoFechasPicker
        visible={calendarioAbierto}
        desdeInicial={rango?.desde || null}
        hastaInicial={rango?.hasta || null}
        onCancelar={() => setCalendarioAbierto(false)}
        onConfirmar={confirmarRangoPersonalizado}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, backgroundColor: colors.primary, paddingBottom: spacing.sm },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#fff', fontWeight: '800', fontSize: 15 },
  titleBar: { fontSize: 14, fontWeight: '800', color: colors.text, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  rangoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: 6,
  },
  rangoTxt: { fontSize: 12, color: colors.textMuted, textTransform: 'capitalize' },
  limpiarFiltroBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  limpiarFiltroTxt: { fontSize: 11, fontWeight: '700', color: colors.primary },
  exportXlsxBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  exportXlsxTxt: { fontSize: 11, fontWeight: '700', color: '#fff' },
  exportPdfBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface,
  },
  exportPdfTxt: { fontSize: 11, fontWeight: '700', color: colors.primary },

  presetRow: { maxHeight: 40 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  chipTxtActive: { color: '#fff' },
  chipDivider: { width: 1, backgroundColor: colors.border, marginVertical: 4 },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: 10, marginHorizontal: spacing.md, marginTop: spacing.sm },
  errorText: { flex: 1, color: colors.error, fontSize: 12, fontWeight: '600' },

  scroll: { padding: spacing.md, paddingBottom: 90, gap: 8 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontStyle: 'italic' },

  avanceCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 2 },
  avanceHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avanceFecha: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  pendingBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  pendingTxt: { fontSize: 10, color: colors.warning, fontWeight: '700' },
  avanceConcepto: { fontSize: 13, fontWeight: '700', color: colors.text },
  avanceCantidad: { fontSize: 12, color: colors.textBody },

  footerFixed: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...shadow.lg,
  },
  footerLabel: { fontSize: 12, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.4 },
  footerValue: { fontSize: 16, fontWeight: '800', color: colors.text },
});
