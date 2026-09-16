// Auto-servicio: cualquier usuario (Coordinador, Sub-coordinador, Especialista)
// cambia su propia contraseña dando la actual — antes solo un Coordinador
// podia restablecerla (generando una temporal) desde Equipo/Invitaciones,
// sin que el propio usuario tuviera forma de elegir la suya. Ver
// POST /auth/change_password en server.py.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/components/Button';
import { api } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!current || !nueva || !confirmacion) {
      setError('Completa los tres campos');
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
      await api.changePassword(current, nueva);
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
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Cambiar contraseña</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.label}>Contraseña actual</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
            <TextInput
              value={current}
              onChangeText={setCurrent}
              placeholder="Tu contraseña actual"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPwd}
              style={styles.input}
              returnKeyType="next"
              editable={!busy}
            />
          </View>

          <Text style={[styles.label, { marginTop: spacing.md }]}>Nueva contraseña</Text>
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
            <Pressable onPress={() => setShowPwd((v) => !v)} hitSlop={8}>
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
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
