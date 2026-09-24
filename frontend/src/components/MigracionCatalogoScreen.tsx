// Migración C-01 (solo Coordinador General): reorganiza catálogos que quedaron planos.
// Un proyecto a la vez, con vista previa y confirmación; se puede deshacer. Cablebús
// Línea 4 aparece marcado y el servidor se niega a tocarlo.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, MigracionCatalogoItem, MigracionCatalogoVistaPrevia } from '@/src/api';
import { Button } from '@/src/components/Button';
import { InlineError } from '@/src/components/InlineError';
import { a11y, t } from '@/src/i18n';
import { colors, radius, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { esErrorDeRed } from '@/src/utils/errores';
import { showToast } from '@/src/utils/toast';

export default function MigracionCatalogoScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<MigracionCatalogoItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [vista, setVista] = useState<{ item: MigracionCatalogoItem; datos: MigracionCatalogoVistaPrevia } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setError(null);
      setItems(await api.migracionCatalogoLista());
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setError(e?.message || t('errores.solicitudInvalida'));
      setItems([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function verCambios(item: MigracionCatalogoItem) {
    setOcupado(item.project_id);
    try {
      setVista({ item, datos: await api.migracionCatalogoVistaPrevia(item.project_id) });
    } catch (e: any) {
      setError(e?.message || t('errores.solicitudInvalida'));
    } finally {
      setOcupado(null);
    }
  }

  async function aplicar(item: MigracionCatalogoItem) {
    const ok = await confirm(
      `${t('migracion.confirmarTitulo')}: ${item.nombre}`,
      t('migracion.confirmarCuerpo', { partidas: item.partidas_a_crear, conceptos: item.conceptos_a_mover }),
      { confirmText: t('migracion.aplicar') },
    );
    if (!ok) return;
    setOcupado(item.project_id);
    try {
      const r = await api.migracionCatalogoAplicar(item.project_id);
      showToast(t('migracion.hecho', { partidas: r.partidas_creadas, conceptos: r.conceptos_reubicados }));
      setVista(null);
      await cargar();
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setError(e?.message || t('errores.solicitudInvalida'));
    } finally {
      setOcupado(null);
    }
  }

  async function deshacer(item: MigracionCatalogoItem) {
    const ok = await confirm(`${t('migracion.deshacer')}: ${item.nombre}`, t('migracion.confirmarDeshacer'), { confirmText: t('migracion.deshacer'), destructive: true });
    if (!ok) return;
    setOcupado(item.project_id);
    try {
      const r = await api.migracionCatalogoRevertir(item.project_id);
      showToast(t('migracion.deshecho', { conceptos: r.conceptos_restaurados }));
      await cargar();
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setError(e?.message || t('errores.solicitudInvalida'));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')} onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">{t('migracion.titulo')}</Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.intro}>{t('migracion.intro')}</Text>
        <InlineError message={error} />
        {items === null ? <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} accessibilityLabel={t('migracion.cargando')} /> : null}
        {items && items.length === 0 ? <Text style={styles.intro}>{t('migracion.vacio')}</Text> : null}
        {items?.map((it) => {
          const hayCambios = it.partidas_a_crear > 0 || it.conceptos_a_mover > 0;
          const aplicada = it.ultima_migracion?.estado === 'aplicada';
          return (
            <View key={it.project_id} style={[styles.card, it.excluido && styles.cardExcluida]}>
              <Text style={styles.nombre} numberOfLines={2}>{it.nombre}</Text>
              {it.excluido ? (
                <Text style={styles.excluido}>{t('migracion.excluido')}</Text>
              ) : (
                <>
                  <Text style={styles.detalle}>
                    {hayCambios ? t('migracion.resumen', { partidas: it.partidas_a_crear, conceptos: it.conceptos_a_mover }) : t('migracion.sinCambios')}
                  </Text>
                  {it.ultima_migracion ? (
                    <Text style={styles.detalle}>
                      {it.ultima_migracion.estado === 'aplicada' ? t('migracion.aplicada') : it.ultima_migracion.estado === 'revertida' ? t('migracion.revertida') : it.ultima_migracion.estado}
                    </Text>
                  ) : null}
                  <View style={styles.acciones}>
                    {hayCambios ? (
                      <Button label={t('migracion.verCambios')} variant="secondary" onPress={() => verCambios(it)} loading={ocupado === it.project_id} style={{ flex: 1 }} />
                    ) : null}
                    {aplicada ? (
                      <Button label={t('migracion.deshacer')} variant="secondary" onPress={() => deshacer(it)} disabled={ocupado === it.project_id} style={{ flex: 1 }} />
                    ) : null}
                  </View>
                </>
              )}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={!!vista} transparent animationType="fade" onRequestClose={() => setVista(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modal} accessibilityViewIsModal>
            <Text style={styles.nombre} accessibilityRole="header">{vista?.item.nombre}</Text>
            <Text style={styles.detalle}>{vista?.datos.nota || t('migracion.nota')}</Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {vista?.datos.partidas_a_crear.map((n) => (
                <Text key={n.clave} style={styles.fila}>
                  + {n.clave}{n.padre ? `  (dentro de ${n.padre})` : ''}
                </Text>
              ))}
              <Text style={[styles.detalle, { marginTop: spacing.sm }]}>
                {vista?.datos.conceptos_a_mover} conceptos se moverán a su partida.
              </Text>
            </ScrollView>
            <View style={styles.acciones}>
              <Button label="Cerrar" variant="secondary" onPress={() => setVista(null)} style={{ flex: 1 }} />
              <Button label={t('migracion.aplicar')} onPress={() => vista && aplicar(vista.item)} loading={!!vista && ocupado === vista.item.project_id} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, flex: 1, textAlign: 'center' },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },
  intro: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 6 },
  cardExcluida: { opacity: 0.6 },
  nombre: { fontSize: 15, fontWeight: '800', color: colors.text },
  detalle: { fontSize: 12, color: colors.textBody },
  excluido: { fontSize: 12, fontWeight: '800', color: colors.warning },
  acciones: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  modal: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: 6 },
  fila: { fontSize: 13, color: colors.text, paddingVertical: 2 },
});
