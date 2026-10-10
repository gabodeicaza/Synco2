// Registrar avance — uso diario en campo (alta frecuencia). Buscar un
// concepto por clave/descripción, capturar cuánto se ejecutó hoy y enviarlo.
// Offline-first: api.createAvance ya encola en avanceQueue.ts si no hay señal
// (mismo criterio que "Nuevo Reporte" — ver src/api.ts createAvance).
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, StatusBar, Image, Modal, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { api, Concepto, Project, LocationNodeTree } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { APP_BRAND } from '@/src/utils/roles';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { UNIDAD_LABELS, Unidad } from '@/src/utils/unidades';
import { concordanciaConcepto } from '@/src/utils/nombresNivel';
import { decimalStringToScaled, formatCantidad, pctDeDecimales } from '@/src/utils/money';
import { esRetrocesoLocal } from '@/src/utils/avancePorcentaje';
import { InlineError } from '@/src/components/InlineError';
import { showToast } from '@/src/utils/toast';
import {
  TipoAvance, excedenteAlCapturar, excedentePorcentajeAlCapturar, hayErrores, sumarCantidades, validarAvance,
} from '@/src/utils/validacionAvance';
import { DECIMALES_CANTIDAD, formatoNumero, mensajeNumeroInvalido, parseNumeroEntrada, SeparadorDecimal } from '@/src/utils/numeros';
import { useBusquedaConceptos } from '@/src/hooks/useBusquedaConceptos';
import { useEnvio } from '@/src/hooks/useEnvio';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { requestCameraPermission, requestMediaLibraryPermission } from '@/src/utils/permissions';
import { prepararFotoEvidencia } from '@/src/utils/comprimirFoto';
import { confirm } from '@/src/utils/confirm';
import { a11y, t } from '@/src/i18n';
import { fmtFecha, hoyProyecto } from '@/src/utils/fechas';

export default function RegistrarAvanceScreen({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const conc = concordanciaConcepto(project);

  const busqueda = useBusquedaConceptos(projectId, t('busquedaConceptos.errorBusqueda'));
  const [selected, setSelected] = useState<Concepto | null>(null);

  // La fecha de la captura es el "hoy" de la zona del PROYECTO (no la del
  // dispositivo ni UTC) y se calcula al enviar, así sigue correcta si la
  // pantalla queda abierta pasada la medianoche.
  const [cantidad, setCantidad] = useState('');
  // A-01: "avance" (incremento > 0) o "ajuste" (corrección con signo y motivo).
  const [tipo, setTipo] = useState<TipoAvance>('normal');
  const [motivo, setMotivo] = useState('');
  const { errores, errorGeneral, ponerTodos, limpiarTodo, alCambiar, errorDeGuardado } =
    useFormErrors<'cantidad' | 'motivo' | 'fecha'>();
  const [foto, setFoto] = useState<string | null>(null);
  const [errorFoto, setErrorFoto] = useState<string | null>(null);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const [preparandoFoto, setPreparandoFoto] = useState(false);
  const { guardando: saving, ejecutar } = useEnvio();

  // Nodo (opcional, nunca bloqueante) — si el residente sabe en qué nodo
  // ejecutó, se guarda aunque el cálculo de avance no lo use hoy (modo
  // CANTIDAD). Un proyecto sin árbol de nodos simplemente no ofrece este
  // campo: `nodes` queda vacío y el bloque ni se renderiza.
  const [nodes, setNodes] = useState<LocationNodeTree[]>([]);
  const [selectedNodo, setSelectedNodo] = useState<LocationNodeTree | null>(null);
  const [nodoPickerOpen, setNodoPickerOpen] = useState(false);

  useEffect(() => { api.getProject(projectId).then(setProject).catch(() => {}); }, [projectId]);
  useEffect(() => { api.getTree(projectId).then(setNodes).catch(() => setNodes([])); }, [projectId]);

  // T-05a: la evidencia entra por la cámara o por la galería y SIEMPRE se comprime
  // (1600 px, JPEG 0.7) antes de adjuntarse: pesa menos en la cola sin conexión.
  // El permiso se pide justo al tocar el botón, con la explicación de Fase 0.
  async function elegirFoto(origen: 'camara' | 'galeria') {
    setErrorFoto(null);
    setAvisoFoto(null);
    const permiso = origen === 'camara' ? await requestCameraPermission() : await requestMediaLibraryPermission();
    if (!permiso.granted) {
      if (origen === 'camara' && !permiso.canAskAgain) {
        const abrir = await confirm(t('permisos.camaraTitulo'), t('permisos.camaraMensaje'), { confirmText: t('permisos.abrirAjustes') });
        if (abrir) Linking.openSettings();
      }
      setErrorFoto(t(origen === 'camara' ? 'camaraEvidencia.permisoCamara' : 'camaraEvidencia.permisoGaleria'));
      return;
    }
    const opciones = { mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.8 };
    let resultado;
    try {
      resultado = origen === 'camara'
        ? await ImagePicker.launchCameraAsync(opciones)
        : await ImagePicker.launchImageLibraryAsync(opciones);
    } catch {
      setErrorFoto(t('camaraEvidencia.noSePudoLeer'));
      return;
    }
    if (resultado.canceled || !resultado.assets?.[0]) return;
    setPreparandoFoto(true);
    try {
      const r = await prepararFotoEvidencia(resultado.assets[0]);
      if (!r.ok) {
        setErrorFoto(
          r.motivo === 'demasiado_grande'
            ? t('camaraEvidencia.demasiadaGrande', { mb: ((r.bytes ?? 0) / (1024 * 1024)).toFixed(1) })
            : t('camaraEvidencia.noSePudoLeer'),
        );
        return;
      }
      setFoto(r.dataUri);
      if (!r.comprimida) setAvisoFoto(t('camaraEvidencia.sinCompresion'));
    } finally {
      setPreparandoFoto(false);
    }
  }

  const esPorcentaje = project?.modo_avance === 'PORCENTAJE';

  // A-07/X-05: se acepta "1,500" y "1500" según el separador del proyecto; al API siempre
  // va el decimal con punto. La cantidad de avance admite hasta 4 decimales.
  const separador: SeparadorDecimal = project?.separador_decimal === ',' ? ',' : '.';
  const opcionesNumero = { separador, maxDecimales: DECIMALES_CANTIDAD, permitirNegativo: tipo === 'ajuste' };
  const lectura = parseNumeroEntrada(cantidad, opcionesNumero);
  const cantidadApi = lectura.ok ? lectura.valor : '';

  function darFormatoCantidad() {
    if (!lectura.ok) return;
    const texto = formatoNumero(lectura.valor, { separador, maxDecimales: DECIMALES_CANTIDAD });
    if (texto && texto !== cantidad) setCantidad(texto);
  }

  function limpiarFormulario() {
    setSelected(null);
    setCantidad('');
    setMotivo('');
    setTipo('normal');
    setFoto(null);
    setErrorFoto(null);
    setAvisoFoto(null);
    setSelectedNodo(null);
    busqueda.limpiar();
    limpiarTodo();
  }

  async function submit() {
    if (!selected) return;
    await ejecutar(async () => {
      const fecha = hoyProyecto(project);
      const e = validarAvance({ cantidad: cantidadApi, tipo, motivo, fecha, hoy: hoyProyecto(project), esPorcentaje });
      if (!lectura.ok && lectura.motivo === 'decimales') {
        e.cantidad = mensajeNumeroInvalido('decimales', DECIMALES_CANTIDAD, t('capturaAvance.cantidad'));
      }
      if (ponerTodos(e) || hayErrores(e)) return;
      try {
        const res = await api.createAvance({
          concepto_id: selected.id,
          fecha,
          cantidad_ejecutada: cantidadApi,
          fotos: foto ? [foto] : [],
          nodo_id: selectedNodo?.id,
          tipo,
          motivo: tipo === 'ajuste' ? motivo.trim() : undefined,
        });
        const resumen = esPorcentaje
          ? `${selected.clave} · va al ${formatCantidad(cantidadApi)}%`
          : `${selected.clave} · ${formatCantidad(cantidadApi)} ${selected.unidad}`;
        if (res.es_retroceso) {
          // Un retroceso se permite (nunca se rechaza) pero nunca se guarda
          // como si nada: el aviso es distinto del de éxito normal.
          showToast(`${t('avance.retrocesoTitulo')}. ${resumen}. ${t('avance.retrocesoDetalle')}`);
        } else {
          showToast(`${tipo === 'ajuste' ? t('avance.ajusteRegistrado') : t('avance.registrado')}: ${resumen}`);
        }
        limpiarFormulario();
      } catch (err: any) {
        errorDeGuardado(err, t('avance.noSePudoRegistrar'));
      }
    });
  }

  // Aviso informativo (nunca bloquea): la captura pasa de lo contratado.
  const avisoExcedente = (() => {
    if (!selected || !cantidadApi || tipo === 'ajuste') return null;
    if (esPorcentaje) {
      const r = excedentePorcentajeAlCapturar(cantidadApi);
      return r.excede ? t('avance.excedePorcentaje', { excedente: formatCantidad(r.excedente) }) : null;
    }
    const r = excedenteAlCapturar(selected.cantidad_ejecutada_acumulada, cantidadApi, selected.cantidad);
    if (!r.excede) return null;
    return t('avance.excedeVolumen', {
      ejecutado: formatCantidad(sumarCantidades(selected.cantidad_ejecutada_acumulada, cantidadApi)),
      contratado: formatCantidad(selected.cantidad),
      unidad: selected.unidad,
      excedente: formatCantidad(r.excedente),
    });
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader title={APP_BRAND} backgroundColor={colors.primary} />
      <Text style={styles.titleBar}>{t('avanceNiveles.tituloRegistrar', { proyecto: (project?.name || '').toUpperCase() })}</Text>
      <Text style={styles.subtitle}>{fmtFecha(hoyProyecto())}</Text>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!selected ? (
          <>
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={18} color={colors.textMuted} />
              <TextInput
                value={busqueda.query}
                onChangeText={busqueda.setQuery}
                placeholder={t('avanceNiveles.buscarConcepto', { concepto: conc.minuscula })}
                placeholderTextColor={colors.textMuted}
                style={styles.searchInput}
                autoCorrect={false}
                accessibilityLabel={t('avanceNiveles.buscarConceptoLabel', { concepto: conc.minuscula })}
              />
            </View>
            {busqueda.cargando ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} accessibilityLabel={t('busquedaConceptos.cargando')} />
            ) : null}
            {!busqueda.cargando && busqueda.error ? (
              <View style={styles.busquedaError}>
                <InlineError message={busqueda.error} />
                <Pressable accessibilityRole="button" onPress={busqueda.reintentar} style={styles.reintentarBtn}>
                  <Ionicons name="refresh" size={14} color={colors.primary} />
                  <Text style={styles.changeBtnTxt}>{t('busquedaConceptos.reintentar')}</Text>
                </Pressable>
              </View>
            ) : null}
            {!busqueda.cargando && !busqueda.error && busqueda.results.length === 0 ? (
              <Text style={styles.ayudaTxt}>
                {busqueda.buscado
                  ? t('busquedaConceptos.sinResultados', { texto: busqueda.buscado })
                  : t('busquedaConceptos.sinConceptos')}
              </Text>
            ) : null}
            {!busqueda.cargando && !busqueda.error && !busqueda.buscado && busqueda.results.length > 0 ? (
              <Text style={styles.ayudaTxt}>{t('busquedaConceptos.listaPorDefecto')}</Text>
            ) : null}
            {!busqueda.cargando && !busqueda.error ? busqueda.results.map((c) => (
              <Pressable accessibilityRole="button" key={c.id} style={styles.resultCard} onPress={() => setSelected(c)}>
                <Text style={styles.resultPartida}>{c.partida_clave} — {c.partida_nombre}</Text>
                <Text style={styles.resultClave}>{c.clave} · {c.descripcion}</Text>
                <Text style={styles.resultMeta}>
                  {project?.modo_avance === 'PORCENTAJE'
                    ? t('avanceNiveles.vaAlPorcentaje', { valor: formatCantidad(c.cantidad_ejecutada_acumulada) })
                    : `${c.meta ? t('avanceNiveles.metaPrefijo', { meta: formatCantidad(c.meta), unidad: c.unidad }) : ''}${t('avanceNiveles.ejecutadoDe', {
                      ejecutado: formatCantidad(c.cantidad_ejecutada_acumulada), contratado: formatCantidad(c.cantidad), unidad: c.unidad,
                    })}`}
                </Text>
              </Pressable>
            )) : null}
          </>
        ) : (
          <View style={styles.formCard}>
            <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={styles.changeBtn}>
              <Ionicons name="chevron-back" size={14} color={colors.primary} />
              <Text style={styles.changeBtnTxt}>{t('avanceNiveles.cambiarConcepto', { concepto: conc.minuscula })}</Text>
            </Pressable>
            <Text style={styles.selectedClave}>{selected.clave}</Text>
            <Text style={styles.selectedDesc}>{selected.descripcion}</Text>
            <Text style={styles.selectedMeta}>
              {t('avanceNiveles.unidadContratado', {
                unidad: UNIDAD_LABELS[selected.unidad as Unidad] || selected.unidad, contratado: formatCantidad(selected.cantidad),
              })}
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
                ? decimalStringToScaled(selected.cantidad_ejecutada_acumulada, DECIMALES_CANTIDAD) / 10 ** DECIMALES_CANTIDAD
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
                    onPress={() => { setTipo(m); limpiarTodo(); }}
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
                  <Text style={styles.fieldLabel}>{t('avanceNiveles.conceptoVaAl', { El: conc.El, concepto: conc.minuscula })}</Text>
                  <Text style={styles.pctAnteriorTxt}>
                    {t('avanceNiveles.anterior', { valor: formatCantidad(selected.cantidad_ejecutada_acumulada) })}
                  </Text>
                </View>
                {/* Acumulativo, no incremental — el residente escribe el
                    estado al que llegó el concepto, no cuánto avanzó hoy.
                    Un valor menor al anterior se permite (retroceso real de
                    obra existe) pero se avisa al confirmar, ver submit(). */}
              </>
            ) : (
              <Text style={styles.fieldLabel}>
                {tipo === 'ajuste' ? t('avance.cantidadAjuste', { unidad: selected.unidad }) : t('avanceNiveles.cantidadHoy', { unidad: selected.unidad })}
              </Text>
            )}
            <TextInput
              value={cantidad}
              onChangeText={alCambiar('cantidad', setCantidad)}
              onBlur={darFormatoCantidad}
              onSubmitEditing={tipo === 'ajuste' ? undefined : submit}
              returnKeyType={tipo === 'ajuste' ? 'next' : 'done'}
              inputMode={tipo === 'ajuste' ? undefined : 'decimal'}
              autoCorrect={false}
              placeholder={esPorcentaje ? '0.00' : tipo === 'ajuste' ? '-0.00' : '0.00'}
              keyboardType={tipo === 'ajuste' ? 'numbers-and-punctuation' : 'decimal-pad'}
              style={[styles.qtyInput, errores.cantidad ? styles.inputConError : null]}
              autoFocus
              editable={!saving}
              accessibilityLabel={esPorcentaje
                ? t('avanceNiveles.etiquetaPorcentaje', { el: conc.el, concepto: conc.minuscula })
                : t('avanceNiveles.etiquetaCantidad')}
            />
            <InlineError message={errores.cantidad} />
            {avisoExcedente ? <Text style={styles.avisoExcedente}>{avisoExcedente}</Text> : null}
            {tipo === 'ajuste' ? (
              <>
                <Text style={styles.fieldLabel}>{t('avance.motivo')}</Text>
                <TextInput
                  value={motivo}
                  onChangeText={alCambiar('motivo', setMotivo)}
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
            {esPorcentaje && cantidadApi && esRetrocesoLocal(cantidadApi, selected.cantidad_ejecutada_acumulada) ? (
              <Text style={styles.pctRetrocesoTxt}>
                {t('avanceNiveles.retroceso', { valor: formatCantidad(selected.cantidad_ejecutada_acumulada) })}
              </Text>
            ) : null}

            {nodes.length > 0 ? (
              <>
                <Text style={styles.fieldLabel}>{t('avanceNiveles.nodoOpcional')}</Text>
                <Pressable accessibilityRole="button" style={styles.nodoBtn} onPress={() => setNodoPickerOpen(true)}>
                  <Ionicons name="location-outline" size={16} color={colors.primary} />
                  <Text style={styles.nodoBtnTxt} numberOfLines={1}>
                    {selectedNodo ? selectedNodo.name : t('avanceNiveles.sinEspecificar')}
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

            <Text style={styles.photoBtnTxt}>{foto ? t('camaraEvidencia.cambiar') : t('camaraEvidencia.adjuntar')}</Text>
            <View style={styles.photoRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('camaraEvidencia.tomarFoto')}
                style={[styles.photoBtn, (preparandoFoto || saving) && { opacity: 0.5 }]}
                disabled={preparandoFoto || saving}
                onPress={() => elegirFoto('camara')}
              >
                <Ionicons name="camera-outline" size={18} color={colors.primary} />
                <Text style={styles.photoBtnTxt}>{t('camaraEvidencia.tomarFoto')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('camaraEvidencia.elegirGaleria')}
                style={[styles.photoBtn, (preparandoFoto || saving) && { opacity: 0.5 }]}
                disabled={preparandoFoto || saving}
                onPress={() => elegirFoto('galeria')}
              >
                <Ionicons name="images-outline" size={18} color={colors.primary} />
                <Text style={styles.photoBtnTxt}>{t('camaraEvidencia.elegirGaleria')}</Text>
              </Pressable>
            </View>
            {preparandoFoto ? <ActivityIndicator color={colors.primary} style={{ marginTop: 6 }} /> : null}
            <InlineError message={errorFoto} style={{ marginTop: 6 }} />
            {avisoFoto ? <Text style={styles.avisoExcedente}>{avisoFoto}</Text> : null}
            {foto ? (
              <View>
                <Image source={{ uri: foto }} style={styles.photoPreview} accessibilityLabel={t('camaraEvidencia.vistaPrevia')} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('camaraEvidencia.quitar')}
                  style={styles.photoQuitar}
                  onPress={() => { setFoto(null); setAvisoFoto(null); }}
                >
                  <Ionicons name="close-circle" size={22} color={colors.error} />
                  <Text style={styles.photoQuitarTxt}>{t('camaraEvidencia.quitar')}</Text>
                </Pressable>
              </View>
            ) : null}

            <InlineError message={errorGeneral} />

            <Pressable accessibilityRole="button" style={[styles.submitBtn, (!cantidad || saving) && { opacity: 0.5 }]} onPress={submit} disabled={!cantidad || saving}>
              {saving ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={styles.submitBtnTxt}>{tipo === 'ajuste' ? t('avanceNiveles.registrarAjuste') : t('avanceNiveles.registrarAvance')}</Text>
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
            <Text style={styles.pickerTitle}>{t('avanceNiveles.elegirNodo')}</Text>
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
  busquedaError: { gap: 8 },
  reintentarBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44 },
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

  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md,
  },
  photoBtnTxt: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  photoQuitar: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  photoQuitarTxt: { color: colors.error, fontSize: 13, fontWeight: '600' },
  photoPreview: { width: '100%', height: 160, borderRadius: radius.md, marginTop: 6 },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingVertical: 14, marginTop: 12,
  },
  submitBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
