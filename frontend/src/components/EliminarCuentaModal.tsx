// Confirmación de "Eliminar mi cuenta": exige la contraseña y muestra el error
// junto al campo (Alert.alert no funciona en web). El borrado real es el
// endpoint POST /auth/delete_account, que anonimiza al usuario en el servidor.
import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { Button } from '@/src/components/Button';
import { InlineError } from '@/src/components/InlineError';
import { t } from '@/src/i18n';
import { colors, radius, spacing } from '@/src/theme';
import { esErrorDeRed } from '@/src/utils/errores';
import { showToast } from '@/src/utils/toast';

export function EliminarCuentaModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { logout } = useAuth();
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function cerrar() {
    if (busy) return;
    setPassword('');
    setError(null);
    setVerPassword(false);
    onClose();
  }

  async function onConfirmar() {
    if (busy) return;
    if (!password) {
      setError(t('cuenta.eliminarPasswordVacia'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      await logout();
      router.replace('/(auth)/login');
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setError(e?.message || t('errores.solicitudInvalida'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cerrar}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.iconWrap}>
            <Ionicons name="warning" size={28} color={colors.error} />
          </View>
          <Text style={styles.title} accessibilityRole="header">{t('cuenta.eliminarTitulo')}</Text>
          <Text style={styles.body}>{t('cuenta.eliminarAviso')}</Text>

          <Text style={styles.label}>{t('cuenta.eliminarPassword')}</Text>
          <View style={[styles.inputWrap, error ? styles.inputError : null]}>
            <TextInput
              value={password}
              onChangeText={(v) => { setPassword(v); if (error) setError(null); }}
              secureTextEntry={!verPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              style={styles.input}
              returnKeyType="go"
              onSubmitEditing={onConfirmar}
              accessibilityLabel={t('cuenta.eliminarPassword')}
            />
            <Pressable
              onPress={() => setVerPassword((v) => !v)}
              hitSlop={8}
              style={styles.eye}
              accessibilityRole="button"
              accessibilityLabel={verPassword ? t('cuenta.ocultarPassword') : t('cuenta.mostrarPassword')}
            >
              <Ionicons name={verPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <InlineError message={error} style={{ marginTop: spacing.sm }} />

          <View style={styles.actions}>
            <Button label={t('cuenta.cancelar')} variant="secondary" onPress={cerrar} disabled={busy} style={{ flex: 1 }} />
            <Button label={t('cuenta.eliminarConfirmar')} variant="danger" onPress={onConfirmar} loading={busy} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: 6 },
  iconWrap: { alignSelf: 'center', width: 52, height: 52, borderRadius: 26, backgroundColor: colors.errorBg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  body: { fontSize: 13, color: colors.textMuted, lineHeight: 19, textAlign: 'center', marginBottom: spacing.sm },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 12 },
  inputError: { borderColor: colors.error },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },
  eye: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
});
