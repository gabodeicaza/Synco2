// Registrar avance — uso diario en campo (alta frecuencia). Buscar un
// concepto por clave/descripción, capturar cuánto se ejecutó hoy y enviarlo.
// Offline-first: api.createAvance ya encola en avanceQueue.ts si no hay señal
// (mismo criterio que "Nuevo Reporte" — ver src/api.ts createAvance).
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, StatusBar, Alert, Image, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { api, Concepto, ConceptoSearchResult, Project, LocationNodeTree } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { APP_BRAND } from '@/src/utils/roles';
import { UNIDAD_LABELS, Unidad } from '@/src/utils/unidades';
import { nombreConcepto } from '@/src/utils/nombresNivel';
import { centsToDecimalString, decimalStringToCents, formatCantidad, pctDeDecimales } from '@/src/utils/money';
import { esRetrocesoLocal } from '@/src/utils/avancePorcentaje';
import { InlineError } from '@/src/components/InlineError';
import { showToast } from '@/src/utils/toast';
import { esErrorDeRed } from '@/src/utils/errores';
import {
  ErroresAvance, TipoAvance, excedenteAlCapturar, excedentePorcentajeAlCapturar, hayErrores, validarAvance,
} from '@/src/utils/validacionAvance';
import { requestMediaLibraryPermission } from '@/src/utils/permissions';
import { a11y, t } from '@/src/i18n';
import { fmtFecha, hoyProyecto } from '@/src/utils/fechas';

export default function RegistrarAvanceScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [project, setProject] = useState<Project | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConceptoSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Concepto | null>(null);

  // La fecha de la captura es el "hoy" de la zona del PROYECTO (no la del
  // dispositivo ni UTC) y se calcula al enviar, así sigue correcta si la
  // pantalla queda abierta pasada la medianoche.
  const [cantidad, setCantidad] = useState('');
  // A-01: "avance" (incremento > 0) o "ajuste" (corrección con signo y motivo).
  const [tipo, setTipo] = useState<TipoAvance>('normal');
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<ErroresAvance>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Nodo (opcional, nunca bloqueante) — si el residente sabe en qué nodo
  // ejecutó, se guarda aunque el cálculo de avance no lo use hoy (modo
  // CANTIDAD). Un proyecto sin árbol de nodos simplemente no ofrece este
  // campo: `nodes` queda vacío y el bloque ni se renderiza.
  const [nodes, setNodes] = useState<LocationNodeTree[]>([]);
  const [selectedNodo, setSelectedNodo] = useState<LocationNodeTree | null>(null);
  const [nodoPickerOpen, setNodoPickerOpen] = useState(false);

  useEffect(() => { api.getProject(projectId).then(setProject).catch(() => {}); }, [projectId]);
  useEffect(() => { api.getTree(projectId).then(setNodes).catch(() => setNodes([])); }, [projectId]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.searchConceptos(projectId, { q: query });
        setResults(r);
      } catch {
        /* noop: busqueda best-effort */
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, projectId]);

  async function pickPhoto() {
    const perm = await requestMediaLibraryPermission();
    if (!perm.granted) {
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
    setFoto(`data:${mime};base64,${asset.base64}`);
  }

  const esPorcentaje = project?.modo_avance === 'PORCENTAJE';

  function limpiarFormulario() {
    setSelected(null);
    setCantidad('');
    setMotivo('');
    setTipo('normal');
    setFoto(null);
    setSelectedNodo(null);
    setQuery('');
    setResults([]);
    setErrores({});
    setErrorGeneral(null);
  }

  async function submit() {
    if (!selected || saving) return;
    const fecha = hoyProyecto(project);
    const e = validarAvance({ cantidad, tipo, motivo, fecha, hoy: hoyProyecto(project), esPorcentaje });
    setErrores(e);
    setErrorGeneral(null);
    if (hayErrores(e)) return;
    try {
      setSaving(true);
      const res = await api.createAvance({
        concepto_id: selected.id,
        fecha,
        cantidad_ejecutada: cantidad.trim(),
        fotos: foto ? [foto] : [],
        nodo_id: selectedNodo?.id,
        tipo,
        motivo: tipo === 'ajuste' ? motivo.trim() : undefined,
      });
      const resumen = esPorcentaje
        ? `${selected.clave} · va al ${formatCantidad(cantidad)}%`
        : `${selected.clave} · ${formatCantidad(cantidad)} ${selected.unidad}`;
      if (res.es_retroceso) {
        // Un retroceso se permite (nunca se rechaza) pero nunca se guarda
        // como si nada: el aviso es distinto del de éxito normal.
        showToast(`${t('avance.retrocesoTitulo')}. ${resumen}. ${t('avance.retrocesoDetalle')}`);
      } else {
        showToast(`${tipo === 'ajuste' ? t('avance.ajusteRegistrado') : t('avance.registrado')}: ${resumen}`);
      }
      limpiarFormulario();
    } catch (err: any) {
      if (esErrorDeRed(err)) showToast(t('red.errorDeRed'));
      else setErrorGeneral(err?.message || t('avance.noSePudoRegistrar'));
    } finally {
      setSaving(false);
    }
  }

  // Aviso informativo (nunca bloquea): la captura pasa de lo contratado.
  const avisoExcedente = (() => {
    if (!selected || !cantidad || tipo === 'ajuste') return null;
    if (esPorcentaje) {
      const r = excedentePorcentajeAlCapturar(cantidad);
      return r.excede ? t('avance.excedePorcentaje', { excedente: formatCantidad(r.excedente) }) : null;
    }
    const r = excedenteAlCapturar(selected.cantidad_ejecutada_acumulada, cantidad, selected.cantidad);
    if (!r.excede) return null;
    return t('avance.excedeVolumen', {
      ejecutado: formatCantidad(centsToDecimalString(decimalStringToCents(selected.cantidad_ejecutada_acumulada) + decimalStringToCents(cantidad))),
      contratado: formatCantidad(selected.cantidad),
      unidad: selected.unidad,
      excedente: formatCantidad(r.excedente),
    });
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')} onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.brand}>{APP_BRAND}</Text>
        <View style={{ width: 32 }} />
      </View>
      <Text style={styles.titleBar}>REGISTRAR AVANCE — {(project?.name || '').toUpperCase()}</Text>
      <Text style={styles.subtitle}>{fmtFecha(hoyProyecto())}</Text>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!selected ? (
          <>
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={18} color={colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={`Buscar ${nombreConcepto(project).toLowerCase()} por clave o descripción…`}
                placeholderTextColor={colors.textMuted}
                style={styles.searchInput}
              />
            </View>
            {searching ? <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} /> : null}
            {results.map((c) => (
              <Pressable accessibilityRole="button" key={c.id} style={styles.resultCard} onPress={() => setSelected(c)}>
                <Text style={styles.resultPartida}>{c.partida_clave} — {c.partida_nombre}</Text>
                <Text style={styles.resultClave}>{c.clave} · {c.descripcion}</Text>
                <Text style={styles.resultMeta}>
                  {project?.modo_avance === 'PORCENTAJE'
                    ? `Va al ${formatCantidad(c.cantidad_ejecutada_acumulada)}%`
                    : `Meta: ${formatCantidad(c.meta)} ${c.unidad} · Ejecutado: ${formatCantidad(c.cantidad_ejecutada_acumulada)} de ${formatCantidad(c.cantidad)} ${c.unidad}`}
                </Text>
              </Pressable>
            ))}
          </>
        ) : (
          <View style={styles.formCard}>
            <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={styles.changeBtn}>
              <Ionicons name="chevron-back" size={14} color={colors.primary} />
              <Text style={styles.changeBtnTxt}>Cambiar concepto</Text>
            </Pressable>
            <Text style={styles.selectedClave}>{selected.clave}</Text>
            <Text style={styles.selectedDesc}>{selected.descripcion}</Text>
            <Text style={styles.selectedMeta}>
              Unidad: {UNIDAD_LABELS[selected.unidad as Unidad] || selected.unidad} · Contratado: {formatCantidad(selected.cantidad)}
            </Text>

            {/* Avance acumulado a la fecha — fracción + porcentaje. Antes solo
                se veía en la tarjeta de resultados de búsqueda y desaparecía
                justo al seleccionar el concepto, que es cuando más se
                necesita para decidir cuánto capturar. */}
            {(() => {
              const avanceFraccionTxt = esPorcentaje
                ? `${formatCantidad(selected.cantidad_ejecutada_acumulada)}%`
                : `${formatCantidad(selected.cantidad_ejecutada_acumulada)} / ${formatCantidad(selected.cantidad)} ${selected.unidad}`;
              const avancePct = esPorcentaje
                ? decimalStringToCents(selected.cantidad_ejecutada_acumulada) / 100
                : pctDeDecimales(selected.cantidad_ejecutada_acumulada, selected.cantidad);
              const barWidth = Math.max(0, Math.min(100, avancePct));
              return (
                <View style={styles.progressBox}>
                  <View style={styles.progressBoxRow}>
                    <Text style={styles.progressFraction}>{avanceFraccionTxt}</Text>
                    <Text style={styles.progressPctTxt}>{formatCantidad(String(avancePct))}%</Text>
                  </View>
                  <View style={styles.progressBarTrack}>
                    <View style={[styles.progressBarFill, { width: `${barWidth}%` }]} />
                  </View>
                </View>
              );
            })()}

            {!esPorcentaje ? (
              <View style={styles.modeRow} accessibilityRole="tablist">
                {(['normal', 'ajuste'] as TipoAvance[]).map((m) => (
                  <Pressable
                    key={m}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: tipo === m }}
                    onPress={() => { setTipo(m); setErrores({}); setErrorGeneral(null); }}
                    style={[styles.modeChip, tipo === m && styles.modeChipOn]}
                  >
                    <Text style={[styles.modeChipTxt, tipo === m && styles.modeChipTxtOn]}>
                      {m === 'normal' ? t('avance.modoAvance') : t('avance.modoAjuste')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {tipo === 'ajuste' ? <Text style={styles.ayudaTxt}>{t('avance.ajusteAyuda')}</Text> : null}

            {esPorcentaje ? (
              <>
                <View style={styles.pctLabelRow}>
                  <Text style={styles.fieldLabel}>El concepto va al ___%</Text>
                  <Text style={styles.pctAnteriorTxt}>
                    Anterior: {formatCantidad(selected.cantidad_ejecutada_acumulada)}%
                  </Text>
                </View>
                {/* Acumulativo, no incremental — el residente escribe el
                    estado al que llegó el concepto, no cuánto avanzó hoy.
                    Un valor menor al anterior se permite (retroceso real de
                    obra existe) pero se avisa al confirmar, ver submit(). */}
              </>
            ) : (
              <Text style={styles.fieldLabel}>
                {tipo === 'ajuste' ? t('avance.cantidadAjuste', { unidad: selected.unidad }) : `Cantidad ejecutada hoy (${selected.unidad})`}
              </Text>
            )}
            <TextInput
              value={cantidad}
              onChangeText={(v) => { setCantidad(v); if (errores.cantidad) setErrores((x) => ({ ...x, cantidad: undefined })); }}
              placeholder={esPorcentaje ? '0.00' : tipo === 'ajuste' ? '-0.00' : '0.00'}
              keyboardType={tipo === 'ajuste' ? 'numbers-and-punctuation' : 'decimal-pad'}
              style={[styles.qtyInput, errores.cantidad ? styles.inputConError : null]}
              autoFocus
              editable={!saving}
              accessibilityLabel={esPorcentaje ? 'Porcentaje al que va el concepto' : 'Cantidad ejecutada'}
            />
            <InlineError message={errores.cantidad} />
            {avisoExcedente ? <Text style={styles.avisoExcedente}>{avisoExcedente}</Text> : null}
            {tipo === 'ajuste' ? (
              <>
                <Text style={styles.fieldLabel}>{t('avance.motivo')}</Text>
                <TextInput
                  value={motivo}
                  onChangeText={(v) => { setMotivo(v); if (errores.motivo) setErrores((x) => ({ ...x, motivo: undefined })); }}
                  placeholder={t('avance.motivoPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  style={[styles.motivoInput, errores.motivo ? styles.inputConError : null]}
                  multiline
                  editable={!saving}
                  accessibilityLabel={t('avance.motivo')}
                />
                <InlineError message={errores.motivo} />
              </>
            ) : null}
            <InlineError message={errores.fecha} />
            {esPorcentaje && cantidad && esRetrocesoLocal(cantidad, selected.cantidad_ejecutada_acumulada) ? (
              <Text style={styles.pctRetrocesoTxt}>
                Este valor es menor que el {formatCantidad(selected.cantidad_ejecutada_acumulada)}% anterior — se permite, pero se marcará como retroceso.
              </Text>
            ) : null}

            {nodes.length > 0 ? (
              <>
                <Text style={styles.fieldLabel}>Nodo (opcional)</Text>
                <Pressable accessibilityRole="button" style={styles.nodoBtn} onPress={() => setNodoPickerOpen(true)}>
                  <Ionicons name="location-outline" size={16} color={colors.primary} />
                  <Text style={styles.nodoBtnTxt} numberOfLines={1}>
                    {selectedNodo ? selectedNodo.name : 'Sin especificar'}
                  </Text>
                  {selectedNodo ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} onPress={() => setSelectedNodo(null)} hitSlop={8}>
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </Pressable>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  )}
                </Pressable>
              </>
            ) : null}

            <Pressable accessibilityRole="button" style={styles.photoBtn} onPress={pickPhoto}>
              <Ionicons name="camera-outline" size={18} color={colors.primary} />
              <Text style={styles.photoBtnTxt}>{foto ? 'Cambiar foto de evidencia' : 'Adjuntar foto de evidencia (opcional)'}</Text>
            </Pressable>
            {foto ? <Image source={{ uri: foto }} style={styles.photoPreview} /> : null}

            <InlineError message={errorGeneral} />

            <Pressable accessibilityRole="button" style={[styles.submitBtn, (!cantidad || saving) && { opacity: 0.5 }]} onPress={submit} disabled={!cantidad || saving}>
              {saving ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={styles.submitBtnTxt}>{tipo === 'ajuste' ? 'Registrar ajuste' : 'Registrar avance'}</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>

      <NodoPickerModal
        visible={nodoPickerOpen}
        nodes={nodes}
        onClose={() => setNodoPickerOpen(false)}
        onSelect={(n) => { setSelectedNodo(n); setNodoPickerOpen(false); }}
      />
    </View>
  );
}

// ============================================================================
// Selector de nodo — árbol aplanado con indentación por profundidad. Simple
// a propósito: este campo es opcional y de un solo uso en esta pantalla: la
// vista de matriz (Etapa 3) es otra pantalla, con su propia navegación por
// árbol más rica.
// ============================================================================
function _flattenNodeTree(nodes: LocationNodeTree[], depth = 0): { node: LocationNodeTree; depth: number }[] {
  const out: { node: LocationNodeTree; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children?.length) out.push(..._flattenNodeTree(n.children, depth + 1));
  }
  return out;
}

function NodoPickerModal({
  visible, nodes, onClose, onSelect,
}: {
  visible: boolean;
  nodes: LocationNodeTree[];
  onClose: () => void;
  onSelect: (n: LocationNodeTree) => void;
}) {
  const flat = _flattenNodeTree(nodes);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.pickerBackdrop}>
        <View style={styles.pickerCard}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Elegir nodo</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 360 }}>
            {flat.map(({ node, depth }) => (
              <Pressable accessibilityRole="button" key={node.id} style={[styles.pickerRow, { paddingLeft: 14 + depth * 18 }]} onPress={() => onSelect(node)}>
                <Ionicons name="location-outline" size={14} color={colors.primary} />
                <Text style={styles.pickerRowTxt} numberOfLines={1}>{node.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, backgroundColor: colors.primary, paddingBottom: spacing.sm },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#fff', fontWeight: '800', fontSize: 15 },
  titleBar: { fontSize: 14, fontWeight: '800', color: colors.text, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  subtitle: { fontSize: 12, color: colors.textMuted, paddingHorizontal: spacing.md, marginBottom: spacing.sm, textTransform: 'capitalize' },

  scroll: { padding: spacing.md, paddingBottom: 60, gap: 10 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },

  resultCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 3 },
  resultPartida: { fontSize: 10, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase' },
  resultClave: { fontSize: 13, fontWeight: '700', color: colors.text },
  resultMeta: { fontSize: 11, color: colors.textMuted },

  formCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: 10, ...shadow.card },
  changeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  changeBtnTxt: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  selectedClave: { fontSize: 18, fontWeight: '800', color: colors.text },
  selectedDesc: { fontSize: 14, color: colors.textBody },
  selectedMeta: { fontSize: 12, color: colors.textMuted },

  progressBox: { backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 6 },
  progressBoxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressFraction: { fontSize: 14, fontWeight: '700', color: colors.text },
  progressPctTxt: { fontSize: 14, fontWeight: '800', color: colors.primary },
  progressBarTrack: { height: 8, borderRadius: radius.full, backgroundColor: colors.border, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.primary },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 8 },
  qtyInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 20, fontWeight: '700', color: colors.text, backgroundColor: colors.bg,
  },
  pctLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  pctAnteriorTxt: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  pctRetrocesoTxt: { fontSize: 11, color: colors.warning, fontWeight: '600', marginTop: 4 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  modeChip: {
    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  modeChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeChipTxt: { fontSize: 13, fontWeight: '700', color: colors.textBody },
  modeChipTxtOn: { color: colors.textInverse },
  ayudaTxt: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  inputConError: { borderColor: colors.error },
  avisoExcedente: {
    fontSize: 12, color: colors.textBody, backgroundColor: colors.warningBg, borderRadius: radius.md,
    padding: 10, fontWeight: '600', marginTop: 6,
  },
  motivoInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg, minHeight: 64, textAlignVertical: 'top',
  },

  nodoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.bg,
  },
  nodoBtnTxt: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '600' },

  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  pickerCard: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.lg },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerRowTxt: { flex: 1, fontSize: 13, color: colors.text },

  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  photoBtnTxt: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  photoPreview: { width: '100%', height: 160, borderRadius: radius.md, marginTop: 6 },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingVertical: 14, marginTop: 12,
  },
  submitBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
