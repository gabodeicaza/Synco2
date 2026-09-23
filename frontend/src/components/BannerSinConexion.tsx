// Banner global "Sin conexión" con reintento (T-03 / X-07). Se monta una vez en
// app/_layout.tsx y solo se pinta mientras el servidor no responde.
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@/src/i18n';
import { colors, spacing } from '@/src/theme';
import { useConectividad } from '@/src/utils/connectivity';

export function BannerSinConexion() {
  const insets = useSafeAreaInsets();
  const { enLinea, reintentando, reintentar } = useConectividad();
  if (enLinea) return null;

  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + 6 }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="cloud-offline-outline" size={18} color={colors.textInverse} />
      <View style={{ flex: 1 }}>
        <Text style={styles.titulo}>{t('red.sinConexion')}</Text>
        <Text style={styles.detalle}>{t('red.sinConexionDetalle')}</Text>
      </View>
      <Pressable
        onPress={reintentar}
        disabled={reintentando}
        style={styles.boton}
        accessibilityRole="button"
        accessibilityLabel={t('red.reintentar')}
        accessibilityState={{ disabled: reintentando, busy: reintentando }}
      >
        {reintentando ? (
          <ActivityIndicator size="small" color={colors.textInverse} />
        ) : (
          <Text style={styles.botonTxt}>{t('red.reintentar')}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.textBody, paddingHorizontal: spacing.md, paddingBottom: 8,
  },
  titulo: { color: colors.textInverse, fontSize: 13, fontWeight: '800' },
  detalle: { color: colors.textInverse, fontSize: 11, opacity: 0.9 },
  boton: {
    minWidth: 44, minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, borderWidth: 1, borderColor: colors.textInverse,
  },
  botonTxt: { color: colors.textInverse, fontSize: 12, fontWeight: '800' },
});
