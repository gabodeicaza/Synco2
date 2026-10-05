// Detalle de la cola offline de reportes: lista de pendientes/fallidos,
// boton de reintento manual y basurero por item para descartar uno que ya
// no se quiere reintentar (mismo patron de basurero-con-confirmacion que
// WorkforceTracker.tsx).
import React from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOfflineQueue } from '@/src/offline-queue-context';
import { QueuedReport } from '@/src/utils/offlineQueue';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { dayjs, CDMX_TZ } from '@/src/utils/tz';

function statusLabel(status: QueuedReport['status']): string {
  if (status === 'syncing') return 'Enviando...';
  if (status === 'failed') return 'Error _ revisa el detalle';
  return 'Esperando conexion';
}

export default function OfflineQueueDetailModal({
  visible, onClose,
}: { visible: boolean; onClose: () => void }) {
  const { items: reportes, customItems, isFlushing, flushNow, discardItem, discardCustomItem } = useOfflineQueue();

  // Reportes + registros de módulos personalizados, en una sola lista.
  const items = [
    ...reportes.map((r) => ({ ...r, kind: 'reporte' as const, titulo: r.payload?.title || 'Reporte sin nombre' })),
    ...customItems.map((r) => ({ ...r, kind: 'registro' as const, titulo: r.payload?.etiqueta || 'Registro de módulo' })),
  ];
  type Fila = (typeof items)[number];

  const onDiscard = (item: Fila) => {
    Alert.alert(
      item.kind === 'reporte' ? 'Descartar reporte' : 'Descartar registro',
      `¿Eliminar "${item.titulo}" de la cola? Se perdera permanentemente (no se envio al servidor).`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: () => (item.kind === 'reporte' ? discardItem(item.client_id) : discardCustomItem(item.client_id)),
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Pendientes de enviar ({items.length})</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          {items.length === 0 ? (
            <Text style={styles.emptyTxt}>No hay nada esperando conexion.</Text>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(it) => it.client_id}
              style={{ maxHeight: 380 }}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.titulo}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {dayjs(item.created_at).tz(CDMX_TZ).format('DD MMM YYYY, HH:mm')} {'_'} {statusLabel(item.status)}
                    </Text>
                    {item.status === 'failed' && item.last_error ? (
                      <Text style={styles.rowError} numberOfLines={2}>{item.last_error}</Text>
                    ) : null}
                  </View>
                  <Pressable onPress={() => onDiscard(item)} hitSlop={8} style={styles.trashBtn}>
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </Pressable>
                </View>
              )}
            />
          )}

          <Pressable
            onPress={flushNow}
            disabled={isFlushing || items.length === 0}
            style={[styles.retryBtn, (isFlushing || items.length === 0) && { opacity: 0.6 }]}
          >
            {isFlushing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="sync" size={16} color="#fff" />
            )}
            <Text style={styles.retryTxt}>Reintentar ahora</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.card },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
  },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  emptyTxt: { color: colors.textMuted, fontSize: 13, paddingVertical: 20, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  rowMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  rowError: { fontSize: 11, color: '#DC2626', marginTop: 2 },
  trashBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, paddingVertical: 12, borderRadius: radius.md, marginTop: 12,
  },
  retryTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
