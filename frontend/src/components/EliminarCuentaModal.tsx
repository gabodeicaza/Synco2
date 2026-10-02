// Confirmación de "Eliminar mi cuenta": exige la contraseña y muestra el error
// junto al campo. El borrado real es POST /auth/delete_account, que anonimiza
// al usuario en el servidor (los reportes quedan firmados "Usuario eliminado").
import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { Button } from '@/src/components/Button';
import { colors, radius, spacing } from '@/src/theme';

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
      setError('Escribe tu contraseña para confirmar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      await logout();
      router.replace('/(auth)/login');
    } catch (e: any) {
      setError(e?.message || 'No se pudo eliminar la cuenta. Inténtalo de nuevo.');
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
          <Text style={styles.title} accessibilityRole="header">Eliminar mi cuenta</Text>
          <Text style={styles.body}>
            Se borrarán tu correo, nombre, teléfono y contraseña, y ya no podrás entrar. Los reportes y minutas que
            capturaste se conservan en el proyecto como «Usuario eliminado». Esta acción no se puede deshacer.
          </Text>

          <Text style={styles.label}>Tu contraseña</Text>
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
              accessibilityLabel="Tu contraseña"
            />
            <Pressable
              onPress={() => setVerPassword((v) => !v)}
              hitSlop={8}
              style={styles.eye}
              accessibilityRole="button"
              accessibilityLabel={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              <Ionicons name={verPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.actions}>
            <Button label="Cancelar" variant="secondary" onPress={cerrar} disabled={busy} style={{ flex: 1 }} />
            <Button label="Eliminar" variant="danger" onPress={onConfirmar} loading={busy} style={{ flex: 1 }} />
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
  errorText: { fontSize: 12, color: colors.error, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
});
