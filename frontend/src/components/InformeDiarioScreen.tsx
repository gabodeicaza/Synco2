// Informe diario del ingeniero — Especialista y Sub-coordinador.
// Muestra el informe generado en el corte de las 19:00 con la estructura de la plantilla de
// "Informe técnico diario de supervisión" (un bloque por reporte: estatus, actividades, fuerza de
// trabajo, equipo, observaciones, fotos) y un resumen redactado con IA. El ingeniero lo revisa y
// lo CONFIRMA: esa confirmación queda registrada (fecha/hora) como su responsabilidad sobre lo reportado.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import { useProyectoActivo } from '@/src/proyecto-activo-context';
import { api, InformeDiario, InformeDiarioBloque } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { fmtFechaHora } from '@/src/utils/fechas';
import { ROLE_SUB } from '@/src/utils/roles';

const DOT: Record<string, string> = { verde: '#16A34A', amarillo: '#F59E0B', rojo: '#DC2626' };

function Bloque({ b }: { b: InformeDiarioBloque }) {
  return (
    <View style={styles.bloque}>
      <Text style={styles.bloqueTitulo}>{b.ubicacion}{b.hora ? `  ·  ${b.hora} hrs` : ''}</Text>
      {b.area_name ? <Text style={styles.muted}>{b.area_name}</Text> : null}
      <View style={styles.estatusRow}>
        <View style={[styles.dot, { backgroundColor: DOT[b.gravedad] || DOT.verde }]} />
        <Text style={styles.estatus}>{b.estatus}</Text>
      </View>
      {b.resumen_ia ? <Text style={styles.resumenIa}>{b.resumen_ia}</Text> : null}
      <Text style={styles.etiqueta}>Actividades desarrolladas</Text>
      {b.actividades.length ? b.actividades.map((a, i) => <Text key={i} style={styles.texto}>• {a}</Text>)
        : <Text style={styles.muted}>Sin actividades capturadas</Text>}
      {b.fuerza_trabajo ? (<><Text style={styles.etiqueta}>Fuerza de trabajo</Text><Text style={styles.texto}>{b.fuerza_trabajo}</Text></>) : null}
      {b.equipo ? (<><Text style={styles.etiqueta}>Equipo y maquinaria</Text><Text style={styles.texto}>{b.equipo}</Text></>) : null}
      {b.observaciones ? (<><Text style={styles.etiqueta}>Observaciones</Text><Text style={styles.texto}>{b.observaciones}</Text></>) : null}
      {b.fotos.length ? (
        <Text style={styles.muted}>
          📷 {b.fotos.length} foto(s) de evidencia{b.fotos.some((f) => f.caption) ? ': ' + b.fotos.map((f, i) => f.caption || `Foto ${i + 1}`).join(' · ') : ''}
        </Text>
      ) : null}
    </View>
  );
}

export function InformeDiarioScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { proyectoId } = useProyectoActivo();
  const pid = proyectoId || (user?.project_ids || [])[0] || '';

  const [informe, setInforme] = useState<InformeDiario | null>(null);
  const [cumplimiento, setCumplimiento] = useState<{ nombre: string; estado: string; confirmado: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comentario, setComentario] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    if (!pid) { setLoading(false); return; }
    try {
      setError(null);
      const mio = await api.informeDiarioMio(pid);
      // `detalle` marca "visto" (el aviso de lectura); el listado `mio` no lo hace.
      const completo = mio && mio.estado === 'listo' ? await api.informeDiarioDetalle(pid, mio.id) : mio;
      setInforme(completo);
      setComentario(completo?.comentario_ingeniero || '');
      if (user?.role === ROLE_SUB) {
        const c = await api.informesDiariosCumplimiento(pid, completo?.fecha);
        setCumplimiento(c.informes.map((i) => ({ nombre: i.user_name, estado: i.estado, confirmado: !!i.confirmado_en })));
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el informe');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pid, user?.role]);

  useEffect(() => { cargar(); }, [cargar]);

  const confirmar = async () => {
    if (!informe) return;
    setGuardando(true);
    try {
      setInforme(await api.informeDiarioConfirmar(pid, informe.id, comentario.trim()));
    } catch (e: any) {
      Alert.alert('No se pudo confirmar', e?.message || 'Intenta de nuevo');
    } finally {
      setGuardando(false);
    }
  };

  const confirmado = !!informe?.confirmado_en;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); cargar(); }} />}
      >
        <Text style={styles.h1}>Informe técnico diario</Text>
        {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && !error && !informe ? (
          <Text style={styles.muted}>Aún no hay un informe. Se genera automáticamente cada día a las 19:00.</Text>
        ) : null}

        {informe ? (
          <>
            <Text style={styles.muted}>Fecha del reporte: {informe.fecha} · Supervisor: {informe.user_name}</Text>

            {informe.estado === 'sin_actividad' ? (
              <Text style={styles.texto}>No capturaste reportes este día.</Text>
            ) : informe.estado !== 'listo' ? (
              <Text style={styles.texto}>Tu informe se está preparando; te avisaremos en cuanto esté listo.</Text>
            ) : (
              <>
                <View style={styles.resumenBox}>
                  <Text style={styles.etiqueta}>Resumen del día{informe.ia ? ' (generado con IA)' : ''}</Text>
                  <Text style={styles.texto}>{informe.resumen_general}</Text>
                  {!informe.ia ? <Text style={styles.muted}>La redacción con IA no estuvo disponible; se muestran tus datos tal cual.</Text> : null}
                </View>
                {informe.bloques.map((b, i) => <Bloque key={b.report_id || i} b={b} />)}

                <Text style={styles.etiqueta}>Comentarios (opcional)</Text>
                <TextInput
                  value={comentario} onChangeText={setComentario} editable={!confirmado} multiline
                  placeholder="Agrega una aclaración si algo no quedó reflejado" style={styles.input}
                />
                {confirmado ? (
                  <View style={styles.confirmadoBox}>
                    <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
                    <Text style={styles.confirmadoTxt}>Confirmado el {fmtFechaHora(informe.confirmado_en)}</Text>
                  </View>
                ) : (
                  <Pressable accessibilityRole="button" onPress={confirmar} disabled={guardando} style={[styles.btn, guardando && { opacity: 0.6 }]}>
                    <Text style={styles.btnTxt}>{guardando ? 'Guardando…' : 'Revisé y confirmo mi informe'}</Text>
                  </Pressable>
                )}
              </>
            )}
          </>
        ) : null}

        {cumplimiento.length ? (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={styles.etiqueta}>Cumplimiento del equipo</Text>
            {cumplimiento.map((c, i) => (
              <Text key={i} style={styles.texto}>
                {c.confirmado ? '✅' : c.estado === 'sin_actividad' ? '➖' : '⏳'} {c.nombre}
                {c.estado === 'sin_actividad' ? ' — sin reportes' : c.confirmado ? ' — confirmó' : ' — pendiente de confirmar'}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: '800', color: colors.textBody, marginBottom: spacing.xs },
  muted: { color: colors.textMuted, fontSize: 12, marginVertical: 2 },
  texto: { color: colors.textBody, fontSize: 14, marginVertical: 2 },
  etiqueta: { color: colors.textBody, fontSize: 12, fontWeight: '800', marginTop: spacing.sm, textTransform: 'uppercase' },
  error: { color: colors.error, fontWeight: '600', marginTop: spacing.md },
  resumenBox: { backgroundColor: '#EFF6FF', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  bloque: { backgroundColor: '#fff', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: '#E2E8F0' },
  bloqueTitulo: { fontSize: 14, fontWeight: '800', color: colors.textBody },
  estatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  estatus: { fontSize: 13, fontWeight: '600', color: colors.textBody },
  resumenIa: { fontSize: 13, fontStyle: 'italic', color: colors.textBody, marginTop: spacing.xs },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: radius.md, padding: spacing.sm, minHeight: 70, backgroundColor: '#fff', textAlignVertical: 'top' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  confirmadoBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md },
  confirmadoTxt: { color: '#166534', fontWeight: '700' },
});
