import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
  Modal, TextInput, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Button } from '@/src/components/Button';
import { api, LocationNodeTree } from '@/src/api';
import { colors, radius, spacing, shadow } from '@/src/theme';
import { MEASUREMENT_LABELS, MEASUREMENT_ICONS, MeasurementType } from '@/src/utils/roles';
import { confirm } from '@/src/utils/confirm';
import { requestMediaLibraryPermission } from '@/src/utils/permissions';
import { UbicacionGpsNodo } from '@/src/components/UbicacionGpsNodo';
import { puntoGpsDeNodo } from '@/src/utils/gpsNodo';
import { a11y } from '@/src/i18n';

// =============================================================================
// Constructor visual del Arbol de Nodos
// =============================================================================

type EditorMode =
  | { kind: 'create_root' }
  | { kind: 'create_child'; parent: LocationNodeTree }
  | { kind: 'edit'; node: LocationNodeTree };

export default function TreeBuilderScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';

  const [tree, setTree] = useState<LocationNodeTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const items = await api.getTree(pid);

      const sortNodes = (nodes: any[]) => {
        if (!nodes) return [];
        return [...nodes].sort((a, b) => (a.order || 0) - (b.order || 0)).map(n => ({
          ...n,
          children: sortNodes(n.children)
        }));
      };

      const sortedItems = sortNodes(items || []);
      setTree(sortedItems);

      // expand root nodes by default the first time
      setExpanded((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const init: Record<string, boolean> = {};
        (sortedItems || []).forEach((n) => { init[n.id] = true; });
        return init;
      });
    } catch (e: any) {
      setError(e?.message || 'Error al cargar el arbol');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sortedTree = tree;

  const totalCount = useMemo(() => countNodes(tree), [tree]);
  const leafCount = useMemo(() => countLeaves(tree), [tree]);

  function toggle(nodeId: string) {
    setExpanded((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  }

  function expandAll() {
    const map: Record<string, boolean> = {};
    function walk(ns: LocationNodeTree[]) {
      for (const n of ns) { map[n.id] = true; walk(n.children); }
    }
    walk(tree);
    setExpanded(map);
  }

  function collapseAll() {
    setExpanded({});
  }

  async function onDelete(node: LocationNodeTree) {
    const childrenCount = countNodes(node.children);
    const msg = childrenCount === 0
      ? `?Eliminar el nodo "${node.name}"?`
      : `?Eliminar "${node.name}" y sus ${childrenCount} descendiente(s)? Esta accion no se puede deshacer.`;
    const ok = await confirm('Eliminar nodo', msg, { confirmText: 'Eliminar', destructive: true });
    if (!ok) return;
    try {
      await api.deleteNode(node.id);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo eliminar');
    }
  }

  async function onDownloadTemplate() {
    try {
      const { blob, filename } = await api.downloadNodesTemplate(pid);
      if (Platform.OS === 'web') {
        // Disparar descarga via anchor en el DOM.
        if (!blob) throw new Error('No se obtuvo el archivo');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
      // Native: convertir el blob a base64 y guardarlo en cache, luego compartir.
      if (!blob) throw new Error('Archivo vacio');
      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onerror = () => reject(reader.error);
        reader.onloadend = () => {
          const s = (reader.result as string) || '';
          // result viene como "data:<mime>;base64,XXXX"
          const idx = s.indexOf('base64,');
          resolve(idx >= 0 ? s.substring(idx + 7) : s);
        };
        reader.readAsDataURL(blob);
      });
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const avail = await Sharing.isAvailableAsync();
      if (avail) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: 'Plantilla de Nodos',
          UTI: 'org.openxmlformats.spreadsheetml.sheet',
        });
      } else {
        Alert.alert('Plantilla descargada', `Guardada en: ${fileUri}`);
      }
    } catch (e: any) {
      Alert.alert('No se pudo descargar', e?.message || 'Error desconocido');
    }
  }

  async function onImportExcel() {
    try {
      // [P0 FIX iOS] En iOS, expo-document-picker mapea los MIME types a UTIs
      // internamente. Enviamos la lista COMPLETA (MIMEs oficiales + wildcard)
      // para asegurar que archivos de iCloud/Files.app se puedan seleccionar,
      // incluso los que llegan sin `content-type` detectado por el sistema.
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          // Excel moderno (.xlsx) - UTI iOS: org.openxmlformats.spreadsheetml.sheet
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          // Excel legacy (.xls) - UTI iOS: com.microsoft.excel.xls
          'application/vnd.ms-excel',
          // CSV - UTI iOS: public.comma-separated-values-text
          'text/csv',
          'text/comma-separated-values',
          // Extensiones (util como redundancia en Android; iOS ignora extensiones
          // y usa UTIs, pero no dana):
          '.xlsx',
          '.xls',
          '.csv',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      // Fallback de MIME (iOS puede devolver mimeType null para archivos de
      // iCloud). Inferimos del sufijo del nombre para que el multipart al
      // backend no aborte con 415.
      let mime = asset.mimeType || undefined;
      if (!mime) {
        const lname = (asset.name || '').toLowerCase();
        if (lname.endsWith('.xlsx')) {
          mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        } else if (lname.endsWith('.xls')) {
          mime = 'application/vnd.ms-excel';
        } else if (lname.endsWith('.csv')) {
          mime = 'text/csv';
        }
      }
      // Android exige `file://` - el asset URI suele venir con ese prefijo
      // desde el DocumentPicker, pero garantizamos por si acaso.
      let uri = asset.uri;
      if (Platform.OS === 'android' && uri && !uri.startsWith('file://') && !uri.startsWith('content://')) {
        uri = `file://${uri.replace(/^\/+/, '')}`;
      }
      const res = await api.bulkUploadNodes(pid, {
        uri,
        name: asset.name || 'nodos.xlsx',
        mimeType: mime,
      });
      const lines = [
        `Nuevos: ${res.created}`,
        `Actualizados: ${res.updated}`,
        `Omitidos (filas vacias): ${res.skipped}`,
      ];
      if (res.metadata_columns?.length) {
        lines.push('');
        lines.push(`Metadatos guardados: ${res.metadata_columns.join(', ')}`);
      }
      if (res.errors?.length) {
        lines.push('');
        lines.push(`Errores: ${res.errors.length}`);
        for (const e of res.errors.slice(0, 5)) {
          lines.push(`_ Fila ${e.row}: ${e.error}`);
        }
      }
      Alert.alert('Importacion completada', lines.join('\n'));
      await load();
    } catch (e: any) {
      // [DEBUG UI] Mostramos el mensaje ENRIQUECIDO desde api.ts que
      // incluye URL, tamano del archivo copiado, mime y error nativo.
      // Fundamental para diagnosticar en Expo Go / device fisico.
      Alert.alert(
        'Error al importar Excel',
        String(e?.message || 'No se pudo procesar el archivo'),
        [{ text: 'OK' }],
      );
    } finally {
      setUploading(false);
    }
  }

  async function onSave(payload: { name: string; is_leaf: boolean; measurement_type: MeasurementType | null; target_lat: number | null; target_lon: number | null; target_elev: number | null; acceso_predio: string | null; situacion_social: string | null }) {
    if (!editor) return;
    try {
      const isCoordLeaf = payload.is_leaf && payload.measurement_type === 'coord_latlon';
      const targets = {
        target_lat: isCoordLeaf ? payload.target_lat : null,
        target_lon: isCoordLeaf ? payload.target_lon : null,
        target_elev: isCoordLeaf ? payload.target_elev : null,
      };
      if (editor.kind === 'edit') {
        await api.updateNode(editor.node.id, {
          name: payload.name,
          is_leaf: payload.is_leaf,
          measurement_type: payload.is_leaf ? payload.measurement_type : null,
          acceso_predio: payload.acceso_predio,
          situacion_social: payload.situacion_social,
          ...targets,
        });
      } else {
        const parent_id = editor.kind === 'create_child' ? editor.parent.id : null;
        await api.createNode(pid, {
          project_id: pid,
          parent_id,
          name: payload.name,
          is_leaf: payload.is_leaf,
          measurement_type: payload.is_leaf ? payload.measurement_type : null,
          acceso_predio: payload.acceso_predio,
          situacion_social: payload.situacion_social,
          ...targets,
        });
        if (parent_id) setExpanded((e) => ({ ...e, [parent_id]: true }));
      }
      setEditor(null);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo guardar');
    }
  }

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')} onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Arbol de nodos</Text>
          <Text style={styles.subtitle}>{totalCount} nodo{totalCount === 1 ? '' : 's'} _ {leafCount} hoja{leafCount === 1 ? '' : 's'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('expandirTodo')} onPress={tree.length === 0 ? undefined : expandAll} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="expand" size={20} color={tree.length === 0 ? colors.textMuted : colors.text} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('contraerTodo')} onPress={tree.length === 0 ? undefined : collapseAll} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="contract" size={20} color={tree.length === 0 ? colors.textMuted : colors.text} />
        </Pressable>
        <Pressable
          onPress={onDownloadTemplate}
          hitSlop={8}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Descargar plantilla Excel"
        >
          <Ionicons name="document-text-outline" size={20} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={uploading ? undefined : onImportExcel}
          hitSlop={8}
          style={styles.iconBtn}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel="Importar nodos desde Excel"
        >
          {uploading
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="cloud-upload-outline" size={20} color={colors.primary} />
          }
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 110 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : tree.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Ionicons name="git-network-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>El arbol esta vacio</Text>
            <Text style={styles.emptyMsg}>
              Define la estructura espacial de tu proyecto. Puedes anidar tantos niveles como necesites. Los nodos hoja son los puntos donde el Especialista captura mediciones.
            </Text>
            <Pressable
              onPress={uploading ? undefined : onImportExcel}
              style={styles.emptyImportBtn}
              disabled={uploading}
              accessibilityRole="button"
            >
              {uploading
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Ionicons name="cloud-upload-outline" size={18} color={colors.primary} />}
              <Text style={styles.emptyImportText}>
                {uploading ? 'Procesando...' : 'Importar Nodos (Excel/CSV)'}
              </Text>
            </Pressable>
            <Pressable
              onPress={onDownloadTemplate}
              style={styles.emptyTemplateBtn}
              accessibilityRole="button"
            >
              <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
              <Text style={styles.emptyTemplateText}>Descargar plantilla de ejemplo</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 4 }}>
            {sortedTree.map((n) => (
              <NodeBranch
                key={n.id}
                node={n}
                expanded={expanded}
                onToggle={toggle}
                onAddChild={(p) => setEditor({ kind: 'create_child', parent: p })}
                onEdit={(node) => setEditor({ kind: 'edit', node })}
                onDelete={onDelete}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable accessibilityRole="button" style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={() => setEditor({ kind: 'create_root' })}>
        <Ionicons name="add" size={26} color={colors.textInverse} />
        <Text style={styles.fabText}>Agregar nodo raiz</Text>
      </Pressable>

      <NodeEditorModal
        visible={!!editor}
        editor={editor}
        pid={pid}
        onClose={() => setEditor(null)}
        onSave={onSave}
        onCoverChanged={load}
      />
    </View>
  );
}

// =============================================================================
// Componente recursivo de rama
// =============================================================================

function NodeBranch({
  node, expanded, onToggle, onAddChild, onEdit, onDelete,
}: {
  node: LocationNodeTree;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onAddChild: (parent: LocationNodeTree) => void;
  onEdit: (node: LocationNodeTree) => void;
  onDelete: (node: LocationNodeTree) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isOpen = !!expanded[node.id];
  const hasChildren = node.children.length > 0;
  const indent = Math.min(node.depth, 6) * 16;
  const isLeaf = node.is_leaf && !hasChildren;
  const mtype = node.measurement_type as MeasurementType | null;

  return (
    <View>
      <View style={[styles.row, { paddingLeft: indent + 4 }]}>
        {/* Vertical guide */}
        {node.depth > 0 ? <View style={[styles.guide, { left: indent - 6 }]} /> : null}

        {/* Toggle / spacer */}
        <Pressable accessibilityRole="button" accessibilityLabel={a11y(isOpen ? 'contraer' : 'expandir')} accessibilityState={{ expanded: isOpen, disabled: !hasChildren }}
          onPress={() => hasChildren && onToggle(node.id)}
          hitSlop={6}
          style={styles.toggleBtn}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textBody} />
          ) : (
            <View style={styles.bullet} />
          )}
        </Pressable>

        {/* Node icon */}
        <View style={[styles.nodeIcon, isLeaf && styles.nodeIconLeaf]}>
          <Ionicons
            name={isLeaf ? (mtype ? (MEASUREMENT_ICONS[mtype] as any) : 'flag-outline') : (hasChildren ? 'folder' : 'folder-outline')}
            size={15}
            color={isLeaf ? colors.primary : colors.textBody}
          />
        </View>

        {/* Label */}
        <Pressable accessibilityRole="button"
          style={{ flex: 1, paddingVertical: 6 }}
          onPress={() => hasChildren ? onToggle(node.id) : onEdit(node)}
          onLongPress={() => onEdit(node)}
        >
          <Text style={styles.nodeName} numberOfLines={1}>{node.name}</Text>
          <View style={styles.metaRow}>
            {isLeaf && mtype ? (
              <View style={styles.leafBadge}>
                <Text style={styles.leafBadgeText}>{MEASUREMENT_LABELS[mtype]}</Text>
              </View>
            ) : null}
            {node.metadata && Object.keys(node.metadata).length > 0 ? (
              <View style={styles.metaBadge}>
                <Ionicons name="document-attach" size={9} color={colors.textBody} />
                <Text style={styles.metaBadgeText}>
                  {Object.keys(node.metadata).length} dato{Object.keys(node.metadata).length === 1 ? '' : 's'}
                </Text>
              </View>
            ) : null}
            {(node as any).cover_image ? (
              <View style={[styles.metaBadge, styles.coverBadge]}>
                <Ionicons name="image" size={9} color={colors.primary} />
                <Text style={[styles.metaBadgeText, { color: colors.primary }]}>Portada</Text>
              </View>
            ) : null}
            {hasChildren ? (
              <Text style={styles.childCount}>{node.children.length} hijo{node.children.length === 1 ? '' : 's'}</Text>
            ) : !isLeaf ? (
              <Text style={styles.muted}>Vacio</Text>
            ) : null}
          </View>
        </Pressable>

        {/* Quick actions */}
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')} onPress={() => onAddChild(node)} hitSlop={6} style={styles.actionBtn}>
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('masOpciones')} onPress={() => setMenuOpen((o) => !o)} hitSlop={6} style={styles.actionBtn}>
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textBody} />
        </Pressable>
      </View>

      {/* Inline action menu */}
      {menuOpen ? (
        <View style={[styles.menu, { marginLeft: indent + 36 }]}>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setMenuOpen(false); onEdit(node); }}>
            <Ionicons name="create-outline" size={16} color={colors.textBody} />
            <Text style={styles.menuText}>Editar</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setMenuOpen(false); onAddChild(node); }}>
            <Ionicons name="git-branch-outline" size={16} color={colors.textBody} />
            <Text style={styles.menuText}>Agregar nodo hijo</Text>
          </Pressable>
          {node.metadata && Object.keys(node.metadata).length > 0 ? (
            <Pressable accessibilityRole="button"
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                const entries = Object.entries(node.metadata || {});
                const body = entries.map(([k, v]) => `_ ${k}: ${formatMetaValue(v)}`).join('\n');
                Alert.alert(node.name, body || 'Sin metadatos');
              }}
            >
              <Ionicons name="document-attach-outline" size={16} color={colors.textBody} />
              <Text style={styles.menuText}>Ver metadatos ({Object.keys(node.metadata).length})</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" style={[styles.menuItem, styles.menuDanger]} onPress={() => { setMenuOpen(false); onDelete(node); }}>
            <Ionicons name="trash-outline" size={16} color={colors.error} />
            <Text style={[styles.menuText, { color: colors.error }]}>Eliminar</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Children */}
      {isOpen && hasChildren ? (
        <View>
          {node.children.map((c) => (
            <NodeBranch
              key={c.id}
              node={c}
              expanded={expanded}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// =============================================================================
// Modal de edicion / creacion de nodo
// =============================================================================

function NodeEditorModal({
  visible, editor, pid, onClose, onSave, onCoverChanged,
}: {
  visible: boolean;
  editor: EditorMode | null;
  pid: string;
  onClose: () => void;
  onSave: (p: { name: string; is_leaf: boolean; measurement_type: MeasurementType | null; target_lat: number | null; target_lon: number | null; target_elev: number | null; acceso_predio: string | null; situacion_social: string | null }) => Promise<void>;
  onCoverChanged?: () => Promise<void> | void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [isLeaf, setIsLeaf] = useState(false);
  const [mtype, setMtype] = useState<MeasurementType | null>(null);
  const [tLat, setTLat] = useState('');
  const [tLon, setTLon] = useState('');
  const [tElev, setTElev] = useState('');
  const [accesoPredio, setAccesoPredio] = useState<string | null>(null);
  const [situacionSocial, setSituacionSocial] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Portadilla del nodo (cover_image)
  const [coverUri, setCoverUri] = useState<string | null>(null); // data-url o URL local para preview
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverErr, setCoverErr] = useState<string | null>(null);

  React.useEffect(() => {
    if (!visible || !editor) return;
    if (editor.kind === 'edit') {
      setName(editor.node.name);
      setIsLeaf(editor.node.is_leaf);
      setMtype((editor.node.measurement_type as MeasurementType | null) || null);
      const n: any = editor.node;
      setTLat(n.target_lat != null ? String(n.target_lat) : '');
      setTLon(n.target_lon != null ? String(n.target_lon) : '');
      setTElev(n.target_elev != null ? String(n.target_elev) : '');
      setAccesoPredio(n.acceso_predio || null);
      setSituacionSocial(n.situacion_social || '');
      setCoverUri(n.cover_image || null);
    } else {
      setName(''); setIsLeaf(false); setMtype(null);
      setTLat(''); setTLon(''); setTElev('');
      setAccesoPredio(null);
      setSituacionSocial('');
      setCoverUri(null);
    }
    setErr(null);
    setCoverErr(null);
  }, [visible, editor]);

  const title = useMemo(() => {
    if (!editor) return '';
    if (editor.kind === 'edit') return `Editar: ${editor.node.name}`;
    if (editor.kind === 'create_child') return `Hijo de "${editor.parent.name}"`;
    return 'Nuevo nodo raiz';
  }, [editor]);

  // Acceso al Predio / Situacion Social son campos de estatus de Subtramo
  // (nodo a profundidad 1, hijo directo de la raiz) - solo se editan ahi.
  const isSubtramoContext = useMemo(() => {
    if (!editor) return false;
    if (editor.kind === 'edit') return (editor.node as any).depth === 1;
    if (editor.kind === 'create_child') return (editor.parent as any).depth === 0;
    return false;
  }, [editor]);

  // Helper para parsear coordenada (admite punto o coma como separador decimal).
  function parseCoord(raw: string): number | null {
    let s = (raw || '').trim();
    if (!s) return null;
    // Soporte UTM: limpia separadores de miles. Si el string ya tiene punto decimal
    // o mas de una coma, las comas se tratan como separador de miles (ej. "1,234,567.89").
    // Si solo hay una coma sin punto, se trata como decimal estilo europeo ("1,5").
    const commaCount = (s.match(/,/g) || []).length;
    if (s.includes('.') || commaCount > 1) {
      s = s.replace(/,/g, '');
    } else if (commaCount === 1) {
      s = s.replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN as any;
  }

  async function submit() {
    setErr(null);
    const n = name.trim();
    if (!n) { setErr('El nombre es obligatorio'); return; }
    if (isLeaf && !mtype) { setErr('Selecciona el tipo de medicion para el nodo hoja'); return; }
    let parsedLat: number | null = null;
    let parsedLon: number | null = null;
    let parsedElev: number | null = null;
    if (isLeaf && mtype === 'coord_latlon') {
      parsedLat = parseCoord(tLat);
      parsedLon = parseCoord(tLon);
      parsedElev = parseCoord(tElev);
      if (Number.isNaN(parsedLat as any)) { setErr('Coordenada X (Este) invalida'); return; }
      if (Number.isNaN(parsedLon as any)) { setErr('Coordenada Y (Norte) invalida'); return; }
      if (Number.isNaN(parsedElev as any)) { setErr('Elevacion invalida'); return; }
      // Nota: en obra civil se usan coordenadas UTM (cientos de miles / millones).
      // No se aplica restriccion de rango geografico (-90/90, -180/180).
    }
    setBusy(true);
    try {
      await onSave({
        name: n,
        is_leaf: isLeaf,
        measurement_type: isLeaf ? mtype : null,
        target_lat: parsedLat,
        target_lon: parsedLon,
        target_elev: parsedElev,
        acceso_predio: isSubtramoContext ? accesoPredio : null,
        situacion_social: isSubtramoContext ? (situacionSocial.trim() || null) : null,
      });
    } finally {
      setBusy(false);
    }
  }

  // === Portadilla del nodo (cover_image) ==================================
  async function pickAndUploadCover() {
    if (!editor || editor.kind !== 'edit') return;
    setCoverErr(null);
    try {
      // Solicitar permiso (solo aplica en native; en web se ignora)
      if (Platform.OS !== 'web') {
        const perm = await requestMediaLibraryPermission();
        if (!perm.granted) {
          setCoverErr('Sin permiso para acceder a la galeria.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      let uri = asset.uri;
      let mime = asset.mimeType || 'image/jpeg';
      let name = asset.fileName || `cover_${Date.now()}.jpg`;

      // Comprimir/redimensionar (max 1600px de ancho) para mantener el base64 razonable
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: 1600 } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
        );
        uri = manipulated.uri;
        mime = 'image/jpeg';
        if (!/\.jpe?g$/i.test(name)) name = name.replace(/\.[^.]+$/, '') + '.jpg';
      } catch { /* si falla el manipulador, subimos el original */ }

      // [P0 FIX] Android exige `file://` como prefijo - sin esto el multipart
      // aborta con "Network request failed" antes de siquiera intentar.
      if (Platform.OS === 'android' && !uri.startsWith('file://') && !uri.startsWith('content://')) {
        uri = `file://${uri.replace(/^\/+/, '')}`;
      }

      // [P0 FIX iOS "invisible"] Mostramos el preview LOCAL de inmediato
      // (URI del manipulator) para que el usuario vea la foto aunque el
      // backend tarde. Si el POST falla, revertimos.
      const previousCover = coverUri;
      setCoverUri(uri);
      setCoverBusy(true);
      try {
        if (!uri) throw new Error('La URI de la portada seleccionada es nula.');
        const updated = await api.uploadNodeCover(pid, editor.node.id, {
          uri, name, mimeType: mime,
        });
        // Cuando el backend responde, reemplazamos el preview local por el
        // data URL persistido (mismo shape que en el resto de la app).
        setCoverUri(updated.cover_image || uri);
        // Reflejar el cambio en el arbol padre (recarga)
        if (onCoverChanged) await onCoverChanged();
      } catch (upErr) {
        // Restauramos la portada previa si el upload falla.
        setCoverUri(previousCover);
        throw upErr;
      }
    } catch (e: any) {
      // [DEBUG UI] Ademas de setear el error inline, mostramos Alert.alert
      // con el mensaje COMPLETO (incluye URL, tamano, mime, error nativo)
      // para que el usuario pueda leerlo en su dispositivo fisico.
      const details = e?.message || 'No se pudo subir la portada';
      setCoverErr(details);
      Alert.alert('Error de subida (portada)', String(details), [{ text: 'OK' }]);
    } finally {
      setCoverBusy(false);
    }
  }

  async function removeCover() {
    if (!editor || editor.kind !== 'edit') return;
    const ok = await confirm(
      'Eliminar portada',
      '?Eliminar la foto de portada de este nodo? Volvera a usarse la portadilla generica del proyecto.',
      { confirmText: 'Eliminar', destructive: true },
    );
    if (!ok) return;
    setCoverErr(null);
    setCoverBusy(true);
    try {
      await api.deleteNodeCover(pid, editor.node.id);
      setCoverUri(null);
      if (onCoverChanged) await onCoverChanged();
    } catch (e: any) {
      const details = e?.message || 'No se pudo eliminar la portada';
      setCoverErr(details);
      Alert.alert('Error eliminando portada', String(details), [{ text: 'OK' }]);
    } finally {
      setCoverBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>{title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingTop: spacing.sm }}>
              <View>
                <Text style={styles.label}>Nombre del nodo</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="pricetag-outline" size={18} color={colors.textMuted} />
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Ej. Tramo 1, Estacion 02+450, Eje A"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    autoFocus
                    autoCapitalize="sentences"
                    editable={!busy}
                    returnKeyType="done"
                  />
                </View>
              </View>

              {/* === Acceso al Predio / Situacion Social - solo Subtramo (profundidad 1) === */}
              {isSubtramoContext ? (
                <>
                  <View>
                    <Text style={styles.label}>Acceso al Predio</Text>
                    <View style={{ gap: 8 }}>
                      {([
                        { key: null, label: 'Sin especificar', icon: 'help-circle-outline' },
                        { key: 'Con acceso', label: 'Con acceso', icon: 'checkmark-circle-outline' },
                        { key: 'Sin acceso', label: 'Sin acceso', icon: 'close-circle-outline' },
                      ] as const).map((opt) => (
                        <Pressable accessibilityRole="button"
                          key={opt.label}
                          onPress={() => setAccesoPredio(opt.key)}
                          style={[styles.mOption, accesoPredio === opt.key && styles.mOptionOn]}
                        >
                          <Ionicons
                            name={opt.icon as any}
                            size={20}
                            color={accesoPredio === opt.key ? colors.primary : colors.textBody}
                          />
                          <Text style={[styles.mOptionText, accesoPredio === opt.key && { color: colors.primary, fontWeight: '800' }]}>
                            {opt.label}
                          </Text>
                          {accesoPredio === opt.key ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.metaHelp}>
                      Estatus vigente del acceso a este subtramo. Se muestra como insignia de color en la pagina de resumen del PDF/PPT exportado.
                    </Text>
                  </View>

                  <View>
                    <Text style={styles.label}>Situacion Social - Liberacion Fisica del Predio (opcional)</Text>
                    <View style={[styles.inputWrap, { alignItems: 'flex-start', minHeight: 88 }]}>
                      <Ionicons name="people-outline" size={18} color={colors.textMuted} style={{ marginTop: 2 }} />
                      <TextInput
                        value={situacionSocial}
                        onChangeText={setSituacionSocial}
                        placeholder={'Una linea por punto, ej.:\nPredio liberado en su totalidad\nPendiente firma de convenio con propietario'}
                        placeholderTextColor={colors.textMuted}
                        style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
                        multiline
                        editable={!busy}
                      />
                    </View>
                    <Text style={styles.metaHelp}>
                      Cada linea se muestra como una vineta independiente en la pagina de resumen exportada.
                    </Text>
                  </View>
                </>
              ) : null}

              {/* === Portadilla del nodo (cover_image) - solo en modo edicion === */}
              {editor?.kind === 'edit' ? (
                <View style={styles.coverSection}>
                  <View style={styles.coverHeader}>
                    <Ionicons name="image" size={18} color={colors.primary} />
                    <Text style={styles.coverTitle}>Foto de portada del nodo</Text>
                  </View>
                  <Text style={styles.coverHelp}>
                    Aparecera como portadilla institucional (capitulo) en el PDF exportado, antes de todos los reportes de este nodo y sus descendientes.
                  </Text>

                  {coverUri ? (
                    <View style={styles.coverPreviewWrap}>
                      <Image
                        source={{ uri: coverUri }}
                        style={styles.coverPreview}
                        resizeMode="cover"
                      />
                      {coverBusy ? (
                        <View style={styles.coverPreviewOverlay}>
                          <ActivityIndicator size="large" color={colors.textInverse} />
                        </View>
                      ) : null}
                    </View>
                  ) : (
                    <View style={styles.coverEmptyWrap}>
                      <Ionicons name="images-outline" size={36} color={colors.textMuted} />
                      <Text style={styles.coverEmptyText}>Sin foto de portada</Text>
                    </View>
                  )}

                  <View style={styles.coverActions}>
                    <Pressable
                      onPress={coverBusy ? undefined : pickAndUploadCover}
                      style={[styles.coverBtn, styles.coverBtnPrimary, coverBusy && { opacity: 0.6 }]}
                      disabled={coverBusy}
                      accessibilityRole="button"
                    >
                      {coverBusy ? (
                        <ActivityIndicator size="small" color={colors.textInverse} />
                      ) : (
                        <>
                          <Ionicons name={coverUri ? 'refresh' : 'cloud-upload'} size={16} color={colors.textInverse} />
                          <Text style={styles.coverBtnPrimaryText}>
                            {coverUri ? 'Cambiar foto' : 'Subir foto'}
                          </Text>
                        </>
                      )}
                    </Pressable>
                    {coverUri ? (
                      <Pressable
                        onPress={coverBusy ? undefined : removeCover}
                        style={[styles.coverBtn, styles.coverBtnDanger, coverBusy && { opacity: 0.5 }]}
                        disabled={coverBusy}
                        accessibilityRole="button"
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                        <Text style={styles.coverBtnDangerText}>Eliminar</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  {coverErr ? (
                    <View style={styles.errorBoxInline}>
                      <Ionicons name="alert-circle" size={16} color={colors.error} />
                      <Text style={styles.errorText}>{coverErr}</Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.coverHint}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                  <Text style={styles.coverHintText}>
                    Podras subir una foto de portada del nodo despues de crearlo.
                  </Text>
                </View>
              )}

              <Pressable accessibilityRole="button"
                onPress={() => setIsLeaf((v) => !v)}
                style={[styles.leafToggle, isLeaf && styles.leafToggleOn]}
              >
                <Ionicons
                  name={isLeaf ? 'flag' : 'flag-outline'}
                  size={20}
                  color={isLeaf ? colors.primary : colors.textBody}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.leafToggleTitle, isLeaf && { color: colors.primary }]}>
                    Es nodo hoja (captura mediciones)
                  </Text>
                  <Text style={styles.leafToggleSub}>
                    Los nodos hoja son los puntos donde el Especialista registra mediciones.
                  </Text>
                </View>
                <View style={[styles.switch, isLeaf && styles.switchOn]}>
                  <View style={[styles.switchThumb, isLeaf && styles.switchThumbOn]} />
                </View>
              </Pressable>

              {isLeaf ? (
                <View>
                  <Text style={styles.label}>Tipo de medicion</Text>
                  <View style={{ gap: 8 }}>
                    {(Object.keys(MEASUREMENT_LABELS) as MeasurementType[]).map((k) => (
                      <Pressable accessibilityRole="button"
                        key={k}
                        onPress={() => setMtype(k)}
                        style={[styles.mOption, mtype === k && styles.mOptionOn]}
                      >
                        <Ionicons
                          name={MEASUREMENT_ICONS[k] as any}
                          size={20}
                          color={mtype === k ? colors.primary : colors.textBody}
                        />
                        <Text style={[styles.mOptionText, mtype === k && { color: colors.primary, fontWeight: '800' }]}>
                          {MEASUREMENT_LABELS[k]}
                        </Text>
                        {mtype === k ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                      </Pressable>
                    ))}
                  </View>

                  {mtype === 'coord_latlon' ? (
                    <View style={styles.coordCard}>
                      <View style={styles.coordHeader}>
                        <Ionicons name="location" size={16} color={colors.primary} />
                        <Text style={styles.coordHeaderText}>Coordenadas objetivo (oficina)</Text>
                      </View>
                      <Text style={styles.coordHelp}>
                        Valores dictados por el Coordinador. El Especialista los vera en modo solo-lectura al capturar este nodo.
                      </Text>
                      <View style={styles.coordRow}>
                        <View style={styles.coordField}>
                          <Text style={styles.coordLabel}>Coordenada X (Este)</Text>
                          <View style={styles.inputWrap}>
                            <Ionicons name="locate-outline" size={16} color={colors.textMuted} />
                            <TextInput
                              value={tLat}
                              onChangeText={setTLat}
                              placeholder="487256.42"
                              placeholderTextColor={colors.textMuted}
                              style={styles.input}
                              keyboardType="numbers-and-punctuation"
                              autoCorrect={false}
                              editable={!busy}
                            />
                          </View>
                        </View>
                        <View style={styles.coordField}>
                          <Text style={styles.coordLabel}>Coordenada Y (Norte)</Text>
                          <View style={styles.inputWrap}>
                            <Ionicons name="locate-outline" size={16} color={colors.textMuted} />
                            <TextInput
                              value={tLon}
                              onChangeText={setTLon}
                              placeholder="2148123.18"
                              placeholderTextColor={colors.textMuted}
                              style={styles.input}
                              keyboardType="numbers-and-punctuation"
                              autoCorrect={false}
                              editable={!busy}
                            />
                          </View>
                        </View>
                      </View>
                      <View style={styles.coordField}>
                        <Text style={styles.coordLabel}>Elevacion / Cota (Z)</Text>
                        <View style={styles.inputWrap}>
                          <Ionicons name="trending-up-outline" size={16} color={colors.textMuted} />
                          <TextInput
                            value={tElev}
                            onChangeText={setTElev}
                            placeholder="2240.50 (msnm)"
                            placeholderTextColor={colors.textMuted}
                            style={styles.input}
                            keyboardType="numbers-and-punctuation"
                            autoCorrect={false}
                            editable={!busy}
                          />
                        </View>
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {editor?.kind === 'edit' ? (
                <UbicacionGpsNodo
                  key={editor.node.id}
                  nodeId={editor.node.id}
                  punto={puntoGpsDeNodo(editor.node as any)}
                  onChanged={onCoverChanged}
                />
              ) : null}

              {err ? (
                <View style={styles.errorBoxInline}>
                  <Ionicons name="alert-circle" size={16} color={colors.error} />
                  <Text style={styles.errorText}>{err}</Text>
                </View>
              ) : null}

              <View style={{ height: 4 }} />
              <Button label={editor?.kind === 'edit' ? 'Guardar cambios' : 'Crear nodo'} onPress={submit} loading={busy} fullWidth />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function countNodes(tree: LocationNodeTree[]): number {
  let n = 0;
  for (const node of tree) { n += 1 + countNodes(node.children); }
  return n;
}
function countLeaves(tree: LocationNodeTree[]): number {
  let n = 0;
  for (const node of tree) {
    if (node.is_leaf && node.children.length === 0) n += 1;
    n += countLeaves(node.children);
  }
  return n;
}
function formatMetaValue(v: any): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number') {
    // Mostrar coordenadas con 6 decimales como maximo
    return Number.isInteger(v) ? String(v) : v.toFixed(Math.min(6, (v.toString().split('.')[1] || '').length));
  }
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 11, color: colors.textMuted, fontWeight: '700', marginTop: 1 },
  scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md },
  errorText: { color: colors.error, fontSize: 13, flex: 1, fontWeight: '600' },
  emptyBlock: { alignItems: 'center', paddingVertical: spacing.xl + 12, gap: 8, paddingHorizontal: spacing.md },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 8 },
  emptyMsg: { fontSize: 13, color: colors.textMuted, textAlign: 'center', maxWidth: 320, lineHeight: 19 },
  emptyImportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 16, paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  emptyImportText: { color: colors.primary, fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
  emptyTemplateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 10, paddingVertical: 6, paddingHorizontal: 4,
  },
  emptyTemplateText: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
  metaBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.bg, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, borderWidth: 1, borderColor: colors.border,
  },
  metaBadgeText: { fontSize: 10, fontWeight: '700', color: colors.textBody },
  coverBadge: { backgroundColor: colors.primaryLight, borderColor: colors.primary },

  // Branch row
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingRight: 6, position: 'relative',
  },
  guide: { position: 'absolute', top: 0, bottom: 0, width: 1.5, backgroundColor: colors.border },
  toggleBtn: { width: 26, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  nodeIcon: {
    width: 30, height: 30, borderRadius: radius.md,
    backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
    marginRight: 8, borderWidth: 1, borderColor: colors.border,
  },
  nodeIconLeaf: { backgroundColor: colors.primaryLight, borderColor: colors.primaryLight },
  nodeName: { fontSize: 14, fontWeight: '700', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' },
  leafBadge: { backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  leafBadgeText: { fontSize: 9, fontWeight: '800', color: colors.textInverse, letterSpacing: 0.4, textTransform: 'uppercase' },
  childCount: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },
  muted: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic' },
  actionBtn: { padding: 6 },

  // Menu
  menu: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, marginTop: 4, marginBottom: 4, paddingVertical: 4, ...shadow.card,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  menuDanger: { borderTopWidth: 1, borderTopColor: colors.border },
  menuText: { fontSize: 13, fontWeight: '700', color: colors.textBody },

  // FAB
  fab: {
    position: 'absolute', right: spacing.lg, alignSelf: 'flex-end',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: radius.full, ...shadow.card,
  },
  fabText: { color: colors.textInverse, fontWeight: '800', fontSize: 14 },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, maxHeight: '90%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: 17, fontWeight: '800', color: colors.text, flex: 1 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    paddingHorizontal: 12, backgroundColor: colors.surface,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },
  leafToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: 12, backgroundColor: colors.bg,
  },
  leafToggleOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  leafToggleTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  leafToggleSub: { fontSize: 11, color: colors.textMuted, marginTop: 2, lineHeight: 15 },
  switch: {
    width: 38, height: 22, borderRadius: 11, backgroundColor: colors.border,
    justifyContent: 'center', paddingHorizontal: 2,
  },
  switchOn: { backgroundColor: colors.primary },
  switchThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  switchThumbOn: { transform: [{ translateX: 16 }] },
  mOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.surface,
  },
  mOptionOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  mOptionText: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '700' },
  // Coord targets card (lat/lon/elev) - visible cuando measurement_type = coord_latlon
  coordCard: {
    marginTop: 12,
    borderWidth: 1, borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md, padding: 12, gap: 10,
  },
  coordHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coordHeaderText: { fontSize: 12, fontWeight: '800', color: colors.primary, letterSpacing: 0.3, textTransform: 'uppercase' },
  coordHelp: { fontSize: 11, color: colors.textBody, lineHeight: 15 },
  coordRow: { flexDirection: 'row', gap: 10 },
  coordField: { flex: 1, gap: 6 },
  coordLabel: { fontSize: 11, fontWeight: '700', color: colors.textBody },
  metaHelp: { fontSize: 11, color: colors.textMuted, marginTop: 6, lineHeight: 15 },
  errorBoxInline: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md },

  // Cover / Portadilla del nodo
  coverSection: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: 12, backgroundColor: colors.bg, gap: 10,
  },
  coverHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coverTitle: { fontSize: 13, fontWeight: '800', color: colors.text, letterSpacing: 0.2 },
  coverHelp: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  coverPreviewWrap: {
    width: '100%', height: 200, borderRadius: radius.md,
    overflow: 'hidden', backgroundColor: colors.border, position: 'relative',
    borderWidth: 1, borderColor: colors.borderStrong,
    alignSelf: 'center',
  },
  coverPreview: { width: '100%', height: '100%' },
  coverPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  coverEmptyWrap: {
    width: '100%', height: 140, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
    backgroundColor: colors.surface,
    alignSelf: 'center',
  },
  coverEmptyText: { fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  coverActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  coverBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md,
    minHeight: 44,
  },
  coverBtnPrimary: { backgroundColor: colors.primary, flex: 1, justifyContent: 'center' },
  coverBtnPrimaryText: { color: colors.textInverse, fontWeight: '800', fontSize: 13 },
  coverBtnDanger: {
    borderWidth: 1, borderColor: colors.error, backgroundColor: colors.errorBg,
    justifyContent: 'center',
  },
  coverBtnDangerText: { color: colors.error, fontWeight: '800', fontSize: 13 },
  coverHint: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: radius.md,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
  },
  coverHintText: { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 15 },
});
