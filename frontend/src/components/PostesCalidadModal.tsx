// Captura de las tres tablas de postes de la lámina "Aseguramiento de control de
// calidad" de la Presentación: avance de fabricación (por bucle y proceso), existencia
// de postes en almacén y postes instalados con su fecha. Estado vigente, no un log.
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, PostesCalidad } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { fechaTecleadaOk } from '@/src/utils/fecha';

const PROCESOS: { key: 'corte' | 'armado' | 'soldadura' | 'galvanizado'; label: string }[] = [
  { key: 'corte', label: 'Corte' }, { key: 'armado', label: 'Armado' },
  { key: 'soldadura', label: 'Soldadura' }, { key: 'galvanizado', label: 'Galvanizado' },
];

type Fab = { bucle: string; num: string; corte: string; armado: string; soldadura: string; galvanizado: string };
type Alm = { almacen: string; danados: string; total: string; bucles: { bucle: string; cantidad: string }[] };
type Inst = { bucle: string; poste: string; fecha: string };

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const txt = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export default function PostesCalidadModal({ projectId, visible, onClose, puedeEscribir }: {
  projectId: string; visible: boolean; onClose: () => void; puedeEscribir: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [fab, setFab] = useState<Fab[]>([]);
  const [alm, setAlm] = useState<Alm[]>([]);
  const [inst, setInst] = useState<Inst[]>([]);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        setLoading(true);
        const d = await api.getPostesCalidad(projectId);
        setTitulo(d.titulo_fabricacion || '');
        setFab(d.fabricacion.map((f) => ({
          bucle: f.bucle, num: txt(f.num_postes), corte: txt(f.corte), armado: txt(f.armado),
          soldadura: txt(f.soldadura), galvanizado: txt(f.galvanizado),
        })));
        setAlm(d.almacen.map((a) => ({
          almacen: a.almacen, danados: txt(a.danados), total: txt(a.total),
          bucles: a.bucles.map((b) => ({ bucle: b.bucle, cantidad: txt(b.cantidad) })),
        })));
        setInst(d.instalados.map((i) => ({ bucle: i.bucle, poste: i.poste, fecha: i.fecha || '' })));
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'No se pudo cargar.');
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, projectId]);

  async function guardar() {
    for (const f of fab) {
      for (const p of PROCESOS) {
        const n = num(f[p.key]);
        if (n !== null && (Number.isNaN(n) || n < 0 || n > 100)) {
          Alert.alert('Valor inválido', `Bucle ${f.bucle} · ${p.label}: usa un porcentaje entre 0 y 100.`);
          return;
        }
      }
    }
    for (const i of inst) {
      if (i.fecha && !fechaTecleadaOk(i.fecha)) {
        Alert.alert('Fecha inválida', `Poste ${i.poste}: escribe la fecha como AAAA-MM-DD.`);
        return;
      }
    }
    try {
      setSaving(true);
      await api.setPostesCalidad(projectId, {
        titulo_fabricacion: titulo.trim() || null,
        fabricacion: fab.map((f) => ({
          bucle: f.bucle, num_postes: num(f.num), corte: num(f.corte), armado: num(f.armado),
          soldadura: num(f.soldadura), galvanizado: num(f.galvanizado),
        })),
        almacen: alm.map((a) => ({
          almacen: a.almacen, danados: num(a.danados) || 0, total: num(a.total),
          bucles: a.bucles.map((b) => ({ bucle: b.bucle, cantidad: num(b.cantidad) || 0 })),
        })),
        instalados: inst.map((i) => ({ bucle: i.bucle, poste: i.poste, fecha: i.fecha || null })),
      });
      Alert.alert('Guardado', 'Postes actualizados.');
      onClose();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  const campo = (valor: string, onChange: (v: string) => void, ph: string, ancho?: number, teclado: 'default' | 'numeric' = 'default') => (
    <TextInput value={valor} onChangeText={onChange} editable={puedeEscribir} placeholder={ph} placeholderTextColor={colors.textMuted}
      keyboardType={teclado} style={[styles.input, ancho ? { width: ancho } : { flex: 1 }]} />
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Postes de calidad</Text>
          <View style={{ width: 22 }} />
        </View>
        {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} /> : (
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
            {/* ---- Fabricación ---- */}
            <Text style={styles.section}>Avance de fabricación</Text>
            {campo(titulo, setTitulo, 'Título (ej. Avance de fabricación de postes planta GEFSA Bucle A y D)')}
            {fab.map((f, i) => (
              <View key={i} style={styles.card}>
                <View style={styles.row}>
                  {campo(f.bucle, (v) => setFab((c) => c.map((x, j) => (j === i ? { ...x, bucle: v } : x))), 'Bucle', 80)}
                  {campo(f.num, (v) => setFab((c) => c.map((x, j) => (j === i ? { ...x, num: v } : x))), 'Número de postes', undefined, 'numeric')}
                  {puedeEscribir ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Quitar" onPress={() => setFab((c) => c.filter((_, j) => j !== i))}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.row}>
                  {PROCESOS.map((p) => (
                    <View key={p.key} style={{ flex: 1 }}>
                      <Text style={styles.mini}>{p.label} %</Text>
                      <TextInput value={f[p.key]} editable={puedeEscribir} keyboardType="numeric"
                        onChangeText={(v) => setFab((c) => c.map((x, j) => (j === i ? { ...x, [p.key]: v } : x)))} style={styles.input} />
                    </View>
                  ))}
                </View>
              </View>
            ))}
            {puedeEscribir ? (
              <Pressable accessibilityRole="button" onPress={() => setFab((c) => [...c, { bucle: '', num: '', corte: '', armado: '', soldadura: '', galvanizado: '' }])}>
                <Text style={styles.link}>+ Agregar bucle</Text>
              </Pressable>
            ) : null}

            {/* ---- Almacén ---- */}
            <Text style={styles.section}>Existencia de postes en almacén</Text>
            {alm.map((a, i) => (
              <View key={i} style={styles.card}>
                <View style={styles.row}>
                  {campo(a.almacen, (v) => setAlm((c) => c.map((x, j) => (j === i ? { ...x, almacen: v } : x))), 'Almacén')}
                  {campo(a.danados, (v) => setAlm((c) => c.map((x, j) => (j === i ? { ...x, danados: v } : x))), 'Dañados', 80, 'numeric')}
                  {campo(a.total, (v) => setAlm((c) => c.map((x, j) => (j === i ? { ...x, total: v } : x))), 'Total', 80, 'numeric')}
                  {puedeEscribir ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Quitar" onPress={() => setAlm((c) => c.filter((_, j) => j !== i))}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  ) : null}
                </View>
                {a.bucles.map((b, k) => (
                  <View key={k} style={styles.row}>
                    {campo(b.bucle, (v) => setAlm((c) => c.map((x, j) => (j === i ? { ...x, bucles: x.bucles.map((y, m) => (m === k ? { ...y, bucle: v } : y)) } : x))), 'Bucle', 80)}
                    {campo(b.cantidad, (v) => setAlm((c) => c.map((x, j) => (j === i ? { ...x, bucles: x.bucles.map((y, m) => (m === k ? { ...y, cantidad: v } : y)) } : x))), 'Cantidad', undefined, 'numeric')}
                  </View>
                ))}
                {puedeEscribir ? (
                  <Pressable accessibilityRole="button" onPress={() => setAlm((c) => c.map((x, j) => (j === i ? { ...x, bucles: [...x.bucles, { bucle: '', cantidad: '' }] } : x)))}>
                    <Text style={styles.link}>+ Bucle</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {puedeEscribir ? (
              <Pressable accessibilityRole="button" onPress={() => setAlm((c) => [...c, { almacen: '', danados: '', total: '', bucles: [{ bucle: '', cantidad: '' }] }])}>
                <Text style={styles.link}>+ Agregar almacén</Text>
              </Pressable>
            ) : null}
            <Text style={styles.mini}>El % de postes en almacén = suma de cantidades ÷ Total del almacén.</Text>

            {/* ---- Instalados ---- */}
            <Text style={styles.section}>Postes instalados</Text>
            {inst.map((r, i) => (
              <View key={i} style={styles.row}>
                {campo(r.bucle, (v) => setInst((c) => c.map((x, j) => (j === i ? { ...x, bucle: v } : x))), 'Bucle', 70)}
                {campo(r.poste, (v) => setInst((c) => c.map((x, j) => (j === i ? { ...x, poste: v } : x))), 'Poste', 90)}
                {campo(r.fecha, (v) => setInst((c) => c.map((x, j) => (j === i ? { ...x, fecha: v } : x))), 'AAAA-MM-DD')}
                {puedeEscribir ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Quitar" onPress={() => setInst((c) => c.filter((_, j) => j !== i))}>
                    <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {puedeEscribir ? (
              <Pressable accessibilityRole="button"
                onPress={() => setInst((c) => [...c, { bucle: c.length ? c[c.length - 1].bucle : '', poste: '', fecha: '' }])}>
                <Text style={styles.link}>+ Agregar poste instalado</Text>
              </Pressable>
            ) : null}

            {puedeEscribir ? <Button label="Guardar" loading={saving} onPress={guardar} style={{ marginTop: spacing.lg }} /> : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  section: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.xs },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: colors.text, backgroundColor: colors.bg },
  mini: { fontSize: 10, color: colors.textMuted, marginTop: 4 },
  link: { fontSize: 13, fontWeight: '700', color: colors.primary, marginTop: spacing.sm },
});
