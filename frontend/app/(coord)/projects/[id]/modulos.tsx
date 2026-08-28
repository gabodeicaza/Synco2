// Configuración de módulos (sistema Multi-Proyecto Modular) — exclusiva del
// Coordinador General. Enciende/apaga, por proyecto, las plantillas
// disponibles agrupadas por cadencia de captura (Diario/Semanal/Mensual).
// Un módulo apagado desaparece del menú hamburguesa de Sub-Coordinador y
// Especialista (ver src/components/HeaderMenu.tsx) y el backend rechaza
// escrituras a sus endpoints (ver _ensure_modulo_activo en server.py).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ModulosConfig, ModuloCategoria, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { MODULOS_CATALOG, CATEGORIA_LABEL, CATEGORIA_ORDEN } from '@/src/utils/modulos';

function vacio(): ModulosConfig {
  return { reportes_diarios: {}, reportes_semanales: {}, reportes_mensuales: {} };
}

export default function ModulosConfigScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // key en curso
  const [project, setProject] = useState<Project | null>(null);
  const [draft, setDraft] = useState<ModulosConfig>(vacio());

  const load = useCallback(async () => {
    if (!pid) return;
    try {
      setLoading(true);
      const p = await api.getProject(pid);
      setProject(p);
      setDraft({ ...vacio(), ...(p.modulos || {}) });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el proyecto.');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  async function onToggle(categoria: ModuloCategoria, key: string, value: boolean) {
    const previous = draft;
    // Optimista: refleja el cambio de inmediato, revierte si el guardado falla.
    setDraft((d) => ({ ...d, [categoria]: { ...d[categoria], [key]: value } }));
    setSaving(key);
    try {
      const upd = await api.setProjectModulos(pid, { [categoria]: { [key]: value } } as Partial<ModulosConfig>);
      setProject(upd);
      setDraft({ ...vacio(), ...(upd.modulos || {}) });
    } catch (e: any) {
      setDraft(previous);
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Módulos del proyecto</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.helpTxt}>
          Enciende las plantillas que este proyecto va a usar. Un módulo apagado desaparece del
          menú de Sub-Coordinador y Especialista.
        </Text>

        {CATEGORIA_ORDEN.map((categoria) => {
          const modulos = MODULOS_CATALOG[categoria];
          if (modulos.length === 0) return null;
          return (
            <View key={categoria} style={{ marginBottom: spacing.lg }}>
              <Text style={styles.sectionTitle}>{CATEGORIA_LABEL[categoria]}</Text>
              <View style={styles.card}>
                {modulos.map((m, idx) => {
                  const value = !!draft[categoria]?.[m.key];
                  return (
                    <View key={m.key} style={[styles.row, idx > 0 && styles.rowBorder]}>
                      <Ionicons name={m.icon} size={20} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{m.label}</Text>
                        <Text style={styles.rowSub}>{m.subtitle}</Text>
                      </View>
                      {saving === m.key ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Switch
                          value={value}
                          onValueChange={(v) => onToggle(categoria, m.key, v)}
                          trackColor={{ false: colors.border, true: colors.primary }}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleBar: { fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  scroll: { padding: spacing.md },
  helpTxt: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.lg, lineHeight: 18 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
