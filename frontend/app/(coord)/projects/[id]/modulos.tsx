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
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { api, ModulosConfig, ModuloCategoria, Project, TipoObraInfo } from '@/src/api';
import { InlineError } from '@/src/components/InlineError';
import { t } from '@/src/i18n';
import { confirm } from '@/src/utils/confirm';
import { showToast } from '@/src/utils/toast';
import { esErrorDeRed } from '@/src/utils/errores';
import { moduloPayloadRecomendado, nombreTipoObra, puedeRestablecerModulos } from '@/src/utils/tipoObraModulos';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { MODULOS, CATEGORIA_LABEL, CATEGORIA_ORDEN } from '@/src/utils/modulos';

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
  const [tipos, setTipos] = useState<TipoObraInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restableciendo, setRestableciendo] = useState(false);

  const load = useCallback(async () => {
    if (!pid) return;
    try {
      setLoading(true);
      setError(null);
      const p = await api.getProject(pid);
      setProject(p);
      setDraft({ ...vacio(), ...(p.modulos || {}) });
      // El catálogo solo aporta los módulos recomendados y el nombre del tipo: si falla, la pantalla sigue.
      api.listTiposObra().then(setTipos).catch(() => setTipos([]));
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setError(e?.message || t('modulosObra.noSePudoCargar'));
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

  async function onToggle(categoria: ModuloCategoria, key: string, value: boolean) {
    const previous = draft;
    // Optimista: refleja el cambio de inmediato, revierte si el guardado falla.
    setDraft((d) => ({ ...d, [categoria]: { ...d[categoria], [key]: value } }));
    setSaving(savingKey(categoria, key));
    setError(null);
    try {
      const upd = await api.setProjectModulos(pid, { [categoria]: { [key]: value } } as Partial<ModulosConfig>);
      setProject(upd);
      setDraft({ ...vacio(), ...(upd.modulos || {}) });
    } catch (e: any) {
      setDraft(previous);
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setError(e?.message || t('modulosObra.noSePudoGuardar'));
    } finally {
      setSaving(null);
    }
  }

  const tipoActual = project?.tipo_obra;
  const infoTipo = tipos.find((x) => x.id === tipoActual);
  const puedeRestablecer = puedeRestablecerModulos(tipoActual) && !!infoTipo;

  async function onRestablecer() {
    if (!infoTipo || restableciendo) return;
    const ok = await confirm(
      t('modulosObra.restablecerTitulo'),
      t('modulosObra.restablecerMensaje', { tipo: infoTipo.nombre }),
      { confirmText: t('modulosObra.restablecerConfirmar') },
    );
    if (!ok) return;
    setRestableciendo(true);
    setError(null);
    try {
      const upd = await api.setProjectModulos(pid, moduloPayloadRecomendado(infoTipo));
      setProject(upd);
      setDraft({ ...vacio(), ...(upd.modulos || {}) });
      showToast(t('modulosObra.restablecido'));
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      else setError(e?.message || t('modulosObra.noSePudoRestablecer'));
    } finally {
      setRestableciendo(false);
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
      <ScreenHeader
        title={t('modulosObra.titulo')}
        backgroundColor={headerColor}
        fallbackHref={{ pathname: '/(coord)/projects/[id]', params: { id: pid } }}
      />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.tipoCard}>
          <Text style={styles.rowTitle}>{t('modulosObra.tipoActual', { tipo: nombreTipoObra(tipoActual, tipos) })}</Text>
          <Text style={styles.rowSub}>{t('modulosObra.tipoActualAyuda')}</Text>
          {puedeRestablecer ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('modulosObra.restablecer')}
              accessibilityState={{ busy: restableciendo, disabled: restableciendo }}
              disabled={restableciendo}
              onPress={onRestablecer}
              style={styles.restablecerBtn}
            >
              {restableciendo ? <ActivityIndicator size="small" color={colors.primary} /> : (
                <Ionicons name="refresh" size={16} color={colors.primary} />
              )}
              <Text style={styles.restablecerTxt}>{t('modulosObra.restablecer')}</Text>
            </Pressable>
          ) : null}
        </View>

        <InlineError message={error} style={{ marginBottom: spacing.md }} />

        <Text style={styles.helpTxt}>{t('modulosObra.ayuda')}</Text>

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
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
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
  tipoCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  restablecerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: spacing.xs },
  restablecerTxt: { color: colors.primary, fontWeight: '700', fontSize: 13, flexShrink: 1 },
});
