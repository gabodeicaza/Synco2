// Hub "ACTIVIDADES GENERALES" — vista agregada y curada de las actividades ya
// capturadas en los reportes de campo (ver backend server.py, sección
// "ACTIVIDADES GENERALES", para el modelo completo). Esta pantalla NO captura
// actividades nuevas de campo: cura (edita/oculta/reordena/mueve) lo que ya
// existe, o añade notas manuales a nivel Estación/General.
//
// Tres submenús = mismo dato, filtrado por `nivel`:
//   Generales    -> sin nodo asociado (siempre alta manual)
//   Por Estación -> nodo a profundidad 1 (Subtramo)
//   Por Poste    -> nodo hoja más profundo
// No hay, hoy, una forma de que el proyecto customice estos nombres (el
// árbol de nodos no tiene un campo de "tipo de nivel"): se usa la misma
// nomenclatura genérica que ya usa el resto de la app para estos niveles
// ("tramos, estaciones, hojas", ver ActionTile "Árbol de nodos").
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import { colors, radius, shadow, spacing, contrastText, readableAccent } from '@/src/theme';
import { ROLE_COORD, ROLE_ESP, ROLE_JEFE, ROLE_SUB, homeRouteForRole } from '@/src/utils/roles';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { api, ActividadCurada, Area, LocationNode, NivelActividad } from '@/src/api';
import { RangoFechasPicker } from '@/src/components/RangoFechasPicker';
import { formatearRangoLegible, rangoHoy, rangoAyer, rangoEstaSemana, rangoEsteMes, RangoFechas } from '@/src/utils/rangoFechas';
import { confirm } from '@/src/utils/confirm';
import { fmtFecha } from '@/src/utils/fechas';
import { t } from '@/src/i18n';

// Antes había 3 pestañas (Generales / Por Estación / Por Poste) — "Por
// Estación" (nivel SUBTRAMO) generaba confusión sin aportar nada que "Por
// Poste" no cubriera, así que aquí se fusionan en una sola pestaña visual
// "Por Ubicación" (decisión de producto, 2026-08-18): la UI ya no distingue
// SUBTRAMO de NODO, solo GENERAL vs "tiene una ubicación asociada". El
// modelo de datos del backend SIGUE guardando SUBTRAMO/NODO por separado
// (necesario para la jerarquía Generales→Subtramo→Nodo que usa la
// impresión, ver `_actividades_resumen_para_bloque` en server.py) — el
// nivel real se resuelve aquí mismo a partir de la profundidad del nodo
// elegido (`depth === 1` → SUBTRAMO, si no → NODO).
type TabUI = 'GENERAL' | 'UBICACION';
const TAB_LABEL_UI: Record<TabUI, string> = { GENERAL: 'Generales', UBICACION: 'Por Ubicación' };
const TAB_ORDER_UI: TabUI[] = ['GENERAL', 'UBICACION'];

function nivelParaNodo(node: LocationNode): NivelActividad {
  return node.depth === 1 ? 'SUBTRAMO' : 'NODO';
}

type FiltroRapido = 'hoy' | 'ayer' | 'semana' | 'mes' | 'custom' | null;
const FILTROS_RAPIDOS: { key: FiltroRapido; label: string; rango: () => RangoFechas }[] = [
  { key: 'hoy', label: 'Hoy', rango: rangoHoy },
  { key: 'ayer', label: 'Ayer', rango: rangoAyer },
  { key: 'semana', label: 'Esta semana', rango: rangoEstaSemana },
  { key: 'mes', label: 'Este mes', rango: rangoEsteMes },
];

type Props = {
  projectId: string;
  projectColor?: string | null;
  initialNivel?: NivelActividad;
  /** A dónde ir si no hay historial (por defecto, el inicio del rol del usuario). */
  fallbackHref?: string;
};

export function ActividadesGeneralesScreen({ projectId, projectColor: projectColorProp, initialNivel, fallbackHref }: Props) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const role = user?.role;
  const [projectColor, setProjectColor] = useState<string | null>(projectColorProp || null);
  const acento = projectColor || colors.primary;
  // El color de marca del proyecto puede ser claro/pastel (es configurable
  // por el Coordinador) — pintar texto/íconos en blanco fijo sobre eso los
  // deja invisibles. Mismo bug ya resuelto en CatalogoConceptosScreen.tsx;
  // aplicarlo acá también.
  const headerTextColor = contrastText(acento);
  const headerIsLight = headerTextColor !== '#FFFFFF';
  const chipBg = headerIsLight ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.18)';
  // Para el indicador de pestaña activa (texto/borde de color sobre fondo
  // BLANCO de la barra de tabs) — problema inverso al del header: acá
  // hace falta una versión del acento suficientemente OSCURA para leerse
  // sobre blanco, no una versión clara para leerse sobre el acento.
  const tabAccent = readableAccent(acento);

  const canSelectArea = role === ROLE_COORD || role === ROLE_SUB;
  const isEspecialista = role === ROLE_ESP;
  const isReadOnly = role === ROLE_JEFE;

  const [nivel, setNivel] = useState<TabUI>(initialNivel && initialNivel !== 'GENERAL' ? 'UBICACION' : 'GENERAL');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [nodes, setNodes] = useState<LocationNode[]>([]);

  const [desde, setDesde] = useState<string | null>(null);
  const [hasta, setHasta] = useState<string | null>(null);
  const [rangoOpen, setRangoOpen] = useState(false);
  const [filtroRapido, setFiltroRapido] = useState<FiltroRapido>(null);

  const [items, setItems] = useState<ActividadCurada[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [incluirOcultas, setIncluirOcultas] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);

  // Resumen con IA por ubicación. Se descarta al cambiar filtros: ya no
  // corresponde a lo que se está viendo.
  const [resumenes, setResumenes] = useState<Record<string, string> | null>(null);
  const [resumiendo, setResumiendo] = useState(false);

  useEffect(() => { setResumenes(null); }, [areaId, desde, hasta, incluirOcultas]);

  useEffect(() => {
    if (!projectId) return;
    api.listAreas(projectId).then(setAreas).catch(() => setAreas([]));
    api.listNodes(projectId).then(setNodes).catch(() => setNodes([]));
    if (!projectColorProp) {
      api.getProject(projectId).then((p) => setProjectColor(p?.color_institucional || p?.color_tema || null)).catch(() => {});
    }
  }, [projectId, projectColorProp]);

  const load = useCallback(async (silent = false) => {
    if (!projectId) return;
    try {
      if (!silent) setLoading(true);
      setError(null);
      const list = await api.listActividadesGenerales(projectId, {
        area_id: canSelectArea ? (areaId || undefined) : undefined,
        desde: desde || undefined,
        hasta: hasta || undefined,
        incluir_ocultas: incluirOcultas,
      });
      setItems(list || []);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar las actividades');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, areaId, desde, hasta, incluirOcultas, canSelectArea]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(true); }, [load]);

  // especialista solo puede ver/editar dentro de su área asignada; el resto
  // del proyecto se muestra igual (spec: "ve TODO el proyecto") con
  // puede_editar=false ya resuelto por el backend por cada item.
  const misActividadesLabel = isEspecialista && user?.area
    ? `Tu área: ${user.area}` : null;

  // "UBICACION" = SUBTRAMO + NODO fusionados (ver nota junto a TabUI).
  const itemsDelNivel = useMemo(
    () => items.filter((it) => (nivel === 'GENERAL' ? it.nivel === 'GENERAL' : it.nivel !== 'GENERAL')),
    [items, nivel],
  );

  function aplicarFiltroRapido(f: FiltroRapido) {
    if (!f) return;
    const preset = FILTROS_RAPIDOS.find((x) => x.key === f);
    if (!preset) return;
    const r = preset.rango();
    setFiltroRapido(f);
    setDesde(r.desde);
    setHasta(r.hasta);
  }

  function limpiarFiltroFecha() {
    setFiltroRapido(null);
    setDesde(null);
    setHasta(null);
  }

  // Agrupadores en el orden en que ya vienen del backend (_flatten_tree_in_order).
  const grupos = useMemo(() => {
    if (nivel === 'GENERAL') return [{ key: 'general', label: null as string | null, items: itemsDelNivel }];
    const order: string[] = [];
    const byNode = new Map<string, ActividadCurada[]>();
    for (const it of itemsDelNivel) {
      const key = it.node_id || '—';
      if (!byNode.has(key)) { byNode.set(key, []); order.push(key); }
      byNode.get(key)!.push(it);
    }
    return order.map((key) => {
      const sample = byNode.get(key)![0];
      return { key, label: sample.node_name || (sample.node_path_names || []).slice(-1)[0] || 'Sin nombre', items: byNode.get(key)! };
    });
  }, [itemsDelNivel, nivel]);

  async function resumirConIA() {
    if (resumiendo) return;
    setResumiendo(true);
    try {
      const r = await api.resumenIaActividadesUbicacion(projectId, {
        area_id: canSelectArea ? (areaId || undefined) : undefined,
        desde: desde || undefined,
        hasta: hasta || undefined,
      });
      setResumenes(r.resumenes || {});
    } catch (e: any) {
      Alert.alert('No se pudo generar el resumen', e?.message || 'Intenta de nuevo');
    } finally {
      setResumiendo(false);
    }
  }

  async function guardarEdicion(item: ActividadCurada, texto: string) {
    try {
      const updated = await api.updateActividadGeneral(projectId, item.id, { texto_editado: texto });
      setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
    } catch (e: any) {
      Alert.alert(t('nivelesGenero.noSePudoGuardar'), e?.message || 'Intenta de nuevo');
    }
  }

  async function revertirEdicion(item: ActividadCurada) {
    try {
      const updated = await api.revertActividadGeneral(projectId, item.id);
      setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
    } catch (e: any) {
      Alert.alert(t('actividadesGenerales.noSePudoRevertir'), e?.message || 'Intenta de nuevo');
    }
  }

  async function alternarOculta(item: ActividadCurada) {
    const ocultar = !item.oculta;
    if (ocultar) {
      const ok = await confirm(t('actividadesGenerales.ocultarActividad'), t('actividadesGenerales.noApareceraEnEl'), { confirmText: 'Ocultar' });
      if (!ok) return;
    }
    try {
      const updated = await api.updateActividadGeneral(projectId, item.id, { oculta: ocultar });
      if (ocultar && !incluirOcultas) {
        setItems((prev) => prev.filter((it) => it.id !== item.id));
      } else {
        setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
      }
    } catch (e: any) {
      Alert.alert(t('noticias.noSeActualizo'), e?.message || 'Intenta de nuevo');
    }
  }

  async function moverActividad(item: ActividadCurada, destino: NivelActividad, nodeId: string | null) {
    try {
      const updated = await api.moveActividadGeneral(projectId, item.id, { nivel: destino, node_id: nodeId || undefined });
      setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
      setMoveTargetId(null);
      setNivel(destino === 'GENERAL' ? 'GENERAL' : 'UBICACION');
    } catch (e: any) {
      Alert.alert(t('actividadesGenerales.noSePudoMover'), e?.message || 'Intenta de nuevo');
    }
  }

  async function crearManual(payload: { area_id: string; nivel: NivelActividad; node_id?: string | null; texto: string }) {
    try {
      const created = await api.createActividadGeneral(projectId, payload);
      setItems((prev) => [...prev, created]);
      setAddOpen(false);
    } catch (e: any) {
      Alert.alert(t('actividadesGenerales.noSePudoAnadir'), e?.message || 'Intenta de nuevo');
    }
  }

  const periodoLabel = desde && hasta ? formatearRangoLegible(desde, hasta) : 'Todo el periodo';
  const nodosDeUbicacion = () => nodes.filter((nd) => nd.depth === 1 || nd.is_leaf);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={t('actividadesGenerales.actividadesGenerales')}
        subtitle={misActividadesLabel || undefined}
        backgroundColor={acento}
        fallbackHref={(fallbackHref || homeRouteForRole(role)) as any}
      />
      <View style={[styles.header, { paddingTop: spacing.xs, backgroundColor: acento }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtrosRapidosRow}>
          {FILTROS_RAPIDOS.map((f) => (
            <Pressable accessibilityRole="button"
              key={f.key}
              onPress={() => aplicarFiltroRapido(f.key)}
              style={[styles.filtroChip, { backgroundColor: chipBg }, filtroRapido === f.key && { backgroundColor: headerTextColor }]}
            >
              <Text style={[styles.filtroChipTxt, { color: headerTextColor }, filtroRapido === f.key && { color: acento }]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
          {desde || hasta ? (
            <Pressable accessibilityRole="button" onPress={limpiarFiltroFecha} style={[styles.filtroChip, { backgroundColor: chipBg }]}>
              <Ionicons name="close" size={13} color={headerTextColor} />
              <Text style={[styles.filtroChipTxt, { color: headerTextColor }]}>{t('a11y.quitar')}</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={styles.headerRow}>
          <Pressable accessibilityRole="button" style={[styles.chipBtn, { backgroundColor: chipBg }]} onPress={() => setRangoOpen(true)}>
            <Ionicons name="calendar-outline" size={14} color={headerTextColor} />
            <Text style={[styles.chipBtnTxt, { color: headerTextColor }]}>{periodoLabel}</Text>
          </Pressable>
          {canSelectArea ? (
            <AreaSelector areas={areas} value={areaId} onChange={setAreaId} textColor={headerTextColor} chipBg={chipBg} />
          ) : null}
          <Pressable accessibilityRole="button" style={[styles.chipBtn, { backgroundColor: chipBg }]} onPress={() => setPreviewOpen(true)}>
            <Ionicons name="eye-outline" size={14} color={headerTextColor} />
            <Text style={[styles.chipBtnTxt, { color: headerTextColor }]}>{t('actividadesGenerales.previsualizar')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.tabs}>
        {TAB_ORDER_UI.map((t) => (
          <Pressable accessibilityRole="button"
            key={t}
            onPress={() => setNivel(t)}
            style={[styles.tab, nivel === t && { borderBottomColor: tabAccent, borderBottomWidth: 2 }]}
          >
            <Text style={[styles.tabTxt, nivel === t && { color: tabAccent, fontWeight: '800' }]}>{TAB_LABEL_UI[t]}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={tabAccent} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorTxt}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => load()} style={[styles.retryBtn, { backgroundColor: acento }]}>
            <Text style={[styles.retryBtnTxt, { color: headerTextColor }]}>{t('red.reintentar')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={acento} />}
        >
          <Pressable accessibilityRole="button" style={styles.toggleOcultas} onPress={() => setIncluirOcultas((v) => !v)}>
            <Ionicons name={incluirOcultas ? 'eye' : 'eye-off-outline'} size={14} color={colors.textMuted} />
            <Text style={styles.toggleOcultasTxt}>{incluirOcultas ? t('actividadesGenerales.viendoOcultasTambien') : t('actividadesGenerales.verActividadesOcultas')}</Text>
          </Pressable>

          {nivel === 'UBICACION' && itemsDelNivel.length > 0 ? (
            <Pressable accessibilityRole="button" disabled={resumiendo} onPress={resumirConIA}
              style={[styles.iaBtn, { borderColor: tabAccent }, resumiendo && { opacity: 0.6 }]}>
              {resumiendo
                ? <ActivityIndicator size="small" color={tabAccent} />
                : <Ionicons name="sparkles-outline" size={14} color={tabAccent} />}
              <Text style={[styles.iaBtnTxt, { color: tabAccent }]}>
                {resumiendo ? 'Generando resumen…' : resumenes ? 'Regenerar resumen con IA' : 'Resumir por ubicación con IA'}
              </Text>
            </Pressable>
          ) : null}

          {itemsDelNivel.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="document-text-outline" size={26} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>
                {t('actividadesGenerales.sinActividadesRegistradasEn')}
              </Text>
            </View>
          ) : (
            grupos.map((g) => (
              <View key={g.key} style={{ marginBottom: spacing.md }}>
                {g.label ? <Text style={styles.groupTitle}>{g.label}</Text> : null}
                {nivel === 'UBICACION' && resumenes?.[g.key] ? (
                  <View style={[styles.iaBox, { borderLeftColor: tabAccent }]}>
                    <Ionicons name="sparkles-outline" size={13} color={tabAccent} />
                    <Text style={styles.iaBoxTxt}>{resumenes[g.key]}</Text>
                  </View>
                ) : null}
                {g.items
                  .slice()
                  .sort((a, b) => a.orden - b.orden)
                  .map((it) => (
                    <ActividadRow
                      key={it.id}
                      item={it}
                      acento={acento}
                      expanded={expandedId === it.id}
                      onToggle={() => setExpandedId((cur) => (cur === it.id ? null : it.id))}
                      onGuardar={(texto) => guardarEdicion(it, texto)}
                      onRevertir={() => revertirEdicion(it)}
                      onOcultar={() => alternarOculta(it)}
                      onMover={() => setMoveTargetId(it.id)}
                      isReadOnly={isReadOnly}
                    />
                  ))}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {!isReadOnly ? (
        <Pressable accessibilityRole="button"
          style={[styles.fab, { backgroundColor: acento, bottom: insets.bottom + spacing.md }]}
          onPress={() => setAddOpen(true)}
        >
          <Ionicons name="add" size={22} color={headerTextColor} />
          <Text style={[styles.fabTxt, { color: headerTextColor }]}>{t('actividadesGenerales.anadir')}</Text>
        </Pressable>
      ) : null}

      <RangoFechasPicker
        visible={rangoOpen}
        desdeInicial={desde}
        hastaInicial={hasta}
        onCancelar={() => setRangoOpen(false)}
        onConfirmar={(d, h) => { setDesde(d); setHasta(h); setFiltroRapido('custom'); setRangoOpen(false); }}
      />

      <AddActividadModal
        visible={addOpen}
        acento={acento}
        nivelInicial={nivel}
        areas={areas}
        canSelectArea={canSelectArea}
        areaFija={!canSelectArea ? user?.area_id || null : null}
        nodosDeUbicacion={nodosDeUbicacion}
        onCancelar={() => setAddOpen(false)}
        onConfirmar={crearManual}
      />

      <MoverModal
        visible={!!moveTargetId}
        acento={acento}
        actualEsGeneral={(items.find((it) => it.id === moveTargetId)?.nivel || 'NODO') === 'GENERAL'}
        nodes={nodes}
        onCancelar={() => setMoveTargetId(null)}
        onSeleccionar={(destino, nodeId) => {
          const it = items.find((i) => i.id === moveTargetId);
          if (it) moverActividad(it, destino, nodeId);
        }}
      />

      <PreviewModal visible={previewOpen} acento={acento} grupos={grupos} nivel={nivel} onCerrar={() => setPreviewOpen(false)} />
    </View>
  );
}

// ============================================================================
function AreaSelector({
  areas, value, onChange, textColor, chipBg,
}: { areas: Area[]; value: string | null; onChange: (v: string | null) => void; textColor: string; chipBg: string }) {
  const [open, setOpen] = useState(false);
  const label = value ? (areas.find((a) => a.id === value)?.name || 'Área') : 'Todas las áreas';
  return (
    <>
      <Pressable accessibilityRole="button" style={[styles.chipBtn, { backgroundColor: chipBg }]} onPress={() => setOpen(true)}>
        <Ionicons name="color-palette-outline" size={14} color={textColor} />
        <Text style={[styles.chipBtnTxt, { color: textColor }]} numberOfLines={1}>{label}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.pickerCard}>
            <Pressable accessibilityRole="button" style={styles.pickerRow} onPress={() => { onChange(null); setOpen(false); }}>
              <Text style={styles.pickerRowTxt}>{t('proyectoPantalla.todasLasAreas2')}</Text>
              {!value ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
            </Pressable>
            {areas.map((a) => (
              <Pressable accessibilityRole="button" key={a.id} style={styles.pickerRow} onPress={() => { onChange(a.id); setOpen(false); }}>
                <Text style={styles.pickerRowTxt}>{a.name}</Text>
                {value === a.id ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

// ============================================================================
function ActividadRow({
  item, acento, expanded, onToggle, onGuardar, onRevertir, onOcultar, onMover, isReadOnly,
}: {
  item: ActividadCurada;
  acento: string;
  expanded: boolean;
  onToggle: () => void;
  onGuardar: (texto: string) => void;
  onRevertir: () => void;
  onOcultar: () => void;
  onMover: () => void;
  isReadOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.texto);

  useEffect(() => { setDraft(item.texto); }, [item.texto]);

  const origenIcon = item.anadida_manual ? 'create-outline' : 'document-text-outline';
  const origenLabel = item.anadida_manual
    ? 'Añadida manualmente'
    : item.reporte_fecha
      ? `Reporte del ${fmtFecha(item.reporte_fecha)}`
      : 'De un reporte';
  // Este renglón vive sobre fondo BLANCO (styles.rowCard) — usar el acento
  // crudo como texto/ícono directo se vuelve ilegible si el color de marca
  // del proyecto es un pastel; acá hace falta la versión oscurecida.
  const accentOnWhite = readableAccent(acento);

  return (
    <View style={[styles.rowCard, item.oculta && { opacity: 0.55 }]}>
      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.rowCollapsed}>
        <Ionicons name={origenIcon as any} size={16} color={colors.textMuted} />
        <Text style={styles.rowTxt} numberOfLines={expanded ? undefined : 2}>{item.texto}</Text>
        {item.editada ? <Badge label={t('actividadesGenerales.editada')} color={accentOnWhite} /> : null}
        {item.dedup_count > 1 ? <Badge label={`×${item.dedup_count}`} color={colors.textMuted} /> : null}
        {item.oculta ? <Badge label={t('actividadesGenerales.oculta')} color={colors.error} /> : null}
        {!item.puede_editar ? <Ionicons name="lock-closed-outline" size={13} color={colors.textMuted} /> : null}
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>

      {expanded ? (
        <View style={styles.rowDetail}>
          <Text style={styles.detailLine}>{origenLabel}{item.reporte_autor ? ` · ${item.reporte_autor}` : ''}</Text>
          {item.node_path_names_origen && item.node_path_names_origen.length > 0 ? (
            <Text style={styles.detailLineMuted}>{item.node_path_names_origen.join(' › ')}</Text>
          ) : null}

          {item.origen_eliminado ? (
            <View style={styles.warnBox}>
              <Ionicons name="warning-outline" size={13} color={colors.error} />
              <Text style={styles.warnTxt}>{t('actividadesGenerales.elReporteDeOrigen')}</Text>
            </View>
          ) : item.origen_estructura_cambio ? (
            <View style={styles.warnBox}>
              <Ionicons name="warning-outline" size={13} color={colors.error} />
              <Text style={styles.warnTxt}>
                {t('actividadesGenerales.elReporteDeOrigen2')}
              </Text>
            </View>
          ) : item.origen_cambio ? (
            <View style={styles.warnBox}>
              <Ionicons name="warning-outline" size={13} color={colors.error} />
              <Text style={styles.warnTxt}>
                {t('actividadesGenerales.elReporteDeOrigen3', { texto: item.texto_actual_reporte ?? '' })}
              </Text>
            </View>
          ) : null}

          {item.editada ? (
            <Pressable accessibilityRole="button" onPress={onRevertir} style={styles.linkBtn}>
              <Ionicons name="arrow-undo-outline" size={13} color={accentOnWhite} />
              <Text style={[styles.linkBtnTxt, { color: accentOnWhite }]}>{t('actividadesGenerales.verOriginalRevertir')}</Text>
            </Pressable>
          ) : null}

          {editing ? (
            <View>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                multiline
                style={styles.editInput}
              />
              <View style={styles.editActions}>
                <Pressable accessibilityRole="button" style={styles.smallBtnGhost} onPress={() => { setDraft(item.texto); setEditing(false); }}>
                  <Text style={styles.smallBtnGhostTxt}>{t('cuenta.cancelar')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button"
                  style={[styles.smallBtn, { backgroundColor: acento }]}
                  onPress={() => { onGuardar(draft); setEditing(false); }}
                >
                  <Text style={[styles.smallBtnTxt, { color: contrastText(acento) }]}>{t('catalogo.guardar')}</Text>
                </Pressable>
              </View>
            </View>
          ) : item.puede_editar && !isReadOnly ? (
            <View style={styles.rowActions}>
              <Pressable accessibilityRole="button" style={styles.iconBtn} onPress={() => setEditing(true)}>
                <Ionicons name="pencil-outline" size={16} color={colors.text} />
                <Text style={styles.iconBtnTxt}>{t('a11y.editar')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.iconBtn} onPress={onMover}>
                <Ionicons name="swap-horizontal-outline" size={16} color={colors.text} />
                <Text style={styles.iconBtnTxt}>{t('a11y.herramientaMover')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.iconBtn} onPress={onOcultar}>
                <Ionicons name={item.oculta ? 'eye-outline' : 'eye-off-outline'} size={16} color={item.oculta ? accentOnWhite : colors.error} />
                <Text style={[styles.iconBtnTxt, { color: item.oculta ? accentOnWhite : colors.error }]}>{item.oculta ? t('actividadesGenerales.restaurar') : t('importadorUI.ocultar')}</Text>
              </Pressable>
            </View>
          ) : !item.puede_editar ? (
            <Text style={styles.lockedNote}>{t('actividadesGenerales.actividadDeOtraArea')}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeTxt, { color }]}>{label}</Text>
    </View>
  );
}

// ============================================================================
function AddActividadModal({
  visible, acento, nivelInicial, areas, canSelectArea, areaFija, nodosDeUbicacion, onCancelar, onConfirmar,
}: {
  visible: boolean;
  acento: string;
  nivelInicial: TabUI;
  areas: Area[];
  canSelectArea: boolean;
  areaFija: string | null;
  nodosDeUbicacion: () => LocationNode[];
  onCancelar: () => void;
  onConfirmar: (payload: { area_id: string; nivel: NivelActividad; node_id?: string | null; texto: string }) => void;
}) {
  const [nivel, setNivel] = useState<TabUI>(nivelInicial);
  const [areaId, setAreaId] = useState<string | null>(areaFija || (areas[0]?.id ?? null));
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [texto, setTexto] = useState('');

  useEffect(() => {
    if (visible) {
      setNivel(nivelInicial);
      setAreaId(areaFija || (areas[0]?.id ?? null));
      setNodeId(null);
      setTexto('');
    }
  }, [visible, nivelInicial, areaFija, areas]);

  const opciones = nodosDeUbicacion();
  const puedeConfirmar = !!areaId && !!texto.trim() && (nivel === 'GENERAL' || !!nodeId);

  function confirmar() {
    if (!areaId) return;
    const nodo = nivel === 'UBICACION' ? opciones.find((n) => n.id === nodeId) : null;
    const nivelReal: NivelActividad = nivel === 'GENERAL' ? 'GENERAL' : (nodo ? nivelParaNodo(nodo) : 'NODO');
    onConfirmar({ area_id: areaId, nivel: nivelReal, node_id: nodeId, texto: texto.trim() });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('actividadesGenerales.anadirActividad')}</Text>

          <Text style={styles.fieldLabel}>{t('actividadesGenerales.nivel')}</Text>
          <View style={styles.segmented}>
            {TAB_ORDER_UI.map((t) => (
              <Pressable accessibilityRole="button"
                key={t}
                onPress={() => { setNivel(t); setNodeId(null); }}
                style={[styles.segItem, nivel === t && { backgroundColor: acento }]}
              >
                <Text style={[styles.segItemTxt, nivel === t && { color: contrastText(acento) }]}>{TAB_LABEL_UI[t]}</Text>
              </Pressable>
            ))}
          </View>

          {nivel !== 'GENERAL' ? (
            <>
              <Text style={styles.fieldLabel}>{t('minuta.form.ubicacion')}</Text>
              <ScrollView style={{ maxHeight: 140 }} nestedScrollEnabled>
                {opciones.map((n) => (
                  <Pressable accessibilityRole="button" key={n.id} style={styles.pickerRow} onPress={() => setNodeId(n.id)}>
                    <Text style={styles.pickerRowTxt}>{n.name}</Text>
                    {nodeId === n.id ? <Ionicons name="checkmark" size={16} color={readableAccent(acento)} /> : null}
                  </Pressable>
                ))}
                {opciones.length === 0 ? <Text style={styles.emptyMini}>{t('actividadesGenerales.noHayNodosDisponibles')}</Text> : null}
              </ScrollView>
            </>
          ) : null}

          {canSelectArea ? (
            <>
              <Text style={styles.fieldLabel}>{t('proyectoPantalla.areaSola')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
                {areas.map((a) => (
                  <Pressable accessibilityRole="button"
                    key={a.id}
                    onPress={() => setAreaId(a.id)}
                    style={[styles.areaChip, areaId === a.id && { backgroundColor: acento, borderColor: acento }]}
                  >
                    <Text style={[styles.areaChipTxt, areaId === a.id && { color: contrastText(acento) }]}>{a.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          <Text style={styles.fieldLabel}>{t('a11y.herramientaTexto')}</Text>
          <TextInput
            value={texto}
            onChangeText={setTexto}
            multiline
            placeholder={t('actividadesGenerales.describeLaActividad')}
            style={styles.editInput}
          />

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancelar} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnGhostTxt}>{t('cuenta.cancelar')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              disabled={!puedeConfirmar}
              onPress={confirmar}
              style={[styles.btn, { backgroundColor: acento }, !puedeConfirmar && { opacity: 0.5 }]}
            >
              <Text style={[styles.btnPrimaryTxt, { color: contrastText(acento) }]}>{t('actividadesGenerales.anadir')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
function MoverModal({
  visible, acento, actualEsGeneral, nodes, onCancelar, onSeleccionar,
}: {
  visible: boolean;
  acento: string;
  actualEsGeneral: boolean;
  nodes: LocationNode[];
  onCancelar: () => void;
  onSeleccionar: (n: NivelActividad, nodeId: string | null) => void;
}) {
  const [paso, setPaso] = useState<'destino' | 'nodo'>('destino');

  useEffect(() => { if (visible) setPaso('destino'); }, [visible]);

  const opciones = nodes.filter((n) => n.depth === 1 || n.is_leaf);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancelar}>
      <Pressable style={styles.backdrop} onPress={onCancelar}>
        <View style={styles.pickerCard}>
          {paso === 'destino' ? (
            <>
              <Text style={styles.title}>{t('actividadesGenerales.moverA')}</Text>
              {actualEsGeneral ? (
                <Pressable accessibilityRole="button" style={styles.pickerRow} onPress={() => setPaso('nodo')}>
                  <Text style={styles.pickerRowTxt}>{t('proyectoPantalla.porUbicacion')}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" style={styles.pickerRow} onPress={() => onSeleccionar('GENERAL', null)}>
                  <Text style={styles.pickerRowTxt}>{t('proyectoPantalla.generales')}</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Text style={styles.title}>{t('actividadesGenerales.eligeLaUbicacion')}</Text>
              <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
                {opciones.map((n) => (
                  <Pressable accessibilityRole="button" key={n.id} style={styles.pickerRow} onPress={() => onSeleccionar(nivelParaNodo(n), n.id)}>
                    <Text style={styles.pickerRowTxt}>{n.name}</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                  </Pressable>
                ))}
                {opciones.length === 0 ? <Text style={styles.emptyMini}>{t('actividadesGenerales.noHayNodosDisponibles')}</Text> : null}
              </ScrollView>
            </>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

// ============================================================================
// Previsualización de texto plano — aproxima el layout del PDF/PPTX (título +
// subtítulos de agrupador + viñetas) SIN ser el render real con estilos de
// marca/paginación; eso vive en las etapas (c)/(d), que resuelven a través de
// esta misma capa curada.
function PreviewModal({
  visible, acento, grupos, nivel, onCerrar,
}: {
  visible: boolean; acento: string;
  grupos: { key: string; label: string | null; items: ActividadCurada[] }[];
  nivel: TabUI; onCerrar: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { maxHeight: '80%' }]}>
          <Text style={styles.title}>{t('actividadesGenerales.previsualizacion', { nivel: TAB_LABEL_UI[nivel] })}</Text>
          <Text style={styles.previewNote}>
            {t('actividadesGenerales.aproximacionDeTextoEl')}
          </Text>
          <ScrollView style={{ marginTop: spacing.sm }}>
            <View style={[styles.previewHeader, { backgroundColor: acento }]}>
              <Text style={[styles.previewHeaderTxt, { color: contrastText(acento) }]}>{t('actividadesGenerales.actividadesGenerales')}</Text>
            </View>
            {grupos.filter((g) => g.items.length > 0).map((g) => (
              <View key={g.key} style={{ marginTop: spacing.sm }}>
                <Text style={styles.previewGroupTitle}>{g.label || 'Actividades Generales'}</Text>
                {g.items.filter((it) => !it.oculta).map((it) => (
                  <Text key={it.id} style={styles.previewBullet}>{'•'} {it.texto}</Text>
                ))}
              </View>
            ))}
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={onCerrar} style={[styles.btn, styles.btnGhost, { marginTop: spacing.md }]}>
            <Text style={styles.btnGhostTxt}>{t('migracion.cerrar')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' },
  filtrosRapidosRow: { flexDirection: 'row', marginTop: spacing.sm },
  filtroChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, marginRight: 6,
  },
  filtroChipTxt: { fontSize: 12, fontWeight: '700' },
  chipBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md,
    maxWidth: 160,
  },
  chipBtnTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  tabs: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabTxt: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  errorTxt: { color: colors.error, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md },
  retryBtnTxt: { color: '#fff', fontWeight: '800' },
  toggleOcultas: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm, alignSelf: 'flex-start' },
  toggleOcultasTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  iaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6, marginBottom: spacing.sm,
  },
  iaBtnTxt: { fontSize: 12, fontWeight: '700' },
  iaBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderLeftWidth: 3,
    backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.xs,
  },
  iaBoxTxt: { flex: 1, fontSize: 12, color: colors.text, lineHeight: 17 },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center', maxWidth: 260 },
  groupTitle: { fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  rowCard: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.xs, overflow: 'hidden',
  },
  rowCollapsed: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.sm },
  rowTxt: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '600' },
  rowDetail: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: 6 },
  detailLine: { fontSize: 12, color: colors.text, fontWeight: '600' },
  detailLineMuted: { fontSize: 11, color: colors.textMuted },
  warnBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: colors.errorBg, padding: 8, borderRadius: radius.sm },
  warnTxt: { flex: 1, fontSize: 11, color: colors.error, fontWeight: '600' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  linkBtnTxt: { fontSize: 12, fontWeight: '700' },
  editInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm,
    fontSize: 13, minHeight: 70, textAlignVertical: 'top', color: colors.text,
  },
  editActions: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, justifyContent: 'flex-end' },
  smallBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm },
  smallBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
  smallBtnGhost: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.bg },
  smallBtnGhostTxt: { color: colors.text, fontWeight: '700', fontSize: 12 },
  rowActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  iconBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  lockedNote: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic' },
  badge: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTxt: { fontSize: 10, fontWeight: '800' },
  fab: {
    position: 'absolute', right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, ...shadow.lg,
  },
  fabTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  card: { width: '100%', maxWidth: 480, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.lg },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  fieldLabel: { fontSize: 12, fontWeight: '800', color: colors.textMuted, marginTop: spacing.sm, marginBottom: 4, textTransform: 'uppercase' },
  segmented: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.md, padding: 3, gap: 3 },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  segItemTxt: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  areaChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6 },
  areaChipTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  pickerCard: { width: '100%', maxWidth: 320, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm, ...shadow.lg },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: spacing.sm },
  pickerRowTxt: { fontSize: 13, color: colors.text, fontWeight: '600' },
  emptyMini: { fontSize: 12, color: colors.textMuted, padding: spacing.sm, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  btnGhostTxt: { color: colors.text, fontWeight: '800', fontSize: 14 },
  btnPrimaryTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  previewNote: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  previewHeader: { padding: 8, borderRadius: radius.sm },
  previewHeaderTxt: { color: '#fff', fontWeight: '800', fontSize: 12, textAlign: 'center' },
  previewGroupTitle: { fontSize: 12, fontWeight: '800', color: colors.text, marginBottom: 2 },
  previewBullet: { fontSize: 12, color: colors.text, marginLeft: 8, marginBottom: 2 },
});
