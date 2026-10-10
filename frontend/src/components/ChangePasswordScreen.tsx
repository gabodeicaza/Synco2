// Auto-servicio: cualquier usuario (Coordinador, Sub-coordinador, Especialista)
// cambia su propia contraseña estando autenticado, sin dar la actual — antes
// solo un Coordinador podia restablecerla (generando una temporal) desde
// Equipo/Invitaciones, sin que el propio usuario tuviera forma de elegir la
// suya. Ver POST /auth/change_password en server.py.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/components/Button';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { api } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { a11y } from '@/src/i18n';

export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!nueva || !confirmacion) {
      setError('Completa los dos campos');
      return;
    }
    if (nueva.length < 6) {
      setError('La nueva contraseña debe tener mínimo 6 caracteres');
      return;
    }
    if (nueva !== confirmacion) {
      setError('La confirmación no coincide con la nueva contraseña');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(nueva);
      Alert.alert('Listo', 'Tu contraseña se actualizó correctamente.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cambiar la contraseña');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenHeader title="Cambiar contraseña" />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.label}>Nueva contraseña</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="key-outline" size={18} color={colors.textMuted} />
            <TextInput
              value={nueva}
              onChangeText={setNueva}
              placeholder="Mínimo 6 caracteres"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPwd}
              style={styles.input}
              returnKeyType="next"
              editable={!busy}
            />
          </View>

          <Text style={[styles.label, { marginTop: spacing.md }]}>Confirmar nueva contraseña</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="key-outline" size={18} color={colors.textMuted} />
            <TextInput
              value={confirmacion}
              onChangeText={setConfirmacion}
              placeholder="Repite la nueva contraseña"
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

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={{ height: spacing.md }} />
          <Button label="Guardar nueva contraseña" loading={busy} onPress={onSubmit} fullWidth />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.lg, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    paddingHorizontal: 12, backgroundColor: colors.surface,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md, marginTop: spacing.md },
  errorText: { color: colors.error, fontSize: 13, flex: 1, fontWeight: '600' },
});
