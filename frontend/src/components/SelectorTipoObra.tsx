// Selector del tipo de obra (K-13 / T-10) para Nuevo proyecto: chips con nombre y descripción corta que
// salen del catálogo del servidor. Si el catálogo no carga, el formulario sigue funcionando con «Genérica».
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, TipoObraInfo } from '@/src/api';
import { InlineError } from '@/src/components/InlineError';
import { t } from '@/src/i18n';
import { colors, radius, spacing } from '@/src/theme';
import { TipoObraElegible } from '@/src/utils/tipoObraModulos';

export function SelectorTipoObra({
  value, onChange, disabled = false,
}: {
  value: TipoObraElegible;
  onChange: (tipo: TipoObraElegible) => void;
  disabled?: boolean;
}) {
  const [tipos, setTipos] = useState<TipoObraInfo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [falloCatalogo, setFalloCatalogo] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setFalloCatalogo(false);
    try {
      setTipos(await api.listTiposObra());
    } catch {
      setFalloCatalogo(true);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('tipoObra.titulo')}</Text>
      <Text style={styles.ayuda}>{t('tipoObra.ayuda')}</Text>

      {cargando ? (
        <View style={styles.cargando} accessibilityRole="progressbar" accessibilityLabel={t('tipoObra.cargando')}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.ayuda}>{t('tipoObra.cargando')}</Text>
        </View>
      ) : null}

      {falloCatalogo ? (
        <>
          <InlineError message={t('tipoObra.errorCatalogo')} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tipoObra.reintentar')}
            onPress={cargar}
            disabled={disabled}
            style={styles.reintentar}
          >
            <Ionicons name="refresh" size={16} color={colors.primary} />
            <Text style={styles.reintentarTxt}>{t('tipoObra.reintentar')}</Text>
          </Pressable>
        </>
      ) : null}

      <View style={styles.chips} accessibilityRole="radiogroup">
        {tipos.map((tipo) => {
          const activo = tipo.id === value;
          return (
            <Pressable
              key={tipo.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: activo, disabled }}
              accessibilityLabel={t('tipoObra.opcion', { nombre: tipo.nombre, descripcion: tipo.descripcion })}
              disabled={disabled}
              onPress={() => onChange(tipo.id)}
              style={[styles.chip, activo && styles.chipActivo]}
            >
              <Text style={[styles.chipNombre, activo && styles.chipNombreActivo]}>{tipo.nombre}</Text>
              <Text style={[styles.chipDescripcion, activo && styles.chipNombreActivo]}>{tipo.descripcion}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  ayuda: { fontSize: 12, color: colors.textMuted, marginBottom: 6 },
  cargando: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  chips: { gap: spacing.sm },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm,
    backgroundColor: colors.bg, minHeight: 44,
  },
  chipActivo: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipNombre: { fontSize: 14, fontWeight: '700', color: colors.text },
  chipNombreActivo: { color: colors.textInverse },
  chipDescripcion: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  reintentar: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: 4 },
  reintentarTxt: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});
