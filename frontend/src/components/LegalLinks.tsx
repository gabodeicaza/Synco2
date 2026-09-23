// Enlaces a los Términos de uso y la Política de privacidad (Google Play y la
// App Store los piden visibles antes de crear la cuenta / iniciar sesión).
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { t } from '@/src/i18n';
import { colors, spacing } from '@/src/theme';
import { PaginaLegal, urlLegal } from '@/src/utils/appInfo';
import { showToast } from '@/src/utils/toast';

async function abrir(pagina: PaginaLegal) {
  try {
    await Linking.openURL(urlLegal(pagina));
  } catch {
    showToast(t('acercaDe.abrirEnlaceFallo'));
  }
}

export function LegalLinks() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>
        {t('legal.aceptacion')}{' '}
        <Text
          style={styles.link}
          onPress={() => abrir('terminos')}
          accessibilityRole="link"
          accessibilityLabel={t('legal.terminos')}
        >
          {t('legal.terminos')}
        </Text>{' '}
        {t('legal.y')}{' '}
        <Text
          style={styles.link}
          onPress={() => abrir('privacidad')}
          accessibilityRole="link"
          accessibilityLabel={t('legal.privacidad')}
        >
          {t('legal.privacidad')}
        </Text>
        .
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, paddingHorizontal: spacing.md },
  text: { fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
});
