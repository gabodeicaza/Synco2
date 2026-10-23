// Informes diarios de los ingenieros — Coordinador General / Jefe de Proyecto.
// Lista, por día, el informe de cada ingeniero del proyecto (estado y si ya lo confirmó), con el PDF de
// cada uno y el compilado de la semana (domingo a sábado) con hoja de firmas para imprimir el sábado.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, InformeDiario } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { dayjs } from '@/src/utils/tz';
import { downloadBlob } from '@/src/utils/downloadBlob';

type Fila = Omit<InformeDiario, 'bloques'>;

const ESTADO: Record<string, { txt: string; fg: string; bg: string }> = {
  confirmado: { txt: 'Confirmado', fg: '#166534', bg: '#DCFCE7' },
  listo: { txt: 'Sin confirmar', fg: '#92400E', bg: '#FEF3C7' },
  pendiente: { txt: 'Preparando', fg: '#1E3A8A', bg: '#DBEAFE' },
  procesando: { txt: 'Preparando', fg: '#1E3A8A', bg: '#DBEAFE' },
  sin_actividad: { txt: 'Sin reportes', fg: '#475569', bg: '#E2E8F0' },
};

export function InformesDiariosCoordScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [fecha, setFecha] = useState(dayjs().format('YYYY-MM-DD'));
  const [filas, setFilas] = useState<Fila[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!projectId) return;
    try {
      setError(null);
      setFilas((await api.informesDiariosCumplimiento(projectId, fecha)).informes);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los informes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, fecha]);

  useEffect(() => { setLoading(true); cargar(); }, [cargar]);

  const bajar = async (clave: string, fn: () => Promise<{ blob: Blob; filename: string }>) => {
    setDescargando(clave);
    try {
      const r = await fn();
      await downloadBlob(r.blob, r.filename, 'application/pdf');
    } catch (e: any) {
      Alert.alert('No se pudo descargar', e?.message || 'Intenta de nuevo');
    } finally {
      setDescargando(null);
    }
  };

  const mover = (dias: number) => setFecha(dayjs(fecha).add(dias, 'day').format('YYYY-MM-DD'));
  const confirmados = filas.filter((f) => f.confirmado_en).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); cargar(); }} />}
      >
        <Text style={styles.h1}>Informes diarios de ingenieros</Text>

        <View style={styles.fechaRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Día anterior" onPress={() => mover(-1)} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
          </Pressable>
          <Text style={styles.fecha}>{dayjs(fecha).format('dddd DD/MM/YYYY')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Día siguiente" onPress={() => mover(1)} hitSlop={8}>
            <Ionicons name="chevron-forward" size={22} color={colors.primary} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button" disabled={!!descargando} style={[styles.btn, !!descargando && { opacity: 0.6 }]}
          onPress={() => bajar('semana', () => api.downloadInformesSemanaPdf(projectId, { fecha }))}
        >
          <Ionicons name="documents-outline" size={18} color="#fff" />
          <Text style={styles.btnTxt}>{descargando === 'semana' ? 'Generando…' : 'Compilado de la semana (PDF para firmar)'}</Text>
        </Pressable>
        <Text style={styles.muted}>Incluye los informes de todos los ingenieros de la semana (domingo a sábado) y al final la hoja de firmas.</Text>

        {loading ? <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && !filas.length ? (
          <Text style={styles.muted}>No hay informes de este día. Se generan automáticamente a las 19:00.</Text>
        ) : null}
        {filas.length ? <Text style={styles.resumen}>{confirmados} de {filas.length} confirmados</Text> : null}

        {filas.map((f) => {
          const clave = f.confirmado_en ? 'confirmado' : f.estado;
          const e = ESTADO[clave] || ESTADO.pendiente;
          return (
            <View key={f.id} style={styles.fila}>
              <View style={{ flex: 1 }}>
                <Text style={styles.nombre}>{f.user_name}</Text>
                <Text style={styles.muted}>{f.reportes_count} reporte(s){f.estado === 'listo' && !f.ia ? ' · sin redacción IA' : ''}</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: e.bg }]}><Text style={[styles.chipTxt, { color: e.fg }]}>{e.txt}</Text></View>
              {f.estado === 'listo' ? (
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`Descargar PDF de ${f.user_name}`} disabled={!!descargando}
                  onPress={() => bajar(f.id, () => api.downloadInformeDiarioPdf(projectId, f.id))} hitSlop={8}
                >
                  {descargando === f.id ? <ActivityIndicator color={colors.primary} />
                    : <Ionicons name="download-outline" size={22} color={colors.primary} />}
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: '800', color: colors.textBody },
  fechaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.md },
  fecha: { fontSize: 15, fontWeight: '700', color: colors.textBody, textTransform: 'capitalize' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  muted: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  error: { color: colors.error, fontWeight: '600', marginTop: spacing.md },
  resumen: { marginTop: spacing.md, fontWeight: '800', color: colors.textBody },
  fila: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: '#E2E8F0', padding: spacing.md, marginTop: spacing.sm },
  nombre: { fontWeight: '700', color: colors.textBody, fontSize: 14 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipTxt: { fontSize: 11, fontWeight: '800' },
});
