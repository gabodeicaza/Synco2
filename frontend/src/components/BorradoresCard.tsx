// Acceso rápido a los borradores desde Inicio. Solo aparece si hay al menos uno.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth-context';
import { useBorradores } from '@/src/hooks/useBorradores';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { t } from '@/src/i18n';

export function BorradoresCard({ basePath }: { basePath: '/(subcoord)' | '/(spec)' }) {
  const { user } = useAuth();
  const { lista } = useBorradores(user?.id || '');
  if (lista.length === 0) return null;

  const resumen = lista.length === 1 ? t('borradores.tarjetaUno') : t('borradores.tarjetaVarios', { n: lista.length });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('borradores.tarjetaTitulo')}. ${resumen}`}
      onPress={() => router.push(`${basePath}/borradores` as any)}
      style={styles.card}
    >
      <View style={styles.icono}><Ionicons name="document-text-outline" size={22} color={colors.warning} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.titulo}>{t('borradores.tarjetaTitulo')}</Text>
        <Text style={styles.texto}>{resumen}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.md,
    backgroundColor: colors.warningBg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.warning,
    minHeight: 56, ...shadow.card,
  },
  icono: {
    width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  titulo: { fontSize: 14, fontWeight: '800', color: colors.text },
  texto: { fontSize: 12, color: colors.textBody, marginTop: 2 },
});
