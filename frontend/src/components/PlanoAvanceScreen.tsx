// Con `categoria="tapial"` este MISMO componente sirve el módulo Tapial: los
// planos se filtran por categoría y la herramienta principal es el TRAMO — una
// polilínea de N vértices con estado propio. Los tramos son independientes
// entre sí, así que los huecos entre ellos (accesos, portones, frentes sin
// tapial) son la discontinuidad; el backend calcula el % terminado por
// longitud (ver `_plano_tapial_avance`, backend/server.py).
// Plano de Avance — lista de planos (blueprints) del proyecto + editor de
// marcadores de estado (punto=columna, dado=rectángulo de cimentación,
// segmento=trabe; rojo/ámbar/verde) sobre cada uno. Mismo patrón "un
// componente hace todo, rutas delgadas por rol" que EstudiosProyectoScreen.tsx.
// Definir/reposicionar marcadores (incluido el modo "Mover", arrastrar) es
// exclusivo de Coordinador/Sub-Coordinador; actualizar SOLO el estado de un
// marcador ya colocado lo puede hacer cualquier rol de escritura
// (Especialista incluido) — el backend aplica el mismo criterio en PATCH
// .../markers/{id}. Al arrastrar un punto/dado en modo Mover, las trabes
// cuyo extremo coincidía con su posición original se mueven junto con él
// (ver onDragEndMarker/CONEXION_TOL) — antes había que rehacerlas a mano.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform, useWindowDimensions, Image as RNImage,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, LocationNode, PlanoAvance, PlanoCategoria, PlanoMarker, PlanoMarkerEstatus, Project } from '@/src/api';
import { EstacionPicker } from '@/src/components/EstacionPicker';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { confirm } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';
import { PlanoMarkerOverlay, PLANO_MARKER_ESTADO_COLOR, PLANO_MARKER_ESTADO_LABEL } from '@/src/components/PlanoMarkerOverlay';
import { requestMediaLibraryPermission } from '@/src/utils/permissions';
import { t, a11y  } from '@/src/i18n';
import { useModalUnico } from '@/src/hooks/useModalUnico';
import { ESTILO_CAPA_CONTROLES, ESTILO_CAPA_MODAL, ESTILO_CAPA_PLANO } from '@/src/utils/capasPlano';

type AddMode = 'none' | 'punto' | 'segmento' | 'dado' | 'tramo';
type LabelPromptDraft = {
  tipo: 'punto' | 'segmento' | 'dado' | 'tramo'; x: number; y: number; x2?: number; y2?: number; puntos?: number[][];
};
// Tolerancia (fracción 0-1 del tamaño de la imagen) para considerar que una
// trabe (segmento) estaba "conectada" a un punto/dado — coincide con el
// mismo criterio con el que el usuario las dibujó (tocando el mismo lugar).
const CONEXION_TOL = 0.015;

export default function PlanoAvanceScreen({
  projectId, categoria = 'avance',
}: { projectId: string; categoria?: PlanoCategoria }) {
  const esTapial = categoria === 'tapial';
  const tituloPantalla = esTapial ? 'Tapial' : 'Plano de Avance';
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { user } = useAuth();
  const canEditEstructura = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [planos, setPlanos] = useState<PlanoAvance[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlanoAvance | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);

  const [addMode, setAddMode] = useState<AddMode>('none');
  const [moverActivo, setMoverActivo] = useState(false);
  const [segmentDraft, setSegmentDraft] = useState<{ x: number; y: number } | null>(null);
  const [tramoDraft, setTramoDraft] = useState<{ x: number; y: number }[]>([]);
  const [labelPrompt, setLabelPrompt] = useState<LabelPromptDraft | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [savingMarker, setSavingMarker] = useState(false);
  const [movingMarkerId, setMovingMarkerId] = useState<string | null>(null);

  const [markerModal, setMarkerModal] = useState<PlanoMarker | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // K-06: un solo modal a la vez. Los datos (marcador, borrador de etiqueta) viven en su
  // estado; qué modal se ve lo decide este hook, así abrir "renombrar" oculta el del
  // marcador en vez de apilarse encima.
  const modal = useModalUnico<'etiqueta' | 'marcador' | 'renombrar' | 'nuevoPlano'>();
  const renamePrompt = modal.esta('renombrar');
  const newPlanoOpen = modal.esta('nuevoPlano');
  const etiquetaVisible = !!labelPrompt && modal.esta('etiqueta');
  const marcadorVisible = !!markerModal && modal.esta('marcador');

  function abrirEtiqueta(borrador: LabelPromptDraft) { setLabelPrompt(borrador); modal.abrir('etiqueta'); }
  function cerrarEtiqueta() { setLabelPrompt(null); modal.cerrar('etiqueta'); }
  function abrirMarcador(m: PlanoMarker) { setMarkerModal(m); modal.abrir('marcador'); }
  function cerrarMarcador() { setMarkerModal(null); modal.cerrar(); }
  function abrirRenombrar() { setRenameDraft(markerModal?.label || ''); modal.abrir('renombrar'); }
  function cancelarRenombrar() { modal.abrir('marcador'); }
  const [nombreDraft, setNombreDraft] = useState('');
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [nodoDraft, setNodoDraft] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

  const loadList = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, items, nodeList] = await Promise.all([
        api.getProject(projectId), api.listPlanosAvance(projectId, categoria),
        esTapial ? api.listNodes(projectId) : Promise.resolve([] as LocationNode[]),
      ]);
      setNodes(nodeList);
      setProject(proj);
      setPlanos(items);
    } catch (e: any) {
      Alert.alert('Error', e?.message || `No se pudo cargar ${tituloPantalla}.`);
    } finally {
      setLoading(false);
    }
  }, [projectId, categoria, tituloPantalla, esTapial]);

  useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = useCallback(async (planoId: string) => {
    try {
      setDetailLoading(true);
      const doc = await api.getPlanoAvance(projectId, planoId);
      setDetail(doc);
    } catch (e: any) {
      Alert.alert(t('planoAvance.error'), e?.message || t('planoAvance.noSePudoCargarEl'));
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else { setDetail(null); setImgSize(null); setAddMode('none'); setSegmentDraft(null); setTramoDraft([]); setMoverActivo(false); }
  }, [selectedId, loadDetail]);

  // Recalcula el tamaño de despliegue a partir de las dimensiones reales de
  // la imagen (misma técnica que PhotoAnnotator.tsx) para que los
  // marcadores en coords-fracción queden alineados 1:1.
  const maxW = winWidth - spacing.md * 2;
  const maxH = winHeight * 0.55;
  useEffect(() => {
    if (!detail?.imagen) { setImgSize(null); return; }
    RNImage.getSize(
      detail.imagen,
      (w, h) => {
        const ratio = Math.min(maxW / w, maxH / h, 1);
        setImgSize({ width: w * ratio, height: h * ratio });
      },
      () => setImgSize({ width: maxW, height: maxW * 0.75 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.imagen]);

  function handleOverlayTap(hit: PlanoMarker | null, xFrac: number, yFrac: number) {
    if (addMode === 'punto' || addMode === 'dado') {
      abrirEtiqueta({ tipo: addMode, x: xFrac, y: yFrac });
      setLabelDraft('');
      return;
    }
    if (addMode === 'tramo') {
      setTramoDraft((d) => [...d, { x: xFrac, y: yFrac }]);
      return;
    }
    if (addMode === 'segmento') {
      if (!segmentDraft) {
        setSegmentDraft({ x: xFrac, y: yFrac });
      } else {
        abrirEtiqueta({ tipo: 'segmento', x: segmentDraft.x, y: segmentDraft.y, x2: xFrac, y2: yFrac });
        setLabelDraft('');
        setSegmentDraft(null);
      }
      return;
    }
    if (hit) abrirMarcador(hit);
  }

  function onFinishTramo() {
    if (tramoDraft.length < 2) {
      Alert.alert('Faltan puntos', 'Un tramo necesita al menos 2 puntos. Toca el plano para agregar vértices.');
      return;
    }
    setLabelPrompt({
      tipo: 'tramo', x: tramoDraft[0].x, y: tramoDraft[0].y, puntos: tramoDraft.map((q) => [q.x, q.y]),
    });
    setLabelDraft('');
  }

  function onCancelTramo() {
    setTramoDraft([]);
    setAddMode('none');
  }

  async function onSaveNewMarker() {
    if (!detail || !labelPrompt) return;
    const label = labelDraft.trim();
    if (!label) {
      Alert.alert(t('planoAvance.faltaInformacion'), t('planoAvance.escribeUnaEtiquetaParaEl'));
      return;
    }
    try {
      setSavingMarker(true);
      await api.createPlanoMarker(projectId, detail.id, {
        tipo: labelPrompt.tipo,
        label,
        x: labelPrompt.x, y: labelPrompt.y,
        x2: labelPrompt.x2, y2: labelPrompt.y2,
        puntos: labelPrompt.puntos,
        estatus: 'sin_iniciar',
      });
      cerrarEtiqueta();
      setAddMode('none');
      setTramoDraft([]);
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert(t('planoAvance.noSePudoGuardar'), e?.message || t('planoAvance.intentaloNuevamente'));
    } finally {
      setSavingMarker(false);
    }
  }

  // Arrastrar un punto/dado en modo "Mover": además de reposicionar el
  // marcador arrastrado, mueve por el mismo delta cualquier extremo de
  // segmento (trabe) que estuviera coincidiendo con su posición ORIGINAL —
  // así una trabe "conectada" (dibujada tocando el mismo lugar) sigue a la
  // columna/dado en vez de quedar huérfana. Ver CONEXION_TOL arriba.
  async function onDragEndMarker(marker: PlanoMarker, newX: number, newY: number) {
    if (!detail || movingMarkerId) return;
    const origX = marker.x;
    const origY = marker.y;
    const patches: Promise<PlanoMarker>[] = [
      api.updatePlanoMarker(projectId, detail.id, marker.id, { x: newX, y: newY }),
    ];
    for (const seg of detail.markers) {
      if (seg.tipo !== 'segmento' || seg.id === marker.id) continue;
      const patch: Partial<{ x: number; y: number; x2: number; y2: number }> = {};
      if (Math.hypot(seg.x - origX, seg.y - origY) <= CONEXION_TOL) {
        patch.x = newX;
        patch.y = newY;
      }
      if (seg.x2 != null && seg.y2 != null && Math.hypot(seg.x2 - origX, seg.y2 - origY) <= CONEXION_TOL) {
        patch.x2 = newX;
        patch.y2 = newY;
      }
      if (Object.keys(patch).length > 0) {
        patches.push(api.updatePlanoMarker(projectId, detail.id, seg.id, patch));
      }
    }
    setMovingMarkerId(marker.id);
    try {
      await Promise.all(patches);
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert(t('planoAvance.noSePudoMover'), e?.message || t('planoAvance.intentaloNuevamente'));
      await loadDetail(detail.id); // recarga por si algún PATCH sí aplicó antes de fallar
    } finally {
      setMovingMarkerId(null);
    }
  }

  async function onSetEstatus(estatus: PlanoMarkerEstatus) {
    if (!detail || !markerModal) return;
    try {
      await api.updatePlanoMarker(projectId, detail.id, markerModal.id, { estatus });
      cerrarMarcador();
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert(t('planoAvance.noSePudoActualizar'), e?.message || t('planoAvance.intentaloNuevamente'));
    }
  }

  async function onRenameMarker() {
    if (!detail || !markerModal) return;
    const label = renameDraft.trim();
    if (!label) return;
    try {
      await api.updatePlanoMarker(projectId, detail.id, markerModal.id, { label });
      cerrarMarcador();
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert(t('planoAvance.noSePudoRenombrar'), e?.message || t('planoAvance.intentaloNuevamente'));
    }
  }

  async function onDeleteMarker() {
    if (!detail || !markerModal) return;
    const ok = await confirm(t('planoAvance.eliminarMarcador'), t('planoAvance.eliminarMarcadorPregunta', { nombre: markerModal.label }), { confirmText: t('planoAvance.eliminarBoton'), destructive: true });
    if (!ok) return;
    try {
      await api.deletePlanoMarker(projectId, detail.id, markerModal.id);
      cerrarMarcador();
      await loadDetail(detail.id);
    } catch (e: any) {
      Alert.alert(t('planoAvance.noSePudoEliminar'), e?.message || t('planoAvance.intentaloNuevamente'));
    }
  }

  async function onDeletePlano(p: PlanoAvance) {
    const ok = await confirm(t('planoAvance.eliminarPlano'), t('planoAvance.eliminarPlanoPregunta', { nombre: p.nombre }), { confirmText: t('planoAvance.eliminarBoton'), destructive: true });
    if (!ok) return;
    try {
      await api.deletePlanoAvance(projectId, p.id);
      await loadList();
    } catch (e: any) {
      Alert.alert(t('planoAvance.noSePudoEliminar'), e?.message || t('planoAvance.intentaloNuevamente'));
    }
  }

  async function pickAndCreatePlano() {
    const nombre = nombreDraft.trim();
    if (!nombre) {
      Alert.alert('Falta información', esTapial ? 'Dale un nombre al plano (ej. "Estación 1").' : 'Dale un nombre al plano (ej. "Cimentación").');
      return;
    }
    try {
      if (Platform.OS !== 'web') {
        const perm = await requestMediaLibraryPermission();
        if (!perm.granted) {
          Alert.alert(t('planoAvance.sinPermiso'), t('planoAvance.noHayPermisoParaAcceder'));
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      let uri = asset.uri;
      let mime = asset.mimeType || 'image/jpeg';
      let name = asset.fileName || `plano_${Date.now()}.jpg`;

      // Planos se leen a detalle (etiquetas de pilas, nomenclatura) — se
      // limita el redimensionado a 2200px de ancho, más holgado que el de
      // portadas de nodo (1600px), para no perder legibilidad.
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          uri, [{ resize: { width: 2200 } }], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
        );
        uri = manipulated.uri;
        mime = 'image/jpeg';
        if (!/\.jpe?g$/i.test(name)) name = name.replace(/\.[^.]+$/, '') + '.jpg';
      } catch { /* si falla el manipulador, subimos el original */ }

      if (Platform.OS === 'android' && !uri.startsWith('file://') && !uri.startsWith('content://')) {
        uri = `file://${uri.replace(/^\/+/, '')}`;
      }

      setUploading(true);
      const created = await api.uploadPlanoAvance(projectId, nombre, { uri, name, mimeType: mime }, categoria, nodoDraft);
      modal.cerrar('nuevoPlano');
      setNombreDraft('');
      setNodoDraft(null);
      await loadList();
      setSelectedId(created.id);
    } catch (e: any) {
      Alert.alert(t('planoAvance.noSePudoCrearEl'), e?.message || t('planoAvance.intentaloNuevamente'));
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // ======================= Vista de DETALLE de un plano =======================
  if (selectedId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title={detail?.nombre || t('planoAvance.plano')} backgroundColor={headerColor} onBack={() => setSelectedId(null)} />

        {detailLoading || !detail || !imgSize ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl, alignItems: 'center' }]}>
            {canEditEstructura && esTapial ? (
              <View style={styles.toolRow}>
                <Pressable accessibilityRole="button"
                  onPress={() => { if (addMode === 'tramo') onCancelTramo(); else { setAddMode('tramo'); setTramoDraft([]); } }}
                  style={[styles.toolBtn, addMode === 'tramo' && styles.toolBtnActive]}
                >
                  <Ionicons name="git-branch-outline" size={16} color={addMode === 'tramo' ? '#fff' : colors.primary} />
                  <Text style={[styles.toolBtnTxt, addMode === 'tramo' && { color: '#fff' }]}>Nuevo tramo</Text>
                </Pressable>
                {addMode === 'tramo' ? (
                  <>
                    <Pressable accessibilityRole="button"
                      onPress={() => setTramoDraft((d) => d.slice(0, -1))}
                      disabled={tramoDraft.length === 0}
                      style={[styles.toolBtn, tramoDraft.length === 0 && { opacity: 0.4 }]}
                    >
                      <Ionicons name="arrow-undo-outline" size={16} color={colors.primary} />
                      <Text style={styles.toolBtnTxt}>Deshacer punto</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={onFinishTramo} style={[styles.toolBtn, styles.toolBtnActive]}>
                      <Ionicons name="checkmark" size={16} color="#fff" />
                      <Text style={[styles.toolBtnTxt, { color: '#fff' }]}>Terminar tramo</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : null}
            {canEditEstructura && !esTapial ? (
              <View style={styles.toolRow}>
                <Pressable accessibilityRole="button"
                  onPress={() => { setAddMode(addMode === 'punto' ? 'none' : 'punto'); setSegmentDraft(null); setMoverActivo(false); }}
                  style={[styles.toolBtn, addMode === 'punto' && styles.toolBtnActive]}
                >
                  <Ionicons name="ellipse-outline" size={16} color={addMode === 'punto' ? '#fff' : colors.primary} />
                  <Text style={[styles.toolBtnTxt, addMode === 'punto' && { color: '#fff' }]}>{t('planoAvance.punto')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button"
                  onPress={() => { setAddMode(addMode === 'dado' ? 'none' : 'dado'); setSegmentDraft(null); setMoverActivo(false); }}
                  style={[styles.toolBtn, addMode === 'dado' && styles.toolBtnActive]}
                >
                  <Ionicons name="square-outline" size={16} color={addMode === 'dado' ? '#fff' : colors.primary} />
                  <Text style={[styles.toolBtnTxt, addMode === 'dado' && { color: '#fff' }]}>{t('planoAvance.dado')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button"
                  onPress={() => { setAddMode(addMode === 'segmento' ? 'none' : 'segmento'); setSegmentDraft(null); setMoverActivo(false); }}
                  style={[styles.toolBtn, addMode === 'segmento' && styles.toolBtnActive]}
                >
                  <Ionicons name="remove-outline" size={16} color={addMode === 'segmento' ? '#fff' : colors.primary} />
                  <Text style={[styles.toolBtnTxt, addMode === 'segmento' && { color: '#fff' }]}>{t('planoAvance.trabe')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button"
                  onPress={() => { setMoverActivo((v) => !v); setAddMode('none'); setSegmentDraft(null); }}
                  style={[styles.toolBtn, moverActivo && styles.toolBtnActive]}
                >
                  <Ionicons name="move-outline" size={16} color={moverActivo ? '#fff' : colors.primary} />
                  <Text style={[styles.toolBtnTxt, moverActivo && { color: '#fff' }]}>{t('planoAvance.mover')}</Text>
                </Pressable>
              </View>
            ) : null}
            {addMode === 'tramo' ? (
              <Text style={styles.hintTxt}>
                {tramoDraft.length === 0
                  ? 'Toca el plano para marcar el inicio del tramo; sigue tocando cada vértice.'
                  : `${tramoDraft.length} punto${tramoDraft.length === 1 ? '' : 's'} — toca más vértices o pulsa "Terminar tramo".`}
              </Text>
            ) : addMode === 'segmento' ? (
              <Text style={styles.hintTxt}>{segmentDraft ? 'Toca el segundo punto de la trabe.' : 'Toca el primer punto de la trabe.'}</Text>
            ) : addMode === 'punto' ? (
              <Text style={styles.hintTxt}>{t('planoAvance.tocaSobreElPlanoPara')}</Text>
            ) : addMode === 'dado' ? (
              <Text style={styles.hintTxt}>{t('planoAvance.tocaSobreElPlanoPara2')}</Text>
            ) : moverActivo ? (
              <Text style={styles.hintTxt}>{t('planoAvance.arrastraUnPuntoODado')}</Text>
            ) : null}

            <View style={[styles.planoFrame, { width: imgSize.width, height: imgSize.height }]}>
              <PlanoMarkerOverlay
                imageUri={detail.imagen || ''}
                markers={detail.markers}
                width={imgSize.width}
                height={imgSize.height}
                onTap={handleOverlayTap}
                draftPoint={segmentDraft}
                draftPuntos={tramoDraft}
                mode={moverActivo ? 'mover' : 'ver'}
                onDragEnd={onDragEndMarker}
              />
              {movingMarkerId ? (
                <View style={styles.movingOverlay}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : null}
            </View>

            <View style={styles.legendRow}>
              {(['sin_iniciar', 'en_proceso', 'terminado'] as PlanoMarkerEstatus[]).map((k) => (
                <View key={k} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: PLANO_MARKER_ESTADO_COLOR[k] }]} />
                  <Text style={styles.legendTxt}>{PLANO_MARKER_ESTADO_LABEL[k]}</Text>
                </View>
              ))}
            </View>

            {esTapial && detail.avance && detail.avance.tramos > 0 ? (
              <View style={styles.avanceBox}>
                <Text style={styles.avancePct}>
                  {detail.avance.pct_terminado != null ? `${detail.avance.pct_terminado.toFixed(1)}%` : '—'}
                </Text>
                <Text style={styles.avanceSub}>
                  terminado (por longitud) · {detail.avance.tramos} tramo{detail.avance.tramos === 1 ? '' : 's'}
                  {detail.avance.pct_en_proceso ? ` · ${detail.avance.pct_en_proceso.toFixed(1)}% en proceso` : ''}
                </Text>
              </View>
            ) : null}

            {detail.markers.length === 0 ? (
              <Text style={styles.emptyTxt}>
                {esTapial
                  ? (canEditEstructura
                    ? 'Sin tramos todavía — usa "Nuevo tramo". Deja sin marcar los huecos donde no hay tapial.'
                    : 'Este plano aún no tiene tramos.')
                  : (canEditEstructura ? 'Sin marcadores todavía — usa "Punto/Dado/Trabe" arriba.' : 'Este plano aún no tiene marcadores.')}
              </Text>
            ) : null}
          </ScrollView>
        )}

        {/* Modal: etiqueta del nuevo marcador */}
        <Modal visible={etiquetaVisible} transparent animationType="slide" onRequestClose={cerrarEtiqueta}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                {labelPrompt?.tipo === 'tramo' ? 'Nuevo tramo' : labelPrompt?.tipo === 'segmento' ? 'Nueva trabe' : labelPrompt?.tipo === 'dado' ? 'Nuevo dado' : 'Nuevo punto'}
              </Text>
              <Text style={styles.fieldLabel}>{t('planoAvance.etiqueta')}</Text>
              <TextInput
                value={labelDraft}
                onChangeText={setLabelDraft}
                placeholder={esTapial ? 'Ej. T1, Frente norte, Acceso 2...' : 'Ej. PL-120, D-1, Estación 3...'}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label={t('planoAvance.cancelar')} variant="secondary" onPress={cerrarEtiqueta} style={{ flex: 1 }} />
                <Button label={t('planoAvance.guardar')} loading={savingMarker} onPress={onSaveNewMarker} style={{ flex: 1 }} />
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Modal: acciones sobre un marcador existente */}
        <Modal visible={marcadorVisible} transparent animationType="fade" onRequestClose={cerrarMarcador}>
          <Pressable style={styles.modalBackdropCenter} onPress={cerrarMarcador}>
            <Pressable accessibilityRole="button" style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>{markerModal?.label}</Text>
              <Text style={styles.fieldLabel}>{t('planoAvance.estado')}</Text>
              <View style={{ gap: spacing.xs }}>
                {(['sin_iniciar', 'en_proceso', 'terminado'] as PlanoMarkerEstatus[]).map((k) => (
                  <Pressable accessibilityRole="button"
                    key={k}
                    onPress={() => onSetEstatus(k)}
                    style={[
                      styles.estatusOption,
                      { borderColor: PLANO_MARKER_ESTADO_COLOR[k] },
                      markerModal?.estatus === k && { backgroundColor: PLANO_MARKER_ESTADO_COLOR[k] + '22' },
                    ]}
                  >
                    <View style={[styles.legendDot, { backgroundColor: PLANO_MARKER_ESTADO_COLOR[k] }]} />
                    <Text style={styles.estatusOptionTxt}>{PLANO_MARKER_ESTADO_LABEL[k]}</Text>
                    {markerModal?.estatus === k ? <Ionicons name="checkmark" size={16} color={colors.text} /> : null}
                  </Pressable>
                ))}
              </View>
              {canEditEstructura ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <Button
                    label={t('planoAvance.renombrar')} variant="secondary" style={{ flex: 1 }}
                    onPress={abrirRenombrar}
                  />
                  <Button label={t('planoAvance.eliminar')} variant="danger" style={{ flex: 1 }} onPress={onDeleteMarker} />
                </View>
              ) : null}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: renombrar marcador */}
        <Modal visible={renamePrompt} transparent animationType="slide" onRequestClose={cancelarRenombrar}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{t('planoAvance.renombrarMarcador')}</Text>
              <TextInput value={renameDraft} onChangeText={setRenameDraft} style={styles.input} autoFocus />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label={t('planoAvance.cancelar')} variant="secondary" onPress={cancelarRenombrar} style={{ flex: 1 }} />
                <Button label={t('planoAvance.guardar')} onPress={onRenameMarker} style={{ flex: 1 }} />
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    );
  }

  // ======================= Vista de LISTA de planos =======================
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={tituloPantalla} backgroundColor={headerColor} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('planoAvance.planos')}</Text>
          {canEditEstructura ? (
            <Pressable accessibilityRole="button" onPress={() => modal.abrir('nuevoPlano')} style={styles.addBtn}>
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={styles.addBtnTxt}>{t('planoAvance.nuevoPlano')}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          {planos.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="map-outline" size={22} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>{esTapial ? 'Aún no hay planos de tapial.' : 'Aún no hay planos registrados.'}</Text>
            </View>
          ) : (
            planos.map((p, idx) => (
              <View key={p.id} style={[styles.planoRow, idx > 0 && styles.rowBorder]}>
                <Pressable accessibilityRole="button" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} onPress={() => setSelectedId(p.id)}>
                  <Ionicons name="map-outline" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planoNombre} numberOfLines={1}>{p.nombre}</Text>
                    <Text style={styles.planoSub}>
                      {esTapial
                        ? `${(p.markers || []).filter((m) => m.tipo === 'tramo').length} tramo(s)${
                          p.node_id && nodes.find((n) => n.id === p.node_id) ? ` · ${nodes.find((n) => n.id === p.node_id)?.name}` : ''}`
                        : `${p.markers?.length || 0} marcador${(p.markers?.length || 0) === 1 ? '' : 'es'}`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
                {canEditEstructura ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} hitSlop={8} onPress={() => onDeletePlano(p)} style={{ paddingLeft: spacing.sm }}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Modal: nuevo plano */}
      <Modal visible={newPlanoOpen} transparent animationType="slide" onRequestClose={() => modal.cerrar('nuevoPlano')}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{esTapial ? 'Nuevo plano de tapial' : 'Nuevo plano'}</Text>
            <Text style={styles.fieldLabel}>Nombre</Text>
            <TextInput
              value={nombreDraft}
              onChangeText={setNombreDraft}
              placeholder={esTapial ? 'Ej. Estación 1, Perímetro norte...' : 'Ej. Cimentación, Estructura...'}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            {esTapial ? (
              <>
                <Text style={styles.fieldLabel}>Estación (para emparejar con la foto de Vuelo DRON)</Text>
                <EstacionPicker nodes={nodes} value={nodoDraft} onChange={setNodoDraft} />
              </>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={t('planoAvance.cancelar')} variant="secondary" onPress={() => modal.cerrar('nuevoPlano')} style={{ flex: 1 }} />
              <Button label={t('planoAvance.elegirImagen')} loading={uploading} onPress={pickAndCreatePlano} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card, marginBottom: spacing.md },
  empty: { alignItems: 'center', gap: 8, padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  planoRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  planoNombre: { fontSize: 14, fontWeight: '700', color: colors.text },
  planoSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  // flexWrap + flexBasis (en vez de flex:1 puro): con 4 botones (Punto/Dado/
  // Trabe/Mover) en pantallas angostas, pasan a 2 filas de 2 en vez de
  // apretarse en una sola fila ilegible.
  toolRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm, alignSelf: 'stretch' },
  toolBtn: {
    flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface,
  },
  toolBtnActive: { backgroundColor: colors.primary },
  toolBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  hintTxt: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm, textAlign: 'center' },
  planoFrame: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...ESTILO_CAPA_PLANO },
  movingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center', justifyContent: 'center', ...ESTILO_CAPA_CONTROLES,
  },
  avanceBox: {
    alignSelf: 'stretch', alignItems: 'center', marginTop: spacing.md, padding: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  avancePct: { fontSize: 26, fontWeight: '800', color: colors.text },
  avanceSub: { fontSize: 12, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  legendRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, flexWrap: 'wrap', justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { fontSize: 12, color: colors.textBody, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end', ...ESTILO_CAPA_MODAL },
  modalBackdropCenter: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg, ...ESTILO_CAPA_MODAL },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, width: '100%', ...ESTILO_CAPA_MODAL },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  estatusOption: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  estatusOptionTxt: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
});
