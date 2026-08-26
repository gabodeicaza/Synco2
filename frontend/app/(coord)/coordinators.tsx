// SynCo v2.0 _ Gestion de Coordinadores Generales (solo coord_general puede acceder)
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError, type User } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { colors, radius, spacing, shadow } from '@/src/theme';
import { fmtDateCDMX } from '@/src/utils/tz';

function formatDate(iso?: string | null): string {
  return fmtDateCDMX(iso);
}

export default function CoordinatorsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [list, setList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listCoordinators();
      setList(data);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo cargar la lista');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setName('');
    setEmail('');
    setPassword('');
  }

  async function onSave() {
    const n = name.trim();
    const e = email.trim().toLowerCase();
    const p = password.trim();
    if (!n) return Alert.alert('Campo requerido', 'Ingresa el nombre');
    if (!e || !e.includes('@')) return Alert.alert('Email invalido', 'Ingresa un email valido');
    if (p.length < 6) return Alert.alert('Contrasena corta', 'Minimo 6 caracteres');
    setSaving(true);
    try {
      await api.createCoordinator({ name: n, email: e, password: p });
      Alert.alert(
        'Coordinador creado',
        `Se creo la cuenta para ${e}. Comparte la contrasena inicial de forma segura.`,
      );
      resetForm();
      setShowForm(false);
      await load();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        Alert.alert('Email duplicado', 'Ya existe un usuario con ese email.');
      } else {
        Alert.alert('Error', err?.message ?? 'No se pudo crear el coordinador');
      }
    } finally {
      setSaving(false);
    }
  }

  if (user?.role !== 'coordinador_general') {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Coordinadores</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.emptyCenter}>
          <Ionicons name="lock-closed-outline" size={42} color={colors.textMuted} />
          <Text style={styles.emptyTxt}>Solo un Coordinador General puede acceder a esta seccion.</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.flex, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Coordinadores Generales</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Gobernanza compartida</Text>
            <Text style={styles.infoTxt}>
              Cualquier Coordinador General puede crear nuevos Coordinadores. Una vez creado, el perfil es permanente
              (no se puede eliminar entre pares) y tiene acceso global a todos los proyectos.
            </Text>
          </View>
        </View>

        {!showForm && (
          <Pressable
            onPress={() => setShowForm(true)}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="person-add" size={18} color="#fff" />
            <Text style={styles.addBtnTxt}>Crear nuevo Coordinador General</Text>
          </Pressable>
        )}

        {showForm && (
          <View style={styles.formCard}>
            <View style={styles.formHeader}>
              <Text style={styles.formTitle}>Nuevo Coordinador General</Text>
              <Pressable onPress={() => { resetForm(); setShowForm(false); }} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <Text style={styles.label}>Nombre completo</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Ej. Maria Lopez"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.label}>Email corporativo</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="maria@empresa.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />

            <Text style={styles.label}>Contrasena inicial (min. 6 caracteres)</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="________"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              style={styles.input}
            />
            <Text style={styles.helper}>
              Comparte la contrasena inicial de forma segura. El nuevo Coordinador podra cambiarla despues.
            </Text>

            <Pressable
              onPress={onSave}
              disabled={saving}
              style={({ pressed }) => [
                styles.saveBtn,
                saving && { opacity: 0.7 },
                pressed && !saving && { opacity: 0.85 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.saveBtnTxt}>Crear Coordinador</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        <Text style={styles.sectionTitle}>Coordinadores actuales ({list.length})</Text>

        {loading ? (
          <View style={styles.centerLoader}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          list.map((c) => (
            <View key={c.id} style={styles.coordCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>{(c.name?.[0] || 'C').toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.coordName} numberOfLines={1}>
                  {c.name}
                  {c.id === user?.id ? '  (tu)' : ''}
                </Text>
                <Text style={styles.coordEmail} numberOfLines={1}>{c.email}</Text>
                <Text style={styles.coordMeta}>Alta: {formatDate(c.created_at)}</Text>
              </View>
              <View style={styles.badge}>
                <Ionicons name="shield-checkmark" size={12} color={colors.primary} />
                <Text style={styles.badgeTxt}>Coord Gral</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },

  infoCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: colors.primaryLight, padding: spacing.md, borderRadius: radius.lg,
  },
  infoTitle: { fontSize: 13, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  infoTxt: { fontSize: 12, color: colors.text, lineHeight: 17 },

  addBtn: {
    backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    ...shadow.card,
  },
  addBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },

  formCard: {
    backgroundColor: '#FFFFFF', borderRadius: radius.lg, padding: spacing.md, gap: 8,
    borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  formHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  formTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  label: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF',
    borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text,
  },
  helper: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  saveBtn: {
    backgroundColor: colors.primary, paddingVertical: 12, borderRadius: radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 10,
  },
  saveBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },

  sectionTitle: {
    fontSize: 11, fontWeight: '800', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8,
  },
  centerLoader: { paddingVertical: 30, alignItems: 'center' },
  coordCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: { color: '#fff', fontWeight: '900', fontSize: 17 },
  coordName: { fontSize: 14, fontWeight: '800', color: colors.text },
  coordEmail: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginTop: 1 },
  coordMeta: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.full,
  },
  badgeTxt: { fontSize: 10, fontWeight: '800', color: colors.primary },

  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: 10 },
  emptyTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center', maxWidth: 280 },
});
