import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Image, KeyboardAvoidingView, Platform, ScrollView, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/components/Button';
import { useAuth } from '@/src/auth-context';
import { homeRouteForRole, APP_BRAND, APP_TAGLINE } from '@/src/utils/roles';
import { colors, radius, spacing } from '@/src/theme';
import { t, a11y } from '@/src/i18n';
import { LegalLinks } from '@/src/components/LegalLinks';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!email.trim() || !password) {
      setError('Ingresa tu correo y contraseña');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await login(email.trim().toLowerCase(), password);
      router.replace(homeRouteForRole(user.role) as any);
    } catch (e: any) {
      setError(e?.message || 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brand}>
          <Image source={require('../../assets/images/dirac-logo.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brandName}>{APP_BRAND}</Text>
          <Text style={styles.brandTagline}>{APP_TAGLINE}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Iniciar sesión</Text>

          <Text style={styles.label}>Correo electrónico</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="nombre@empresa.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              returnKeyType="next"
              editable={!busy}
            />
          </View>

          <Text style={[styles.label, { marginTop: spacing.md }]}>Contraseña</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPwd}
              style={styles.input}
              returnKeyType="go"
              onSubmitEditing={onSubmit}
              editable={!busy}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={a11y(showPwd ? 'ocultarPassword' : 'mostrarPassword')} onPress={() => setShowPwd((v) => !v)} hitSlop={8}>
              <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          <Pressable accessibilityRole="button" onPress={() => router.push('/(auth)/forgot-password')} hitSlop={8} style={styles.forgotRow} disabled={busy}>
            <Text style={styles.forgotText}>¿Olvidaste tu contraseña?</Text>
          </Pressable>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={{ height: spacing.md }} />
          <Button label="Entrar" loading={busy} onPress={onSubmit} fullWidth />

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>o</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Canje de invitacion in-app */}
          <Pressable accessibilityRole="button"
            style={({ pressed }) => [styles.inviteBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/(auth)/redeem')}
            disabled={busy}
          >
            <View style={styles.inviteIcon}>
              <Ionicons name="key-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inviteTitle}>Tengo un código de invitación</Text>
              <Text style={styles.inviteSubtitle}>Pega aquí el token que te envió tu Coordinador.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </Pressable>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
            <Text style={styles.infoText}>
              {t('auth.accesoSoloInvitacion')}
            </Text>
          </View>

        </View>
        <LegalLinks />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, flexGrow: 1 },
  brand: { alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.lg },
  logo: { width: 96, height: 96 },
  brandName: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5, color: colors.primary, marginTop: spacing.sm },
  brandTagline: { fontSize: 13, color: colors.textMuted, marginTop: 4, textAlign: 'center', maxWidth: 280 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    paddingHorizontal: 12, backgroundColor: colors.surface,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },
  forgotRow: { alignSelf: 'flex-end', paddingVertical: 8, marginTop: 4 },
  forgotText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md, marginTop: spacing.md },
  errorText: { color: colors.error, fontSize: 13, flex: 1, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: spacing.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight + '40',
  },
  inviteIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  inviteTitle: { fontSize: 14, fontWeight: '800', color: colors.primary },
  inviteSubtitle: { fontSize: 11, color: colors.textBody, marginTop: 2 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: spacing.md, padding: 10, backgroundColor: colors.primaryLight + '55', borderRadius: radius.md },
  infoText: { flex: 1, fontSize: 12, color: colors.textBody, lineHeight: 18 },
});
