import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/components/Button';
import { useAuth } from '@/src/auth-context';
import { api } from '@/src/api';
import { homeRouteForRole, roleLabel } from '@/src/utils/roles';
import { colors, radius, spacing } from '@/src/theme';
import { t, a11y } from '@/src/i18n';

export default function AcceptInviteScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useLocalSearchParams<{ token: string }>();
  const tok = (Array.isArray(token) ? token[0] : token) || '';
  const { acceptInvite } = useAuth();

  const [preview, setPreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!tok) { setPreviewError('Token de invitacion no valido'); setLoadingPreview(false); return; }
      try {
        const p = await api.invitePreview(tok);
        if (mounted) setPreview(p);
      } catch (e: any) {
        if (mounted) setPreviewError(e?.message || 'Invitacion no valida o expirada');
      } finally {
        if (mounted) setLoadingPreview(false);
      }
    })();
    return () => { mounted = false; };
  }, [tok]);

  async function onAccept() {
    setSubmitError(null);
    if (password.length < 6) { setSubmitError('La contrasena debe tener al menos 6 caracteres'); return; }
    if (password !== password2) { setSubmitError('Las contrasenas no coinciden'); return; }
    setBusy(true);
    try {
      const user = await acceptInvite(tok, password);
      router.replace(homeRouteForRole(user.role) as any);
    } catch (e: any) {
      setSubmitError(e?.message || 'No se pudo aceptar la invitacion');
    } finally {
      setBusy(false);
    }
  }

  if (loadingPreview) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.muted}>Validando invitacion_</Text>
      </View>
    );
  }

  if (previewError || !preview) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top + 24 }]}>
        <Ionicons name="close-circle" size={56} color={colors.error} />
        <Text style={styles.errorTitle}>Invitacion invalida</Text>
        <Text style={styles.muted}>{previewError || 'No se pudo cargar la invitacion.'}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.replace('/(auth)/login')} style={styles.linkBtn}>
          <Text style={styles.linkText}>Volver a inicio de sesion</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.header}>
          <Ionicons name="mail-open" size={48} color={colors.primary} />
          <Text style={styles.title}>{t('auth.bienvenida')}</Text>
          <Text style={styles.subtitle}>Has sido invitado a colaborar</Text>
        </View>

        <View style={styles.card}>
          <Row label="Proyecto" value={preview.project_name} icon="briefcase-outline" />
          <Row label="Tu rol" value={roleLabel(preview.role)} icon="shield-outline" />
          <Row label="Tu correo" value={preview.email} icon="mail-outline" />
          <Row label="Tu nombre" value={preview.name} icon="person-outline" />
          {preview.puesto ? <Row label="Puesto" value={preview.puesto} icon="hammer-outline" /> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Crear contrasena</Text>
          <Text style={styles.label}>Nueva contrasena</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
            <TextInput
              value={password} onChangeText={setPassword}
              placeholder="Minimo 6 caracteres" placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPwd} style={styles.input} editable={!busy}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={a11y(showPwd ? 'ocultarPassword' : 'mostrarPassword')} onPress={() => setShowPwd((v) => !v)} hitSlop={8}>
              <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          <Text style={[styles.label, { marginTop: spacing.md }]}>Repetir contrasena</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
            <TextInput
              value={password2} onChangeText={setPassword2}
              placeholder="________" placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPwd} style={styles.input} editable={!busy}
              onSubmitEditing={onAccept} returnKeyType="go"
            />
          </View>

          {submitError ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{submitError}</Text>
            </View>
          ) : null}

          <View style={{ height: spacing.md }} />
          <Button label="Aceptar invitacion y entrar" onPress={onAccept} loading={busy} fullWidth />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon: any }) {
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, gap: 12, backgroundColor: colors.bg },
  header: { alignItems: 'center', marginBottom: spacing.sm, gap: 6 },
  title: { fontSize: 22, fontWeight: '900', color: colors.text, marginTop: 8 },
  subtitle: { fontSize: 13, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  cardTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  rowValue: { fontSize: 14, color: colors.text, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 12, backgroundColor: colors.surface },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md, marginTop: spacing.md },
  errorText: { color: colors.error, fontSize: 13, flex: 1, fontWeight: '600' },
  errorTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 8 },
  muted: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  linkBtn: { marginTop: spacing.md, padding: 12 },
  linkText: { color: colors.primary, fontWeight: '700' },
});
