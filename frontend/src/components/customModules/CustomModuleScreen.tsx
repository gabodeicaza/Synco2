// Captura y consulta de los registros de UN módulo personalizado (creado con el
// Creador de módulos). El formulario se arma solo a partir de los campos del
// módulo: respeta campos obligatorios, condicionales (visible_si), calculados,
// ubicaciones, estatus y fotos. Funciona SIN señal (los registros nuevos esperan
// en la cola offline y se sincronizan solos), con folio automático, historial de
// cambios, filtros, exportación a Excel/CSV e importación desde Excel.
// Abierto a cualquier rol de escritura; si el módulo es «solo coordinación»,
// solo Coordinador/Sub-Coordinador capturan.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  api, CustomBorrado, CustomHistorial, CustomModule, CustomRecord, JerarquiaInforme, LocationNode, Project,
} from '@/src/api';
import { JerarquiaInformePicker, JERARQUIA_DEFAULT } from '@/src/components/JerarquiaInformePicker';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { showToast } from '@/src/utils/toast';
import { fechaCorta, fechaTecleadaOk, FECHA_AYUDA } from '@/src/utils/fecha';
import { useAuth } from '@/src/auth-context';
import { useOfflineQueue } from '@/src/offline-queue-context';
import { ROLE_COORD, ROLE_SUB, ROLE_JEFE } from '@/src/utils/roles';
import {
  FILTROS_VACIOS, FiltrosRegistros, campoEstatusDe, campoVisible, detalleRegistro, esNumerico, estaCerrado,
  fechaIso, filtrarRegistros, fmtNumeroCampo, hayFiltros, parseNumero, recalcular, tituloRegistro,
  validarCaptura, valoresIniciales,
} from '@/src/utils/customModules';
import { CampoInput } from './CampoInput';
import { Header, inputStyle } from './ui';
import { EliminadosModal, FiltrosModal, HistorialModal } from './RegistroModals';
import { ImportarRegistrosModal } from './ImportarRegistrosModal';

type Borrador = {
  id: string | null;
  folio?: string | null;
  fecha: string;
  valores: Record<string, any>;
  jerarquia: JerarquiaInforme;
  previews: Record<string, string>; // foto visible por campo (miniatura o la recién elegida)
  nuevas: Record<string, string | null>; // fotos cambiadas: data URL nuevo, o null = quitar
};

const hoyISO = () => new Date().toISOString().slice(0, 10);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default function CustomModuleScreen({ projectId, moduloId }: { projectId: string; moduloId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { customItems } = useOfflineQueue();
  const esCoordSub = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [modulo, setModulo] = useState<CustomModule | null>(null);
  const [items, setItems] = useState<CustomRecord[]>([]);
  const [nodos, setNodos] = useState<LocationNode[]>([]);
  const [filtros, setFiltros] = useState<FiltrosRegistros>(FILTROS_VACIOS);
  const [verFiltros, setVerFiltros] = useState(false);
  const [verMenu, setVerMenu] = useState(false);
  const [historial, setHistorial] = useState<CustomHistorial[] | null>(null);
  const [borrados, setBorrados] = useState<CustomBorrado[] | null>(null);
  const [verImportar, setVerImportar] = useState(false);
  const [draft, setDraft] = useState<Borrador | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportando, setExportando] = useState(false);

  const puedeEscribir = !!modulo && user?.role !== ROLE_JEFE && (!modulo.solo_coordinacion || esCoordSub);
  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const campos = useMemo(() => modulo?.campos || [], [modulo]);
  const estatus = campoEstatusDe(campos);

  const load = useCallback(async () => {
    if (!projectId || !moduloId) return;
    try {
      const [proj, mod, regs] = await Promise.all([
        api.getProject(projectId), api.getCustomModule(projectId, moduloId), api.listCustomRecords(projectId, moduloId),
      ]);
      setProject(proj);
      setModulo(mod);
      setItems(regs);
      if (mod.campos.some((c) => c.tipo === 'ubicacion')) api.listNodes(projectId).then(setNodos).catch(() => setNodos([]));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el módulo.');
    } finally {
      setLoading(false);
    }
  }, [projectId, moduloId]);

  useEffect(() => { load(); }, [load]);

  // Registros guardados SIN señal de este módulo: se muestran arriba (con su
  // etiqueta «sin sincronizar») y, cuando la cola los envía, se recarga la lista.
  const locales = useMemo<CustomRecord[]>(() => customItems
    .filter((q) => q.payload?.module_id === moduloId && q.payload?.op === 'create')
    .map((q) => {
      const valores: Record<string, any> = { ...(q.payload.valores || {}) };
      const thumbs: Record<string, string> = {};
      for (const f of campos) {
        if (f.tipo === 'foto' && typeof valores[f.id] === 'string') { thumbs[f.id] = valores[f.id]; delete valores[f.id]; }
      }
      return {
        id: `local-${q.client_id}`, project_id: projectId, module_id: moduloId, fecha: q.payload.fecha || q.created_at.slice(0, 10),
        valores: recalcular(campos, valores), thumbs, created_by_name: user?.name, created_at: q.created_at, sincronizado: false,
      } as CustomRecord;
    }), [customItems, moduloId, projectId, campos, user?.name]);

  const nPendientes = customItems.filter((q) => q.payload?.module_id === moduloId).length;
  const prevPendientes = React.useRef(nPendientes);
  useEffect(() => {
    if (prevPendientes.current > 0 && nPendientes < prevPendientes.current) load(); // se sincronizó algo
    prevPendientes.current = nPendientes;
  }, [nPendientes, load]);

  const todos = useMemo(() => [...locales, ...items], [locales, items]);
  const autores = useMemo(() => Array.from(new Set(items.map((r) => r.created_by_name).filter(Boolean) as string[])).sort(), [items]);
  const filtrados = useMemo(() => filtrarRegistros(todos, campos, filtros), [todos, campos, filtros]);

  // Totales de los campos que el módulo totaliza (sobre lo que se está viendo).
  const totales = useMemo(() => {
    const out: { id: string; label: string; valor: string }[] = [];
    for (const f of campos) {
      const agg = f.agregacion || 'ninguna';
      if (agg === 'ninguna' || f.tipo === 'foto') continue;
      const vals = filtrados.map((r) => r.valores[f.id]);
      let res: number | null = null;
      if (agg === 'conteo') res = vals.filter((v) => (f.tipo === 'interruptor' ? !!v : v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))).length;
      else {
        const nums = vals.filter((v) => typeof v === 'number' && Number.isFinite(v)) as number[];
        if (nums.length) {
          res = agg === 'suma' ? nums.reduce((a, b) => a + b, 0)
            : agg === 'promedio' ? nums.reduce((a, b) => a + b, 0) / nums.length
              : agg === 'minimo' ? Math.min(...nums) : Math.max(...nums);
        }
      }
      if (res === null) continue;
      const rot = { suma: 'Total', promedio: 'Promedio', minimo: 'Mínimo', maximo: 'Máximo', conteo: 'Cuenta' }[agg];
      out.push({ id: f.id, label: `${rot} · ${f.etiqueta}`, valor: agg === 'conteo' ? String(res) : fmtNumeroCampo(f, res) });
    }
    return out;
  }, [campos, filtrados]);

  // Resumen por estatus (chips con conteo) cuando el módulo tiene seguimiento.
  const porEstatus = useMemo(() => {
    if (!estatus) return [];
    return (estatus.opciones || []).map((o) => ({ o, n: filtrados.filter((r) => r.valores[estatus.id] === o).length }));
  }, [estatus, filtrados]);

  const puedeEditar = (r: CustomRecord) => puedeEscribir && r.sincronizado !== false && (esCoordSub || r.created_by === user?.id);

  function nuevo() {
    if (!modulo) return;
    setDraft({ id: null, fecha: hoyISO(), valores: valoresIniciales(campos), jerarquia: JERARQUIA_DEFAULT, previews: {}, nuevas: {} });
  }

  function abrir(r: CustomRecord) {
    if (r.sincronizado === false) {
      Alert.alert('Esperando conexión', 'Este registro se guardó en tu dispositivo y se enviará solo cuando haya señal.');
      return;
    }
    const previews: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.thumbs || {})) previews[k] = v.startsWith('data:') ? v : `data:image/jpeg;base64,${v}`;
    setDraft({
      id: r.id, folio: r.folio, fecha: r.fecha, valores: recalcular(campos, { ...r.valores }),
      jerarquia: (r.jerarquia as JerarquiaInforme) || JERARQUIA_DEFAULT, previews, nuevas: {},
    });
  }

  function setValor(id: string, v: any) {
    setDraft((d) => (d ? { ...d, valores: recalcular(campos, { ...d.valores, [id]: v }) } : d));
  }

  async function pickPhoto(campoId: string, source: 'camera' | 'library') {
    try {
      if (Platform.OS !== 'web') {
        const perm = source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Sin permiso', source === 'camera' ? 'No hay permiso para usar la cámara.' : 'No hay permiso para acceder a la galería.');
          return;
        }
      }
      const opts = { mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 0.9, exif: false };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled || !result.assets?.[0]) return;
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, [{ resize: { width: 1800 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) throw new Error('No se pudo leer la imagen.');
      const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
      setDraft((d) => (d ? { ...d, previews: { ...d.previews, [campoId]: dataUrl }, nuevas: { ...d.nuevas, [campoId]: dataUrl } } : d));
    } catch (e: any) {
      Alert.alert('No se pudo cargar la foto', e?.message || 'Inténtalo nuevamente.');
    }
  }

  function quitarFoto(campoId: string) {
    setDraft((d) => {
      if (!d) return d;
      const previews = { ...d.previews };
      delete previews[campoId];
      return { ...d, previews, nuevas: { ...d.nuevas, [campoId]: null } };
    });
  }

  async function guardar() {
    if (!draft || !modulo) return;
    if (!fechaTecleadaOk(draft.fecha)) { Alert.alert('Fecha inválida', FECHA_AYUDA); return; }
    const error = validarCaptura(campos, draft.valores, draft.previews);
    if (error) { Alert.alert('Falta información', error); return; }
    const valores: Record<string, any> = {};
    for (const f of campos) {
      if (f.tipo === 'calculado') continue;
      if (f.tipo === 'foto') {
        if (f.id in draft.nuevas) valores[f.id] = draft.nuevas[f.id];
        continue;
      }
      const v = draft.valores[f.id];
      valores[f.id] = esNumerico(f.tipo) && v !== '' && v !== null && v !== undefined ? parseNumero(v) : v;
    }
    const cuerpo = { fecha: draft.fecha.trim(), valores, ...(modulo.usar_jerarquia ? { jerarquia: draft.jerarquia } : {}) };
    const titulo = tituloRegistro(campos, { id: '', project_id: '', module_id: '', fecha: cuerpo.fecha, valores: draft.valores });
    const etiqueta = `${modulo.nombre}: ${titulo}`;
    try {
      setSaving(true);
      const res = draft.id
        ? await api.updateCustomRecord(projectId, modulo.id, draft.id, cuerpo, `Edición · ${etiqueta}`)
        : await api.createCustomRecord(projectId, modulo.id, cuerpo, etiqueta);
      setDraft(null);
      if (res.sincronizado === false) showToast('Sin señal: guardado en el dispositivo, se enviará solo.');
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  async function borrar(r: CustomRecord) {
    if (!modulo) return;
    const ok = await confirm('Eliminar registro', `¿Eliminar el registro${r.folio ? ` ${r.folio}` : ''} del ${fechaCorta(r.fecha)}? Quedará anotado en la bitácora de eliminados.`, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deleteCustomRecord(projectId, modulo.id, r.id);
      setDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Inténtalo nuevamente.');
    }
  }

  async function verHistorial(id: string) {
    try {
      const r = await api.getCustomRecord(projectId, moduloId, id);
      setHistorial(r.historial || []);
    } catch (e: any) {
      Alert.alert('No se pudo cargar', e?.message || 'Inténtalo nuevamente.');
    }
  }

  async function exportar(formato: 'xlsx' | 'csv') {
    setVerMenu(false);
    try {
      setExportando(true);
      const { blob, filename } = await api.downloadCustomExport(projectId, moduloId, formato, { desde: fechaIso(filtros.desde) || undefined, hasta: fechaIso(filtros.hasta) || undefined });
      await downloadBlob(blob, filename, formato === 'xlsx' ? XLSX_MIME : 'text/csv');
    } catch (e: any) {
      Alert.alert('No se pudo exportar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setExportando(false);
    }
  }

  async function abrirBorrados() {
    setVerMenu(false);
    try {
      setBorrados(await api.listCustomBorrados(projectId, moduloId));
    } catch (e: any) {
      Alert.alert('No se pudo cargar', e?.message || 'Inténtalo nuevamente.');
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!modulo) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header title="Módulo" color={headerColor} onBack={() => router.back()} />
        <View style={styles.center}><Text style={styles.emptyTxt}>Este módulo ya no está disponible.</Text></View>
      </View>
    );
  }

  const nFiltros = hayFiltros(filtros) ? 1 : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header
        title={modulo.nombre} color={headerColor} onBack={() => router.back()}
        right={(
          <Pressable accessibilityRole="button" accessibilityLabel="Más opciones" onPress={() => setVerMenu(true)} hitSlop={10} disabled={exportando}>
            {exportando ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="ellipsis-vertical" size={20} color="#fff" />}
          </Pressable>
        )}
      />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 96 }]} keyboardShouldPersistTaps="handled">
        {modulo.descripcion ? <Text style={styles.desc}>{modulo.descripcion}</Text> : null}
        {!modulo.activo ? <Text style={styles.aviso}>Este módulo está apagado: solo se consulta.</Text> : null}
        {modulo.solo_coordinacion && !esCoordSub ? <Text style={styles.aviso}>Solo la coordinación captura en este módulo.</Text> : null}
        {nPendientes > 0 ? <Text style={styles.aviso}>{nPendientes} registro{nPendientes === 1 ? '' : 's'} esperando conexión: se enviará{nPendientes === 1 ? '' : 'n'} solo cuando haya señal.</Text> : null}

        <View style={styles.filtroRow}>
          <TextInput
            value={filtros.texto} onChangeText={(t) => setFiltros((f) => ({ ...f, texto: t }))} placeholder="Buscar…"
            placeholderTextColor={colors.textMuted} style={[inputStyle, { flex: 1 }]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Filtrar" onPress={() => setVerFiltros(true)} style={[styles.filtroBtn, nFiltros > 0 && { backgroundColor: colors.primary }]}>
            <Ionicons name="funnel-outline" size={18} color={nFiltros > 0 ? '#fff' : colors.primary} />
          </Pressable>
        </View>
        {(hayFiltros(filtros) || filtros.texto) ? (
          <Pressable accessibilityRole="button" onPress={() => setFiltros(FILTROS_VACIOS)} style={styles.limpiar}>
            <Text style={styles.limpiarTxt}>Mostrando {filtrados.length} de {todos.length} · Quitar filtros</Text>
          </Pressable>
        ) : null}

        {porEstatus.length > 0 ? (
          <View style={styles.estRow}>
            {porEstatus.map(({ o, n }) => {
              const cerrado = (estatus?.cierre || []).includes(o);
              const on = filtros.estatus === o;
              return (
                <Pressable accessibilityRole="button"
                  key={o} onPress={() => setFiltros((f) => ({ ...f, estatus: on ? null : o }))}
                  style={[styles.estChip, { borderColor: cerrado ? colors.success : colors.warning }, on && { backgroundColor: cerrado ? colors.success : colors.warning }]}
                >
                  <Text style={[styles.estN, on && { color: '#fff' }]}>{n}</Text>
                  <Text style={[styles.estTxt, on && { color: '#fff' }]} numberOfLines={1}>{o}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {totales.length > 0 ? (
          <View style={styles.totales}>
            {totales.map((t) => (
              <View key={t.id} style={styles.totalCell}>
                <Text style={styles.totalLabel} numberOfLines={1}>{t.label}</Text>
                <Text style={styles.totalVal}>{t.valor}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {filtrados.length === 0 ? (
          <View style={[styles.card, styles.empty]}>
            <Ionicons name="file-tray-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTxt}>{todos.length ? 'Ningún registro coincide con los filtros.' : 'Aún no hay registros.'}</Text>
          </View>
        ) : filtrados.map((r) => {
          const thumbs = Object.values(r.thumbs || {});
          const cerrado = estaCerrado(campos, r);
          const cierre = estatus && r.cierres?.[estatus.id];
          return (
            <Pressable accessibilityRole="button" key={r.id} style={[styles.card, r.sincronizado === false && { borderColor: colors.warning }]} onPress={() => (puedeEditar(r) || r.sincronizado === false ? abrir(r) : undefined)}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  {r.folio ? <Text style={styles.folio}>{r.folio}</Text> : null}
                  <Text style={styles.cardTitle} numberOfLines={2}>{tituloRegistro(campos, r)}</Text>
                </View>
                <Text style={styles.fecha}>{fechaCorta(r.fecha)}</Text>
              </View>
              {detalleRegistro(campos, r) ? <Text style={styles.meta} numberOfLines={5}>{detalleRegistro(campos, r)}</Text> : null}
              {estatus && r.valores[estatus.id] ? (
                <View style={[styles.estBadge, { backgroundColor: cerrado ? colors.successBg : colors.warningBg }]}>
                  <Text style={[styles.estBadgeTxt, { color: cerrado ? '#065F46' : '#92400E' }]}>
                    {String(r.valores[estatus.id])}{cerrado && cierre ? ` · cerrado el ${fechaCorta(String(cierre).slice(0, 10))}` : ''}
                  </Text>
                </View>
              ) : null}
              {thumbs.length ? (
                <View style={styles.thumbs}>
                  {thumbs.slice(0, 4).map((t, i) => (
                    <Image key={i} source={{ uri: t.startsWith('data:') ? t : `data:image/jpeg;base64,${t}` }} style={styles.thumb} resizeMode="cover" />
                  ))}
                </View>
              ) : null}
              <View style={styles.cardBottom}>
                <Text style={styles.meta}>{r.created_by_name ? `Registró: ${r.created_by_name}` : ''}{(r.n_ediciones || 0) > 0 ? ` · ${r.n_ediciones} edición${r.n_ediciones === 1 ? '' : 'es'}` : ''}</Text>
                {r.sincronizado === false ? <Text style={[styles.badge, { backgroundColor: colors.warningBg, color: '#92400E' }]}>Sin sincronizar</Text> : null}
                {modulo.usar_jerarquia && r.jerarquia ? <Text style={styles.badge}>{r.jerarquia}</Text> : null}
                {puedeEditar(r) ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Eliminar" hitSlop={8} onPress={() => borrar(r)}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {puedeEscribir && modulo.activo ? (
        <Pressable accessibilityRole="button" onPress={nuevo} style={[styles.fab, { bottom: insets.bottom + spacing.md }]}>
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={styles.fabTxt}>Nuevo registro</Text>
        </Pressable>
      ) : null}

      {/* Formulario */}
      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={2}>
                {draft?.id ? 'Editar' : 'Nuevo'} registro{draft?.folio ? ` ${draft.folio}` : ''} · {modulo.nombre}
              </Text>
              {draft?.id ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Historial" onPress={() => verHistorial(draft.id as string)} hitSlop={10}><Ionicons name="time-outline" size={22} color={colors.primary} /></Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={() => setDraft(null)} hitSlop={10}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.md }}>
              {draft ? (
                <>
                  <Text style={styles.fieldLabel}>Fecha</Text>
                  <TextInput
                    value={draft.fecha} onChangeText={(t) => setDraft((d) => (d ? { ...d, fecha: t } : d))}
                    placeholder="AAAA-MM-DD" placeholderTextColor={colors.textMuted} style={inputStyle} autoCapitalize="none"
                  />
                  {campos.map((f) => (campoVisible(f, draft.valores) ? (
                    <CampoInput
                      key={f.id} campo={f} value={draft.valores[f.id]} onChange={(v) => setValor(f.id, v)} nodos={nodos}
                      fotoUri={draft.previews[f.id]} onPickFoto={(s) => pickPhoto(f.id, s)} onClearFoto={() => quitarFoto(f.id)}
                    />
                  ) : null))}
                  {modulo.usar_jerarquia ? (
                    <JerarquiaInformePicker value={draft.jerarquia} onChange={(j) => setDraft((d) => (d ? { ...d, jerarquia: j } : d))} />
                  ) : null}
                </>
              ) : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={saving} onPress={guardar} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Menú ⋮ */}
      <Modal visible={verMenu} transparent animationType="fade" onRequestClose={() => setVerMenu(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setVerMenu(false)}>
          <View style={[styles.menu, { top: insets.top + 48 }]}>
            <MenuItem icon="grid-outline" label="Exportar a Excel" onPress={() => exportar('xlsx')} />
            <MenuItem icon="document-text-outline" label="Exportar a CSV" onPress={() => exportar('csv')} />
            {esCoordSub && modulo.activo ? <MenuItem icon="cloud-upload-outline" label="Importar desde Excel" onPress={() => { setVerMenu(false); setVerImportar(true); }} /> : null}
            {esCoordSub || user?.role === ROLE_JEFE ? <MenuItem icon="trash-bin-outline" label="Registros eliminados" onPress={abrirBorrados} /> : null}
            <Text style={styles.menuNote}>La exportación respeta el rango de fechas de los filtros.</Text>
          </View>
        </Pressable>
      </Modal>

      <FiltrosModal
        visible={verFiltros} filtros={filtros} campos={campos} autores={autores}
        onApply={setFiltros} onClose={() => setVerFiltros(false)}
      />
      <HistorialModal visible={historial !== null} historial={historial || []} onClose={() => setHistorial(null)} />
      <EliminadosModal visible={borrados !== null} items={borrados || []} campos={campos} onClose={() => setBorrados(null)} />
      <ImportarRegistrosModal
        visible={verImportar} projectId={projectId} moduloId={moduloId} campos={campos}
        onClose={() => setVerImportar(false)} onImported={load}
      />
    </View>
  );
}

function MenuItem({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.menuItem}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.menuTxt}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.md },
  desc: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm, lineHeight: 18 },
  aviso: { backgroundColor: colors.warningBg, color: '#92400E', fontSize: 12, fontWeight: '700', padding: spacing.sm, borderRadius: radius.md, marginBottom: spacing.sm, overflow: 'hidden' },
  filtroRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.xs },
  filtroBtn: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  limpiar: { marginBottom: spacing.sm },
  limpiarTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  estRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: spacing.sm },
  estChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.surface },
  estN: { fontSize: 14, fontWeight: '800', color: colors.text },
  estTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  totales: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  totalCell: { flexGrow: 1, minWidth: '45%', backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.sm },
  totalLabel: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  totalVal: { fontSize: 16, fontWeight: '800', color: colors.primaryDark, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.sm, padding: spacing.md },
  empty: { alignItems: 'center', gap: 6, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  folio: { fontSize: 11, fontWeight: '800', color: colors.primary, letterSpacing: 0.5 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  fecha: { fontSize: 12, fontWeight: '700', color: colors.primary },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 3, lineHeight: 17, flex: 1 },
  estBadge: { alignSelf: 'flex-start', borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  estBadgeTxt: { fontSize: 11, fontWeight: '800' },
  thumbs: { flexDirection: 'row', gap: 6, marginTop: 8 },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.border },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 },
  badge: { fontSize: 11, fontWeight: '800', color: colors.primaryDark, backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden', textTransform: 'capitalize' },
  fab: {
    position: 'absolute', right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary,
    paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radius.full, ...shadow.lg,
  },
  fabTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '92%', width: '100%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs, gap: spacing.md },
  sheetTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.25)' },
  menu: { position: 'absolute', right: spacing.md, width: 260, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm, ...shadow.lg },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: spacing.sm },
  menuTxt: { fontSize: 14, fontWeight: '700', color: colors.text },
  menuNote: { fontSize: 11, color: colors.textMuted, padding: spacing.sm, lineHeight: 15 },
});
