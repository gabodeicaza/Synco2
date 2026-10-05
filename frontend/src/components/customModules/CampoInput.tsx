// Entrada de captura de UN campo de un módulo personalizado, según su tipo.
import React from 'react';
import { View, Text, TextInput, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CustomCampo } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { esNumerico, fmtValor } from '@/src/utils/customModules';
import { Chip, ChipRow, SwitchRow, inputStyle } from './ui';

export function CampoInput({
  campo, value, onChange, fotoUri, onPickFoto, onClearFoto, editable = true,
}: {
  campo: CustomCampo;
  value: any;
  onChange: (v: any) => void;
  fotoUri?: string | null;
  onPickFoto?: (source: 'camera' | 'library') => void;
  onClearFoto?: () => void;
  editable?: boolean;
}) {
  const t = campo.tipo;
  const titulo = (
    <Text style={styles.label}>
      {campo.etiqueta}{campo.requerido ? <Text style={{ color: colors.error }}> *</Text> : null}
      {esNumerico(t) && t === 'numero' && campo.unidad ? <Text style={styles.unit}>  ({campo.unidad})</Text> : null}
    </Text>
  );
  const ayuda = campo.ayuda ? <Text style={styles.ayuda}>{campo.ayuda}</Text> : null;

  if (t === 'interruptor') {
    return (
      <View style={styles.wrap}>
        <SwitchRow label={campo.etiqueta} hint={campo.ayuda} value={!!value} onChange={onChange} disabled={!editable} />
      </View>
    );
  }

  if (t === 'calculado') {
    return (
      <View style={styles.wrap}>
        {titulo}
        <View style={styles.calc}>
          <Ionicons name="calculator-outline" size={16} color={colors.textMuted} />
          <Text style={styles.calcTxt}>{fmtValor(campo, value) || '—'}</Text>
          <Text style={styles.ayuda}>calculado automáticamente</Text>
        </View>
      </View>
    );
  }

  if (t === 'foto') {
    return (
      <View style={styles.wrap}>
        {titulo}
        {fotoUri ? <Image source={{ uri: fotoUri }} style={styles.foto} resizeMode="cover" /> : null}
        {editable ? (
          <ChipRow>
            <Chip label="Cámara" icon="camera-outline" onPress={() => onPickFoto?.('camera')} />
            <Chip label="Galería" icon="images-outline" onPress={() => onPickFoto?.('library')} />
            {fotoUri ? <Chip label="Quitar" tone="danger" icon="trash-outline" onPress={() => onClearFoto?.()} /> : null}
          </ChipRow>
        ) : null}
        {ayuda}
      </View>
    );
  }

  if (t === 'seleccion') {
    return (
      <View style={styles.wrap}>
        {titulo}
        <ChipRow>
          {(campo.opciones || []).map((o) => (
            <Chip
              key={o} label={o} on={value === o} disabled={!editable}
              onPress={() => onChange(value === o && !campo.requerido ? '' : o)}
            />
          ))}
        </ChipRow>
        {ayuda}
      </View>
    );
  }

  if (t === 'multiseleccion') {
    const sel: string[] = Array.isArray(value) ? value : [];
    return (
      <View style={styles.wrap}>
        {titulo}
        <ChipRow>
          {(campo.opciones || []).map((o) => (
            <Chip
              key={o} label={o} on={sel.includes(o)} disabled={!editable}
              icon={sel.includes(o) ? 'checkmark' : undefined}
              onPress={() => onChange(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o])}
            />
          ))}
        </ChipRow>
        {ayuda}
      </View>
    );
  }

  if (t === 'fecha') {
    return (
      <View style={styles.wrap}>
        {titulo}
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <TextInput
            value={String(value ?? '')} onChangeText={onChange} editable={editable} placeholder="DD/MM/AAAA"
            placeholderTextColor={colors.textMuted} style={[inputStyle, { flex: 1 }]} autoCapitalize="none"
          />
          {editable ? <Chip label="Hoy" icon="today-outline" onPress={() => onChange(new Date().toISOString().slice(0, 10))} /> : null}
        </View>
        {ayuda}
      </View>
    );
  }

  const numerico = esNumerico(t);
  return (
    <View style={styles.wrap}>
      {titulo}
      <View style={styles.inputRow}>
        {t === 'moneda' ? <Text style={styles.prefix}>$</Text> : null}
        <TextInput
          value={value === null || value === undefined ? '' : String(value)}
          onChangeText={onChange} editable={editable}
          keyboardType={numerico ? 'decimal-pad' : 'default'}
          multiline={t === 'texto_largo'}
          placeholder={numerico ? '0' : ''} placeholderTextColor={colors.textMuted}
          style={[inputStyle, { flex: 1 }, t === 'texto_largo' && { minHeight: 88, textAlignVertical: 'top' }]}
        />
        {t === 'porcentaje' ? <Text style={styles.prefix}>%</Text> : null}
      </View>
      {ayuda}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6 },
  unit: { fontWeight: '600', color: colors.textMuted },
  ayuda: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prefix: { fontSize: 15, fontWeight: '800', color: colors.textMuted },
  calc: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.primaryLight,
  },
  calcTxt: { fontSize: 15, fontWeight: '800', color: colors.primaryDark },
  foto: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.border, marginBottom: 8 },
});
