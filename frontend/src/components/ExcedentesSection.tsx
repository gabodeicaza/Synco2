// Volumen excedente (A-02): lo ejecutado por encima de lo contratado. Es
// informativo (nunca bloquea la captura). Solo el Coordinador General autoriza o
// rechaza, y para autorizar debe indicar el convenio modificatorio u orden de
// cambio. Vive dentro del Dashboard EVM.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/src/components/Button';
import { InlineError } from '@/src/components/InlineError';
import { useAuth } from '@/src/auth-context';
import { api, EstatusAutorizacion, Excedente } from '@/src/api';
import { t } from '@/src/i18n';
import { colors, radius, spacing } from '@/src/theme';
import { esErrorDeRed } from '@/src/utils/errores';
import { formatCantidad, formatMoney } from '@/src/utils/money';
import { showToast } from '@/src/utils/toast';

export const ETIQUETA_ESTATUS: Record<EstatusAutorizacion, string> = {
  pendiente_autorizacion: 'Pendiente de autorización',
  autorizado: 'Autorizado',
  rechazado: 'Rechazado',
};

function colorEstatus(e: EstatusAutorizacion): string {
  return e === 'autorizado' ? colors.success : e === 'rechazado' ? colors.error : colors.warning;
}

export function ExcedentesSection({ projectId, onChanged }: { projectId: string; onChanged?: () => void }) {
  const { user } = useAuth();
  const esCoordGeneral = user?.role === 'coordinador_general';
  const [items, setItems] = useState<Excedente[] | null>(null);
  const [destino, setDestino] = useState<{ item: Excedente; estatus: EstatusAutorizacion } | null>(null);
  const [referencia, setReferencia] = useState('');
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setItems(await api.listExcedentes(projectId));
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      setItems([]);
    }
  }, [projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  function abrir(item: Excedente, estatus: EstatusAutorizacion) {
    setDestino({ item, estatus });
    setReferencia(item.referencia || '');
    setComentario(item.comentario || '');
    setError(null);
  }

  async function confirmar() {
    if (!destino || busy) return;
    if (destino.estatus === 'autorizado' && !referencia.trim()) {
      setError(t('excedentes.referenciaObligatoria'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setExcedenteEstatus(projectId, destino.item.concepto_id, {
        estatus: destino.estatus, referencia: referencia.trim() || undefined, comentario: comentario.trim() || undefined,
      });
      setDestino(null);
      await cargar();
      onChanged?.();
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setError(e?.message || t('errores.solicitudInvalida'));
    } finally {
      setBusy(false);
    }
  }

  if (items === null) return <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />;
  if (items.length === 0) return <Text style={styles.vacio}>{t('excedentes.vacio')}</Text>;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.nota}>{t('excedentes.nota')}</Text>
      {items.map((it) => (
        <View key={it.concepto_id} style={styles.card}>
          <View style={styles.fila}>
            <Text style={styles.clave} numberOfLines={2}>{it.clave} · {it.descripcion}</Text>
            <View style={[styles.chip, { borderColor: colorEstatus(it.estatus) }]}>
              <Text style={[styles.chipTxt, { color: colorEstatus(it.estatus) }]}>{ETIQUETA_ESTATUS[it.estatus]}</Text>
            </View>
          </View>
          <Text style={styles.detalle}>
            {t('excedentes.detalle', {
              ejecutado: formatCantidad(it.cantidad_ejecutada), contratado: formatCantidad(it.cantidad_contratada),
              excedente: formatCantidad(it.cantidad_excedente), unidad: it.unidad, importe: formatMoney(it.importe_excedente),
            })}
          </Text>
          {it.extraordinario ? <Text style={styles.extra}>{t('excedentes.extraordinario')}</Text> : null}
          {it.referencia ? <Text style={styles.detalle}>{t('excedentes.referencia')}: {it.referencia}</Text> : null}
          {esCoordGeneral ? (
            <View style={styles.acciones}>
              {it.estatus !== 'autorizado' ? (
                <Pressable
                  onPress={() => abrir(it, 'autorizado')} style={styles.accion} accessibilityRole="button"
                  accessibilityLabel={`${t('excedentes.autorizar')} ${it.clave}`}
                >
                  <Text style={styles.accionTxt}>{t('excedentes.autorizar')}</Text>
                </Pressable>
              ) : null}
              {it.estatus !== 'rechazado' ? (
                <Pressable
                  onPress={() => abrir(it, 'rechazado')} style={styles.accion} accessibilityRole="button"
                  accessibilityLabel={`${t('excedentes.rechazar')} ${it.clave}`}
                >
                  <Text style={styles.accionTxt}>{t('excedentes.rechazar')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ))}

      <Modal visible={!!destino} transparent animationType="fade" onRequestClose={() => !busy && setDestino(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modal} accessibilityViewIsModal>
            <Text style={styles.modalTitulo} accessibilityRole="header">
              {destino?.estatus === 'autorizado' ? t('excedentes.autorizarTitulo') : t('excedentes.rechazarTitulo')}
            </Text>
            <Text style={styles.detalle}>{destino?.item.clave} · {destino?.item.descripcion}</Text>
            <Text style={styles.etiqueta}>{t('excedentes.referenciaEtiqueta')}</Text>
            <TextInput
              value={referencia}
              onChangeText={(v) => { setReferencia(v); if (error) setError(null); }}
              placeholder={t('excedentes.referenciaPlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={[styles.input, error ? { borderColor: colors.error } : null]}
              editable={!busy}
              accessibilityLabel={t('excedentes.referenciaEtiqueta')}
            />
            <Text style={styles.etiqueta}>{t('excedentes.comentarioEtiqueta')}</Text>
            <TextInput value={comentario} onChangeText={setComentario} style={[styles.input, { minHeight: 56 }]} multiline editable={!busy} accessibilityLabel={t('excedentes.comentarioEtiqueta')} />
            <InlineError message={error} />
            <View style={styles.acciones}>
              <Button label={t('cuenta.cancelar')} variant="secondary" onPress={() => setDestino(null)} disabled={busy} style={{ flex: 1 }} />
              <Button label={t('excedentes.confirmar')} onPress={confirmar} loading={busy} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  vacio: { fontSize: 12, color: colors.textMuted },
  nota: { fontSize: 11, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 4 },
  fila: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  clave: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  chip: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  chipTxt: { fontSize: 10, fontWeight: '800' },
  detalle: { fontSize: 12, color: colors.textBody },
  extra: { fontSize: 11, color: colors.warning, fontWeight: '700' },
  acciones: { flexDirection: 'row', gap: 8, marginTop: 4 },
  accion: {
    minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primary,
  },
  accionTxt: { fontSize: 12, fontWeight: '800', color: colors.primary },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  modal: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: 6 },
  modalTitulo: { fontSize: 16, fontWeight: '800', color: colors.text },
  etiqueta: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
