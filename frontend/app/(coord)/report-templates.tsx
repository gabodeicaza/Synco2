// Dirac · Gestion de Plantillas de Reporte (solo coordinador_general)
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { api, ApiError, ReportTemplate, ReportTemplateField } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { colors, radius, spacing, shadow } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { a11y, t } from '@/src/i18n';

const FIELD_TYPE_VALUES: ReportTemplateField['type'][] = ['string', 'number', 'boolean', 'select', 'multiselect'];

function tipoCampoLabel(value: ReportTemplateField['type']): string {
  switch (value) {
    case 'string': return t('plantillasReporte.tipoTexto');
    case 'number': return t('plantillasReporte.tipoNumero');
    case 'boolean': return t('plantillasReporte.tipoSiNo');
    case 'select': return t('plantillasReporte.tipoSeleccionUnica');
    default: return t('plantillasReporte.tipoSeleccionMultiple');
  }
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(new RegExp('[̀-ͯ]', 'g'), '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const emptyField = (): ReportTemplateField => ({ key: '', label: '', type: 'string', required: false, options: [] });

export default function ReportTemplatesScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [list, setList] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [fields, setFields] = useState<ReportTemplateField[]>([]);
  const [fieldDraft, setFieldDraft] = useState<ReportTemplateField>(emptyField());
  const [optionsText, setOptionsText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getReportTemplates();
      setList(data);
    } catch (e: any) {
      Alert.alert(t('plantillasReporte.error'), e?.message ?? t('plantillasReporte.noSeCargo'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setEditingId(null);
    setCode('');
    setName('');
    setCategory('');
    setFields([]);
    setFieldDraft(emptyField());
    setOptionsText('');
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
  }

  function startEdit(tpl: ReportTemplate) {
    setEditingId(tpl.id);
    setCode(tpl.code);
    setName(tpl.name);
    setCategory(tpl.category);
    setFields(tpl.fields.map((f) => ({ ...f })));
    setFieldDraft(emptyField());
    setOptionsText('');
    setShowForm(true);
  }

  function addField() {
    const label = fieldDraft.label.trim();
    if (!label) return Alert.alert(t('plantillasReporte.campoRequerido'), t('plantillasReporte.ingresaEtiqueta'));
    const key = slugify(fieldDraft.key || label);
    if (!key) return Alert.alert(t('plantillasReporte.claveInvalida'), t('plantillasReporte.claveVacia'));
    if (fields.some((f) => f.key === key)) return Alert.alert(t('plantillasReporte.claveDuplicada'), t('plantillasReporte.claveDuplicadaDetalle'));
    const needsOptions = fieldDraft.type === 'select' || fieldDraft.type === 'multiselect';
    const options = needsOptions ? optionsText.split(',').map((o) => o.trim()).filter(Boolean) : [];
    if (needsOptions && options.length === 0) {
      return Alert.alert(t('plantillasReporte.opcionesRequeridas'), t('plantillasReporte.opcionesDetalle'));
    }
    setFields([...fields, { key, label, type: fieldDraft.type, required: fieldDraft.required, options }]);
    setFieldDraft(emptyField());
    setOptionsText('');
  }

  function removeField(key: string) {
    setFields(fields.filter((f) => f.key !== key));
  }

  async function onSave() {
    const n = name.trim();
    const c = category.trim();
    if (!n) return Alert.alert(t('plantillasReporte.campoRequerido'), t('plantillasReporte.ingresaNombre'));
    if (!c) return Alert.alert(t('plantillasReporte.campoRequerido'), t('plantillasReporte.ingresaCategoria'));
    if (fields.length === 0) return Alert.alert(t('plantillasReporte.agregaCampos'), t('plantillasReporte.necesitaCampo'));
    setSaving(true);
    try {
      if (editingId) {
        await api.updateReportTemplate(editingId, { name: n, category: c, fields });
      } else {
        const cd = slugify(code || n);
        if (!cd) { Alert.alert(t('plantillasReporte.codigoInvalido'), t('plantillasReporte.ingresaCodigo')); setSaving(false); return; }
        await api.createReportTemplate({ code: cd, name: n, category: c, fields });
      }
      resetForm();
      setShowForm(false);
      await load();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        Alert.alert(t('plantillasReporte.codigoDuplicado'), t('plantillasReporte.codigoDuplicadoDetalle'));
      } else {
        Alert.alert(t('plantillasReporte.error'), err?.message ?? t('plantillasReporte.noSeGuardo'));
      }
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(tpl: ReportTemplate) {
    const ok = await confirm(
      t('plantillasReporte.eliminarTitulo'),
      t('plantillasReporte.eliminarPregunta', { nombre: tpl.name }),
      { confirmText: t('plantillasReporte.eliminar'), destructive: true },
    );
    if (!ok) return;
    try {
      await api.deleteReportTemplate(tpl.id);
      await load();
    } catch (err: any) {
      Alert.alert(t('plantillasReporte.error'), err?.message ?? t('plantillasReporte.noSeElimino'));
    }
  }

  if (user?.role !== 'coordinador_general') {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <ScreenHeader title={t('plantillasReporte.titulo')} fallbackHref="/(coord)" safeArea={false} />
        <View style={styles.emptyCenter}>
          <Ionicons name="lock-closed-outline" size={42} color={colors.textMuted} />
          <Text style={styles.emptyTxt}>{t('plantillasReporte.soloCoordinador')}</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.flex, { paddingTop: insets.top }]}
    >
      <ScreenHeader title={t('plantillasReporte.titulo')} fallbackHref="/(coord)" safeArea={false} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
      >
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>{t('plantillasReporte.formulariosDinamicos')}</Text>
            <Text style={styles.infoTxt}>{t('plantillasReporte.ayuda')}</Text>
          </View>
        </View>

        {!showForm && (
          <Pressable accessibilityRole="button" onPress={startCreate} style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="add-circle" size={18} color="#fff" />
            <Text style={styles.addBtnTxt}>{t('plantillasReporte.nueva')}</Text>
          </Pressable>
        )}

        {showForm && (
          <View style={styles.formCard}>
            <View style={styles.formHeader}>
              <Text style={styles.formTitle}>{editingId ? t('plantillasReporte.editar') : t('plantillasReporte.nueva')}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={() => { resetForm(); setShowForm(false); }} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <Text style={styles.label}>{t('plantillasReporte.nombre')}</Text>
            <TextInput
              value={name} onChangeText={setName}
              placeholder={t('plantillasReporte.nombreEjemplo')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.label}>{t('plantillasReporte.categoria')}</Text>
            <TextInput
              value={category} onChangeText={setCategory}
              placeholder={t('plantillasReporte.categoriaEjemplo')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            {!editingId && (
              <>
                <Text style={styles.label}>{t('plantillasReporte.codigoEtiqueta')}</Text>
                <TextInput
                  value={code} onChangeText={setCode}
                  placeholder={t('plantillasReporte.codigoEjemplo')}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  style={styles.input}
                />
              </>
            )}

            <Text style={[styles.sectionTitle, { marginTop: 14 }]}>{t('plantillasReporte.campos', { n: fields.length })}</Text>
            {fields.length === 0 ? (
              <Text style={styles.helper}>{t('plantillasReporte.sinCampos')}</Text>
            ) : (
              fields.map((f) => (
                <View key={f.key} style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{f.label}{f.required ? ' *' : ''}</Text>
                    <Text style={styles.fieldMeta}>
                      {tipoCampoLabel(f.type)} · {f.key}
                      {f.options?.length ? ` · ${f.options.join(', ')}` : ''}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} onPress={() => removeField(f.key)} hitSlop={8} style={{ padding: 4 }}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
              ))
            )}

            <View style={styles.fieldBuilder}>
              <Text style={styles.label}>{t('plantillasReporte.agregarCampo')}</Text>
              <TextInput
                value={fieldDraft.label}
                onChangeText={(v) => setFieldDraft({ ...fieldDraft, label: v })}
                placeholder={t('plantillasReporte.etiquetaEjemplo')}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
              <View style={styles.chipRow}>
                {FIELD_TYPE_VALUES.map((tipo) => (
                  <Pressable accessibilityRole="button"
                    key={tipo}
                    onPress={() => setFieldDraft({ ...fieldDraft, type: tipo })}
                    style={[styles.chip, fieldDraft.type === tipo && styles.chipActive]}
                  >
                    <Text style={[styles.chipTxt, fieldDraft.type === tipo && styles.chipTxtActive]}>{tipoCampoLabel(tipo)}</Text>
                  </Pressable>
                ))}
              </View>
              {(fieldDraft.type === 'select' || fieldDraft.type === 'multiselect') && (
                <TextInput
                  value={optionsText} onChangeText={setOptionsText}
                  placeholder={t('plantillasReporte.opcionesEjemplo')}
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
              )}
              <Pressable accessibilityRole="button"
                onPress={() => setFieldDraft({ ...fieldDraft, required: !fieldDraft.required })}
                style={[styles.chip, fieldDraft.required && styles.chipActive, { alignSelf: 'flex-start' }]}
              >
                <Text style={[styles.chipTxt, fieldDraft.required && styles.chipTxtActive]}>{t('plantillasReporte.obligatorio')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={addField} style={({ pressed }) => [styles.addFieldBtn, pressed && { opacity: 0.85 }]}>
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={styles.addFieldBtnTxt}>{t('plantillasReporte.agregarCampo')}</Text>
              </Pressable>
            </View>

            <Pressable accessibilityRole="button"
              onPress={onSave}
              disabled={saving}
              style={({ pressed }) => [styles.saveBtn, saving && { opacity: 0.7 }, pressed && !saving && { opacity: 0.85 }]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.saveBtnTxt}>{editingId ? t('plantillasReporte.guardarCambios') : t('plantillasReporte.crear')}</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        <Text style={styles.sectionTitle}>{t('plantillasReporte.actuales', { n: list.length })}</Text>

        {loading ? (
          <View style={styles.centerLoader}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          list.map((tpl) => (
            <View key={tpl.id} style={styles.tplCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.tplName}>{tpl.name}</Text>
                <Text style={styles.tplMeta}>
                  {tpl.fields.length === 1
                    ? t('plantillasReporte.metaUnCampo', { categoria: tpl.category, codigo: tpl.code })
                    : t('plantillasReporte.metaCampos', { categoria: tpl.category, n: tpl.fields.length, codigo: tpl.code })}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('editar')} onPress={() => startEdit(tpl)} hitSlop={8} style={{ padding: 6 }}>
                <Ionicons name="create-outline" size={20} color={colors.primary} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} onPress={() => onDelete(tpl)} hitSlop={8} style={{ padding: 6 }}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
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

  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  fieldMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  fieldBuilder: {
    marginTop: 10, padding: spacing.sm, borderRadius: radius.lg,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, gap: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTxtActive: { color: '#fff' },
  addFieldBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.primary, borderStyle: 'dashed',
  },
  addFieldBtnTxt: { color: colors.primary, fontWeight: '800', fontSize: 13 },

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
  tplCard: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  tplName: { fontSize: 14, fontWeight: '800', color: colors.text },
  tplMeta: { fontSize: 11, color: colors.textMuted, marginTop: 3 },

  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: 10 },
  emptyTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center', maxWidth: 280 },
});
