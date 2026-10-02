// Configuración de módulos (sistema Multi-Proyecto Modular) — exclusiva del
// Coordinador General. Cada plantilla tiene un interruptor INDEPENDIENTE en
// cada una de las 3 categorías de informe (Diario/Semanal/Mensual): no es
// "en qué cadencia vive el módulo" sino "en cuáles informes exportados
// quiero ver el recuento de sus actividades" — un módulo puede aparecer en
// más de uno, o en ninguno.
// El módulo se considera activo (aparece en el menú hamburguesa de
// Sub-Coordinador/Especialista y admite captura, ver
// src/utils/modulos.ts#moduloActivo) si tiene AL MENOS UN interruptor
// encendido en cualquiera de las 3 categorías; el backend rechaza
// escrituras si ninguno lo está (ver _ensure_modulo_activo en server.py).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert, Switch, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, Area, ModulosConfig, ModuloCategoria, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { MODULOS, CATEGORIA_LABEL, CATEGORIA_ORDEN, ModuloDef } from '@/src/utils/modulos';

function vacio(): ModulosConfig {
  return { reportes_diarios: {}, reportes_semanales: {}, reportes_mensuales: {} };
}

function savingKey(categoria: ModuloCategoria, key: string): string {
  return `${categoria}:${key}`;
}

export default function ModulosConfigScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // `${categoria}:${key}` en curso
  const [project, setProject] = useState<Project | null>(null);
  const [draft, setDraft] = useState<ModulosConfig>(vacio());
  const [areas, setAreas] = useState<Area[]>([]);
  const [asignaciones, setAsignaciones] = useState<Record<string, string>>({});
  const [elegir, setElegir] = useState<ModuloDef | null>(null); // módulo cuyo área se está eligiendo
  const [savingArea, setSavingArea] = useState(false);

  const load = useCallback(async () => {
    if (!pid) return;
    try {
      setLoading(true);
      const [p, a] = await Promise.all([api.getProject(pid), api.listAreas(pid).catch(() => [] as Area[])]);
      setProject(p);
      setAreas(a);
      setAsignaciones(p.modulos_areas || {});
      setDraft({ ...vacio(), ...(p.modulos || {}) });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el proyecto.');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  async function onToggle(categoria: ModuloCategoria, key: string, value: boolean) {
    const previous = draft;
    // Optimista: refleja el cambio de inmediato, revierte si el guardado falla.
    setDraft((d) => ({ ...d, [categoria]: { ...d[categoria], [key]: value } }));
    setSaving(savingKey(categoria, key));
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

  async function asignarArea(m: ModuloDef, areaId: string | null) {
    setSavingArea(true);
    try {
      const upd = await api.setProjectModulosAreas(pid, { [m.key]: areaId });
      setProject(upd);
      setAsignaciones(upd.modulos_areas || {});
      setElegir(null);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSavingArea(false);
    }
  }

  const nombreArea = (m: ModuloDef) => areas.find((a) => a.id === asignaciones[m.key])?.name;
  const conPantalla = MODULOS.filter((m) => !!m.screen);

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
          Cada plantilla tiene un interruptor por informe: enciéndelo en Diario, Semanal y/o
          Mensual para indicar en cuáles quieres que aparezca el recuento de sus actividades al
          exportar. Con al menos uno encendido, la plantilla queda disponible para capturar datos
          y aparece en el menú de Sub-Coordinador y Especialista.
        </Text>

        <View style={{ marginBottom: spacing.lg }}>
          <Text style={styles.sectionTitle}>Área de cada módulo</Text>
          <Text style={styles.helpTxt}>
            Elige a qué área pertenece cada herramienta. Cuando Sub-Coordinadores y Especialistas abran
            el hub de Módulos verán primero las áreas y, al entrar a una, todas sus herramientas. Las
            que no tengan área aparecen en “General”.
          </Text>
          <View style={styles.card}>
            {conPantalla.map((m, idx) => {
              const nombre = nombreArea(m);
              return (
                <Pressable key={m.key} onPress={() => setElegir(m)} style={[styles.row, idx > 0 && styles.rowBorder]}>
                  <Ionicons name={m.icon} size={20} color={colors.primary} />
                  <Text style={[styles.rowTitle, { flex: 1 }]}>{m.label}</Text>
                  <Text style={[styles.areaChip, !nombre && { color: colors.textMuted, fontWeight: '600' }]} numberOfLines={1}>
                    {nombre || 'General'}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              );
            })}
          </View>
        </View>

        {CATEGORIA_ORDEN.map((categoria) => (
          <View key={categoria} style={{ marginBottom: spacing.lg }}>
            <Text style={styles.sectionTitle}>{CATEGORIA_LABEL[categoria]}</Text>
            <View style={styles.card}>
              {MODULOS.map((m, idx) => {
                const value = !!draft[categoria]?.[m.key];
                const key = savingKey(categoria, m.key);
                return (
                  <View key={m.key} style={[styles.row, idx > 0 && styles.rowBorder]}>
                    <Ionicons name={m.icon} size={20} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{m.label}</Text>
                      <Text style={styles.rowSub}>{m.subtitle}</Text>
                    </View>
                    {saving === key ? (
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
        ))}
      </ScrollView>

      <Modal visible={!!elegir} transparent animationType="fade" onRequestClose={() => setElegir(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setElegir(null)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Área de “{elegir?.label}”</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <Pressable disabled={savingArea} onPress={() => elegir && asignarArea(elegir, null)} style={styles.optRow}>
                <Text style={[styles.optTxt, !elegir || !asignaciones[elegir.key] ? styles.optSel : null]}>General (sin área)</Text>
              </Pressable>
              {areas.map((a) => (
                <Pressable key={a.id} disabled={savingArea} onPress={() => elegir && asignarArea(elegir, a.id)} style={[styles.optRow, styles.rowBorder]}>
                  <Text style={[styles.optTxt, elegir && asignaciones[elegir.key] === a.id ? styles.optSel : null]}>{a.name}</Text>
                </Pressable>
              ))}
              {areas.length === 0 ? (
                <Text style={styles.helpTxt}>Este proyecto aún no tiene áreas. Créalas primero en la configuración de áreas del proyecto.</Text>
              ) : null}
            </ScrollView>
            {savingArea ? <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.primary} /> : null}
          </Pressable>
        </Pressable>
      </Modal>
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
  areaChip: { maxWidth: 140, fontSize: 12, fontWeight: '800', color: colors.primary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  optRow: { paddingVertical: 14 },
  optTxt: { fontSize: 14, color: colors.text },
  optSel: { fontWeight: '800', color: colors.primary },
});
