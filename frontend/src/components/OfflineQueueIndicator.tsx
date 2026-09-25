// Pill flotante con el conteo de pendientes (reportes y avances) esperando
// conexion. Se monta una vez por layout de rol (coord/spec/subcoord) — no interfiere con el
// padding `insets.top` que cada pantalla ya maneja por su cuenta porque es absolute.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useOfflineQueue } from '@/src/offline-queue-context';
import { colors, radius } from '@/src/theme';
import { t } from '@/src/i18n';
import OfflineQueueDetailModal from './OfflineQueueDetailModal';

export default function OfflineQueueIndicator() {
  const insets = useSafeAreaInsets();
  const { pendingCount } = useOfflineQueue();
  const [open, setOpen] = useState(false);

  const texto = pendingCount === 1
    ? t('colaSinConexion.pendienteUno', { n: 1 })
    : t('colaSinConexion.pendienteVarios', { n: pendingCount });

  return (
    <>
      {pendingCount > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={texto}
          onPress={() => setOpen(true)}
          style={[styles.pill, { top: insets.top + 8 }]}
          hitSlop={8}
        >
          <Ionicons name="cloud-offline-outline" size={14} color={colors.text} />
          <Text style={styles.pillTxt}>{texto}</Text>
        </Pressable>
      )}
      <OfflineQueueDetailModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    right: 12,
    zIndex: 999,
    elevation: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.warning,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  pillTxt: { color: colors.text, fontSize: 12, fontWeight: '800' },
});
