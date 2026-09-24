// Catálogo de Conceptos — pantalla completa (nivel 1: partidas, nivel 2:
// conceptos de una partida, búsqueda global, importación desde Excel).
// Screen "dueña" de su propio header (igual que MinutasHubScreen.tsx), para
// que las 3 rutas (subcoord/spec/coord) sean simples re-exports que solo
// resuelven `projectId` desde los params — ver app/(subcoord)/catalogo-conceptos.tsx.
//
// Divulgación progresiva: nivel 2 muestra cada concepto colapsado (clave ·
// descripción a una línea · meta) y solo un concepto expandido a la vez
// (acordeón) con el detalle completo tipo Excel.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, StatusBar, Alert, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, Concepto, ConceptoSearchResult, Partida, Project } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { ROLE_SUB, ROLE_COORD, APP_BRAND } from '@/src/utils/roles';
import { UNIDAD_LABELS, Unidad, unidadesDelProyecto } from '@/src/utils/unidades';
import { textoDeMeta } from '@/src/utils/metaPorDefecto';
import { formatMoney, formatCantidad, sumDecimalStringsAsCents, centsToDecimalString } from '@/src/utils/money';
import { DECIMALES_CANTIDAD, DECIMALES_IMPORTE, SeparadorDecimal, mensajeNumeroInvalido, parseNumeroEntrada } from '@/src/utils/numeros';
import { showToast } from '@/src/utils/toast';
import { ImportarCatalogoModal } from '@/src/components/ImportarCatalogoModal';
import { ImportarMaestroModal } from '@/src/components/ImportarMaestroModal';
import { nombreNivel, nombreConcepto, tituloModuloCatalogo, pluralizar } from '@/src/utils/nombresNivel';
import { a11y, t } from '@/src/i18n';
import { Button } from '@/src/components/Button';
import { InlineError } from '@/src/components/InlineError';
import { NuevaPartidaModal } from '@/src/components/NuevaPartidaModal';
import { NuevoConceptoModal } from '@/src/components/NuevoConceptoModal';

type ViewMode = 'partidas' | 'conceptos' | 'busqueda';
type ConceptoEditableField = 'precio_unitario' | 'meta' | 'importe_total_editable';

// Etapa EVM (Importador Maestro): un concepto migrado nunca guarda un
// precio_unitario/importe_contratado legado útil (quedan en "0" a
// propósito, ver server.py _ejecutar_commit_evm_con_compensacion) — su
// precio real es precio_unitario_dinamico (importe_total_editable /
// meta_cantidad, ya calculado por el servidor). Sin este chequeo, todo
// concepto importado por el Importador Maestro se ve con $0.00 aquí.
function conceptoTieneEvm(c: Concepto): boolean {
  return !!(c.meta_cantidad && c.importe_total_editable);
}

/** Precio unitario a MOSTRAR — dinámico (ya calculado por el servidor) si
 * el concepto tiene datos EVM, si no el precio_unitario estático. Nunca
 * leer `c.precio_unitario` directo en una vista: para un concepto EVM
 * siempre vale "0". */
function conceptoPrecioMostrado(c: Concepto): string {
  return conceptoTieneEvm(c) ? (c.precio_unitario_dinamico || '0') : c.precio_unitario;
}

export default function CatalogoConceptosScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  // Edición de PU/meta y editar/desactivar partidas: Sub-Coordinador Y Coordinador General.
  const canEdit = user?.role === ROLE_SUB || user?.role === ROLE_COORD;
  // Importar catálogo y crear partidas (prerrequisito para tener dónde
  // importar): Sub-Coordinador Y Coordinador General.
  const canImport = user?.role === ROLE_SUB || user?.role === ROLE_COORD;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [partidas, setPartidas] = useState<Partida[]>([]);

  const [mode, setMode] = useState<ViewMode>('partidas');
  // Navegación de partidas anidadas (N niveles): currentParentId = null es
  // la raíz del catálogo; breadcrumb guarda el camino completo hasta ahí
  // para poder saltar de vuelta a cualquier nivel, no solo "un paso atrás".
  const [currentParentId, setCurrentParentId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<Partida[]>([]);
  const [selectedPartida, setSelectedPartida] = useState<Partida | null>(null);
  const [conceptos, setConceptos] = useState<Concepto[]>([]);
  const [conceptosLoading, setConceptosLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tableView, setTableView] = useState(false);

  const [query, setQuery] = useState('');
  const [unidadFiltro, setUnidadFiltro] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ConceptoSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [nuevaPartidaOpen, setNuevaPartidaOpen] = useState(false);
  const [nuevoConceptoOpen, setNuevoConceptoOpen] = useState(false);
  const [renombrando, setRenombrando] = useState<Partida | null>(null);

  // Importador único: para proyectos a PRECIO_ALZADO se usa el Importador
  // Maestro (captura fecha_inicio/fecha_fin por concepto en el mismo paso,
  // ver ImportarMaestroModal.tsx) — ya no hay un import de "Programa de
  // obra" por separado, los datos se importan una sola vez.
  const esPrecioAlzado = project?.tipo_contrato === 'PRECIO_ALZADO';

  // C-04: filtros y captura ofrecen las unidades base MÁS las personalizadas del proyecto, sin repetirse.
  const unidadesProyecto = useMemo(() => unidadesDelProyecto(project?.unidades_personalizadas), [project?.unidades_personalizadas]);
  const separador: SeparadorDecimal = project?.separador_decimal === ',' ? ',' : '.';

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const loadPartidas = useCallback(async () => {
    if (!projectId) return;
    try {
      setError(null);
      setLoading(true);
      const [proj, parts] = await Promise.all([api.getProject(projectId), api.listPartidas(projectId)]);
      setProject(proj);
      setPartidas(parts);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el catálogo');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadPartidas(); }, [loadPartidas]);

  // C-02: dentro de un nodo se ven juntos sus subniveles Y sus conceptos directos.
  useEffect(() => {
    if (mode !== 'partidas') return;
    if (!currentParentId) { setConceptos([]); return; }
    let vivo = true;
    setConceptosLoading(true);
    api.listConceptos(currentParentId)
      .then((list) => { if (vivo) setConceptos(list); })
      .catch(() => { if (vivo) setConceptos([]); })
      .finally(() => { if (vivo) setConceptosLoading(false); });
    return () => { vivo = false; };
  }, [mode, currentParentId]);

  async function openPartida(p: Partida) {
    setSelectedPartida(p);
    setMode('conceptos');
    setExpandedId(null);
    setConceptosLoading(true);
    try {
      const list = await api.listConceptos(p.id);
      setConceptos(list);
    } catch (e: any) {
      Alert.alert('Error', e?.message || `No se pudieron cargar los ${pluralizar(nombreConcepto(project)).toLowerCase()} de esta ${nombreNivel(project, breadcrumb.length).toLowerCase()}`);
    } finally {
      setConceptosLoading(false);
    }
  }

  function backToPartidas() {
    setMode('partidas');
    setSelectedPartida(null);
    setConceptos([]);
    setExpandedId(null);
    setTableView(false);
    loadPartidas();
  }

  // --- Navegación entre carpetas de partidas (N niveles) ----------------------
  function abrirCarpeta(p: Partida) {
    setBreadcrumb((b) => [...b, p]);
    setCurrentParentId(p.id);
  }

  // index === -1 vuelve a la raíz del catálogo.
  function irABreadcrumb(index: number) {
    if (index < 0) {
      setBreadcrumb([]);
      setCurrentParentId(null);
      return;
    }
    setBreadcrumb((b) => {
      const next = b.slice(0, index + 1);
      setCurrentParentId(next[next.length - 1]?.id ?? null);
      return next;
    });
  }

  function subirUnNivel() {
    irABreadcrumb(breadcrumb.length - 2);
  }

  const tienePartidasHijas = useCallback(
    (p: Partida) => partidas.some((x) => x.partida_padre_id === p.id),
    [partidas],
  );

  function onPressPartidaRow(p: Partida) {
    if (tienePartidasHijas(p)) abrirCarpeta(p);
    else openPartida(p);
  }

  // --- Búsqueda global (debounce 300ms) --------------------------------------
  useEffect(() => {
    if (!query.trim() && !unidadFiltro) {
      if (mode === 'busqueda') setMode(selectedPartida ? 'conceptos' : 'partidas');
      return;
    }
    setMode('busqueda');
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const results = await api.searchConceptos(projectId, { q: query, unidad: unidadFiltro || undefined });
        setSearchResults(results);
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'La búsqueda falló');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, unidadFiltro, projectId]);

  function clearSearch() {
    setQuery('');
    setUnidadFiltro(null);
    setMode(selectedPartida ? 'conceptos' : 'partidas');
  }

  // Solo las partidas del nivel que se está viendo ahora mismo (raíz o
  // dentro de una carpeta) — el total del catálogo sigue sumando TODAS
  // (partidas.length), no solo las visibles.
  const visiblePartidas = useMemo(
    () => partidas.filter((p) => (p.partida_padre_id || null) === currentParentId),
    [partidas, currentParentId],
  );
  const totalCatalogoCents = useMemo(
    () => sumDecimalStringsAsCents(partidas.filter((p) => !p.partida_padre_id).map((p) => p.importe_contratado_partida)),
    [partidas],
  );
  const subtotalPartidaCents = useMemo(
    () => sumDecimalStringsAsCents(conceptos.map((c) => c.importe_contratado)),
    [conceptos],
  );

  async function saveField(concepto: Concepto, field: ConceptoEditableField, value: string) {
    const labels: Record<ConceptoEditableField, string> = {
      precio_unitario: 'precio unitario',
      meta: 'meta (ritmo)',
      importe_total_editable: 'importe contratado',
    };
    const label = labels[field];
    const maxDecimales = field === 'meta' ? DECIMALES_CANTIDAD : DECIMALES_IMPORTE;
    const leido = parseNumeroEntrada(value, { separador, maxDecimales });
    if (!leido.ok) {
      showToast(mensajeNumeroInvalido(leido.motivo, maxDecimales, label.charAt(0).toUpperCase() + label.slice(1)));
      return;
    }
    value = leido.valor;
    const esDinero = field !== 'meta';
    const fmt = (v: string) => (esDinero ? formatMoney(v) : v ? formatCantidad(v) : t('meta.sinMeta').toLowerCase());
    const actual = field === 'importe_total_editable' ? (concepto.importe_total_editable || '0') : concepto[field];
    const ok = await confirm(
      `Actualizar ${label}`,
      `${nombreConcepto(project)} ${concepto.clave}: cambiar ${label} de ${fmt(actual)} a ${fmt(value)}.`,
    );
    if (!ok) return;
    try {
      const updated = await api.updateConcepto(concepto.id, { [field]: value } as any);
      setConceptos((list) => list.map((c) => (c.id === concepto.id ? updated : c)));
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    }
  }

  // Partida donde cae un concepto nuevo: la abierta en la lista de conceptos, o el nodo actual.
  const partidaDestinoConcepto: Partida | null = mode === 'conceptos' ? selectedPartida : (breadcrumb[breadcrumb.length - 1] ?? null);

  async function alCrearConcepto(nuevo: Concepto) {
    setNuevoConceptoOpen(false);
    const destinoId = partidaDestinoConcepto?.id;
    if (destinoId) {
      try { setConceptos(await api.listConceptos(destinoId)); } catch { /* la lista se recarga al reabrir */ }
    }
    setExpandedId(nuevo.id);
    await loadPartidas();
  }

  async function borrarPartida(p: Partida) {
    const esCarpeta = tienePartidasHijas(p);
    const ok = await confirm(
      `Borrar ${nombreNivel(project, breadcrumb.length).toLowerCase()}`,
      esCarpeta
        ? `Se borrará "${p.clave} — ${p.nombre}" y TODO lo que contiene (subcarpetas y ${pluralizar(nombreConcepto(project)).toLowerCase()}). Esta acción no se puede deshacer desde la app.`
        : `Se borrará "${p.clave} — ${p.nombre}" y sus ${pluralizar(nombreConcepto(project)).toLowerCase()}. Esta acción no se puede deshacer desde la app.`,
      { confirmText: 'Borrar', destructive: true },
    );
    if (!ok) return;
    try {
      await api.deletePartida(p.id);
      await loadPartidas();
    } catch (e: any) {
      Alert.alert('No se pudo borrar', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function borrarConcepto(c: Concepto) {
    const ok = await confirm(
      `Borrar ${nombreConcepto(project).toLowerCase()}`,
      `Se borrará "${c.clave} — ${c.descripcion}". Esta acción no se puede deshacer desde la app.`,
      { confirmText: 'Borrar', destructive: true },
    );
    if (!ok) return;
    try {
      await api.deleteConcepto(c.id);
      setConceptos((list) => list.filter((x) => x.id !== c.id));
      await loadPartidas();
    } catch (e: any) {
      Alert.alert('No se pudo borrar', e?.message || 'Intentalo nuevamente.');
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle={headerTextColor === '#FFFFFF' ? 'light-content' : 'dark-content'} />

      {/* Encabezado: marca + área/periodo del proyecto + barra de título.
          El color de texto/ícono se calcula por contraste contra
          headerColor (color_tema del proyecto) — antes era blanco fijo, y
          si el proyecto tenía un color_tema claro el botón de "atrás"
          quedaba invisible. */}
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')}
            onPress={() => {
              if (mode === 'conceptos') backToPartidas();
              else if (mode === 'partidas' && breadcrumb.length > 0) subirUnNivel();
              else router.back();
            }}
            hitSlop={10}
            style={styles.iconBtn}
          >
            <Ionicons
              name={mode === 'conceptos' || (mode === 'partidas' && breadcrumb.length > 0) ? 'arrow-back' : 'chevron-back'}
              size={22}
              color={headerTextColor}
            />
          </Pressable>
          <Text style={[styles.brand, { color: headerTextColor }]}>{APP_BRAND}</Text>
          <View style={{ width: 32 }} />
        </View>
        <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>
          {tituloModuloCatalogo(project).toUpperCase()} — {(project?.name || '').toUpperCase()}
        </Text>
        {(project?.start_date || project?.end_date) ? (
          <Text style={[styles.periodo, { color: headerTextColor, opacity: 0.85 }]} numberOfLines={1}>
            Periodo: {project?.start_date || '—'} a {project?.end_date || '—'}
          </Text>
        ) : null}
        {mode === 'conceptos' && selectedPartida ? (
          <Text style={[styles.partidaCrumb, { color: headerTextColor, opacity: 0.9 }]} numberOfLines={1}>
            {selectedPartida.clave} — {selectedPartida.nombre}
          </Text>
        ) : null}
      </View>

      {/* Búsqueda global + filtro por unidad */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar por clave o descripción en todo el catálogo…"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
        />
        {query || unidadFiltro ? (
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} onPress={clearSearch} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.unidadFiltroRow} contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.md }}>
        {unidadesProyecto.map((u) => {
          const active = unidadFiltro === u;
          return (
            <Pressable accessibilityRole="button"
              key={u}
              onPress={() => setUnidadFiltro(active ? null : u)}
              style={[styles.unidadChip, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={[styles.unidadChipTxt, active && { color: '#fff' }]}>{u}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {mode === 'busqueda' ? (
        <SearchResultsList results={searchResults} loading={searching} />
      ) : mode === 'partidas' ? (
        <PartidasList
          project={project}
          partidas={visiblePartidas}
          totalCatalogoCents={totalCatalogoCents}
          esRaiz={breadcrumb.length === 0}
          depth={breadcrumb.length}
          breadcrumb={breadcrumb}
          onIrABreadcrumb={irABreadcrumb}
          tienePartidasHijas={tienePartidasHijas}
          onAbrirCarpeta={abrirCarpeta}
          onPressPartida={onPressPartidaRow}
          onVerConceptos={openPartida}
          canImport={canImport}
          canEdit={canEdit}
          onDeletePartida={borrarPartida}
          onNuevaPartida={() => setNuevaPartidaOpen(true)}
          onNuevoConcepto={canEdit && breadcrumb.length > 0 ? () => setNuevoConceptoOpen(true) : undefined}
          onRenombrar={setRenombrando}
          conceptosDelNodo={conceptos}
          conceptosCargando={conceptosLoading}
          expandedId={expandedId}
          onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          onSaveField={saveField}
          onDeleteConcepto={borrarConcepto}
          subtotalNodoCents={breadcrumb.length > 0 ? sumDecimalStringsAsCents([breadcrumb[breadcrumb.length - 1].importe_contratado_partida]) : null}
        />
      ) : (
        <ConceptosList
          project={project}
          depth={breadcrumb.length}
          conceptos={conceptos}
          loading={conceptosLoading}
          expandedId={expandedId}
          onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          canEdit={canEdit}
          onSaveField={saveField}
          onDeleteConcepto={borrarConcepto}
          tableView={tableView}
          onToggleTableView={() => setTableView((v) => !v)}
          onNuevoConcepto={canEdit && selectedPartida ? () => setNuevoConceptoOpen(true) : undefined}
          headerColor={headerColor}
          subtotalCents={subtotalPartidaCents}
        />
      )}

      {canImport && mode !== 'busqueda' ? (
        <Pressable accessibilityRole="button" style={styles.importFab} onPress={() => setImportOpen(true)}>
          <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
          <Text style={styles.importFabTxt}>Importar catálogo</Text>
        </Pressable>
      ) : null}

      {esPrecioAlzado ? (
        <ImportarMaestroModal
          visible={importOpen}
          projectId={projectId}
          partidas={partidas}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            loadPartidas();
            if (selectedPartida) openPartida(selectedPartida);
          }}
        />
      ) : (
        <ImportarCatalogoModal
          visible={importOpen}
          projectId={projectId}
          partidas={partidas}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            loadPartidas();
            if (selectedPartida) openPartida(selectedPartida);
          }}
        />
      )}

      <RenombrarPartidaModal
        partida={renombrando}
        project={project}
        depth={breadcrumb.length}
        onClose={() => setRenombrando(null)}
        onGuardada={() => { setRenombrando(null); loadPartidas(); }}
      />

      <NuevaPartidaModal
        visible={nuevaPartidaOpen}
        project={project}
        depth={breadcrumb.length}
        projectId={projectId}
        ordenSugerido={visiblePartidas.length}
        partidaPadreId={currentParentId}
        partidaPadreNombre={breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].nombre : null}
        hermanas={visiblePartidas}
        todas={partidas}
        onClose={() => setNuevaPartidaOpen(false)}
        onCreada={() => { setNuevaPartidaOpen(false); loadPartidas(); }}
      />

      <NuevoConceptoModal
        visible={nuevoConceptoOpen}
        project={project}
        partida={partidaDestinoConcepto}
        onClose={() => setNuevoConceptoOpen(false)}
        onCreado={alCrearConcepto}
      />

    </View>
  );
}

// ============================================================================
// Renombrar una partida. Sobre todo para las creadas por la migración (C-01),
// que nacen con la clave como nombre y la marca "nombre pendiente".
// ============================================================================
function RenombrarPartidaModal({
  partida, project, depth, onClose, onGuardada,
}: {
  partida: Partida | null;
  project: Project | null;
  depth: number;
  onClose: () => void;
  onGuardada: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (partida) { setNombre(partida.nombre_pendiente ? '' : partida.nombre); setErr(null); }
  }, [partida]);

  async function guardar() {
    if (!partida || busy) return;
    if (!nombre.trim()) { setErr(t('catalogo.nombreObligatorio')); return; }
    try {
      setBusy(true); setErr(null);
      await api.updatePartida(partida.id, { nombre: nombre.trim() });
      onGuardada();
    } catch (e: any) {
      setErr(e?.message || 'No se pudo guardar el nombre.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={!!partida} transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
      <View style={styles.nuevaPartidaBackdrop}>
        <View style={styles.nuevaPartidaCard}>
          <Text style={styles.nuevaPartidaTitle}>{t('catalogo.renombrarTitulo', { nivel: nombreNivel(project, depth).toLowerCase() })}</Text>
          <Text style={styles.nuevaPartidaPadreTxt}>{partida?.clave}</Text>
          <TextInput
            value={nombre}
            onChangeText={(v) => { setNombre(v); if (err) setErr(null); }}
            style={styles.nuevaPartidaInput}
            editable={!busy}
            autoFocus
            accessibilityLabel="Nombre"
            onSubmitEditing={guardar}
          />
          <InlineError message={err} style={{ marginTop: 8 }} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <Button label="Cancelar" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
            <Button label={t('catalogo.guardar')} onPress={guardar} loading={busy} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// Nivel 1 — lista de partidas
// ============================================================================
function PartidasList({
  project, depth, partidas, totalCatalogoCents, esRaiz, breadcrumb, onIrABreadcrumb,
  tienePartidasHijas, onAbrirCarpeta, onPressPartida, onVerConceptos, canImport, canEdit, onDeletePartida, onNuevaPartida, onNuevoConcepto,
  conceptosDelNodo, conceptosCargando, expandedId, onToggleExpand, onSaveField, onDeleteConcepto, subtotalNodoCents, onRenombrar,
}: {
  project: Project | null;
  depth: number;
  partidas: Partida[];
  totalCatalogoCents: number;
  esRaiz: boolean;
  breadcrumb: Partida[];
  onIrABreadcrumb: (index: number) => void;
  tienePartidasHijas: (p: Partida) => boolean;
  onAbrirCarpeta: (p: Partida) => void;
  onPressPartida: (p: Partida) => void;
  onVerConceptos: (p: Partida) => void;
  canImport: boolean;
  canEdit: boolean;
  onDeletePartida: (p: Partida) => void;
  onNuevaPartida: () => void;
  /** Crear un concepto directo en este nodo (solo dentro de un nodo y con permiso de edición). */
  onNuevoConcepto?: () => void;
  onRenombrar: (p: Partida) => void;
  conceptosDelNodo: Concepto[];
  conceptosCargando: boolean;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onSaveField: (c: Concepto, field: ConceptoEditableField, value: string) => void;
  onDeleteConcepto: (c: Concepto) => void;
  /** Subtotal del nodo actual = TODO lo que tiene debajo (subniveles y conceptos). null en la raíz. */
  subtotalNodoCents: number | null;
}) {
  const nivelActual = nombreNivel(project, depth);
  const nivelPadre = depth > 0 ? nombreNivel(project, depth - 1) : nivelActual;
  const conceptoPlural = pluralizar(nombreConcepto(project));
  return (
    <View style={{ flex: 1 }}>
      {breadcrumb.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.breadcrumbRow} contentContainerStyle={{ paddingHorizontal: spacing.md, alignItems: 'center' }}>
          <Pressable accessibilityRole="button" onPress={() => onIrABreadcrumb(-1)} style={styles.breadcrumbItem}>
            <Ionicons name="albums-outline" size={13} color={colors.primary} />
            <Text style={styles.breadcrumbTxt}>Catálogo</Text>
          </Pressable>
          {breadcrumb.map((p, idx) => (
            <React.Fragment key={p.id}>
              <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
              <Pressable accessibilityRole="button" onPress={() => onIrABreadcrumb(idx)} style={styles.breadcrumbItem}>
                <Text style={[styles.breadcrumbTxt, idx === breadcrumb.length - 1 && styles.breadcrumbTxtActive]} numberOfLines={1}>
                  {p.clave}
                </Text>
              </Pressable>
            </React.Fragment>
          ))}
        </ScrollView>
      ) : null}
      <ScrollView contentContainerStyle={styles.listScroll}>
        {canImport ? (
          <Pressable accessibilityRole="button" onPress={onNuevaPartida} style={styles.nuevaPartidaRow}>
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.nuevaPartidaRowTxt}>
              {esRaiz ? `Nueva ${nivelActual.toLowerCase()}` : `Nueva ${nivelActual.toLowerCase()} aquí`}
            </Text>
          </Pressable>
        ) : null}
        {partidas.length === 0 && (esRaiz || (conceptosDelNodo.length === 0 && !conceptosCargando)) ? (
          <Text style={styles.empty}>
            {esRaiz
              ? `Este proyecto aún no tiene ${pluralizar(nivelActual).toLowerCase()} en su catálogo.`
              : `Esta ${nivelPadre.toLowerCase()} aún no tiene ${pluralizar(nivelActual).toLowerCase()}.`}
          </Text>
        ) : (
          partidas.map((p) => {
            const pct = Math.max(0, Math.min(100, Math.round(parseFloat(p.porcentaje_avance_partida) || 0)));
            const esCarpeta = tienePartidasHijas(p);
            return (
              <Pressable accessibilityRole="button" key={p.id} onPress={() => onPressPartida(p)} style={styles.partidaRow}>
                <Ionicons name={esCarpeta ? 'folder' : 'folder-outline'} size={22} color={colors.primary} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.partidaTitle} numberOfLines={1}>{p.clave} — {p.nombre}</Text>
                  {p.nombre_pendiente ? <Text style={styles.nombrePendiente}>{t('catalogo.nombrePendiente')}</Text> : null}
                  <View style={styles.partidaMetaRow}>
                    <Text style={styles.partidaMetaTxt}>{p.numero_conceptos} {conceptoPlural.toLowerCase()}</Text>
                    <Text style={styles.partidaMetaTxt}>·</Text>
                    <Text style={styles.partidaMetaTxt}>{formatMoney(p.importe_contratado_partida)}</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>
                </View>
                {/* Acción secundaria = lo opuesto al tap principal: si la
                    fila ya es una "carpeta" (tiene sub-partidas), el tap
                    principal navega ahí y este botón va directo a sus
                    conceptos propios; si todavía es una hoja, el tap
                    principal va a sus conceptos y este botón es la única
                    forma de entrar a crear su PRIMERA sub-partida. */}
                <Pressable accessibilityRole="button" accessibilityLabel={a11y(esCarpeta ? 'verConceptos' : 'abrirCarpeta')}
                  onPress={(e) => { e.stopPropagation(); esCarpeta ? onVerConceptos(p) : onAbrirCarpeta(p); }}
                  hitSlop={8}
                  style={styles.verConceptosBtn}
                >
                  <Ionicons name={esCarpeta ? 'list-outline' : 'folder-open-outline'} size={16} color={colors.primary} />
                </Pressable>
                {canEdit ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`${t('catalogo.renombrar')} ${p.clave}`}
                    onPress={(e) => { e.stopPropagation(); onRenombrar(p); }}
                    hitSlop={8}
                    style={styles.verConceptosBtn}
                  >
                    <Ionicons name="create-outline" size={16} color={colors.primary} />
                  </Pressable>
                ) : null}
                {canEdit ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')}
                    onPress={(e) => { e.stopPropagation(); onDeletePartida(p); }}
                    hitSlop={8}
                    style={styles.verConceptosBtn}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                  </Pressable>
                ) : null}
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            );
          })
        )}
        {!esRaiz ? (
          <>
            <Text style={styles.seccionNodo}>{pluralizar(nombreConcepto(project))} de este nodo ({conceptosDelNodo.length})</Text>
            {onNuevoConcepto ? (
              <Pressable accessibilityRole="button" onPress={onNuevoConcepto} style={styles.nuevaPartidaRow}>
                <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                <Text style={styles.nuevaPartidaRowTxt}>{t('catalogoForm.nuevoConcepto', { concepto: nombreConcepto(project).toLowerCase() })}</Text>
              </Pressable>
            ) : null}
            {conceptosCargando ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} /> : null}
            {!conceptosCargando && conceptosDelNodo.length === 0 ? (
              <Text style={styles.empty}>Este nodo no tiene {pluralizar(nombreConcepto(project)).toLowerCase()} propios; su contenido está en los subniveles.</Text>
            ) : null}
            {conceptosDelNodo.map((c) => (
              <ConceptoRow
                key={c.id}
                concepto={c}
                expanded={expandedId === c.id}
                onToggle={() => onToggleExpand(c.id)}
                canEdit={canEdit}
                onSaveField={onSaveField}
                onDelete={onDeleteConcepto}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
      <View style={styles.footerFixed}>
        <Text style={styles.footerLabel}>
          {subtotalNodoCents !== null ? `SUBTOTAL — ${nivelPadre.toUpperCase()} (todo lo que contiene)` : 'TOTAL DEL CATÁLOGO'}
        </Text>
        <Text style={styles.footerValue}>
          {formatMoney(centsToDecimalString(subtotalNodoCents !== null ? subtotalNodoCents : totalCatalogoCents))}
        </Text>
      </View>
    </View>
  );
}

// ============================================================================
// Nivel 2 — conceptos de una partida (acordeón + vista tabla)
// ============================================================================
function ConceptosList({
  project, depth, conceptos, loading, expandedId, onToggleExpand, canEdit, onSaveField, onDeleteConcepto, tableView, onToggleTableView, onNuevoConcepto, headerColor, subtotalCents,
}: {
  project: Project | null;
  depth: number;
  conceptos: Concepto[];
  loading: boolean;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  canEdit: boolean;
  onSaveField: (c: Concepto, field: ConceptoEditableField, value: string) => void;
  onDeleteConcepto: (c: Concepto) => void;
  tableView: boolean;
  onToggleTableView: () => void;
  onNuevoConcepto?: () => void;
  headerColor: string;
  subtotalCents: number;
}) {
  if (loading) return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  const nivelActual = nombreNivel(project, depth);
  const conceptoPlural = pluralizar(nombreConcepto(project));

  return (
    <View style={{ flex: 1 }}>
      {onNuevoConcepto ? (
        <Pressable accessibilityRole="button" onPress={onNuevoConcepto} style={[styles.nuevaPartidaRow, { marginHorizontal: spacing.md }]}>
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.nuevaPartidaRowTxt}>{t('catalogoForm.nuevoConcepto', { concepto: nombreConcepto(project).toLowerCase() })}</Text>
        </Pressable>
      ) : null}
      <View style={styles.tableToggleRow}>
        <Pressable accessibilityRole="button" onPress={onToggleTableView} style={styles.tableToggleBtn}>
          <Ionicons name={tableView ? 'list-outline' : 'grid-outline'} size={16} color={colors.primary} />
          <Text style={styles.tableToggleTxt}>{tableView ? 'Vista lista' : 'Vista tabla completa'}</Text>
        </Pressable>
      </View>

      {conceptos.length === 0 ? (
        <Text style={styles.empty}>Esta {nivelActual.toLowerCase()} aún no tiene {conceptoPlural.toLowerCase()}.</Text>
      ) : tableView ? (
        <ConceptosTable conceptos={conceptos} headerColor={headerColor} />
      ) : (
        <ScrollView contentContainerStyle={styles.listScroll}>
          {conceptos.map((c) => (
            <ConceptoRow
              key={c.id}
              concepto={c}
              expanded={expandedId === c.id}
              onToggle={() => onToggleExpand(c.id)}
              canEdit={canEdit}
              onSaveField={onSaveField}
              onDelete={onDeleteConcepto}
            />
          ))}
        </ScrollView>
      )}

      <View style={styles.footerFixed}>
        <Text style={styles.footerLabel}>
          {nivelActual.toLowerCase() === 'partida' ? 'SUBTOTAL DE LA PARTIDA' : `SUBTOTAL — ${nivelActual.toUpperCase()}`}
        </Text>
        <Text style={styles.footerValue}>{formatMoney(centsToDecimalString(subtotalCents))}</Text>
      </View>
    </View>
  );
}

function ConceptoRow({
  concepto, expanded, onToggle, canEdit, onSaveField, onDelete,
}: {
  concepto: Concepto;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  onSaveField: (c: Concepto, field: ConceptoEditableField, value: string) => void;
  onDelete: (c: Concepto) => void;
}) {
  return (
    <View style={styles.conceptoCard}>
      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.conceptoCollapsedRow}>
        <View style={styles.conceptoClaveBadge}>
          <Text style={styles.conceptoClaveBadgeTxt} numberOfLines={1}>{concepto.clave}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.conceptoDescCollapsed} numberOfLines={2} ellipsizeMode="tail">
            {concepto.descripcion}
          </Text>
          <Text style={styles.conceptoMetaCollapsed} numberOfLines={1}>
            {concepto.meta ? `Meta: ${textoDeMeta(concepto.meta, concepto.unidad, concepto.periodicidad_meta)}` : textoDeMeta('', concepto.unidad)}
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </Pressable>

      {expanded ? (
        <View style={styles.conceptoDetail}>
          <Text style={styles.detailDescFull}>{concepto.descripcion}</Text>
          <DetailField
            label="Cantidad contratada"
            value={`${formatCantidad(concepto.cantidad)} ${UNIDAD_LABELS[concepto.unidad as Unidad] || concepto.unidad}`}
          />
          {conceptoTieneEvm(concepto) ? (
            <>
              <DetailField label="Precio unitario (calculado)" value={formatMoney(concepto.precio_unitario_dinamico || '0')} />
              <EditableDetailField
                label="Importe contratado"
                value={formatMoney(concepto.importe_total_editable || '0')}
                rawValue={concepto.importe_total_editable || '0'}
                canEdit={canEdit}
                onSave={(v) => onSaveField(concepto, 'importe_total_editable', v)}
              />
            </>
          ) : (
            <>
              <EditableDetailField
                label="Precio unitario"
                value={formatMoney(concepto.precio_unitario)}
                rawValue={concepto.precio_unitario}
                canEdit={canEdit}
                onSave={(v) => onSaveField(concepto, 'precio_unitario', v)}
              />
              <DetailField label="Importe contratado" value={formatMoney(concepto.importe_contratado)} bold />
            </>
          )}
          <EditableDetailField
            label="Meta (ritmo)"
            value={textoDeMeta(concepto.meta, concepto.unidad, concepto.periodicidad_meta)}
            rawValue={concepto.meta}
            canEdit={canEdit}
            onSave={(v) => onSaveField(concepto, 'meta', v)}
          />
          <DetailField
            label="Ejecutado acumulado"
            value={`${formatCantidad(concepto.cantidad_ejecutada_acumulada)} de ${formatCantidad(concepto.cantidad)} ${concepto.unidad}`}
          />
          {canEdit ? (
            <Pressable accessibilityRole="button" onPress={() => onDelete(concepto)} style={styles.deleteConceptoBtn} hitSlop={8}>
              <Ionicons name="trash-outline" size={14} color={colors.error} />
              <Text style={styles.deleteConceptoTxt}>Borrar concepto</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function DetailField({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.detailFieldRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, bold && { fontWeight: '800' }]}>{value}</Text>
    </View>
  );
}

function EditableDetailField({
  label, value, rawValue, canEdit, onSave,
}: {
  label: string;
  value: string;
  rawValue: string;
  canEdit: boolean;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rawValue);

  if (!canEdit) {
    return (
      <View style={styles.detailFieldRow}>
        <View style={styles.lockedLabelRow}>
          <Ionicons name="lock-closed-outline" size={12} color={colors.textMuted} />
          <Text style={styles.detailLabel}>{label}</Text>
        </View>
        <Text style={[styles.detailValue, styles.detailValueLocked]}>{value}</Text>
      </View>
    );
  }

  if (editing) {
    return (
      <View style={styles.detailFieldRow}>
        <Text style={styles.detailLabel}>{label}</Text>
        <View style={styles.editRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            keyboardType="decimal-pad"
            style={styles.editInput}
            autoFocus
          />
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('confirmar')} onPress={() => { setEditing(false); onSave(draft); }} hitSlop={8}>
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} onPress={() => { setDraft(rawValue); setEditing(false); }} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color={colors.error} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Pressable accessibilityRole="button" onPress={() => { setDraft(rawValue); setEditing(true); }} style={styles.detailFieldRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={styles.detailValue}>{value}</Text>
        <Ionicons name="create-outline" size={14} color={colors.primary} />
      </View>
    </Pressable>
  );
}

// ============================================================================
// Vista tabla completa (horizontal, encabezado con color de identidad del proyecto)
// ============================================================================
function ConceptosTable({ conceptos, headerColor }: { conceptos: Concepto[]; headerColor: string }) {
  return (
    <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: spacing.md }}>
      <View>
        <View style={[styles.tableHeaderRow, { backgroundColor: headerColor }]}>
          <Text style={[styles.tableHeaderCell, { width: 90 }]}>CLAVE</Text>
          <Text style={[styles.tableHeaderCell, { width: 320 }]}>DESCRIPCIÓN</Text>
          <Text style={[styles.tableHeaderCell, { width: 80 }]}>UNIDAD</Text>
          <Text style={[styles.tableHeaderCell, { width: 100 }]}>CANTIDAD</Text>
          <Text style={[styles.tableHeaderCell, { width: 110 }]}>PU</Text>
          <Text style={[styles.tableHeaderCell, { width: 130 }]}>IMPORTE</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 90 }}>
          {conceptos.map((c, idx) => (
            <View key={c.id} style={[styles.tableRow, idx % 2 === 1 && { backgroundColor: colors.bg }]}>
              <Text style={[styles.tableCell, { width: 90 }]}>{c.clave}</Text>
              <Text style={[styles.tableCell, { width: 320 }]}>{c.descripcion}</Text>
              <Text style={[styles.tableCell, { width: 80 }]}>{c.unidad}</Text>
              <Text style={[styles.tableCell, { width: 100, textAlign: 'right' }]}>{formatCantidad(c.cantidad)}</Text>
              <Text style={[styles.tableCell, { width: 110, textAlign: 'right' }]}>{formatMoney(conceptoPrecioMostrado(c))}</Text>
              <Text style={[styles.tableCell, { width: 130, textAlign: 'right' }]}>{formatMoney(c.importe_contratado)}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

// ============================================================================
// Búsqueda global — indica a qué partida pertenece cada resultado
// ============================================================================
function SearchResultsList({ results, loading }: { results: ConceptoSearchResult[]; loading: boolean }) {
  if (loading) return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  return (
    <ScrollView contentContainerStyle={styles.listScroll}>
      {results.length === 0 ? (
        <Text style={styles.empty}>Sin resultados.</Text>
      ) : (
        results.map((c) => (
          <View key={c.id} style={styles.searchCard}>
            <Text style={styles.searchPartida} numberOfLines={1}>{c.partida_clave} — {c.partida_nombre}</Text>
            <View style={styles.searchRow}>
              <Text style={styles.conceptoClave}>{c.clave}</Text>
              <Text style={styles.conceptoDescCollapsed} numberOfLines={2}>{c.descripcion}</Text>
            </View>
            <Text style={styles.searchMeta}>{UNIDAD_LABELS[c.unidad as Unidad] || c.unidad} · {formatMoney(c.importe_contratado)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#fff', fontWeight: '800', fontSize: 15 },
  titleBar: { color: '#fff', fontWeight: '800', fontSize: 15, marginTop: 6, letterSpacing: 0.3 },
  periodo: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 2 },
  partidaCrumb: { color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 4, fontWeight: '600' },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.md, marginTop: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 10, height: 40,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },
  unidadFiltroRow: { marginTop: 8, maxHeight: 34 },
  unidadChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  unidadChipTxt: { fontSize: 11, fontWeight: '700', color: colors.textBody },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg,
    padding: 10, borderRadius: 10, marginHorizontal: spacing.md, marginTop: spacing.sm,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 13, fontWeight: '600' },

  listScroll: { padding: spacing.md, paddingBottom: 110, gap: 12 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontStyle: 'italic' },

  // Breadcrumb de partidas anidadas
  breadcrumbRow: { maxHeight: 32, marginTop: 8 },
  nombrePendiente: { fontSize: 10, fontWeight: '800', color: colors.warning, textTransform: 'uppercase' },
  seccionNodo: { fontSize: 12, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', marginTop: spacing.md, marginBottom: 4 },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  breadcrumbTxt: { fontSize: 12, fontWeight: '700', color: colors.primary, maxWidth: 120 },
  breadcrumbTxtActive: { color: colors.text },

  // Nivel 1 — partidas
  partidaRow: {
    flexDirection: 'row', alignItems: 'center', minHeight: 56, backgroundColor: colors.surface,
    borderRadius: radius.md, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border,
  },
  verConceptosBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginRight: 4,
  },
  partidaTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  partidaMetaRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  partidaMetaTxt: { fontSize: 11, color: colors.textMuted },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.success },

  footerFixed: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...shadow.lg,
  },
  footerLabel: { fontSize: 12, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.4 },
  footerValue: { fontSize: 16, fontWeight: '800', color: colors.text },

  // Nivel 2 — conceptos
  tableToggleRow: { paddingHorizontal: spacing.md, paddingTop: 8, alignItems: 'flex-end' },
  tableToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tableToggleTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },

  conceptoCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  conceptoCollapsedRow: {
    flexDirection: 'row', alignItems: 'center', minHeight: 68, paddingHorizontal: 14, paddingVertical: 12, gap: 12,
  },
  conceptoClaveBadge: {
    backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 7,
    alignItems: 'center', justifyContent: 'center', minWidth: 52,
  },
  conceptoClaveBadgeTxt: { fontSize: 13, fontWeight: '800', color: colors.primary },
  conceptoClave: { fontSize: 12, fontWeight: '800', color: colors.primary, width: 56 },
  conceptoDescCollapsed: { fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 20 },
  conceptoMetaCollapsed: { fontSize: 12, color: colors.textMuted, marginTop: 3 },

  conceptoDetail: { borderTopWidth: 1, borderTopColor: colors.border, padding: 14, gap: 10 },
  detailDescFull: { fontSize: 13, color: colors.text, marginBottom: 4 },
  detailFieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  detailValue: { fontSize: 13, color: colors.text, fontWeight: '700' },
  detailValueLocked: { color: colors.textMuted },
  lockedLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editInput: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4,
    fontSize: 13, minWidth: 80, textAlign: 'right', color: colors.text,
  },
  deleteConceptoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 4, paddingVertical: 8, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.error,
  },
  deleteConceptoTxt: { fontSize: 12, fontWeight: '700', color: colors.error },

  // Vista tabla
  tableHeaderRow: { flexDirection: 'row' },
  tableHeaderCell: { color: '#fff', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', padding: 8 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tableCell: { fontSize: 12, color: colors.text, padding: 8 },

  // Búsqueda
  searchCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 4 },
  searchPartida: { fontSize: 10, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase' },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  searchMeta: { fontSize: 11, color: colors.textMuted },

  importFab: {
    position: 'absolute', right: spacing.md, bottom: 64, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 10, ...shadow.lg,
  },
  importFabTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },

  nuevaPartidaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
    borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed', borderRadius: radius.md,
    paddingHorizontal: 12, justifyContent: 'center',
  },
  nuevaPartidaRowTxt: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  nuevaPartidaBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  nuevaPartidaCard: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.lg },
  nuevaPartidaTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 4 },
  nuevaPartidaPadreTxt: { fontSize: 12, color: colors.textMuted, marginBottom: 12, fontStyle: 'italic' },
  nuevaPartidaInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  nuevaPartidaBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
