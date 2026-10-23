// Configuración de lo que el Área captura en sus reportes: Personal, Equipo y
// campos libres definidos por el Coordinador (p. ej. Banderilleros). Se usa al
// crear un área y al editar la de una existente.
import React from 'react';
import { View, Text, StyleSheet, Switch, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AreaCampoExtra } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { a11y, t } from '@/src/i18n';

export interface AreaCapturaValor {
  capturaPersonal: boolean;
  capturaEquipo: boolean;
  capturaActividades: boolean;
  capturaObservaciones: boolean;
  camposExtra: AreaCampoExtra[];
}

export const MAX_CAMPOS_EXTRA = 20;

/** Campos con nombre (los vacíos se descartan al guardar). */
export function camposLimpios(campos: AreaCampoExtra[]): AreaCampoExtra[] {
  return campos
    .map((c) => ({ ...c, nombre: c.nombre.trim(), unidad: (c.unidad || '').trim() || null }))
    .filter((c) => c.nombre);
}

/** Primer problema que impide guardar los campos, o null. */
export function problemaCampos(campos: AreaCampoExtra[]): string | null {
  const nombres = camposLimpios(campos).map((c) => c.nombre.toLowerCase());
  if (new Set(nombres).size !== nombres.length) return t('areas.campoRepetido');
  return null;
}

interface Props {
  value: AreaCapturaValor;
  onChange: (v: AreaCapturaValor) => void;
  disabled?: boolean;
}

export function AreaCapturaEditor({ value, onChange, disabled }: Props) {
  const { capturaPersonal, capturaEquipo, capturaActividades, capturaObservaciones, camposExtra } = value;

  const setCampo = (i: number, cambio: Partial<AreaCampoExtra>) =>
    onChange({ ...value, camposExtra: camposExtra.map((c, j) => (j === i ? { ...c, ...cambio } : c)) });
  const quitarCampo = (i: number) =>
    onChange({ ...value, camposExtra: camposExtra.filter((_, j) => j !== i) });
  const agregarCampo = () =>
    onChange({ ...value, camposExtra: [...camposExtra, { nombre: '', tipo: 'numero', unidad: null }] });

  return (
    <View>
      <Text style={styles.titulo}>{t('areas.queCapturaTitulo')}</Text>
      <Text style={styles.ayuda}>{t('areas.queCapturaAyuda')}</Text>

      <View style={styles.fila}>
        <Text style={styles.filaTxt}>{t('areas.capturaPersonal')}</Text>
        <Switch
          accessibilityLabel={t('areas.capturaPersonal')}
          value={capturaPersonal}
          onValueChange={(v) => onChange({ ...value, capturaPersonal: v })}
          disabled={disabled}
        />
      </View>
      <View style={styles.fila}>
        <Text style={styles.filaTxt}>{t('areas.capturaEquipo')}</Text>
        <Switch
          accessibilityLabel={t('areas.capturaEquipo')}
          value={capturaEquipo}
          onValueChange={(v) => onChange({ ...value, capturaEquipo: v })}
          disabled={disabled}
        />
      </View>

      <View style={styles.fila}>
        <Text style={styles.filaTxt}>{t('areas.capturaActividades')}</Text>
        <Switch
          accessibilityLabel={t('areas.capturaActividades')}
          value={capturaActividades}
          onValueChange={(v) => onChange({ ...value, capturaActividades: v })}
          disabled={disabled}
        />
      </View>
      <View style={styles.fila}>
        <Text style={styles.filaTxt}>{t('areas.capturaObservaciones')}</Text>
        <Switch
          accessibilityLabel={t('areas.capturaObservaciones')}
          value={capturaObservaciones}
          onValueChange={(v) => onChange({ ...value, capturaObservaciones: v })}
          disabled={disabled}
        />
      </View>

      <Text style={[styles.titulo, { marginTop: spacing.md }]}>{t('areas.camposExtraTitulo')}</Text>
      <Text style={styles.ayuda}>{t('areas.camposExtraAyuda')}</Text>

      {camposExtra.map((c, i) => (
        <View key={c.id || `nuevo-${i}`} style={styles.campo}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={c.nombre}
            onChangeText={(v) => setCampo(i, { nombre: v })}
            placeholder={t('areas.campoNombrePlaceholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('areas.campoNombre')}
            maxLength={60}
            editable={!disabled}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('areas.campoTipoCambiar', { tipo: c.tipo === 'numero' ? t('areas.tipoNumero') : t('areas.tipoTexto') })}
            onPress={() => setCampo(i, { tipo: c.tipo === 'numero' ? 'texto' : 'numero' })}
            disabled={disabled}
            style={styles.tipo}
            hitSlop={6}
          >
            <Text style={styles.tipoTxt}>{c.tipo === 'numero' ? t('areas.tipoNumero') : t('areas.tipoTexto')}</Text>
          </Pressable>
          {c.tipo === 'numero' ? (
            <TextInput
              style={[styles.input, styles.unidad]}
              value={c.unidad || ''}
              onChangeText={(v) => setCampo(i, { unidad: v })}
              placeholder={t('areas.campoUnidad')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('areas.campoUnidad')}
              maxLength={12}
              editable={!disabled}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={a11y('eliminar')}
            onPress={() => quitarCampo(i)}
            disabled={disabled}
            hitSlop={8}
            style={styles.quitar}
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      ))}

      {camposExtra.length < MAX_CAMPOS_EXTRA ? (
        <Pressable accessibilityRole="button" onPress={agregarCampo} disabled={disabled} style={styles.agregar}>
          <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.agregarTxt}>{t('areas.agregarCampo')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  titulo: { fontSize: 13, fontWeight: '800', color: colors.text },
  ayuda: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm, lineHeight: 17 },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, minHeight: 44 },
  filaTxt: { fontSize: 14, color: colors.text, fontWeight: '600', flex: 1, paddingRight: spacing.sm },
  campo: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10,
    height: 44, fontSize: 14, color: colors.text, backgroundColor: colors.surface,
  },
  unidad: { width: 72 },
  tipo: {
    height: 44, minWidth: 64, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  tipoTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  quitar: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  agregar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, minHeight: 44 },
  agregarTxt: { fontSize: 14, fontWeight: '700', color: colors.primary },
});
