// "Olvidé mi contraseña" — para el usuario que ya no recuerda ninguna
// contraseña (a diferencia de src/components/ChangePasswordScreen.tsx, que
// pide la actual). Solo deja una SOLICITUD pendiente para que un
// Coordinador General la resuelva desde Perfil > Solicitudes de contraseña
// (ver POST /auth/forgot_password en server.py) — no cambia nada por sí sola.
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/components/Button';
import { api } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!email.trim()) {
      setError('Ingresa tu correo');
      return;
    }
    setBusy(true);
    try {
      await api.forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch (e: any) {
      setError(e?.message || 'No se pudo enviar la solicitud');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.replace('/(auth)/login')} hitSlop={10} style={styles.backIconBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.topTitle}>Olvidé mi contraseña</Text>
          <View style={{ width: 32 }} />
        </View>

        {sent ? (
          <View style={styles.card}>
            <View style={styles.sentIcon}>
              <Ionicons name="checkmark-circle" size={40} color={colors.primary} />
            </View>
            <Text style={styles.sentTitle}>Solicitud enviada</Text>
            <Text style={styles.sentBody}>
              Si el correo está registrado, tu Coordinador General verá la solicitud y te compartirá una
              contraseña nueva. Avísale que ya la mandaste para que la atienda.
            </Text>
            <View style={{ height: spacing.md }} />
            <Button label="Volver a inicio de sesión" onPress={() => router.replace('/(auth)/login')} fullWidth />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.heroSubtitle}>
              Escribe el correo con el que entras a SynCo. Le avisaremos a tu Coordinador General para que te
              genere una contraseña nueva — no necesitas recordar la anterior.
            </Text>
            <Text style={[styles.label, { marginTop: spacing.md }]}>Correo electrónico</Text>
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
                returnKeyType="go"
                onSubmitEditing={onSubmit}
                editable={!busy}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={{ height: spacing.md }} />
            <Button label="Enviar solicitud" loading={busy} onPress={onSubmit} fullWidth />
            <Pressable onPress={() => router.replace('/(auth)/login')} hitSlop={8} style={styles.linkRow}>
              <Text style={styles.linkText}>Volver a inicio de sesión</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md, flexGrow: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  backIconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  topTitle: { fontSize: 15, fontWeight: '800', color: colors.text },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  heroSubtitle: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },

  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    paddingHorizontal: 12, backgroundColor: colors.surface,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md, marginTop: spacing.md },
  errorText: { color: colors.error, fontSize: 13, flex: 1, fontWeight: '600' },

  linkRow: { paddingVertical: 10, alignItems: 'center' },
  linkText: { color: colors.primary, fontWeight: '700', fontSize: 13 },

  sentIcon: { alignItems: 'center', marginBottom: spacing.sm },
  sentTitle: { fontSize: 17, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 6 },
  sentBody: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
});
