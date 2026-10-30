// Editor del texto de un informe diario (resumen del día y, por reporte de campo: resumen, actividades,
// fuerza de trabajo, equipo y observaciones). Lo usan el ingeniero (mientras no confirma), el Coordinador de
// área de su área, el Sub-coordinador y el Coordinador General. Las fotos y el estatus no se editan aquí.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api, InformeDiario } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

type Borrador = { resumen_ia: string; actividades: string; fuerza_trabajo: string; equipo: string; observaciones: string };

export function InformeEditor({
  projectId, informeId, propio, onClose, onSaved,
}: { projectId: string; informeId: string | null; propio: boolean; onClose: () => void; onSaved: (inf: InformeDiario) => void }) {
  const [informe, setInforme] = useState<InformeDiario | null>(null);
  const [resumen, setResumen] = useState('');
  const [bloques, setBloques] = useState<Record<string, Borrador>>({});
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!informeId) { setInforme(null); return; }
    let vivo = true;
    setCargando(true);
    setError(null);
    api.informeDiarioDetalle(projectId, informeId).then((inf) => {
      if (!vivo) return;
      setInforme(inf);
      setResumen(inf.resumen_general || '');
      const b: Record<string, Borrador> = {};
      inf.bloques.forEach((x) => {
        b[x.report_id] = {
          resumen_ia: x.resumen_ia || '', actividades: (x.actividades || []).join('\n'),
          fuerza_trabajo: x.fuerza_trabajo || '', equipo: x.equipo || '', observaciones: x.observaciones || '',
        };
      });
      setBloques(b);
    }).catch((e) => vivo && setError(e?.message || 'No se pudo cargar el informe'))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [projectId, informeId]);

  const poner = (rid: string, campo: keyof Borrador, v: string) =>
    setBloques((p) => ({ ...p, [rid]: { ...p[rid], [campo]: v } }));

  const guardar = async () => {
    if (!informe) return;
    setGuardando(true);
    try {
      const r = await api.informeDiarioEditar(projectId, informe.id, {
        resumen_general: resumen,
        bloques: informe.bloques.map((b) => ({
          report_id: b.report_id,
          resumen_ia: bloques[b.report_id]?.resumen_ia ?? '',
          actividades: (bloques[b.report_id]?.actividades ?? '').split('\n').map((l) => l.trim()).filter(Boolean),
          fuerza_trabajo: bloques[b.report_id]?.fuerza_trabajo ?? '',
          equipo: bloques[b.report_id]?.equipo ?? '',
          observaciones: bloques[b.report_id]?.observaciones ?? '',
        })),
      });
      onSaved(r);
      onClose();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intenta de nuevo');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal visible={!!informeId} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.cab}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.titulo}>Editar informe</Text>
            {informe ? <Text style={styles.sub}>{informe.user_name} · {informe.fecha}</Text> : null}
          </View>
          <Pressable
            accessibilityRole="button" disabled={guardando || !informe} onPress={guardar}
            style={[styles.guardar, (guardando || !informe) && { opacity: 0.5 }]}
          >
            {guardando ? <ActivityIndicator color="#fff" /> : <Text style={styles.guardarTxt}>Guardar</Text>}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {cargando ? <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {informe ? (
            <>
              {!propio ? (
                <Text style={styles.aviso}>Al guardar, {informe.user_name} tendrá que volver a revisar y confirmar su informe.</Text>
              ) : null}
              <Campo etiqueta="Resumen del día" valor={resumen} onChange={setResumen} alto={110} />
              {informe.bloques.map((b) => {
                const d = bloques[b.report_id];
                if (!d) return null;
                return (
                  <View key={b.report_id} style={styles.bloque}>
                    <Text style={styles.bloqueTitulo}>{b.ubicacion}{b.hora ? `  ·  ${b.hora} hrs` : ''}</Text>
                    <Campo etiqueta="Resumen del reporte" valor={d.resumen_ia} onChange={(v) => poner(b.report_id, 'resumen_ia', v)} alto={70} />
                    <Campo etiqueta="Actividades (una por línea)" valor={d.actividades} onChange={(v) => poner(b.report_id, 'actividades', v)} alto={110} />
                    <Campo etiqueta="Fuerza de trabajo" valor={d.fuerza_trabajo} onChange={(v) => poner(b.report_id, 'fuerza_trabajo', v)} alto={60} />
                    <Campo etiqueta="Equipo y maquinaria" valor={d.equipo} onChange={(v) => poner(b.report_id, 'equipo', v)} alto={60} />
                    <Campo etiqueta="Observaciones" valor={d.observaciones} onChange={(v) => poner(b.report_id, 'observaciones', v)} alto={80} />
                  </View>
                );
              })}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Campo({ etiqueta, valor, onChange, alto }: { etiqueta: string; valor: string; onChange: (v: string) => void; alto: number }) {
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={styles.etiqueta}>{etiqueta}</Text>
      <TextInput
        value={valor} onChangeText={onChange} multiline style={[styles.input, { minHeight: alto }]}
        placeholderTextColor={colors.textMuted} accessibilityLabel={etiqueta}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cab: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, paddingTop: spacing.lg, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.border },
  titulo: { fontSize: 17, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted },
  guardar: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 9, minWidth: 90, alignItems: 'center' },
  guardarTxt: { color: '#fff', fontWeight: '800' },
  aviso: { color: '#92400E', backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.sm, fontSize: 12, fontWeight: '600' },
  bloque: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md },
  bloqueTitulo: { fontSize: 14, fontWeight: '800', color: colors.text },
  etiqueta: { fontSize: 11, fontWeight: '800', color: colors.text, textTransform: 'uppercase', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, padding: spacing.sm, backgroundColor: '#fff', color: colors.text, textAlignVertical: 'top', fontSize: 14 },
  error: { color: colors.error, fontWeight: '600', marginTop: spacing.md },
});
