// Encabezado estándar de pantalla (K-01): botón de regreso de al menos 44 pt, título,
// subtítulo opcional y una zona derecha para acciones. Todas las pantallas que no son
// una pestaña raíz lo usan, para que el regreso sea siempre el mismo (en iPhone no hay
// botón atrás del sistema) y para no repetir tres estilos de encabezado.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { a11y } from '@/src/i18n';
import { colors, contrastText, spacing } from '@/src/theme';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Sustituye la acción de regreso (p. ej. subir un nivel dentro de la misma pantalla). */
  onBack?: () => void;
  /** A dónde ir si no hay historial al que regresar (entrada directa por enlace). */
  fallbackHref?: Href;
  /** Oculta el botón de regreso (pestañas raíz). */
  showBack?: boolean;
  /** Acciones a la derecha (botones de ícono, menú). */
  right?: React.ReactNode;
  /** Fondo del encabezado (p. ej. el color del proyecto). El texto se ajusta para contrastar. */
  backgroundColor?: string;
  /** false si la pantalla ya reserva el área segura superior. */
  safeArea?: boolean;
  testID?: string;
}

export function ScreenHeader({
  title, subtitle, onBack, fallbackHref = '/', showBack = true, right, backgroundColor, safeArea = true, testID,
}: ScreenHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const fg = backgroundColor ? contrastText(backgroundColor) : colors.text;

  function volver() {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace(fallbackHref);
  }

  return (
    <View
      testID={testID}
      style={[
        styles.header,
        { backgroundColor: backgroundColor ?? colors.surface, paddingTop: (safeArea ? insets.top : 0) + spacing.xs },
      ]}
    >
      {showBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a11y('volver')}
          onPress={volver}
          hitSlop={8}
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={24} color={fg} />
        </Pressable>
      ) : null}
      <View style={styles.titles}>
        <Text accessibilityRole="header" style={[styles.title, { color: fg }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: fg }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  titles: { flex: 1 },
  title: { fontSize: 18, fontWeight: '800' },
  subtitle: { fontSize: 12, opacity: 0.8, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});

export default ScreenHeader;
