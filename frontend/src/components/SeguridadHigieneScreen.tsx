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
import { pickPhotoDataUrl } from '@/src/utils/photoPicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  api, SeguridadReporte, SeguridadChecklist, SeguridadChecklistItem, SeguridadTipoRegistro, SeguridadCruz, JerarquiaInforme, Project,
} from '@/src/api';
import { JerarquiaInformePicker, JERARQUIA_DEFAULT } from '@/src/components/JerarquiaInformePicker';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD } from '@/src/utils/roles';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { t, a11y  } from '@/src/i18n';

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
  const { user } = useAuth();
  const esCoord = user?.role === ROLE_COORD;
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
  const [jerarquiaDraft, setJerarquiaDraft] = useState<JerarquiaInforme>(JERARQUIA_DEFAULT);

  // === Cruz de Seguridad ===
  const [cruzMes, setCruzMes] = useState(mesActual());
  const [cruz, setCruz] = useState<SeguridadCruz | null>(null);
  const [cruzLoading, setCruzLoading] = useState(false);
  const [cruzExporting, setCruzExporting] = useState(false);
  // Fuerza de trabajo del mes: se captura directo (incluye contratistas y demas frentes).
  const [fuerzaDraft, setFuerzaDraft] = useState('');
  // Parametros que Seguridad reporta (p. ej. banderilleros): valor del mes por parametro.
  const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});
  // Hub del Coordinador General: define que parametros reporta Seguridad.
  const [paramHubOpen, setParamHubOpen] = useState(false);
  const [paramHubDraft, setParamHubDraft] = useState<{ id?: string; nombre: string }[]>([]);
  const [paramHubSaving, setParamHubSaving] = useState(false);

  function aplicarCruz(data: SeguridadCruz) {
    setCruz(data);
    setFuerzaDraft(data.fuerza_trabajo.personal != null ? String(data.fuerza_trabajo.personal) : '');
    setParamDrafts(Object.fromEntries((data.parametros || []).map((p) => [p.id, p.valor != null ? String(p.valor) : ''])));
  }

  const loadCruz = useCallback(async () => {
    if (!projectId) return;
    try {
      setCruzLoading(true);
      const data = await api.getSeguridadCruz(projectId, cruzMes);
      aplicarCruz(data);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar la Cruz de Seguridad.');
    } finally {
      setCruzLoading(false);
    }
  }, [projectId, cruzMes]);

  useEffect(() => { if (tab === 'cruz') loadCruz(); }, [tab, loadCruz]);

  // Autoguardado: onEndEditing no siempre dispara en Android (p. ej. al
  // regresar con el boton atras), asi que el numero se guarda solo, poco
  // despues de dejar de escribir.
  useEffect(() => {
    if (!cruz || fuerzaDraft.trim() === '') return;
    const n = Number(fuerzaDraft);
    if (!Number.isInteger(n) || n === (cruz.fuerza_trabajo.personal ?? null)) return;
    const t = setTimeout(() => { onSaveFuerza(fuerzaDraft); }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuerzaDraft]);

  async function onSaveParametro(id: string, texto: string) {
    const limpio = texto.trim();
    const n = limpio === '' ? null : Number(limpio);
    const actual = cruz?.parametros.find((p) => p.id === id)?.valor ?? null;
    if (n !== null && (!Number.isInteger(n) || n < 0)) return;
    if (n === actual) return;
    try {
      const data = await api.setSeguridadParametrosValores(projectId, cruzMes, { [id]: n });
      setCruz(data);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    }
  }

  useEffect(() => {
    if (!cruz) return;
    const t = setTimeout(() => {
      for (const p of cruz.parametros) {
        const txt = paramDrafts[p.id];
        if (txt !== undefined && txt.trim() !== '' && Number(txt) !== (p.valor ?? null)) onSaveParametro(p.id, txt);
      }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramDrafts]);

  async function abrirParamHub() {
    try {
      const r = await api.getSeguridadParametros(projectId);
      setParamHubDraft(r.parametros.map((p) => ({ id: p.id, nombre: p.nombre })));
      setParamHubOpen(true);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar los parametros.');
    }
  }

  async function guardarParamHub() {
    setParamHubSaving(true);
    try {
      await api.putSeguridadParametros(projectId, paramHubDraft);
      setParamHubOpen(false);
      await loadCruz();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setParamHubSaving(false);
    }
  }

  async function onSaveFuerza(texto: string) {
    const limpio = texto.trim();
    const n = limpio === '' ? null : Number(limpio);
    if (n !== null && (!Number.isInteger(n) || n < 0)) {
      Alert.alert('Número inválido', 'Escribe la cantidad de personas como un número entero.');
      setFuerzaDraft(cruz?.fuerza_trabajo.personal != null ? String(cruz.fuerza_trabajo.personal) : '');
      return;
    }
    if (n === (cruz?.fuerza_trabajo.personal ?? null)) return;  // sin cambios
    try {
      const data = await api.setSeguridadFuerzaTrabajo(projectId, cruzMes, n);
      setCruz(data);
      setFuerzaDraft(data.fuerza_trabajo.personal != null ? String(data.fuerza_trabajo.personal) : '');
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    }
  }

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
      Alert.alert(t('seguridadHigiene.error'), e?.message || t('seguridadHigiene.noSePudoCargarEl'));
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
    setJerarquiaDraft(r?.jerarquia || JERARQUIA_DEFAULT);
    setFormOpen(true);
  }

  // Contratistas del proyecto (catalogo del Coordinador): se eligen con un toque.
  const contratistas = (project?.contratistas_list || []).filter(Boolean);

  async function onPickFoto() {
    const dataUrl = await pickPhotoDataUrl('library', { maxDim: 1400, quality: 0.75 });
    if (dataUrl) setFotoDraft(dataUrl);
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
        jerarquia: jerarquiaDraft,
      };
      if (editingId) await api.updateSeguridadReporte(projectId, editingId, body);
      else await api.createSeguridadReporte(projectId, body);
      setFormOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert(t('seguridadHigiene.noSePudoGuardar'), e?.message || t('seguridadHigiene.intentaloNuevamente'));
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
      Alert.alert(t('seguridadHigiene.checklistVacio'), t('seguridadHigiene.agregaAlMenosUnElemento'));
      return;
    }
    try {
      setChecklistSaving(true);
      await api.createSeguridadChecklist(projectId, { items: checklistDraft });
      setChecklistDraft([]);
      await load();
      Alert.alert(t('seguridadHigiene.guardado'), t('seguridadHigiene.elChecklistDelDiaSe'));
    } catch (e: any) {
      Alert.alert(t('seguridadHigiene.noSePudoGuardar'), e?.message || t('seguridadHigiene.intentaloNuevamente'));
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
      <View style={{ backgroundColor: headerColor }}>
        <ScreenHeader title={t('seguridadHigiene.seguridadEHigiene')} backgroundColor={headerColor} />
        <View style={styles.tabRow}>
          <Pressable accessibilityRole="button" onPress={() => setTab('reportes')} style={[styles.tabBtn, tab === 'reportes' && styles.tabBtnActive]}>
            <Text style={[styles.tabTxt, { color: tab === 'reportes' ? headerColor : headerTextColor }]}>{t('seguridadHigiene.reportes')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setTab('cruz')} style={[styles.tabBtn, tab === 'cruz' && styles.tabBtnActive]}>
            <Text style={[styles.tabTxt, { color: tab === 'cruz' ? headerColor : headerTextColor }]}>Cruz</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setTab('checklist')} style={[styles.tabBtn, tab === 'checklist' && styles.tabBtnActive]}>
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
                <Text style={styles.emptyTxt}>{t('seguridadHigiene.aunNoHayReportesDe')}</Text>
              </View>
            ) : (
              reportes.map((r, idx) => {
                const tipo = TIPOS.find((t) => t.value === r.tipo_registro);
                const badgeColor = tipo?.color ?? SEVERIDAD_LEGACY_COLOR[r.severidad] ?? colors.textMuted;
                const foto = r.images?.[0];
                return (
                  <Pressable accessibilityRole="button"
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
            <Pressable accessibilityRole="button" accessibilityLabel="Volver" hitSlop={10} onPress={() => setCruzMes((m) => mesDesplazado(m, -1))}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
            <Text style={styles.cruzMes}>{cruz?.mes_label ?? cruzMes}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Siguiente" hitSlop={10} onPress={() => setCruzMes((m) => mesDesplazado(m, 1))}>
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </Pressable>
          </View>

          {cruzLoading && !cruz ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
          ) : cruz ? (
            <>
              <View style={[styles.card, styles.cruzFuerza]}>
                <Text style={styles.cruzFuerzaTitulo}>Fuerza de trabajo PROMEDIO</Text>
                <TextInput
                  value={fuerzaDraft}
                  onChangeText={(t) => setFuerzaDraft(t.replace(/[^0-9]/g, ''))}
                  onEndEditing={(e) => onSaveFuerza(e.nativeEvent.text)}
                  placeholder="—"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  style={[styles.input, styles.cruzFuerzaInput]}
                />
              </View>
              <Text style={styles.fieldHint}>
                Personal del mes, de todos los frentes y contratistas: escríbelo directo (se guarda solo).
                {cruz.fuerza_trabajo.heredado ? ' Se muestra el último valor capturado; edítalo si cambió.' : ''}
              </Text>

              {cruz.parametros.length > 0 || esCoord ? (
                <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[styles.sectionTitle, { flex: 1 }]}>Parámetros de Seguridad</Text>
                    {esCoord ? (
                      <Pressable accessibilityRole="button" onPress={abrirParamHub} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Ionicons name="settings-outline" size={16} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Configurar</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {cruz.parametros.map((p) => (
                    <View key={p.id} style={[styles.card, styles.cruzFuerza]}>
                      <Text style={styles.cruzFuerzaTitulo}>{p.nombre}</Text>
                      <TextInput
                        value={paramDrafts[p.id] ?? ''}
                        onChangeText={(t) => setParamDrafts((d) => ({ ...d, [p.id]: t.replace(/[^0-9]/g, '') }))}
                        onEndEditing={(e) => onSaveParametro(p.id, e.nativeEvent.text)}
                        placeholder="—"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        maxLength={6}
                        style={[styles.input, styles.cruzFuerzaInput]}
                      />
                    </View>
                  ))}
                  {cruz.parametros.length === 0 ? (
                    <Text style={styles.fieldHint}>Aún no hay parámetros. Toca Configurar para añadirlos.</Text>
                  ) : null}
                </View>
              ) : null}

              <Modal visible={paramHubOpen} transparent animationType="slide" onRequestClose={() => setParamHubOpen(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
                  <View style={{ backgroundColor: colors.bg, padding: spacing.md, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' }}>
                    <Text style={styles.sectionTitle}>Parámetros que reporta Seguridad</Text>
                    <Text style={styles.fieldHint}>
                      Seguridad no reporta personal ni equipo; solo estos números (p. ej. banderilleros). Al quitar uno se
                      oculta, pero sus valores ya capturados se conservan.
                    </Text>
                    <ScrollView keyboardShouldPersistTaps="handled" style={{ marginVertical: spacing.sm }}>
                      {paramHubDraft.map((p, i) => (
                        <View key={p.id || `n${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <TextInput
                            value={p.nombre}
                            onChangeText={(t) => setParamHubDraft((l) => l.map((x, j) => (j === i ? { ...x, nombre: t } : x)))}
                            placeholder="Nombre del parámetro"
                            placeholderTextColor={colors.textMuted}
                            maxLength={60}
                            style={[styles.input, { flex: 1, marginTop: 0 }]}
                          />
                          <Pressable accessibilityRole="button" accessibilityLabel="Eliminar" onPress={() => setParamHubDraft((l) => l.filter((_, j) => j !== i))} hitSlop={8}>
                            <Ionicons name="trash-outline" size={20} color={colors.error} />
                          </Pressable>
                        </View>
                      ))}
                      <Pressable accessibilityRole="button" onPress={() => setParamHubDraft((l) => [...l, { nombre: '' }])} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 }}>
                        <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontWeight: '700' }}>Añadir parámetro</Text>
                      </Pressable>
                    </ScrollView>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable accessibilityRole="button" onPress={() => setParamHubOpen(false)} style={{ flex: 1, padding: 12, alignItems: 'center' }}>
                        <Text style={{ color: colors.textMuted, fontWeight: '700' }}>Cancelar</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" onPress={guardarParamHub} disabled={paramHubSaving} style={{ flex: 1, padding: 12, alignItems: 'center', backgroundColor: colors.primary, borderRadius: 10 }}>
                        {paramHubSaving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '800' }}>Guardar</Text>}
                      </Pressable>
                    </View>
                  </View>
                </View>
              </Modal>

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
          <Text style={styles.sectionTitle}>{t('seguridadHigiene.checklistDeHoy')}</Text>
          <View style={styles.card}>
            {checklistDraft.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTxt}>{t('seguridadHigiene.agregaElementosPreventivosOCorrectivos')}</Text>
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
                    <Text style={styles.checkTipo}>{it.tipo === 'preventiva' ? t('seguridadHigiene.preventiva') : t('seguridadHigiene.correctiva')}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} hitSlop={8} onPress={() => removeChecklistItem(idx)}>
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))
            )}
          </View>

          <View style={styles.addItemRow}>
            <Pressable accessibilityRole="button"
              onPress={() => setTipoItemDraft(tipoItemDraft === 'preventiva' ? 'correctiva' : 'preventiva')}
              style={styles.tipoToggle}
            >
              <Text style={styles.tipoToggleTxt}>{tipoItemDraft === 'preventiva' ? t('seguridadHigiene.preventiva') : t('seguridadHigiene.correctiva')}</Text>
              <Ionicons name="swap-horizontal-outline" size={14} color={colors.primary} />
            </Pressable>
            <TextInput
              value={itemDraft}
              onChangeText={setItemDraft}
              placeholder={t('seguridadHigiene.nuevaAccion')}
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { flex: 1 }]}
              onSubmitEditing={addChecklistItem}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} hitSlop={8} style={styles.addBtn} onPress={addChecklistItem}>
              <Ionicons name="add" size={20} color="#fff" />
            </Pressable>
          </View>

          <Button
            label={t('seguridadHigiene.guardarChecklistDelDia')}
            loading={checklistSaving}
            onPress={onSaveChecklist}
            style={{ marginTop: spacing.md }}
          />

          {checklists.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>{t('seguridadHigiene.checklistsAnteriores')}</Text>
              <View style={styles.card}>
                {checklists.slice(0, 10).map((c, idx) => (
                  <View key={c.id} style={[styles.repRow, idx > 0 && styles.rowBorder]}>
                    <Ionicons name="checkbox-outline" size={18} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.repDesc}>{c.fecha} · {t('seguridadHigiene.elementosN', { n: c.items.length })}</Text>
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
        <Pressable accessibilityRole="button" accessibilityLabel="Agregar" style={styles.fab} onPress={() => openForm()}>
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
                <Pressable accessibilityRole="button"
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
                  <Pressable accessibilityRole="button"
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
              placeholder={t('seguridadHigiene.queSucedio')}
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

            <Text style={styles.fieldLabel}>{t('seguridadHigiene.fotoOpcional')}</Text>
            <Pressable accessibilityRole="button" style={styles.fotoPicker} onPress={onPickFoto}>
              {fotoDraft ? (
                <Image source={{ uri: fotoDraft }} style={styles.fotoPreview} contentFit="cover" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={22} color={colors.textMuted} />
                  <Text style={styles.fotoPickerTxt}>{t('seguridadHigiene.adjuntarFoto')}</Text>
                </>
              )}
            </Pressable>

            <JerarquiaInformePicker value={jerarquiaDraft} onChange={setJerarquiaDraft} />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={t('seguridadHigiene.cancelar')} variant="secondary" onPress={() => setFormOpen(false)} style={{ flex: 1 }} />
              <Button label={t('seguridadHigiene.guardar')} loading={saving} onPress={onSaveReporte} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
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
  cruzFuerzaInput: { width: 90, textAlign: 'center', fontSize: 16, fontWeight: '800', marginTop: 0, paddingVertical: 6 },
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
