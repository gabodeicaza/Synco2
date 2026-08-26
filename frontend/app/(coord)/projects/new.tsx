import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/components/Button';
import { api } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

export default function NewProjectScreen() {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [constructora, setConstructora] = useState('');
  const [contract, setContract] = useState('');
  const [objetoContrato, setObjetoContrato] = useState('');
  const [clientePrincipal, setClientePrincipal] = useState('');
  const [colorTema, setColorTema] = useState('#003366');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setError(null);
    if (!name.trim() || !constructora.trim() || !contract.trim()) {
      setError('Nombre, constructora y numero de contrato son obligatorios');
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
        color_tema: colorTema.trim() || null,
        start_date: startDate.trim() || null,
        end_date: endDate.trim() || null,
        description: description.trim() || null,
      });
      router.replace({ pathname: '/(coord)/projects/[id]', params: { id: p.id } });
    } catch (e: any) {
      setError(e?.message || 'No se pudo crear');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
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
        <Field
          label="Color institucional (#RRGGBB)"
          value={colorTema}
          onChangeText={setColorTema}
          placeholder="#003366"
          icon="color-palette-outline"
          autoCapitalize="characters"
        />
        {/* Vista previa rapida del color */}
        <View style={styles.colorPreviewRow}>
          <Text style={styles.colorPreviewLabel}>Vista previa:</Text>
          <View
            style={[
              styles.colorSwatch,
              { backgroundColor: /^#([0-9a-fA-F]{3}){1,2}$/.test(colorTema.trim()) ? colorTema.trim() : '#003366' },
            ]}
          />
          <Text style={styles.colorPreviewHint}>(Usado en portadas y encabezados de exportaciones)</Text>
        </View>
        <Field label="Fecha de inicio (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} placeholder="2026-01-15" icon="calendar-outline" />
        <Field label="Fecha de termino (YYYY-MM-DD)" value={endDate} onChangeText={setEndDate} placeholder="2027-06-30" icon="calendar-outline" />
        <Field label="Descripcion (opcional)" value={description} onChangeText={setDescription} placeholder="Notas_" icon="chatbox-ellipses-outline" multiline />

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

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
