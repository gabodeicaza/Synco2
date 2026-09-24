import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/components/Button';
import { api } from '@/src/api';
import { COLOR_IDENTIDAD_DEFECTO, colors, radius, spacing } from '@/src/theme';
import { a11y, t } from '@/src/i18n';
import { ColorInput } from '@/src/components/ColorInput';
import { InlineError } from '@/src/components/InlineError';
import { errorDeColor, normalizarColorHex } from '@/src/utils/color';
import { esErrorDeRed } from '@/src/utils/errores';
import { showToast } from '@/src/utils/toast';

export default function NewProjectScreen() {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [constructora, setConstructora] = useState('');
  const [contract, setContract] = useState('');
  const [objetoContrato, setObjetoContrato] = useState('');
  const [clientePrincipal, setClientePrincipal] = useState('');
  const [colorTema, setColorTema] = useState(COLOR_IDENTIDAD_DEFECTO);
  const [colorInstitucional, setColorInstitucional] = useState(COLOR_IDENTIDAD_DEFECTO);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    if (busy) return;
    setError(null);
    if (!name.trim() || !constructora.trim() || !contract.trim()) {
      setError('Nombre, constructora y número de contrato son obligatorios.');
      return;
    }
    if (errorDeColor(colorInstitucional) || errorDeColor(colorTema)) {
      setError(t('color.corrige'));
      return;
    }
    setBusy(true);
    try {
      const p = await api.createProject({
        name: name.trim(),
        constructora: constructora.trim(),
        contract_number: contract.trim(),
        objeto_contrato: objetoContrato.trim() || null,
        cliente_principal: clientePrincipal.trim() || null,
        color_tema: normalizarColorHex(colorTema),
        color_institucional: normalizarColorHex(colorInstitucional),
        start_date: startDate.trim() || null,
        end_date: endDate.trim() || null,
        description: description.trim() || null,
      });
      router.replace({ pathname: '/(coord)/projects/[id]', params: { id: p.id } });
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setError(e?.message || 'No se pudo crear el proyecto.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Nuevo proyecto</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Field label="Nombre del proyecto *" value={name} onChangeText={setName} placeholder="Ej. Libramiento Norte Tramo II" icon="briefcase-outline" />
        <Field label="Constructora *" value={constructora} onChangeText={setConstructora} placeholder="Ej. ICA SA de CV" icon="business-outline" />
        <Field label="Numero de contrato *" value={contract} onChangeText={setContract} placeholder="Ej. SCT-2026-114" icon="document-text-outline" />
        <Field
          label="Objeto del contrato (opcional)"
          value={objetoContrato}
          onChangeText={setObjetoContrato}
          placeholder="Ej. Supervision tecnica de la construccion del Tramo III_"
          icon="reader-outline"
          multiline
        />
        <Field
          label="Cliente principal (opcional)"
          value={clientePrincipal}
          onChangeText={setClientePrincipal}
          placeholder="Ej. Secretaria de Comunicaciones y Transportes"
          icon="ribbon-outline"
        />
        <ColorInput
          label="Color institucional (#RRGGBB)"
          ayuda="Usado en banners, tablas y acentos de toda la app y las exportaciones"
          value={colorInstitucional}
          onChange={setColorInstitucional}
          editable={!busy}
        />
        <ColorInput
          label="Color del título de portada (#RRGGBB)"
          ayuda="Solo el título de la portada del Informe PDF/PPTX exportado"
          value={colorTema}
          onChange={setColorTema}
          editable={!busy}
        />
        <Field label="Fecha de inicio (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} placeholder="2026-01-15" icon="calendar-outline" />
        <Field label="Fecha de termino (YYYY-MM-DD)" value={endDate} onChangeText={setEndDate} placeholder="2027-06-30" icon="calendar-outline" />
        <Field label="Descripcion (opcional)" value={description} onChangeText={setDescription} placeholder="Notas_" icon="chatbox-ellipses-outline" multiline />

        <InlineError message={error} />

        <View style={{ height: spacing.md }} />
        <Button label="Crear proyecto" onPress={onCreate} loading={busy} fullWidth />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChangeText, placeholder, icon, multiline, autoCapitalize }: any) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, multiline && { minHeight: 80, alignItems: 'flex-start', paddingTop: 12 }]}>
        <Ionicons name={icon} size={18} color={colors.textMuted} />
        <TextInput
          value={value} onChangeText={onChangeText}
          placeholder={placeholder} placeholderTextColor={colors.textMuted}
          style={[styles.input, multiline && { textAlignVertical: 'top', minHeight: 60 }]}
          multiline={!!multiline}
          autoCapitalize={autoCapitalize || 'sentences'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    paddingHorizontal: 12, backgroundColor: colors.surface,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md },
  errorText: { color: colors.error, fontSize: 13, flex: 1, fontWeight: '600' },
  colorPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -spacing.sm },
  colorPreviewLabel: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  colorSwatch: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong },
  colorPreviewHint: { flex: 1, fontSize: 11, color: colors.textMuted, fontStyle: 'italic' },
});
