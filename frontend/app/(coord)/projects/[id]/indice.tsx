// Indice editable de los informes PDF/PowerPoint — exclusivo del Coordinador.
// Cada categoria (Diario/Semanal/Mensual) tiene su propio indice: titulo,
// orden de las secciones, titulos personalizados y secciones ocultas. El
// servidor aplica el orden de verdad al generar el PDF/PPTX y calcula los
// numeros de pagina sobre el documento final, asi que el indice nunca se
// desfasa. La lista de secciones sale del ultimo informe generado (o de
// "Actualizar estructura", que lo recalcula con los datos de hoy).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert, Switch, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, IndiceConfig, IndicePeriodo, IndiceSeccion, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import {
  INDICE_CONFIG_DEFAULT, INDICE_PERIODOS, alternarOculta, moverSeccion, renombrarSeccion,
  seccionesOrdenadas,
} from '@/src/utils/indice';

type Borrador = { config: IndiceConfig; estructura: IndiceSeccion[]; sucio: boolean };

export default function IndiceEditorScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';

  const [project, setProject] = useState<Project | null>(null);
  const [periodo, setPeriodo] = useState<IndicePeriodo>('diario');
  const [borradores, setBorradores] = useState<Partial<Record<IndicePeriodo, Borrador>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const actual = borradores[periodo];

  const cargar = useCallback(async (p: IndicePeriodo) => {
    try {
      setLoading(true);
      const r = await api.getIndiceConfig(pid, p);
      setBorradores((b) => ({ ...b, [p]: { config: r.config, estructura: r.estructura, sucio: false } }));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el indice.');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => {
    if (!pid) return;
    api.getProject(pid).then(setProject).catch(() => {});
  }, [pid]);

  // Carga cada periodo la primera vez que se abre; cambiar de pestana conserva
  // los cambios sin guardar de las demas.
  useEffect(() => {
    if (!pid) return;
    if (borradores[periodo]) { setLoading(false); return; }
    cargar(periodo);
  }, [pid, periodo, borradores, cargar]);

  function editar(fn: (c: IndiceConfig) => IndiceConfig) {
    setBorradores((b) => {
      const cur = b[periodo];
      if (!cur) return b;
      return { ...b, [periodo]: { ...cur, config: fn(cur.config), sucio: true } };
    });
  }

  async function guardar() {
    if (!actual) return;
    try {
      setSaving(true);
      const r = await api.putIndiceConfig(pid, periodo, actual.config);
      setBorradores((b) => ({ ...b, [periodo]: { ...actual, config: r.config, sucio: false } }));
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function actualizarEstructura() {
    if (!actual) return;
    try {
      setRefreshing(true);
      const r = await api.refreshIndiceEstructura(pid, periodo);
      setBorradores((b) => ({ ...b, [periodo]: { ...actual, estructura: r.estructura } }));
    } catch (e: any) {
      Alert.alert('No se pudo actualizar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setRefreshing(false);
    }
  }

  const secciones = useMemo(
    () => (actual ? seccionesOrdenadas(actual.estructura, actual.config) : []),
    [actual],
  );

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);
  const config = actual?.config ?? INDICE_CONFIG_DEFAULT;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Indice de informes</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.helpTxt}>
          El indice se inserta despues de la portada del PDF y del PowerPoint con los numeros de
          pagina reales. El orden que definas aqui es el orden en que quedan las secciones en el
          documento. Cada informe (Diario, Semanal, Mensual) tiene su propio indice.
        </Text>

        <View style={styles.tabs}>
          {INDICE_PERIODOS.map((p) => {
            const activo = p.value === periodo;
            return (
              <Pressable
                key={p.value}
                onPress={() => setPeriodo(p.value)}
                style={[styles.tab, activo && styles.tabActivo]}
              >
                <Text style={[styles.tabTxt, activo && styles.tabTxtActivo]}>
                  {p.label}{borradores[p.value]?.sucio ? ' •' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : !actual ? (
          <Pressable onPress={() => cargar(periodo)} style={{ alignItems: 'center', marginTop: spacing.xl }}>
            <Text style={styles.linkTxt}>No se pudo cargar. Toca para reintentar</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Incluir indice</Text>
                  <Text style={styles.rowSub}>Si lo apagas, el informe sale sin indice pero conserva el orden.</Text>
                </View>
                <Switch
                  value={config.enabled}
                  onValueChange={(v) => editar((c) => ({ ...c, enabled: v }))}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Titulo</Text>
                  <TextInput
                    value={config.titulo}
                    onChangeText={(t) => editar((c) => ({ ...c, titulo: t }))}
                    placeholder="INDICE"
                    placeholderTextColor={colors.textMuted}
                    maxLength={80}
                    style={styles.input}
                  />
                </View>
              </View>
            </View>

            <View style={styles.seccionesHead}>
              <Text style={styles.sectionTitle}>Secciones ({secciones.length})</Text>
              <Pressable onPress={actualizarEstructura} disabled={refreshing} hitSlop={8} style={styles.linkBtn}>
                {refreshing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <Ionicons name="refresh" size={16} color={colors.primary} />
                    <Text style={styles.linkTxt}>Actualizar estructura</Text>
                  </>
                )}
              </Pressable>
            </View>

            {secciones.length === 0 ? (
              <Text style={styles.empty}>
                Aun no hay secciones. Toca "Actualizar estructura" (o genera un informe) para listarlas.
              </Text>
            ) : (
              <View style={styles.card}>
                {secciones.map((s, idx) => {
                  const oculta = config.hidden.includes(s.key);
                  return (
                    <View key={s.key} style={[styles.secRow, idx > 0 && styles.rowBorder]}>
                      <Text style={styles.secNum}>{idx + 1}</Text>
                      <TextInput
                        value={config.titles[s.key] ?? ''}
                        onChangeText={(t) => editar((c) => renombrarSeccion(c, s.key, t))}
                        placeholder={s.title}
                        placeholderTextColor={colors.textMuted}
                        maxLength={200}
                        style={[styles.input, styles.secInput, oculta && { opacity: 0.45 }]}
                      />
                      <Pressable
                        onPress={() => editar((c) => alternarOculta(c, s.key))}
                        hitSlop={6}
                        style={styles.secBtn}
                        accessibilityLabel={oculta ? 'Mostrar en el indice' : 'Ocultar del indice'}
                      >
                        <Ionicons
                          name={oculta ? 'eye-off-outline' : 'eye-outline'}
                          size={20}
                          color={oculta ? colors.textMuted : colors.primary}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => editar((c) => moverSeccion(actual.estructura, c, s.key, -1))}
                        disabled={idx === 0}
                        hitSlop={6}
                        style={[styles.secBtn, idx === 0 && { opacity: 0.25 }]}
                        accessibilityLabel="Subir seccion"
                      >
                        <Ionicons name="chevron-up" size={20} color={colors.text} />
                      </Pressable>
                      <Pressable
                        onPress={() => editar((c) => moverSeccion(actual.estructura, c, s.key, 1))}
                        disabled={idx === secciones.length - 1}
                        hitSlop={6}
                        style={[styles.secBtn, idx === secciones.length - 1 && { opacity: 0.25 }]}
                        accessibilityLabel="Bajar seccion"
                      >
                        <Ionicons name="chevron-down" size={20} color={colors.text} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            <Pressable
              onPress={guardar}
              disabled={saving || !actual.sucio}
              style={[styles.saveBtn, (saving || !actual.sucio) && { opacity: 0.5 }]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveTxt}>{actual.sucio ? 'Guardar indice' : 'Sin cambios'}</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleBar: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  scroll: { padding: spacing.md },
  helpTxt: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.md, lineHeight: 18 },
  tabs: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 4,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.md },
  tabActivo: { backgroundColor: colors.primary },
  tabTxt: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  tabTxtActivo: { color: '#fff' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    ...shadow.card, marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10,
    paddingVertical: 8, fontSize: 14, color: colors.text, backgroundColor: colors.bg, marginTop: 6,
  },
  seccionesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: {
    fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkTxt: { fontSize: 13, fontWeight: '700', color: colors.primary },
  empty: { textAlign: 'center', color: colors.textMuted, fontStyle: 'italic', marginVertical: spacing.lg },
  secRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  secNum: { width: 24, textAlign: 'center', fontSize: 12, fontWeight: '800', color: colors.textMuted },
  secInput: { flex: 1, marginTop: 0 },
  secBtn: { width: 30, height: 32, alignItems: 'center', justifyContent: 'center' },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: 14, alignItems: 'center',
  },
  saveTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
