// SynCo v2.0 _ Canje de invitacion in-app.
// Permite al usuario pegar el token alfanumerico recibido por WhatsApp/correo,
// previsualizar a que proyecto/rol esta siendo invitado y crear su contrasena,
// todo sin salir de la app (sin abrir URLs externas).
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { Button } from '@/src/components/Button';
import { useAuth } from '@/src/auth-context';
import { api } from '@/src/api';
import { homeRouteForRole, roleLabel } from '@/src/utils/roles';
import { colors, radius, spacing } from '@/src/theme';
import { a11y } from '@/src/i18n';

type Stage = 'token' | 'password';

export default function RedeemInviteScreen() {
  const insets = useSafeAreaInsets();
  const { acceptInvite } = useAuth();

  const [stage, setStage] = useState<Stage>('token');
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [validating, setValidating] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const cleanToken = token.trim();

  async function pasteFromClipboard() {
    try {
      const s = await Clipboard.getStringAsync();
      if (s) setToken(s.trim());
    } catch {
      /* noop */
    }
  }

  async function validateToken() {
    if (!cleanToken) { setTokenError('Pega o escribe tu codigo de invitacion.'); return; }
    setTokenError(null);
    setValidating(true);
    try {
      const p = await api.invitePreview(cleanToken);
      setPreview(p);
      setStage('password');
    } catch (e: any) {
      setTokenError(e?.message || 'Codigo no valido o expirado. Pide uno nuevo a tu Coordinador.');
    } finally {
      setValidating(false);
    }
  }

  async function submitPassword() {
    setSubmitError(null);
    if (password.length < 6) { setSubmitError('La contrasena debe tener al menos 6 caracteres.'); return; }
    if (password !== password2) { setSubmitError('Las contrasenas no coinciden.'); return; }
    setBusy(true);
    try {
      const user = await acceptInvite(cleanToken, password);
      router.replace(homeRouteForRole(user.role) as any);
    } catch (e: any) {
      setSubmitError(e?.message || 'No se pudo completar el registro.');
    } finally {
      setBusy(false);
    }
  }

  function backToLogin() {
    router.replace('/(auth)/login');
  }
  function backToToken() {
    setStage('token');
    setPreview(null);
    setPassword('');
    setPassword2('');
    setSubmitError(null);
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')} onPress={stage === 'password' ? backToToken : backToLogin} hitSlop={10} style={styles.backIconBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.topTitle}>Unirme con codigo</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name={stage === 'token' ? 'mail-open-outline' : 'shield-checkmark'} size={28} color={colors.primary} />
          </View>
          <Text style={styles.heroTitle}>
            {stage === 'token' ? 'Pega tu codigo de invitacion' : '!Listo! Configura tu acceso'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {stage === 'token'
              ? 'Tu Coordinador te envio un codigo alfanumerico por WhatsApp o correo. Pegalo abajo para entrar.'
              : 'Crea una contrasena para acceder a tu cuenta.'}
          </Text>
        </View>

        {stage === 'token' ? (
          <View style={styles.card}>
            <Text style={styles.label}>Codigo de invitacion</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="key-outline" size={18} color={colors.textMuted} />
              <TextInput
                value={token}
                onChangeText={(t) => { setToken(t); setTokenError(null); }}
                placeholder="Ej. KX9P-3M2J-7B1V_"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!validating}
                style={[styles.input, { letterSpacing: 1 }]}
                returnKeyType="go"
                onSubmitEditing={validateToken}
                multiline
              />
            </View>
            <Pressable accessibilityRole="button" onPress={pasteFromClipboard} hitSlop={6} style={styles.pasteBtn}>
              <Ionicons name="clipboard-outline" size={14} color={colors.primary} />
              <Text style={styles.pasteText}>Pegar desde portapapeles</Text>
            </Pressable>

            {tokenError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.errorText}>{tokenError}</Text>
              </View>
            ) : null}

            <View style={{ height: spacing.md }} />
            <Button
              label={validating ? 'Validando_' : 'Validar codigo'}
              onPress={validateToken}
              loading={validating}
              disabled={!cleanToken || validating}
              fullWidth
              icon={<Ionicons name="arrow-forward" size={18} color="#fff" />}
            />
            <Pressable accessibilityRole="button" onPress={backToLogin} hitSlop={8} style={styles.linkRow}>
              <Text style={styles.linkText}>Volver a inicio de sesion</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <PreviewRow label="Proyecto" value={preview?.project_name || ''} icon="briefcase-outline" />
              <PreviewRow label="Tu rol" value={roleLabel(preview?.role)} icon="shield-outline" />
              <PreviewRow label="Tu correo" value={preview?.email || ''} icon="mail-outline" />
              <PreviewRow label="Tu nombre" value={preview?.name || ''} icon="person-outline" />
              {preview?.puesto ? <PreviewRow label="Puesto" value={preview.puesto} icon="hammer-outline" /> : null}
              {preview?.area_name ? <PreviewRow label="Area / Disciplina" value={preview.area_name} icon="layers-outline" /> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Crear contrasena</Text>
              <Text style={styles.label}>Nueva contrasena</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Minimo 6 caracteres"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPwd}
                  style={styles.input}
                  editable={!busy}
                />
                <Pressable accessibilityRole="button" accessibilityLabel={a11y(showPwd ? 'ocultarPassword' : 'mostrarPassword')} onPress={() => setShowPwd((v) => !v)} hitSlop={8}>
                  <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
                </Pressable>
              </View>

              <Text style={[styles.label, { marginTop: spacing.md }]}>Repetir contrasena</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
                <TextInput
                  value={password2}
                  onChangeText={setPassword2}
                  placeholder="Repite la contrasena"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPwd}
                  style={styles.input}
                  editable={!busy}
                  returnKeyType="go"
                  onSubmitEditing={submitPassword}
                />
              </View>

              {submitError ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={16} color={colors.error} />
                  <Text style={styles.errorText}>{submitError}</Text>
                </View>
              ) : null}

              <View style={{ height: spacing.md }} />
              <Button
                label="Aceptar invitacion y entrar"
                onPress={submitPassword}
                loading={busy}
                fullWidth
                icon={<Ionicons name="checkmark" size={18} color="#fff" />}
              />
              <Pressable accessibilityRole="button" onPress={backToToken} hitSlop={8} style={styles.linkRow}>
                <Text style={styles.linkText}>Usar otro codigo</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PreviewRow({ label, value, icon }: { label: string; value: string; icon: any }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={16} color={colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md, flexGrow: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  backIconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  topTitle: { fontSize: 15, fontWeight: '800', color: colors.text },

  hero: { alignItems: 'center', gap: 6, paddingVertical: spacing.md },
  heroIcon: {
    width: 64, height: 64, borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: { fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center' },
  heroSubtitle: { fontSize: 13, color: colors.textMuted, textAlign: 'center', maxWidth: 320, lineHeight: 19 },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  cardTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },

  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    paddingHorizontal: 12, backgroundColor: colors.surface,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text, minHeight: 22 },

  pasteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  pasteText: { color: colors.primary, fontWeight: '700', fontSize: 12 },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md, marginTop: spacing.sm },
  errorText: { color: colors.error, fontSize: 13, flex: 1, fontWeight: '600' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  rowValue: { fontSize: 14, color: colors.text, fontWeight: '700' },

  linkRow: { paddingVertical: 10, alignItems: 'center' },
  linkText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});
