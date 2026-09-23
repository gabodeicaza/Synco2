// Pill flotante con el conteo de reportes esperando conexion. Se monta una
// vez por layout de rol (spec/subcoord) — no interfiere con el padding
// `insets.top` que cada pantalla ya maneja por su cuenta porque es absolute.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useOfflineQueue } from '@/src/offline-queue-context';
import { radius } from '@/src/theme';
import OfflineQueueDetailModal from './OfflineQueueDetailModal';

export default function OfflineQueueIndicator() {
  const insets = useSafeAreaInsets();
  const { pendingCount } = useOfflineQueue();
  const [open, setOpen] = useState(false);

  return (
    <>
      {pendingCount > 0 && (
        <Pressable accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={[styles.pill, { top: insets.top + 8 }]}
          hitSlop={8}
        >
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.pillTxt}>
            {pendingCount} pendiente{pendingCount > 1 ? 's' : ''}
          </Text>
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
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  pillTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
