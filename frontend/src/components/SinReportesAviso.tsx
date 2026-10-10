// Aviso en línea (no Alert.alert: en web no hace nada) cuando el periodo elegido para
// exportar no tiene reportes. Deja cambiar el periodo o exportar de todos modos.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/src/i18n';
import { colors, radius } from '@/src/theme';

export function SinReportesAviso({
  otros, onCambiarPeriodo, onExportarDeTodosModos,
}: {
  otros: number;
  onCambiarPeriodo: () => void;
  onExportarDeTodosModos: () => void;
}) {
  return (
    <View style={styles.caja} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View style={styles.fila}>
        <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
        <Text style={styles.titulo}>{t('exportar.sinReportesTitulo')}</Text>
      </View>
      <Text style={styles.texto}>
        {otros > 0 ? t('exportar.sinReportesSeveridad', { otros }) : t('exportar.sinReportes')}
      </Text>
      <View style={styles.acciones}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('exportar.cambiarPeriodo')}
          onPress={onCambiarPeriodo}
          style={[styles.boton, styles.botonPrimario]}
        >
          <Text style={styles.botonPrimarioTxt}>{t('exportar.cambiarPeriodo')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('exportar.exportarDeTodosModos')}
          onPress={onExportarDeTodosModos}
          style={[styles.boton, styles.botonSecundario]}
        >
          <Text style={styles.botonSecundarioTxt}>{t('exportar.exportarDeTodosModos')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caja: {
    backgroundColor: colors.warningBg, borderRadius: radius.md, padding: 12, gap: 8, marginTop: 8,
  },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titulo: { fontSize: 14, fontWeight: '800', color: colors.text, flex: 1 },
  texto: { fontSize: 13, color: colors.textBody, lineHeight: 18 },
  acciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  boton: { minHeight: 44, paddingHorizontal: 14, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  botonPrimario: { backgroundColor: colors.primary },
  botonPrimarioTxt: { color: colors.textInverse, fontWeight: '800', fontSize: 13 },
  botonSecundario: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  botonSecundarioTxt: { color: colors.text, fontWeight: '700', fontSize: 13 },
});
