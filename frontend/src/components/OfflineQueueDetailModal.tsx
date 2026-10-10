// Detalle de la cola offline: reportes y registros de avance pendientes/fallidos,
// boton de reintento manual y basurero por item para descartar uno que ya
// no se quiere reintentar (con confirmacion multiplataforma: Alert.alert no
// hace nada en web).
import React from 'react';
import {
  ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Pendiente, useOfflineQueue } from '@/src/offline-queue-context';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { a11y, t } from '@/src/i18n';
import { fmtFechaHora } from '@/src/utils/fechas';
import { formatCantidad } from '@/src/utils/money';
import { confirm } from '@/src/utils/confirm';

function statusLabel(status: Pendiente['item']['status']): string {
  if (status === 'syncing') return t('colaSinConexion.enviando');
  if (status === 'failed') return t('colaSinConexion.conError');
  return t('colaSinConexion.esperando');
}

/** Titulo de una fila: el nombre del reporte, o "Registro de avance · cantidad". */
export function tituloDePendiente(p: Pendiente): string {
  const payload = (p.item.payload || {}) as Record<string, any>;
  if (p.tipo === 'avance') {
    const cantidad = payload.cantidad_ejecutada ? ` · ${formatCantidad(String(payload.cantidad_ejecutada))}` : '';
    return `${t('colaSinConexion.avance')}${cantidad}`;
  }
  if (p.tipo === 'registro') return payload.etiqueta || 'Registro de módulo';
  return payload.title || t('colaSinConexion.reporteSinNombre');
}

export default function OfflineQueueDetailModal({
  visible, onClose,
}: { visible: boolean; onClose: () => void }) {
  const { pendientes, isFlushing, flushNow, discardItem } = useOfflineQueue();

  const onDiscard = async (p: Pendiente) => {
    const ok = await confirm(
      t('colaSinConexion.descartarTitulo'),
      t('colaSinConexion.descartarMensaje', { nombre: tituloDePendiente(p) }),
      { confirmText: t('colaSinConexion.descartar'), destructive: true },
    );
    if (ok) await discardItem(p.item.client_id, p.tipo);
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('colaSinConexion.titulo', { n: pendientes.length })}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          {pendientes.length === 0 ? (
            <Text style={styles.emptyTxt}>{t('colaSinConexion.vacio')}</Text>
          ) : (
            <FlatList
              data={pendientes}
              keyExtractor={(p) => `${p.tipo}:${p.item.client_id}`}
              style={{ maxHeight: 380 }}
              renderItem={({ item: p }) => (
                <View style={styles.row}>
                  <Ionicons
                    name={p.tipo === 'avance' ? 'trending-up-outline' : p.tipo === 'registro' ? 'apps-outline' : 'document-text-outline'}
                    size={18}
                    color={colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{tituloDePendiente(p)}</Text>
                    <Text style={styles.rowMeta}>
                      {fmtFechaHora(p.item.created_at)} · {statusLabel(p.item.status)}
                    </Text>
                    {p.item.status === 'failed' && p.item.last_error ? (
                      <Text style={styles.rowError} numberOfLines={2}>{p.item.last_error}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${a11y('eliminar')}: ${tituloDePendiente(p)}`}
                    onPress={() => onDiscard(p)}
                    hitSlop={8}
                    style={styles.trashBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
              )}
            />
          )}

          <Pressable
            accessibilityRole="button"
            onPress={flushNow}
            disabled={isFlushing || pendientes.length === 0}
            style={[styles.retryBtn, (isFlushing || pendientes.length === 0) && { opacity: 0.6 }]}
          >
            {isFlushing ? (
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <Ionicons name="sync" size={16} color={colors.textInverse} />
            )}
            <Text style={styles.retryTxt}>{t('colaSinConexion.reintentar')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.card },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
  },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, flex: 1 },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  emptyTxt: { color: colors.textMuted, fontSize: 13, paddingVertical: 20, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  rowMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  rowError: { fontSize: 11, color: colors.error, marginTop: 2 },
  trashBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, minHeight: 44, borderRadius: radius.md, marginTop: 12,
  },
  retryTxt: { color: colors.textInverse, fontWeight: '800', fontSize: 13 },
});
