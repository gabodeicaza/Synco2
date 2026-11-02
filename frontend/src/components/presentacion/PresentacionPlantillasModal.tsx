// Administrador de plantillas de presentación (solo Coordinador / Sub-Coordinador):
// lista, duplica, crea, edita y borra. La "semanal" va integrada: no se edita ni
// se borra, pero se duplica para personalizarla. Una plantilla es solo la lista
// ordenada de secciones con que arranca una presentación nueva.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, PresentacionPlantilla, PresentacionPlantillaSeccion, PresentacionSeccionTipo } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { showToast } from '@/src/utils/toast';
import { TIPO_ICON, TIPO_LABEL, TIPOS_PARA_PLANTILLA } from '@/src/components/presentacion/tiposSeccion';

interface Borrador {
  id: string | null; // null = nueva (o copia)
  nombre: string;
  descripcion: string;
  incluir_estaciones: boolean;
  secciones: PresentacionPlantillaSeccion[];
}

const BORRADOR_VACIO: Borrador = {
  id: null, nombre: '', descripcion: '', incluir_estaciones: false,
  secciones: [{ tipo: 'portada' }, { tipo: 'cierre' }],
};

/** Mueve el elemento `i` una posición (−1 arriba, +1 abajo). */
function mover<T>(arr: T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return arr;
  const copia = [...arr];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}

export function PresentacionPlantillasModal({
  visible, onClose, onChanged,
}: { visible: boolean; onClose: () => void; onChanged?: () => void }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<PresentacionPlantilla[]>([]);
  const [loading, setLoading] = useState(false);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [saving, setSaving] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      setItems(await api.listPresentacionPlantillas());
    } catch (e: any) {
      Alert.alert('Plantillas', e?.message || 'No se pudieron cargar las plantillas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) { setBorrador(null); setAgregando(false); cargar(); }
  }, [visible, cargar]);

  const desdePlantilla = (p: PresentacionPlantilla, copia: boolean): Borrador => ({
    id: copia ? null : p.id,
    nombre: copia ? `${p.nombre} (copia)` : p.nombre,
    descripcion: p.descripcion || '',
    incluir_estaciones: p.incluir_estaciones,
    secciones: p.secciones.map((s) => ({ tipo: s.tipo, titulo: s.titulo || '' })),
  });

  async function onEliminar(p: PresentacionPlantilla) {
    const ok = await confirm(
      'Eliminar plantilla',
      `¿Eliminar "${p.nombre}"? Las presentaciones ya creadas con ella no cambian.`,
      { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deletePresentacionPlantilla(p.id);
      await cargar();
      onChanged?.();
    } catch (e: any) {
      showToast(e?.message || 'No se pudo eliminar la plantilla.');
    }
  }

  async function onGuardar() {
    if (!borrador) return;
    if (!borrador.nombre.trim()) {
      Alert.alert('Plantilla', 'Ponle un nombre a la plantilla.');
      return;
    }
    const body = {
      nombre: borrador.nombre.trim(),
      descripcion: borrador.descripcion.trim() || null,
      incluir_estaciones: borrador.incluir_estaciones,
      secciones: borrador.secciones.map((s) => ({ tipo: s.tipo, titulo: (s.titulo || '').trim() || null })),
    };
    try {
      setSaving(true);
      if (borrador.id) await api.updatePresentacionPlantilla(borrador.id, body);
      else await api.createPresentacionPlantilla(body);
      setBorrador(null);
      await cargar();
      onChanged?.();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  const setSecciones = (fn: (s: PresentacionPlantillaSeccion[]) => PresentacionPlantillaSeccion[]) =>
    setBorrador((b) => (b ? { ...b, secciones: fn(b.secciones) } : b));

  function agregar(tipo: PresentacionSeccionTipo) {
    setSecciones((s) => [...s, { tipo, titulo: '' }]);
    setAgregando(false);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={borrador ? () => setBorrador(null) : onClose}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.topRow}>
          <Text style={styles.title}>{borrador ? (borrador.id ? 'Editar plantilla' : 'Nueva plantilla') : 'Plantillas de presentación'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={8} onPress={borrador ? () => setBorrador(null) : onClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>

        {!borrador ? (
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
            <Text style={styles.hint}>
              Una plantilla es la lista de secciones con que arranca una presentación nueva. El contenido
              de cada sección se llena solo con los datos del periodo.
            </Text>
            {loading ? <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.primary} /> : null}
            {items.map((p) => (
              <View key={p.id} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nombre} numberOfLines={2}>{p.nombre}{p.integrada ? '  · integrada' : ''}</Text>
                  <Text style={styles.sub}>{p.secciones.length} secciones{p.incluir_estaciones ? ' · con estaciones' : ''}</Text>
                  {p.descripcion ? <Text style={styles.sub} numberOfLines={3}>{p.descripcion}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Duplicar" hitSlop={8} style={styles.accion} onPress={() => setBorrador(desdePlantilla(p, true))}>
                  <Ionicons name="copy-outline" size={20} color={colors.primary} />
                </Pressable>
                {!p.integrada ? (
                  <>
                    <Pressable accessibilityRole="button" accessibilityLabel="Editar" hitSlop={8} style={styles.accion} onPress={() => setBorrador(desdePlantilla(p, false))}>
                      <Ionicons name="create-outline" size={20} color={colors.primary} />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Eliminar" hitSlop={8} style={styles.accion} onPress={() => onEliminar(p)}>
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </Pressable>
                  </>
                ) : null}
              </View>
            ))}
            <Button label="Nueva plantilla" onPress={() => setBorrador({ ...BORRADOR_VACIO })} style={{ marginTop: spacing.md }} />
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Nombre</Text>
            <TextInput value={borrador.nombre} onChangeText={(v) => setBorrador({ ...borrador, nombre: v })} style={styles.input} placeholder="Ej. Innova Centro Escolar" placeholderTextColor={colors.textMuted} maxLength={80} />
            <Text style={styles.label}>Descripción (opcional)</Text>
            <TextInput value={borrador.descripcion} onChangeText={(v) => setBorrador({ ...borrador, descripcion: v })} style={styles.input} multiline maxLength={300} />
            <Pressable accessibilityRole="checkbox" onPress={() => setBorrador({ ...borrador, incluir_estaciones: !borrador.incluir_estaciones })} style={styles.checkRow}>
              <Ionicons name={borrador.incluir_estaciones ? 'checkbox' : 'square-outline'} size={22} color={borrador.incluir_estaciones ? colors.primary : colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.nombre}>Agregar una lámina por estación</Text>
                <Text style={styles.sub}>Croquis e información particular de cada estación o intertramo del proyecto.</Text>
              </View>
            </Pressable>

            <Text style={[styles.label, { marginTop: spacing.md }]}>Secciones ({borrador.secciones.length})</Text>
            {borrador.secciones.map((s, i) => (
              <View key={`${i}-${s.tipo}`} style={styles.secRow}>
                <Ionicons name={TIPO_ICON[s.tipo]} size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.secLabel} numberOfLines={1}>{TIPO_LABEL[s.tipo]}</Text>
                  <TextInput
                    value={s.titulo || ''}
                    onChangeText={(v) => setSecciones((arr) => arr.map((x, k) => (k === i ? { ...x, titulo: v } : x)))}
                    placeholder={s.tipo === 'divisor' ? 'Título del divisor' : 'Título (opcional)'}
                    placeholderTextColor={colors.textMuted} style={styles.tituloInput} maxLength={120}
                  />
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Subir" hitSlop={6} disabled={i === 0} style={[styles.accion, i === 0 && { opacity: 0.3 }]} onPress={() => setSecciones((a) => mover(a, i, -1))}>
                  <Ionicons name="chevron-up" size={20} color={colors.text} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Bajar" hitSlop={6} disabled={i === borrador.secciones.length - 1} style={[styles.accion, i === borrador.secciones.length - 1 && { opacity: 0.3 }]} onPress={() => setSecciones((a) => mover(a, i, 1))}>
                  <Ionicons name="chevron-down" size={20} color={colors.text} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Quitar" hitSlop={6} style={styles.accion} onPress={() => setSecciones((a) => a.filter((_, k) => k !== i))}>
                  <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                </Pressable>
              </View>
            ))}

            {agregando ? (
              <View style={styles.picker}>
                {TIPOS_PARA_PLANTILLA.map((tp) => (
                  <Pressable key={tp} accessibilityRole="button" style={styles.pickerOpt} onPress={() => agregar(tp)}>
                    <Ionicons name={TIPO_ICON[tp]} size={18} color={colors.primary} />
                    <Text style={styles.secLabel}>{TIPO_LABEL[tp]}</Text>
                  </Pressable>
                ))}
                <Button label="Cancelar" variant="secondary" onPress={() => setAgregando(false)} style={{ marginTop: spacing.sm }} />
              </View>
            ) : (
              <Button label="Agregar sección" variant="secondary" onPress={() => setAgregando(true)} style={{ marginTop: spacing.sm }} />
            )}

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setBorrador(null)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={onGuardar} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: '800', color: colors.text, flex: 1 },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  nombre: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  accion: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.surface,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.md },
  secRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 6, marginBottom: 6,
  },
  secLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  tituloInput: { fontSize: 12, color: colors.text, paddingVertical: 2, paddingHorizontal: 0 },
  picker: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginTop: spacing.sm },
  pickerOpt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: spacing.xs },
});
