// Modal "Datos de contrato" — captura los datos que alimentan la diapositiva
// DATOS DE CONTRATO del informe PPTX (dos columnas: OBRA y SUPERVISIÓN, cada
// una con objeto, empresa, contrato, ubicación, periodo y montos). Los montos
// se capturan ya formateados (ej. "$117,352,207.05"): el export los imprime
// tal cual. Lo que se deje en blanco en OBRA cae a los datos base del proyecto
// (objeto, constructora, número de contrato, fechas); si SUPERVISIÓN no
// tiene ningún dato, el slide muestra solo la obra. Ver
// `_sanitize_datos_contrato` y `_emit_contrato_slide` (backend/server.py).
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, DatosContrato, DatosContratoBloque, Project } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';

type Bloque = 'obra' | 'supervision';
type Campo = keyof DatosContratoBloque;

const CAMPOS: { key: Campo; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: 'objeto', label: 'Objeto / nombre del contrato', placeholder: 'PROYECTO INTEGRAL A PRECIO ALZADO…', multiline: true },
  { key: 'empresa', label: 'Empresa', placeholder: 'Razón social' },
  { key: 'contrato', label: 'Número de contrato', placeholder: 'DGOT-LP-F-4-017-2025' },
  { key: 'ubicacion', label: 'Ubicación', placeholder: 'Tlalpan - Coyoacán' },
  { key: 'inicio', label: 'Inicio del periodo', placeholder: '05/12/2025' },
  { key: 'fin', label: 'Fin del periodo', placeholder: '31/12/2028' },
  { key: 'monto', label: 'Monto', placeholder: '$117,352,207.05' },
  { key: 'iva', label: 'IVA', placeholder: '$18,776,353.13' },
  { key: 'monto_con_iva', label: 'Monto con IVA', placeholder: '$136,128,560.18' },
  { key: 'anticipo_label', label: 'Etiqueta del anticipo', placeholder: 'Anticipo (10%) 2025' },
  { key: 'anticipo', label: 'Anticipo', placeholder: '$519,794.75' },
];

const BLOQUE_LABEL: Record<Bloque, string> = { obra: 'OBRA', supervision: 'SUPERVISIÓN' };

export function DatosContratoModal({
  visible, project, onClose, onSaved,
}: {
  visible: boolean;
  project: Project | null;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const [bloque, setBloque] = useState<Bloque>('obra');
  const [draft, setDraft] = useState<DatosContrato>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setDraft({
        obra: { ...(project?.datos_contrato?.obra || {}) },
        supervision: { ...(project?.datos_contrato?.supervision || {}) },
      });
      setBloque('obra');
    }
  }, [visible, project]);

  function setCampo(key: Campo, value: string) {
    setDraft((d) => ({ ...d, [bloque]: { ...(d[bloque] || {}), [key]: value } }));
  }

  async function onSave() {
    if (!project || saving) return;
    try {
      setSaving(true);
      const upd = await api.updateProject(project.id, { datos_contrato: draft });
      onSaved(upd);
      onClose();
      Alert.alert('Guardado', 'Los datos de contrato se actualizaron correctamente.');
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  const actual = draft[bloque] || {};

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => !saving && onClose()}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        style={styles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && onClose()} />
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Datos de contrato</Text>
              <Text style={styles.subtitle}>
                Alimentan la diapositiva "Datos de contrato" del informe PowerPoint. En blanco, la obra usa los datos base del proyecto.
              </Text>
            </View>
            <Pressable onPress={() => !saving && onClose()} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.tabs}>
            {(['obra', 'supervision'] as Bloque[]).map((b) => (
              <Pressable key={b} onPress={() => setBloque(b)} style={[styles.tab, bloque === b && styles.tabActive]}>
                <Text style={[styles.tabTxt, bloque === b && { color: '#fff' }]}>{BLOQUE_LABEL[b]}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.lg }}>
            {CAMPOS.map((c) => (
              <View key={c.key} style={{ marginTop: spacing.sm }}>
                <Text style={styles.label}>{c.label}</Text>
                <TextInput
                  value={actual[c.key] || ''}
                  onChangeText={(v) => setCampo(c.key, v)}
                  placeholder={c.placeholder}
                  placeholderTextColor={colors.textMuted}
                  multiline={c.multiline}
                  style={[styles.input, c.multiline && { minHeight: 70, textAlignVertical: 'top' }]}
                />
              </View>
            ))}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Cancelar" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button label="Guardar" loading={saving} onPress={onSave} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, maxHeight: '90%',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary },
  tabTxt: { fontSize: 12, fontWeight: '800', color: colors.primary, letterSpacing: 0.4 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
