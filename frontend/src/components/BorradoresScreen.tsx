// Lista de borradores del reporte "Nuevo": retomar uno o descartarlo.
import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth-context';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useBorradores } from '@/src/hooks/useBorradores';
import { BorradorResumen, eliminarBorrador, textoHace } from '@/src/utils/borradores';
import { confirm } from '@/src/utils/confirm';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { t, a11y } from '@/src/i18n';

export default function BorradoresScreen({ basePath }: { basePath: '/(subcoord)' | '/(spec)' }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userId = user?.id || '';
  const { lista, cargando } = useBorradores(userId);

  function abrir(b: BorradorResumen) {
    const params: Record<string, string> = { borrador_id: b.id, borrador_ts: String(Date.now()) };
    if (b.projectId) params.project_id = b.projectId;
    if (b.nodeId) params.node_id = b.nodeId;
    router.push({ pathname: `${basePath}/nuevo`, params } as any);
  }

  async function descartar(b: BorradorResumen) {
    const ok = await confirm(t('borradores.descartarTitulo'), t('borradores.descartarMensaje'), {
      confirmText: t('borradores.descartar'), destructive: true,
    });
    if (ok) await eliminarBorrador(userId, b.id);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title={t('borradores.titulo')} fallbackHref={basePath as any} />
      <FlatList
        data={lista}
        keyExtractor={(b) => b.id}
        contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + spacing.xl }]}
        ListHeaderComponent={lista.length > 0 ? <Text style={styles.intro}>{t('borradores.intro')}</Text> : null}
        ListEmptyComponent={cargando ? null : (
          <View style={styles.vacio}>
            <Ionicons name="document-text-outline" size={40} color={colors.textMuted} />
            <Text style={styles.vacioTitulo}>{t('borradores.vacioTitulo')}</Text>
            <Text style={styles.vacioTexto}>{t('borradores.vacioTexto')}</Text>
          </View>
        )}
        renderItem={({ item: b }) => (
          <View style={styles.fila}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${b.titulo || t('borradores.sinNombre')}. ${textoHace(b.actualizado)}`}
              onPress={() => abrir(b)}
              style={styles.cuerpo}
            >
              <Text style={styles.titulo} numberOfLines={1}>{b.titulo || t('borradores.sinNombre')}</Text>
              <Text style={styles.ubicacion} numberOfLines={1}>
                {b.ubicacion.length ? b.ubicacion.join(' › ') : t('borradores.sinUbicacion')}
              </Text>
              <Text style={styles.meta}>
                {textoHace(b.actualizado)}{b.fotos > 0 ? ` · ${t('borradores.fotos', { n: b.fotos })}` : ''}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${a11y('eliminar')}: ${b.titulo || t('borradores.sinNombre')}`}
              hitSlop={8}
              onPress={() => descartar(b)}
              style={styles.borrar}
            >
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  lista: { padding: spacing.md, gap: spacing.sm },
  intro: { fontSize: 13, color: colors.textBody, marginBottom: spacing.sm },
  fila: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  cuerpo: { flex: 1, padding: spacing.md, minHeight: 64 },
  titulo: { fontSize: 15, fontWeight: '800', color: colors.text },
  ubicacion: { fontSize: 12, color: colors.textBody, marginTop: 2 },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  borrar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  vacio: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  vacioTitulo: { fontSize: 16, fontWeight: '800', color: colors.text },
  vacioTexto: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
});
