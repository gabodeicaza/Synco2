// Módulo piloto "Seguridad e Higiene" (sistema Multi-Proyecto Modular).
// Dos secciones: registro de accidentes (Fecha, Mes, Trabajador, Contratista,
// Registro, Ubicación, Descripción, Foto y Seguimiento — el mismo formato que
// se imprime en el informe) y checklist de acciones preventivas/correctivas. Screen "dueña"
// de su propio header — mismo patrón que CatalogoConceptosScreen.tsx.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  api, SeguridadReporte, SeguridadChecklist, SeguridadChecklistItem, SeguridadTipoRegistro, SeguridadCruz, Project,
} from '@/src/api';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';

type Tab = 'reportes' | 'cruz' | 'checklist';
const CRUZ_CELDA = 30;                 // lado de cada casilla de la cruz (px)
const CRUZ_COLOR_FUTURO = '#A6A6A6';   // dias que aun no ocurren
const CRUZ_TEXTO_OSCURO = new Set<string>(['dano_propiedad', 'accidente_leve']);  // fondos claros

// 'AAAA-MM' del mes actual y desplazamiento de meses.
function mesActual(): string { return hoyISO().slice(0, 7); }
function mesDesplazado(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const TIPOS: { value: SeguridadTipoRegistro; label: string; color: string }[] = [
  { value: 'sin_accidentes', label: 'Sin accidentes', color: colors.success },
  { value: 'dano_propiedad', label: 'Daño a la propiedad', color: colors.warning },
  { value: 'incidente', label: 'Incidente', color: colors.warning },
  { value: 'accidente_leve', label: 'Accidente leve / primeros auxilios', color: colors.warning },
  { value: 'incapacitante', label: 'Incapacitante', color: colors.error },
  { value: 'grave', label: 'Grave', color: colors.error },
];
// Reportes anteriores al formato solo traen `severidad`.
const SEVERIDAD_LEGACY_COLOR: Record<string, string> = {
  leve: colors.success, moderado: colors.warning, grave: colors.error,
};
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre',
  'Octubre', 'Noviembre', 'Diciembre'];

function hoyISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Mes (en espanol) de una fecha AAAA-MM-DD; '' si aun no es una fecha valida.
function mesDe(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  const n = m ? parseInt(m[2], 10) : 0;
  return n >= 1 && n <= 12 ? MESES[n - 1] : '';
}

export default function SeguridadHigieneScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('reportes');
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [reportes, setReportes] = useState<SeguridadReporte[]>([]);
  const [checklists, setChecklists] = useState<SeguridadChecklist[]>([]);

  // === Reporte de accidente ===
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = alta nueva
  const [fechaDraft, setFechaDraft] = useState(hoyISO());
  const [trabajadorDraft, setTrabajadorDraft] = useState('');
  const [contratistaDraft, setContratistaDraft] = useState('');
  const [tipoDraft, setTipoDraft] = useState<SeguridadTipoRegistro>('accidente_leve');
  const [ubicacionDraft, setUbicacionDraft] = useState('');
  const [descripcionDraft, setDescripcionDraft] = useState('');
  const [seguimientoDraft, setSeguimientoDraft] = useState('');
  const [fotoDraft, setFotoDraft] = useState<string | null>(null);

  // === Cruz de Seguridad ===
  const [cruzMes, setCruzMes] = useState(mesActual());
  const [cruz, setCruz] = useState<SeguridadCruz | null>(null);
  const [cruzLoading, setCruzLoading] = useState(false);
  const [cruzExporting, setCruzExporting] = useState(false);

  const loadCruz = useCallback(async () => {
    if (!projectId) return;
    try {
      setCruzLoading(true);
      setCruz(await api.getSeguridadCruz(projectId, cruzMes));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar la Cruz de Seguridad.');
    } finally {
      setCruzLoading(false);
    }
  }, [projectId, cruzMes]);

  useEffect(() => { if (tab === 'cruz') loadCruz(); }, [tab, loadCruz]);

  async function onExportCruz() {
    try {
      setCruzExporting(true);
      const { blob, filename } = await api.downloadSeguridadCruzXlsx(projectId, cruzMes);
      await downloadBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e: any) {
      Alert.alert('No se pudo exportar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setCruzExporting(false);
    }
  }

  // === Checklist ===
  const [checklistDraft, setChecklistDraft] = useState<SeguridadChecklistItem[]>([]);
  const [itemDraft, setItemDraft] = useState('');
  const [tipoItemDraft, setTipoItemDraft] = useState<'preventiva' | 'correctiva'>('preventiva');
  const [checklistSaving, setChecklistSaving] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, reps, checks] = await Promise.all([
        api.getProject(projectId),
        api.listSeguridadReportes(projectId),
        api.listSeguridadChecklist(projectId),
      ]);
      setProject(proj);
      setReportes(reps);
      setChecklists(checks);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el módulo Seguridad e Higiene.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  function openForm(r?: SeguridadReporte) {
    setEditingId(r?.id ?? null);
    setFechaDraft(r?.fecha ?? hoyISO());
    setTrabajadorDraft(r?.trabajador ?? '');
    setContratistaDraft(r?.contratista ?? '');
    setTipoDraft(r?.tipo_registro ?? 'accidente_leve');
    setUbicacionDraft(r?.ubicacion ?? '');
    setDescripcionDraft(r?.descripcion ?? '');
    setSeguimientoDraft(r?.seguimiento ?? r?.acciones_tomadas ?? '');
    setFotoDraft(r?.images?.[0] ?? null);
    setFormOpen(true);
  }

  // Contratistas del proyecto (catalogo del Coordinador): se eligen con un toque.
  const contratistas = (project?.contratistas_list || []).filter(Boolean);

  async function onPickFoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permiso requerido', 'Habilita el acceso a fotos para adjuntar evidencia.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.5,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];
    const mime = asset.mimeType || 'image/jpeg';
    setFotoDraft(`data:${mime};base64,${asset.base64}`);
  }

  async function onSaveReporte() {
    if (!mesDe(fechaDraft)) {
      Alert.alert('Fecha inválida', 'Escribe la fecha como AAAA-MM-DD (ej. 2026-10-01).');
      return;
    }
    // "Sin accidentes" es un renglón válido sin descripción (día sin novedad).
    if (!descripcionDraft.trim() && tipoDraft !== 'sin_accidentes') {
      Alert.alert('Descripción requerida', 'Describe brevemente lo sucedido.');
      return;
    }
    try {
      setSaving(true);
      const body = {
        fecha: fechaDraft.trim(),
        trabajador: trabajadorDraft.trim() || null,
        contratista: contratistaDraft.trim() || null,
        tipo_registro: tipoDraft,
        ubicacion: ubicacionDraft.trim() || null,
        descripcion: descripcionDraft.trim(),
        seguimiento: seguimientoDraft.trim() || null,
        images: fotoDraft ? [fotoDraft] : [],
      };
      if (editingId) await api.updateSeguridadReporte(projectId, editingId, body);
      else await api.createSeguridadReporte(projectId, body);
      setFormOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  function addChecklistItem() {
    const t = itemDraft.trim();
    if (!t) return;
    setChecklistDraft((arr) => [...arr, { item: t, tipo: tipoItemDraft, cumplido: false, notas: null }]);
    setItemDraft('');
  }

  function toggleChecklistItem(idx: number) {
    setChecklistDraft((arr) => arr.map((it, i) => (i === idx ? { ...it, cumplido: !it.cumplido } : it)));
  }

  function removeChecklistItem(idx: number) {
    setChecklistDraft((arr) => arr.filter((_, i) => i !== idx));
  }

  async function onSaveChecklist() {
    if (checklistDraft.length === 0) {
      Alert.alert('Checklist vacío', 'Agrega al menos un elemento antes de guardar.');
      return;
    }
    try {
      setChecklistSaving(true);
      await api.createSeguridadChecklist(projectId, { items: checklistDraft });
      setChecklistDraft([]);
      await load();
      Alert.alert('Guardado', 'El checklist del día se guardó correctamente.');
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setChecklistSaving(false);
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
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Seguridad e Higiene</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.tabRow}>
          <Pressable onPress={() => setTab('reportes')} style={[styles.tabBtn, tab === 'reportes' && styles.tabBtnActive]}>
            <Text style={[styles.tabTxt, { color: tab === 'reportes' ? headerColor : headerTextColor }]}>Reportes</Text>
          </Pressable>
          <Pressable onPress={() => setTab('cruz')} style={[styles.tabBtn, tab === 'cruz' && styles.tabBtnActive]}>
            <Text style={[styles.tabTxt, { color: tab === 'cruz' ? headerColor : headerTextColor }]}>Cruz</Text>
          </Pressable>
          <Pressable onPress={() => setTab('checklist')} style={[styles.tabBtn, tab === 'checklist' && styles.tabBtnActive]}>
            <Text style={[styles.tabTxt, { color: tab === 'checklist' ? headerColor : headerTextColor }]}>Checklist</Text>
          </Pressable>
        </View>
      </View>

      {tab === 'reportes' ? (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.card}>
            {reportes.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="shield-checkmark-outline" size={22} color={colors.textMuted} />
                <Text style={styles.emptyTxt}>Aún no hay reportes de accidentes.</Text>
              </View>
            ) : (
              reportes.map((r, idx) => {
                const tipo = TIPOS.find((t) => t.value === r.tipo_registro);
                const badgeColor = tipo?.color ?? SEVERIDAD_LEGACY_COLOR[r.severidad] ?? colors.textMuted;
                const foto = r.images?.[0];
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => openForm(r)}
                    style={[styles.repRow, idx > 0 && styles.rowBorder]}
                  >
                    {foto ? (
                      <Image source={{ uri: foto }} style={styles.repThumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.repThumb, styles.repThumbPlaceholder]}>
                        <Ionicons name="image-outline" size={20} color={colors.textMuted} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={styles.repHeaderRow}>
                        <View style={[styles.badge, { backgroundColor: badgeColor + '22' }]}>
                          <Text style={[styles.badgeTxt, { color: badgeColor }]}>{r.registro_label}</Text>
                        </View>
                        <Text style={styles.repDate}>{r.fecha}{r.mes ? ` · ${r.mes}` : ''}</Text>
                      </View>
                      {!!(r.trabajador || r.contratista) && (
                        <Text style={styles.repAcciones} numberOfLines={1}>
                          {[r.trabajador, r.contratista].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                      {!!r.ubicacion && <Text style={styles.repAcciones} numberOfLines={1}>{r.ubicacion}</Text>}
                      {!!r.descripcion && <Text style={styles.repDesc} numberOfLines={3}>{r.descripcion}</Text>}
                      {!!(r.seguimiento || r.acciones_tomadas) && (
                        <Text style={styles.repAcciones} numberOfLines={2}>
                          Seguimiento: {r.seguimiento || r.acciones_tomadas}
                        </Text>
                      )}
                      <Text style={styles.repAutor}>{r.captured_by_name} · toca para editar o dar seguimiento</Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </ScrollView>
      ) : tab === 'cruz' ? (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.cruzNav}>
            <Pressable hitSlop={10} onPress={() => setCruzMes((m) => mesDesplazado(m, -1))}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
            <Text style={styles.cruzMes}>{cruz?.mes_label ?? cruzMes}</Text>
            <Pressable hitSlop={10} onPress={() => setCruzMes((m) => mesDesplazado(m, 1))}>
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </Pressable>
          </View>

          {cruzLoading && !cruz ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
          ) : cruz ? (
            <>
              <View style={[styles.card, styles.cruzFuerza]}>
                <Text style={styles.cruzFuerzaTitulo}>Fuerza de trabajo PROMEDIO</Text>
                <Text style={styles.cruzFuerzaNum}>{cruz.fuerza_trabajo.personal ?? '—'}</Text>
              </View>
              <Text style={styles.fieldHint}>Personal: promedio diario de los reportes de campo del mes.</Text>

              <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>Cruz de seguridad</Text>
              <View style={[styles.card, { alignItems: 'center', padding: spacing.md }]}>
                <View
                  style={{
                    width: CRUZ_CELDA * 9,
                    height: CRUZ_CELDA * (Math.max(...cruz.dias.map((d) => d.fila)) + 1),
                  }}
                >
                  {cruz.dias.map((d) => {
                    const info = cruz.resumen.find((r) => r.tipo === d.tipo);
                    const bg = d.tipo && info ? `#${info.color}` : CRUZ_COLOR_FUTURO;
                    const oscuro = !d.tipo || CRUZ_TEXTO_OSCURO.has(d.tipo);
                    return (
                      <View
                        key={d.dia}
                        style={[styles.cruzCelda, { left: d.col * CRUZ_CELDA, top: d.fila * CRUZ_CELDA, backgroundColor: bg }]}
                      >
                        <Text style={[styles.cruzCeldaTxt, { color: oscuro ? '#0F172A' : '#fff' }]}>{d.dia}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>Registro de accidentes</Text>
              <View style={styles.card}>
                {cruz.resumen.map((r, idx) => (
                  <View key={r.tipo} style={[styles.cruzFila, idx > 0 && styles.rowBorder]}>
                    <View style={[styles.cruzEtiqueta, { backgroundColor: `#${r.color}` }]}>
                      <Text style={[styles.cruzEtiquetaTxt, { color: CRUZ_TEXTO_OSCURO.has(r.tipo) ? '#0F172A' : '#fff' }]}>
                        {r.label}
                      </Text>
                    </View>
                    <Text style={styles.cruzCol}>{r.abrev}</Text>
                    <Text style={styles.cruzCol}>{r.cantidad}</Text>
                    <Text style={styles.cruzCol}>{r.porcentaje}%</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.fieldHint}>
                Cantidad = registros del mes ("Sin accidentes" = días laborables sin eventos). Porcentaje sobre los{' '}
                {cruz.dias_laborables} días laborables transcurridos (lunes a sábado).
              </Text>

              <Button
                label="Exportar a Excel"
                loading={cruzExporting}
                onPress={onExportCruz}
                style={{ marginTop: spacing.md }}
              />

              <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Bitácora del año ({cruz.registros.length})</Text>
              <View style={styles.card}>
                {cruz.registros.length === 0 ? (
                  <View style={styles.empty}><Text style={styles.emptyTxt}>Sin accidentes ni incidentes este año.</Text></View>
                ) : (
                  cruz.registros.map((b, idx) => (
                    <View key={b.n} style={[styles.repRow, idx > 0 && styles.rowBorder]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.repDesc} numberOfLines={2}>
                          {b.n}. {b.abrev} · {b.mes} · {b.fecha}
                        </Text>
                        <Text style={styles.repAcciones} numberOfLines={1}>
                          {[b.trabajador, b.contratista, b.ubicacion].filter(Boolean).join(' · ')}
                        </Text>
                        {!!b.descripcion && <Text style={styles.repAcciones} numberOfLines={2}>{b.descripcion}</Text>}
                      </View>
                    </View>
                  ))
                )}
              </View>
            </>
          ) : null}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.sectionTitle}>Checklist de hoy</Text>
          <View style={styles.card}>
            {checklistDraft.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTxt}>Agrega elementos preventivos o correctivos.</Text>
              </View>
            ) : (
              checklistDraft.map((it, idx) => (
                <View key={idx} style={[styles.checkRow, idx > 0 && styles.rowBorder]}>
                  <Switch
                    value={it.cumplido}
                    onValueChange={() => toggleChecklistItem(idx)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.checkTxt, it.cumplido && styles.checkTxtDone]}>{it.item}</Text>
                    <Text style={styles.checkTipo}>{it.tipo === 'preventiva' ? 'Preventiva' : 'Correctiva'}</Text>
                  </View>
                  <Pressable hitSlop={8} onPress={() => removeChecklistItem(idx)}>
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))
            )}
          </View>

          <View style={styles.addItemRow}>
            <Pressable
              onPress={() => setTipoItemDraft(tipoItemDraft === 'preventiva' ? 'correctiva' : 'preventiva')}
              style={styles.tipoToggle}
            >
              <Text style={styles.tipoToggleTxt}>{tipoItemDraft === 'preventiva' ? 'Preventiva' : 'Correctiva'}</Text>
              <Ionicons name="swap-horizontal-outline" size={14} color={colors.primary} />
            </Pressable>
            <TextInput
              value={itemDraft}
              onChangeText={setItemDraft}
              placeholder="Nueva acción..."
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { flex: 1 }]}
              onSubmitEditing={addChecklistItem}
            />
            <Pressable style={styles.addBtn} onPress={addChecklistItem}>
              <Ionicons name="add" size={20} color="#fff" />
            </Pressable>
          </View>

          <Button
            label="Guardar checklist del día"
            loading={checklistSaving}
            onPress={onSaveChecklist}
            style={{ marginTop: spacing.md }}
          />

          {checklists.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Checklists anteriores</Text>
              <View style={styles.card}>
                {checklists.slice(0, 10).map((c, idx) => (
                  <View key={c.id} style={[styles.repRow, idx > 0 && styles.rowBorder]}>
                    <Ionicons name="checkbox-outline" size={18} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.repDesc}>{c.fecha} · {c.items.length} elemento(s)</Text>
                      <Text style={styles.repAutor}>{c.captured_by_name}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}

      {tab === 'reportes' && (
        <Pressable style={styles.fab} onPress={() => openForm()}>
          <Ionicons name="add" size={26} color="#fff" />
        </Pressable>
      )}

      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <ScrollView style={styles.modalCard} contentContainerStyle={{ paddingBottom: spacing.lg }}>
            <Text style={styles.modalTitle}>{editingId ? 'Editar registro' : 'Registro de accidentes'}</Text>

            <Text style={styles.fieldLabel}>Fecha</Text>
            <TextInput
              value={fechaDraft}
              onChangeText={setFechaDraft}
              placeholder="AAAA-MM-DD"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              autoCapitalize="none"
              maxLength={10}
            />
            <Text style={styles.fieldHint}>Mes: {mesDe(fechaDraft) || '— (fecha incompleta)'}</Text>

            <Text style={styles.fieldLabel}>Registro</Text>
            <View style={styles.chipWrap}>
              {TIPOS.map((t) => (
                <Pressable
                  key={t.value}
                  onPress={() => setTipoDraft(t.value)}
                  style={[styles.chip, tipoDraft === t.value && { backgroundColor: t.color, borderColor: t.color }]}
                >
                  <Text style={[styles.segmentTxt, tipoDraft === t.value && styles.segmentTxtActive]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Nombre del trabajador</Text>
            <TextInput
              value={trabajadorDraft}
              onChangeText={setTrabajadorDraft}
              placeholder="Nombre completo"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={120}
            />

            <Text style={styles.fieldLabel}>Contratista</Text>
            {contratistas.length > 0 && (
              <View style={[styles.chipWrap, { marginBottom: 6 }]}>
                {contratistas.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setContratistaDraft(c)}
                    style={[styles.chip, contratistaDraft === c && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                  >
                    <Text style={[styles.segmentTxt, contratistaDraft === c && styles.segmentTxtActive]}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <TextInput
              value={contratistaDraft}
              onChangeText={setContratistaDraft}
              placeholder={contratistas.length > 0 ? 'O escribe otro' : 'Nombre del contratista'}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={120}
            />

            <Text style={styles.fieldLabel}>Ubicación</Text>
            <TextInput
              value={ubicacionDraft}
              onChangeText={setUbicacionDraft}
              placeholder="Estación, poste, frente de trabajo…"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={200}
            />

            <Text style={styles.fieldLabel}>
              Descripción{tipoDraft === 'sin_accidentes' ? ' (opcional)' : ''}
            </Text>
            <TextInput
              value={descripcionDraft}
              onChangeText={setDescripcionDraft}
              placeholder="¿Qué sucedió?"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline
            />

            <Text style={styles.fieldLabel}>Seguimiento (opcional)</Text>
            <TextInput
              value={seguimientoDraft}
              onChangeText={setSeguimientoDraft}
              placeholder="¿Qué se hizo o qué sigue? Puedes completarlo después."
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              multiline
            />

            <Text style={styles.fieldLabel}>Foto (opcional)</Text>
            <Pressable style={styles.fotoPicker} onPress={onPickFoto}>
              {fotoDraft ? (
                <Image source={{ uri: fotoDraft }} style={styles.fotoPreview} contentFit="cover" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={22} color={colors.textMuted} />
                  <Text style={styles.fotoPickerTxt}>Adjuntar foto</Text>
                </>
              )}
            </Pressable>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setFormOpen(false)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={onSaveReporte} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
  tabRow: { flexDirection: 'row', gap: 8, marginTop: spacing.sm },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  tabBtnActive: { backgroundColor: '#fff' },
  tabTxt: { fontSize: 13, fontWeight: '700' },
  scroll: { padding: spacing.md },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.md },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  repRow: { flexDirection: 'row', gap: 10, padding: spacing.md },
  repThumb: { width: 48, height: 48, borderRadius: radius.sm },
  repThumbPlaceholder: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  repHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  badgeTxt: { fontSize: 11, fontWeight: '800' },
  repDate: { fontSize: 11, color: colors.textMuted },
  repDesc: { fontSize: 13, color: colors.text, fontWeight: '600' },
  repAcciones: { fontSize: 12, color: colors.textBody, marginTop: 2 },
  repAutor: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md },
  checkTxt: { fontSize: 13, fontWeight: '600', color: colors.text },
  checkTxtDone: { textDecorationLine: 'line-through', color: colors.textMuted },
  checkTipo: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  addItemRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  tipoToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tipoToggleTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  addBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadow.lg,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '85%' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  fieldHint: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  cruzNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  cruzMes: { fontSize: 16, fontWeight: '800', color: colors.text },
  cruzFuerza: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginBottom: 0 },
  cruzFuerzaTitulo: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.text },
  cruzFuerzaNum: { fontSize: 16, fontWeight: '800', color: colors.text, minWidth: 40, textAlign: 'center' },
  cruzCelda: { position: 'absolute', width: CRUZ_CELDA, height: CRUZ_CELDA, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#fff' },
  cruzCeldaTxt: { fontSize: 11, fontWeight: '800' },
  cruzFila: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6 },
  cruzEtiqueta: { flex: 1, paddingVertical: 8, paddingHorizontal: 8, borderRadius: radius.sm },
  cruzEtiquetaTxt: { fontSize: 11, fontWeight: '800' },
  cruzCol: { width: 44, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.text },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.bg,
  },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  segmentTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  segmentTxtActive: { color: '#fff' },
  fotoPicker: {
    height: 120, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, overflow: 'hidden', gap: 6,
  },
  fotoPickerTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  fotoPreview: { width: '100%', height: '100%' },
});
