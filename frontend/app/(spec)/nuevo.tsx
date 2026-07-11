// SynCo v2.0 — Pantalla del Especialista (Captura Rápida v2).
// - Auto-data read-only (fecha, nombre, rol, contrato, ubicación).
// - Lecturas P/U con helper histórico "Última lectura registrada en este nodo".
// - Actividades + Observaciones (multilínea).
// - Personal y Equipo como listas dinámicas con [-] [+] y autocomplete vía
//   AsyncStorage (catálogo local de items previamente capturados).
// - Fotos: Base64 en RAM (Cero Huella Local).
// - Tras éxito → modal "Modo WhatsApp" con botones Copiar y Enviar.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';

import { useAuth } from '@/src/auth-context';
import { Button } from '@/src/components/Button';
import { colors, radius, spacing, shadow } from '@/src/theme';
import { confirm, notify } from '@/src/utils/confirm';
import { storage } from '@/src/utils/storage';
import {
  MEASUREMENT_LABELS, MeasurementType, roleLabel,
} from '@/src/utils/roles';
import {
  buildWhatsAppMessage, formatMeasurementValue, formatDateLongES,
  fmtNum2, Unidad,
} from '@/src/utils/whatsapp';
import { api, LocationNodeTree, Project } from '@/src/api';

const UNIDAD_OPTIONS: Unidad[] = ['km', 'm', 'cm'];

type MeasurementValue = Record<string, any>;

interface CascadeLevel {
  parentName: string | null;
  options: LocationNodeTree[];
  selectedId: string | null;
}

interface DynItem {
  id: string;
  qty: number;
  desc: string;
}

interface NodeHistorySnapshot {
  has_previous: boolean;
  ultima_lectura: number | null;
  primera_lectura: number | null;
  captured_by_name: string | null;
  created_at: string | null;
}

const CATALOG_PERSONAL_KEY = 'syncsite_catalog_personal';
const CATALOG_EQUIPO_KEY = 'syncsite_catalog_equipo';
const MAX_CATALOG_SIZE = 80;

export default function SpecCaptureScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const projectId = (user?.project_ids || [])[0] || '';
  // Para especialistas: scope_node_ids (lista de hojas asignadas).
  // Para sub-coordinadores: scope_node_id (un nodo padre) → todas las hojas descendientes son válidas.
  const isSubCoord = user?.role === 'sub_coordinador';

  // ----- Estado remoto (declarado ANTES de los useMemo que lo referencian) --
  const [project, setProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<LocationNodeTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowedLeafIds = useMemo(() => {
    if (isSubCoord) {
      // Marcamos como "permitido" cualquier nodo hoja presente en el árbol
      // (el backend ya filtra el árbol al scope del sub-coord).
      const set = new Set<string>();
      const walk = (nodes: any[]) => {
        for (const n of nodes || []) {
          if (n?.is_leaf) set.add(n.id);
          if (n?.children?.length) walk(n.children);
        }
      };
      walk(tree as any[]);
      return set;
    }
    return new Set<string>(user?.scope_node_ids || []);
  }, [isSubCoord, user?.scope_node_ids, tree]);

  // ----- Cascade -----------------------------------------------------------
  const [path, setPath] = useState<LocationNodeTree[]>([]);

  // ----- Form --------------------------------------------------------------
  const [actividades, setActividades] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [incidencias, setIncidencias] = useState('');
  const [severidad, setSeveridad] = useState<'informativo' | 'importante' | 'urgente'>('informativo');
  const [primeraLectura, setPrimeraLectura] = useState('');
  const [ultimaLectura, setUltimaLectura] = useState('');
  const [unidad, setUnidad] = useState<Unidad>('m');
  const [personal, setPersonal] = useState<DynItem[]>([]);
  const [equipo, setEquipo] = useState<DynItem[]>([]);
  const [measurement, setMeasurement] = useState<MeasurementValue>({});
  // === Fotos del reporte =================================================
  // A partir del fix P0 (Android "Network Request Failed" / iOS "invisible")
  // ya NO acumulamos base64 en memoria. Guardamos objetos con la URI local
  // (que expo-image-picker devuelve `file://...` en móvil), pre-comprimidos
  // vía `expo-image-manipulator` para no llenar la RAM del iPhone. En el
  // submit se sube cada URI vía multipart/form-data al backend, que responde
  // con el `data_url` base64 y ese es el string que finalmente entra al
  // reporte. Esto permite pipelines idempotentes y elimina JSONs gigantes.
  type PhotoAsset = { uri: string; mime: string; name: string };
  const [images, setImages] = useState<PhotoAsset[]>([]);
  // Descripciones individuales por foto (foto 1 → photoCaptions[0], foto 2 → [1]).
  // Solo se muestran/consideran las 2 primeras fotos (tope estricto de export).
  const [photoCaptions, setPhotoCaptions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // ----- Catálogos AsyncStorage --------------------------------------------
  const [catalogPersonal, setCatalogPersonal] = useState<string[]>([]);
  const [catalogEquipo, setCatalogEquipo] = useState<string[]>([]);

  // Catálogos efectivos = proyecto (Coordinador) + locales (autocomplete personal).
  // Dedup case-insensitive, conservando primer orden visto.
  const effectiveCatalogPersonal = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of [...(project?.categorias_personal || []), ...catalogPersonal]) {
      const k = (s || '').trim();
      if (!k) continue;
      const lk = k.toLowerCase();
      if (seen.has(lk)) continue;
      seen.add(lk);
      out.push(k);
    }
    return out;
  }, [project?.categorias_personal, catalogPersonal]);
  const effectiveCatalogEquipo = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of [...(project?.categorias_equipo || []), ...catalogEquipo]) {
      const k = (s || '').trim();
      if (!k) continue;
      const lk = k.toLowerCase();
      if (seen.has(lk)) continue;
      seen.add(lk);
      out.push(k);
    }
    return out;
  }, [project?.categorias_equipo, catalogEquipo]);

  // ----- Historial nodo ----------------------------------------------------
  const [nodeHistory, setNodeHistory] = useState<NodeHistorySnapshot | null>(null);
  const [nodeHistoryLoading, setNodeHistoryLoading] = useState(false);

  // Contratista / Contrato: captura libre simple (TextInputs).
  const [contratistaText, setContratistaText] = useState<string>('');
  const [contratoText, setContratoText] = useState<string>('');

  // Sincronizar defaults cuando llega el proyecto.
  useEffect(() => {
    if (!project) return;
    if (!contratistaText && project.constructora) {
      setContratistaText(project.constructora);
    }
    if (!contratoText && project.contract_number) {
      setContratoText(project.contract_number);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Valor efectivo (lo que va al reporte / WhatsApp)
  const contratistaEfectivo = contratistaText.trim();
  const contratoEfectivo = contratoText.trim();

  // ----- Modal cascada -----------------------------------------------------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLevelIdx, setPickerLevelIdx] = useState(0);

  // ----- Modal éxito (WhatsApp) --------------------------------------------
  const [successOpen, setSuccessOpen] = useState(false);
  const [waMessage, setWaMessage] = useState('');

  // -------------------------------------------------------------------------
  // Carga inicial.
  const load = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      setError('Tu cuenta no está asociada a ningún proyecto. Pide a tu Coordinador General que te envíe una nueva invitación.');
      return;
    }
    try {
      setError(null);
      const [p, t] = await Promise.all([api.getProject(projectId), api.getTree(projectId)]);
      setProject(p);
      // Sub-coordinador: scope GLOBAL (sin filtrado de hojas).
      setTree(isSubCoord ? t : filterTreeByLeafScope(t, allowedLeafIds));
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el proyecto');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, allowedLeafIds, isSubCoord]);

  useEffect(() => { load(); }, [load]);

  // Cargar catálogos de AsyncStorage al iniciar.
  useEffect(() => {
    (async () => {
      const p = await storage.getItem<string>(CATALOG_PERSONAL_KEY, '[]');
      const e = await storage.getItem<string>(CATALOG_EQUIPO_KEY, '[]');
      try { setCatalogPersonal(JSON.parse(p || '[]') as string[]); } catch { setCatalogPersonal([]); }
      try { setCatalogEquipo(JSON.parse(e || '[]') as string[]); } catch { setCatalogEquipo([]); }
    })();
  }, []);

  // -------------------------------------------------------------------------
  // Cascade levels.
  const levels: CascadeLevel[] = useMemo(() => {
    const out: CascadeLevel[] = [];
    out.push({ parentName: null, options: tree, selectedId: path[0]?.id ?? null });
    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      if (!node.children || node.children.length === 0) break;
      out.push({
        parentName: node.name,
        options: node.children,
        selectedId: path[i + 1]?.id ?? null,
      });
    }
    return out;
  }, [tree, path]);

  const leafNode: LocationNodeTree | null = useMemo(() => {
    const last = path[path.length - 1];
    if (last && last.is_leaf && allowedLeafIds.has(last.id)) return last;
    return null;
  }, [path, allowedLeafIds]);

  const parentOfLeaf: LocationNodeTree | null = useMemo(() => {
    if (!leafNode) return null;
    return path.length >= 2 ? path[path.length - 2] : null;
  }, [path, leafNode]);

  // Ubicación legible (path completo).
  const ubicacionPathLabel = useMemo(() => {
    if (path.length === 0) return 'Sin seleccionar';
    return path.map((n) => n.name).join(' / ');
  }, [path]);

  // -------------------------------------------------------------------------
  // Pre-cargar Lat/Lon/Elev cuando se selecciona una hoja con measurement_type=coord_latlon.
  // Orden de precedencia (de mayor a menor): valores ya escritos por el usuario en el form,
  // luego target_lat/target_lon/target_elev del nodo, luego metadata X/Y/Z (cargado vía Excel masivo).
  // En cualquier caso los campos siguen 100% editables por el usuario.
  useEffect(() => {
    if (!leafNode) return;
    if (leafNode.measurement_type !== 'coord_latlon') return;
    const tLat = (leafNode as any).target_lat;
    const tLon = (leafNode as any).target_lon;
    const tElev = (leafNode as any).target_elev;
    // Buscar en metadata X/Y/Z (importación masiva Excel). Case-insensitive, normaliza acentos.
    let mdX: number | null = null;
    let mdY: number | null = null;
    let mdZ: number | null = null;
    const md = (leafNode as any).metadata;
    if (md && typeof md === 'object') {
      for (const rawKey of Object.keys(md)) {
        if (typeof rawKey !== 'string') continue;
        const k = rawKey
          .trim()
          .toLowerCase()
          .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
          .replace(/ó/g, 'o').replace(/ú/g, 'u');
        const val = md[rawKey];
        const num = typeof val === 'number' ? val : (val != null ? parseFloat(String(val)) : NaN);
        if (!Number.isFinite(num)) continue;
        if (mdX === null && (k === 'x' || k === 'coordenada x' || k === 'coord x')) mdX = num;
        else if (mdY === null && (k === 'y' || k === 'coordenada y' || k === 'coord y')) mdY = num;
        else if (mdZ === null && (
          k === 'z' || k === 'coordenada z' || k === 'coord z' ||
          k === 'elev' || k === 'elevacion' || k === 'elevacion (tn)' ||
          k === 'elevacion tn' || k === 'altitud' || k === 'altura'
        )) mdZ = num;
      }
    }
    setMeasurement((prev) => {
      // En obra civil X=lon-axis (este), Y=lat-axis (norte), Z=elev (altitud).
      // Sólo aplicamos fallback si prev está vacío (no escritos manualmente).
      const nextLat = typeof tLat === 'number'
        ? tLat
        : (mdY !== null && (prev.lat == null || prev.lat === 0) ? mdY : prev.lat);
      const nextLon = typeof tLon === 'number'
        ? tLon
        : (mdX !== null && (prev.lon == null || prev.lon === 0) ? mdX : prev.lon);
      const nextElev = typeof tElev === 'number'
        ? tElev
        : (mdZ !== null && (prev.elev == null || prev.elev === 0) ? mdZ : prev.elev);
      return { ...prev, lat: nextLat, lon: nextLon, elev: nextElev };
    });
  }, [leafNode]);

  // -------------------------------------------------------------------------
  // Cargar historial del nodo cuando se selecciona una hoja.
  useEffect(() => {
    if (!leafNode || !projectId) {
      setNodeHistory(null);
      return;
    }
    let cancelled = false;
    setNodeHistoryLoading(true);
    (async () => {
      try {
        const h = await api.nodeHistory(projectId, leafNode.id);
        if (cancelled) return;
        if (h.has_previous && h.last_report) {
          setNodeHistory({
            has_previous: true,
            ultima_lectura: h.last_report.ultima_lectura ?? null,
            primera_lectura: h.last_report.primera_lectura ?? null,
            captured_by_name: h.last_report.captured_by_name || null,
            created_at: h.last_report.created_at || null,
          });
        } else {
          setNodeHistory({
            has_previous: false,
            ultima_lectura: null,
            primera_lectura: null,
            captured_by_name: null,
            created_at: null,
          });
        }
      } catch {
        if (!cancelled) setNodeHistory(null);
      } finally {
        if (!cancelled) setNodeHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leafNode, projectId]);

  // -------------------------------------------------------------------------
  // Picker.
  function openPicker(levelIdx: number) {
    setPickerLevelIdx(levelIdx);
    setPickerOpen(true);
  }
  function pickNode(node: LocationNodeTree) {
    setPickerOpen(false);
    setPath((prev) => {
      const next = prev.slice(0, pickerLevelIdx);
      next.push(node);
      return next;
    });
    if (node.is_leaf) setMeasurement({});
  }
  function resetCascade() {
    setPath([]);
    setMeasurement({});
    setNodeHistory(null);
  }

  // -------------------------------------------------------------------------
  // Cámara/galería (SÓLO URIs → sin base64 en JS).
  //
  // Flujo:
  //   1. Picker → obtenemos `asset.uri` (`file://...` en móvil).
  //   2. `expo-image-manipulator` re-encoda como JPEG max-width 1600 px con
  //      compresión 0.7 → ≈ 250-450 KB por foto (vs 2-4 MB del asset raw).
  //      Esto es CRÍTICO para que la subida no falle en Android ni congele
  //      el iPhone al preparar el payload.
  //   3. Guardamos la URI del manipulator (siempre `file://...cache/...jpg`).
  //   4. En el submit, se sube vía multipart (ver `onSubmit`).
  //
  // Además garantizamos que la URI final tenga `file://` (Android exige el
  // scheme explícito o rechaza el request con "Network request failed").
  async function compressPickedAsset(rawUri: string): Promise<PhotoAsset | null> {
    if (!rawUri) return null;
    try {
      // Sólo comprimimos en móvil. En web dejamos la URI tal cual (blob/data URL).
      if (Platform.OS === 'web') {
        return { uri: rawUri, mime: 'image/jpeg', name: `photo_${Date.now()}.jpg` };
      }
      const result = await ImageManipulator.manipulateAsync(
        rawUri,
        [{ resize: { width: 1600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      let uri = result.uri || rawUri;
      // Android exige `file://` como prefijo o falla el multipart upload.
      if (Platform.OS === 'android' && !uri.startsWith('file://') && !uri.startsWith('content://')) {
        uri = `file://${uri.replace(/^\/+/, '')}`;
      }
      return { uri, mime: 'image/jpeg', name: `photo_${Date.now()}.jpg` };
    } catch {
      // Si el manipulator falla, intentamos con la URI original.
      let uri = rawUri;
      if (Platform.OS === 'android' && !uri.startsWith('file://') && !uri.startsWith('content://')) {
        uri = `file://${uri.replace(/^\/+/, '')}`;
      }
      return { uri, mime: 'image/jpeg', name: `photo_${Date.now()}.jpg` };
    }
  }

  async function takePhotoFromCamera() {
    try {
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        if (!perm.canAskAgain) {
          await offerOpenSettings('Necesitas permitir el acceso a la cámara en la configuración de tu sistema para tomar fotos.');
          return;
        }
        perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,      // el picker guarda al disco, la compresión real la hace el manipulator.
        base64: false,     // ¡NO base64! Sólo URI (rendimiento móvil).
        exif: false,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const asset = await compressPickedAsset(res.assets[0].uri);
      if (asset) setImages((prev) => [...prev, asset]);
    } catch (e: any) {
      notify('Cámara', e?.message || 'No se pudo abrir la cámara.');
    }
  }

  async function pickPhotoFromLibrary() {
    try {
      let perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        if (!perm.canAskAgain) {
          await offerOpenSettings('Necesitas permitir el acceso a tu galería de fotos en la configuración para adjuntar imágenes.');
          return;
        }
        perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,      // real compression la hace el manipulator.
        base64: false,     // ¡NO base64!
        exif: false,
        allowsMultipleSelection: Platform.OS !== 'ios',
      });
      if (res.canceled) return;
      const newAssets: PhotoAsset[] = [];
      for (const a of res.assets || []) {
        if (a.uri) {
          const compressed = await compressPickedAsset(a.uri);
          if (compressed) newAssets.push(compressed);
        }
      }
      if (newAssets.length) setImages((prev) => [...prev, ...newAssets]);
    } catch (e: any) {
      notify('Galería', e?.message || 'No se pudo abrir la galería.');
    }
  }

  async function offerOpenSettings(message: string) {
    const ok = await confirm('Permisos requeridos', message, { confirmText: 'Abrir ajustes' });
    if (ok) Linking.openSettings();
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  // -------------------------------------------------------------------------
  // Catálogo AsyncStorage.
  async function persistCatalog(key: string, list: string[]) {
    // Dedupe + cap.
    const seen = new Set<string>();
    const trimmed: string[] = [];
    for (const s of list) {
      const k = s.trim();
      if (!k) continue;
      const norm = k.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      trimmed.push(k);
      if (trimmed.length >= MAX_CATALOG_SIZE) break;
    }
    await storage.setItem(key, JSON.stringify(trimmed));
  }

  async function addToCatalog(kind: 'personal' | 'equipo', descs: string[]) {
    const cleaned = descs.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    if (kind === 'personal') {
      const merged = [...cleaned, ...catalogPersonal];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const s of merged) {
        const n = s.toLowerCase();
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(s);
        if (out.length >= MAX_CATALOG_SIZE) break;
      }
      setCatalogPersonal(out);
      await persistCatalog(CATALOG_PERSONAL_KEY, out);
    } else {
      const merged = [...cleaned, ...catalogEquipo];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const s of merged) {
        const n = s.toLowerCase();
        if (seen.has(n)) continue;
        seen.add(n);
        out.push(s);
        if (out.length >= MAX_CATALOG_SIZE) break;
      }
      setCatalogEquipo(out);
      await persistCatalog(CATALOG_EQUIPO_KEY, out);
    }
  }

  // -------------------------------------------------------------------------
  // Dynamic items helpers.
  function addItem(kind: 'personal' | 'equipo') {
    const newItem: DynItem = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, qty: 1, desc: '' };
    if (kind === 'personal') setPersonal((prev) => [...prev, newItem]);
    else setEquipo((prev) => [...prev, newItem]);
  }
  function updateItem(kind: 'personal' | 'equipo', id: string, patch: Partial<DynItem>) {
    const updater = (prev: DynItem[]) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it));
    if (kind === 'personal') setPersonal(updater);
    else setEquipo(updater);
  }
  function removeItem(kind: 'personal' | 'equipo', id: string) {
    if (kind === 'personal') setPersonal((prev) => prev.filter((it) => it.id !== id));
    else setEquipo((prev) => prev.filter((it) => it.id !== id));
  }
  function incQty(kind: 'personal' | 'equipo', id: string, delta: number) {
    const target = kind === 'personal' ? personal : equipo;
    const cur = target.find((it) => it.id === id);
    if (!cur) return;
    const next = Math.max(1, (cur.qty || 1) + delta);
    updateItem(kind, id, { qty: next });
  }

  function serializeItems(items: DynItem[]): string[] {
    return items
      .filter((it) => (it.desc || '').trim().length > 0)
      .map((it) => `${Math.max(1, it.qty || 1)} ${it.desc.trim()}`);
  }

  // -------------------------------------------------------------------------
  // Envío.
  const primeraLecturaNum = parseFloatOrNull(primeraLectura);
  const ultimaLecturaNum = parseFloatOrNull(ultimaLectura);

  // Avance calculado en vivo (Última − Primera) con 2 decimales máximo.
  const avanceStr: string | null = useMemo(() => {
    if (primeraLecturaNum == null || ultimaLecturaNum == null) return null;
    return fmtNum2(ultimaLecturaNum - primeraLecturaNum);
  }, [primeraLecturaNum, ultimaLecturaNum]);

  const canSubmit = !!leafNode && !!project
    && validateMeasurement(leafNode.measurement_type, measurement)
    && !submitting;

  async function onSubmit() {
    if (!leafNode || !project) return;
    if (!validateMeasurement(leafNode.measurement_type, measurement)) {
      notify('Falta el valor de medición', `Captura el valor requerido (${MEASUREMENT_LABELS[leafNode.measurement_type as MeasurementType] || leafNode.measurement_type}) antes de finalizar.`);
      return;
    }
    setSubmitting(true);
    try {
      const personnelArr = serializeItems(personal);
      const equipmentArr = serializeItems(equipo);

      // === Fotos: RUTA ORIGINAL PARA iOS (base64 en JSON) ==================
      // ⚠️ ROLLBACK P0 (2026-07-06):
      // El flujo "bulletproof" multipart introdujo una regresión en iOS que
      // rompió la carga de fotos que funcionaba desde el día 1. En iPhone,
      // el pipeline probado y estable es: leer la URI local con
      // `FileSystem.readAsStringAsync(base64)` y mandar el string como
      // `data:image/jpeg;base64,…` dentro del array `images` del JSON del
      // POST /reports. `_strip_b64_prefix` en el backend ya lo normaliza.
      //
      // En Android SÍ mantenemos el multipart (`api.uploadReportPhoto`)
      // porque los JSONs > 5-10 MB provocan "Network request failed"
      // reproducible en el bridge nativo de RN Android.
      //
      // Web sigue por el mismo camino multipart (Blob → FormData).
      const dataUrls: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const asset = images[i];
        try {
          if (Platform.OS === 'ios') {
            // --- Ruta legacy iOS: base64 directo en JSON --------------
            const b64 = await FileSystem.readAsStringAsync(asset.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            if (b64 && b64.length > 0) {
              dataUrls.push(`data:${asset.mime || 'image/jpeg'};base64,${b64}`);
            } else {
              throw new Error('Archivo vacío tras la lectura local.');
            }
          } else {
            // --- Android + Web: multipart nativo (evita JSON gigante) ---
            const { data_url } = await api.uploadReportPhoto({
              uri: asset.uri,
              name: asset.name,
              mimeType: asset.mime,
            });
            if (data_url) dataUrls.push(data_url);
          }
        } catch (upErr: any) {
          // Volcado del error COMPLETO: incluye TypeError/NetworkError/AbortError
          // más cualquier prop no-enumerable (message, stack, url, etc.).
          const rawJson = (() => {
            try {
              return JSON.stringify(upErr, Object.getOwnPropertyNames(upErr), 2);
            } catch {
              return String(upErr);
            }
          })();
          const short = upErr?.message || String(upErr);
          Alert.alert(
            'Error de subida (foto ' + (i + 1) + ')',
            `${short}\n\n----- DUMP -----\n${rawJson.slice(0, 900)}`,
            [{ text: 'OK' }],
          );
          throw new Error(`Falló la subida de la foto ${i + 1}: ${short}`);
        }
      }

      await api.createReport({
        project_id: project.id,
        node_id: leafNode.id,
        measurement_value: measurement,
        notes: actividades.trim() || null, // legacy notes = actividades
        // [P0 FIX] avance ahora envía el string calculado + unidad (no actividades).
        avance: avanceStr != null ? `${avanceStr} ${unidad}` : null,
        observaciones: observaciones.trim() || null,
        incidencias: incidencias.trim() || null,
        severidad: severidad,
        contratista: null, // Deprecado: ahora se usa project.constructora global.
        personnel: personnelArr,
        equipment: equipmentArr,
        // El backend acepta data URLs completos (data:image/...) igual que
        // los base64 crudos históricos: `_strip_b64_prefix` en `server.py`
        // normaliza ambos formatos.
        images: dataUrls,
        // Solo se guardan los captions de las 2 primeras fotos (tope
        // estricto del exportador ejecutivo). Se envían aunque `images`
        // contenga más para preservar futuras extensiones sin romper compat.
        photo_captions: photoCaptions.slice(0, 2),
        primera_lectura: primeraLecturaNum,
        ultima_lectura: ultimaLecturaNum,
        unidad: unidad,
      });

      // Actualizar catálogo local (autocomplete).
      await addToCatalog('personal', personal.map((p) => p.desc));
      await addToCatalog('equipo', equipo.map((e) => e.desc));

      // Construir mensaje WhatsApp.
      const areaOrPuesto = (user?.puesto || user?.area || '').trim();
      const ubicacion = formatMeasurementValue(leafNode.measurement_type || '', measurement);
      const msg = buildWhatsAppMessage({
        userName: user?.name || '',
        areaOrPuesto,
        contractNumber: contratoEfectivo || project.contract_number,
        parentNodeName: parentOfLeaf?.name || '',
        leafNodeName: leafNode.name,
        ubicacion,
        constructora: contratistaEfectivo || project.constructora || '',
        personal: personnelArr,
        equipo: equipmentArr,
        actividades: actividades.trim(),
        observaciones: observaciones.trim(),
        primeraLectura: primeraLecturaNum,
        ultimaLectura: ultimaLecturaNum,
        unidad: unidad,
      });
      setWaMessage(msg);
      setSuccessOpen(true);
    } catch (e: any) {
      Alert.alert('Error al enviar', e?.message || 'No se pudo registrar el reporte');
    } finally {
      setSubmitting(false);
    }
  }

  function clearFormAndCloseSuccess() {
    setActividades('');
    setObservaciones('');
    setPrimeraLectura('');
    setUltimaLectura('');
    setPersonal([]);
    setEquipo([]);
    setMeasurement({});
    setImages([]);
    setPhotoCaptions([]);
    resetCascade();
    setSuccessOpen(false);
  }

  async function copyWhatsAppToClipboard() {
    try {
      await Clipboard.setStringAsync(waMessage);
      notify('Copiado', 'Reporte copiado al portapapeles, listo para pegar en WhatsApp.');
    } catch (e: any) {
      notify('Error', e?.message || 'No se pudo copiar');
    }
  }

  // Compartir reporte por WhatsApp (foto + texto).
  // - Si hay imagen: la copiamos a caché y abrimos el menú nativo de Share con
  //   `expo-sharing`. WhatsApp recoge la imagen y el caption desde el clipboard.
  // - Si no hay imagen: caemos al esquema clásico de Linking (wa.me / whatsapp://).
  async function sendViaWhatsApp() {
    try {
      // Siempre dejamos el texto listo para pegar como caption en WhatsApp.
      try { await Clipboard.setStringAsync(waMessage); } catch {}

      if (images.length > 0) {
        if (Platform.OS === 'web') {
          // En web, Share API directo si está disponible; si no, abrir wa.me con texto.
          try {
            const first = images[0];
            const resp = await fetch(first.uri);
            const blob = await resp.blob();
            const file = new File([blob], first.name || `reporte_${Date.now()}.jpg`, { type: first.mime || 'image/jpeg' });
            // @ts-ignore navigator.share
            if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [file] })) {
              // @ts-ignore
              await navigator.share({ files: [file], text: waMessage, title: 'Reporte' });
              return;
            }
          } catch {/* fallthrough */}
          // Fallback web: abrir wa.me con texto (sin imagen).
          const encoded = encodeURIComponent(waMessage);
          await Linking.openURL(`https://wa.me/?text=${encoded}`);
          return;
        }

        const available = await Sharing.isAvailableAsync();
        if (!available) {
          // Si no hay share sheet, caemos al clásico
          const encoded = encodeURIComponent(waMessage);
          const native = `whatsapp://send?text=${encoded}`;
          const canOpen = await Linking.canOpenURL(native);
          await Linking.openURL(canOpen ? native : `https://wa.me/?text=${encoded}`);
          return;
        }

        // En móvil ahora tenemos la URI directa del archivo comprimido en
        // caché (por el manipulator) → podemos compartirlo tal cual, sin
        // pasar por base64 → no bloquea el hilo principal.
        notify(
          'Foto lista',
          'El texto del reporte fue copiado. Selecciona WhatsApp y pega el texto como pie de la foto.',
        );

        await Sharing.shareAsync(images[0].uri, {
          mimeType: images[0].mime || 'image/jpeg',
          dialogTitle: 'Compartir reporte',
          UTI: 'public.jpeg',
        });
        return;
      }

      // Sin imágenes → flujo clásico de texto
      const encoded = encodeURIComponent(waMessage);
      const native = `whatsapp://send?text=${encoded}`;
      const fallback = `https://wa.me/?text=${encoded}`;
      try {
        const canOpen = await Linking.canOpenURL(native);
        await Linking.openURL(canOpen ? native : fallback);
      } catch {
        await Linking.openURL(fallback);
      }
    } catch (e: any) {
      notify('WhatsApp', e?.message || 'No se pudo abrir WhatsApp');
    }
  }

  async function onLogout() {
    const ok = await confirm('Cerrar sesión', '¿Seguro que deseas salir? Cualquier foto sin enviar se descartará.', { confirmText: 'Salir', destructive: true });
    if (!ok) return;
    setImages([]);
    await logout();
    router.replace('/(auth)/login');
  }

  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { paddingTop: insets.top, padding: spacing.lg }]}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
        <Text style={styles.errorTitle}>No se pudo cargar</Text>
        <Text style={styles.errorMsg}>{error}</Text>
        <Button label="Reintentar" onPress={load} fullWidth />
        <View style={{ height: spacing.sm }} />
        <Button label="Cerrar sesión" variant="ghost" onPress={onLogout} fullWidth />
      </View>
    );
  }

  // Sub-coordinador SIEMPRE tiene acceso global: NUNCA mostrar "Sin nodos asignados".
  const noAllowedLeaves = !isSubCoord && allowedLeafIds.size === 0;
  const noTree = !tree.length;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <StatusBar barStyle="dark-content" />
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.projName} numberOfLines={1}>{project?.name || 'Proyecto'}</Text>
          <Text style={styles.projMeta} numberOfLines={1}>
            {project?.contract_number ? `Contrato ${project.contract_number}` : ''}
            {project?.constructora ? `  ·  ${project.constructora}` : ''}
          </Text>
        </View>
        <Pressable style={styles.iconBtn} onPress={onLogout} hitSlop={8}>
          <Ionicons name="log-out-outline" size={20} color={colors.textBody} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl + 20 }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {/* AUTO-DATA (read-only) */}
        <SectionCard
          icon="information-circle-outline"
          title="Datos del reporte"
          subtitle="Información automática, no editable."
        >
          <View style={styles.autoGrid}>
            <AutoRow icon="calendar-outline" label="Fecha" value={formatDateLongES(new Date()).replace(/\.$/, '')} />
            <AutoRow icon="person-outline" label="Capturado por" value={`Ing. ${user?.name || ''}`.trim()} />
            <AutoRow icon="briefcase-outline" label="Rol" value={roleLabel(user?.role, user?.area)} />
            {user?.puesto ? <AutoRow icon="ribbon-outline" label="Puesto" value={user.puesto} /> : null}
            <AutoRow icon="document-attach-outline" label="No. de contrato" value={project?.contract_number || '—'} />
            <AutoRow icon="git-branch-outline" label="Ubicación" value={ubicacionPathLabel} />
          </View>
        </SectionCard>

        {/* Cascada */}
        <SectionCard
          icon="navigate-outline"
          title="Selecciona ubicación"
          subtitle="Navega hasta el nodo hoja autorizado."
        >
          {noAllowedLeaves ? (
            <EmptyState
              icon="warning-outline"
              title="Sin nodos asignados"
              msg="Tu invitación no incluye nodos hoja para capturar. Pide a tu Coordinador General que actualice tu scope."
            />
          ) : noTree ? (
            <EmptyState
              icon="git-network-outline"
              title="Aún no hay árbol"
              msg="El Coordinador General todavía no creó nodos visibles para tu scope."
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {levels.map((lvl, idx) => {
                const selected = lvl.options.find((o) => o.id === lvl.selectedId) || null;
                const label = idx === 0 ? 'Nivel raíz' : (lvl.parentName ? `Dentro de “${lvl.parentName}”` : `Nivel ${idx + 1}`);
                return (
                  <Pressable
                    key={`${idx}-${lvl.parentName || 'root'}`}
                    onPress={() => openPicker(idx)}
                    style={({ pressed }) => [styles.cascadeRow, pressed && { opacity: 0.85 }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cascadeLabel}>{label}</Text>
                      <Text style={[styles.cascadeValue, !selected && { color: colors.textMuted }]} numberOfLines={1}>
                        {selected ? selected.name : 'Seleccionar…'}
                      </Text>
                    </View>
                    {selected?.is_leaf && allowedLeafIds.has(selected.id) ? (
                      <View style={styles.leafBadge}>
                        <Ionicons name="flag" size={11} color={colors.textInverse} />
                        <Text style={styles.leafBadgeTxt}>Hoja</Text>
                      </View>
                    ) : null}
                    <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                  </Pressable>
                );
              })}
              {path.length > 0 ? (
                <Pressable onPress={resetCascade} hitSlop={8} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
                  <Text style={styles.linkBtn}>Reiniciar selección</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </SectionCard>

        {/* Coordenadas objetivo */}
        {leafNode && leafNode.measurement_type === 'coord_latlon' && (
          (leafNode as any).target_lat != null ||
          (leafNode as any).target_lon != null ||
          (leafNode as any).target_elev != null
        ) ? (
          <SectionCard
            icon="location-outline"
            title="Coordenadas objetivo (oficina)"
            subtitle="Valores dictados por el Coordinador. Solo lectura."
          >
            <View style={styles.coordsTargetGrid}>
              <View style={styles.coordsTargetItem}>
                <Text style={styles.coordsTargetLabel}>Coordenada X (Este)</Text>
                <Text style={styles.coordsTargetValue} numberOfLines={1}>
                  {(leafNode as any).target_lat != null ? String((leafNode as any).target_lat) : '—'}
                </Text>
              </View>
              <View style={styles.coordsTargetItem}>
                <Text style={styles.coordsTargetLabel}>Coordenada Y (Norte)</Text>
                <Text style={styles.coordsTargetValue} numberOfLines={1}>
                  {(leafNode as any).target_lon != null ? String((leafNode as any).target_lon) : '—'}
                </Text>
              </View>
              <View style={styles.coordsTargetItem}>
                <Text style={styles.coordsTargetLabel}>Elevación (Z)</Text>
                <Text style={styles.coordsTargetValue} numberOfLines={1}>
                  {(leafNode as any).target_elev != null ? String((leafNode as any).target_elev) : '—'}
                </Text>
              </View>
            </View>
          </SectionCard>
        ) : null}

        {/* Medición */}
        {leafNode ? (
          <SectionCard
            icon="speedometer-outline"
            title={`Medición · ${MEASUREMENT_LABELS[leafNode.measurement_type as MeasurementType] || leafNode.measurement_type}`}
            subtitle="Captura el valor que define este nodo."
          >
            <MeasurementInput
              type={leafNode.measurement_type as MeasurementType}
              value={measurement}
              onChange={setMeasurement}
            />
          </SectionCard>
        ) : null}

        {/* Lecturas P/U */}
        {leafNode ? (
          <SectionCard
            icon="analytics-outline"
            title="Lecturas"
            subtitle="Captura la primera y última lectura del día."
          >
            {/* Selector de Unidades — pills [km | m | cm] */}
            <Field label="Unidad de medida">
              <View style={styles.unidadRow}>
                {UNIDAD_OPTIONS.map((u) => {
                  const active = unidad === u;
                  return (
                    <Pressable
                      key={u}
                      onPress={() => setUnidad(u)}
                      style={[styles.unidadPill, active && styles.unidadPillActive]}
                      hitSlop={6}
                    >
                      <Text style={[styles.unidadPillTxt, active && styles.unidadPillTxtActive]}>
                        {u}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            <Field label="Primera lectura">
              <TextInput
                placeholder="Ej. 12.45"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                style={styles.input}
                value={primeraLectura}
                onChangeText={setPrimeraLectura}
              />
              {/* Helper histórico SOLO debajo de Primera lectura */}
              {nodeHistoryLoading ? (
                <Text style={styles.histHelperMuted}>Buscando histórico…</Text>
              ) : nodeHistory && nodeHistory.has_previous && nodeHistory.ultima_lectura != null ? (
                <View style={styles.histHelperBox}>
                  <Ionicons name="time-outline" size={13} color={colors.primary} />
                  <Text style={styles.histHelperTxt}>
                    Última lectura registrada en este nodo:{' '}
                    <Text style={styles.histHelperVal}>{String(nodeHistory.ultima_lectura)}</Text>
                  </Text>
                </View>
              ) : nodeHistory && !nodeHistory.has_previous ? (
                <Text style={styles.histHelperMuted}>Sin lecturas previas en este nodo.</Text>
              ) : null}
            </Field>

            <Field label="Última lectura">
              <TextInput
                placeholder="Ej. 12.80"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                style={styles.input}
                value={ultimaLectura}
                onChangeText={setUltimaLectura}
              />
            </Field>

            {/* Avance calculado en vivo = Última - Primera */}
            {avanceStr != null ? (
              <View style={styles.avanceBox}>
                <Ionicons name="trending-up" size={16} color={colors.primary} />
                <Text style={styles.avanceLabel}>Avance:</Text>
                <Text style={styles.avanceValue}>{avanceStr} {unidad}</Text>
              </View>
            ) : (primeraLectura.trim() !== '' || ultimaLectura.trim() !== '') ? (
              <Text style={styles.histHelperMuted}>
                Captura ambas lecturas (Primera y Última) para calcular el avance.
              </Text>
            ) : null}
          </SectionCard>
        ) : null}

        {/* Reporte: Actividades / Observaciones / Incidencias / Severidad */}
        {leafNode ? (
          <SectionCard icon="document-text-outline" title="Reporte" subtitle="Actividades y observaciones del día.">
            <Field label="Actividades">
              <TextInput
                placeholder="Describe las actividades del día…"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.inputMulti]}
                multiline
                numberOfLines={4}
                value={actividades}
                onChangeText={setActividades}
              />
            </Field>

            <Field label="Observaciones">
              <TextInput
                placeholder="Comentarios, retrasos, lo que ocurrió en el día…"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.inputMulti]}
                multiline
                numberOfLines={4}
                value={observaciones}
                onChangeText={setObservaciones}
              />
            </Field>

            <Field label="Incidencias (opcional)">
              <TextInput
                placeholder="Eventos relevantes: bloqueos, fallas, accidentes, desviaciones…"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.inputMulti]}
                multiline
                numberOfLines={3}
                value={incidencias}
                onChangeText={setIncidencias}
              />
            </Field>

            <Field label="Severidad (semáforo)">
              <View style={styles.sevRow}>
                {([
                  { key: 'informativo', label: 'Informativo', color: '#1d4ed8', icon: 'information-circle' },
                  { key: 'importante', label: 'Importante', color: '#d97706', icon: 'alert-circle' },
                  { key: 'urgente', label: 'Urgente', color: '#dc2626', icon: 'warning' },
                ] as const).map((opt) => {
                  const active = severidad === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setSeveridad(opt.key)}
                      style={[
                        styles.sevChip,
                        active && { backgroundColor: opt.color, borderColor: opt.color },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Ionicons
                        name={opt.icon as any}
                        size={16}
                        color={active ? '#fff' : opt.color}
                      />
                      <Text style={[styles.sevChipTxt, active && { color: '#fff' }]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

          </SectionCard>
        ) : null}

        {/* Personal dinámico */}
        {leafNode ? (
          <DynamicListSection
            title="Personal"
            subtitle="Cantidad + descripción (ej. 3 Albañiles)."
            icon="people-outline"
            items={personal}
            catalog={effectiveCatalogPersonal}
            onAdd={() => addItem('personal')}
            onRemove={(id) => removeItem('personal', id)}
            onInc={(id, d) => incQty('personal', id, d)}
            onChangeDesc={(id, t) => updateItem('personal', id, { desc: t })}
            onChangeQty={(id, q) => updateItem('personal', id, { qty: q })}
          />
        ) : null}

        {/* Contratación (Contratista → Contrato) — se muestra INMEDIATAMENTE
            debajo de Personal por requisito ejecutivo (Personal → Contratista
            → Contrato). Antes vivían en la sección "Reporte" arriba. */}
        {leafNode ? (
          <SectionCard
            icon="briefcase-outline"
            title="Contratación"
            subtitle="Contratista y número de contrato."
          >
            <Field label="Contratista">
              <TextInput
                placeholder="Nombre del contratista"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={contratistaText}
                onChangeText={setContratistaText}
              />
            </Field>

            <Field label="No. de contrato">
              <TextInput
                placeholder="Ej. CONT-2026-001"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={contratoText}
                onChangeText={setContratoText}
              />
            </Field>
          </SectionCard>
        ) : null}

        {/* Equipo dinámico */}
        {leafNode ? (
          <DynamicListSection
            title="Equipo"
            subtitle="Cantidad + descripción (ej. 1 Retro CAT 320)."
            icon="construct-outline"
            items={equipo}
            catalog={effectiveCatalogEquipo}
            onAdd={() => addItem('equipo')}
            onRemove={(id) => removeItem('equipo', id)}
            onInc={(id, d) => incQty('equipo', id, d)}
            onChangeDesc={(id, t) => updateItem('equipo', id, { desc: t })}
            onChangeQty={(id, q) => updateItem('equipo', id, { qty: q })}
          />
        ) : null}

        {/* Fotos + descripciones individuales por foto -------------------- */}
        {/* Sólo las 2 primeras se exportan a PPTX/PDF (layout ejecutivo).   */}
        {leafNode ? (
          <SectionCard
            icon="camera-outline"
            title={`Fotos (${images.length})`}
            subtitle="Máximo 2 fotos se exportarán al reporte ejecutivo (PPTX/PDF)."
          >
            {/* Fila 1: fotos 1 y 2 (las que sí van al export) — cada una con
                su TextInput de descripción individual justo debajo. */}
            <View style={{ gap: spacing.md }}>
              {images.slice(0, 2).map((asset, i) => (
                <View key={`photo-${i}`} style={styles.photoWithCaption}>
                  <View style={styles.photoWithCaptionHead}>
                    <View style={styles.photoIndexBadge}>
                      <Text style={styles.photoIndexBadgeTxt}>{i + 1}</Text>
                    </View>
                    <View style={styles.photoTile}>
                      <Image
                        source={{ uri: asset.uri }}
                        style={styles.photoImg}
                      />
                      <Pressable
                        onPress={() => {
                          removeImage(i);
                          // Colapsamos el caption removido, no dejamos huecos.
                          setPhotoCaptions((prev) => prev.filter((_, idx) => idx !== i));
                        }}
                        style={styles.photoRemove}
                        hitSlop={6}
                      >
                        <Ionicons name="close" size={14} color={colors.textInverse} />
                      </Pressable>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.photoCaptionLabel}>
                        Descripción foto {i + 1}
                      </Text>
                      <Text style={styles.photoCaptionHint}>
                        Aparecerá al pie de la foto en PPTX/PDF.
                      </Text>
                    </View>
                  </View>
                  <TextInput
                    placeholder={
                      i === 0
                        ? 'Descripción de la primera foto (máx. 4 líneas)'
                        : 'Descripción de la segunda foto (máx. 4 líneas)'
                    }
                    placeholderTextColor={colors.textMuted}
                    style={[styles.input, styles.inputMulti]}
                    multiline
                    numberOfLines={4}
                    maxLength={160}
                    value={photoCaptions[i] || ''}
                    onChangeText={(t) => {
                      setPhotoCaptions((prev) => {
                        const next = [...prev];
                        while (next.length <= i) next.push('');
                        next[i] = t;
                        return next;
                      });
                    }}
                  />
                  <Text style={styles.photoCaptionCounter}>
                    {(photoCaptions[i] || '').length}/160
                  </Text>
                </View>
              ))}
            </View>

            {/* Fotos extra (3+): informativas, no exportan. */}
            {images.length > 2 ? (
              <View style={styles.photoExtraBox}>
                <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
                <Text style={styles.photoExtraTxt}>
                  Adjuntaste {images.length} fotos, pero sólo las primeras 2 aparecerán en el reporte ejecutivo.
                </Text>
              </View>
            ) : null}
            {images.length > 2 ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.sm }}>
                {images.slice(2).map((asset, offset) => {
                  const realIdx = offset + 2;
                  return (
                    <View key={`extra-${realIdx}`} style={[styles.photoTile, { opacity: 0.65 }]}>
                      <Image source={{ uri: asset.uri }} style={styles.photoImg} />
                      <Pressable
                        onPress={() => {
                          removeImage(realIdx);
                          setPhotoCaptions((prev) => prev.filter((_, idx) => idx !== realIdx));
                        }}
                        style={styles.photoRemove}
                        hitSlop={6}
                      >
                        <Ionicons name="close" size={14} color={colors.textInverse} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Botones para agregar */}
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.md }}>
              <Pressable onPress={takePhotoFromCamera} style={[styles.photoTile, styles.photoAdd]}>
                <Ionicons name="camera" size={22} color={colors.primary} />
                <Text style={styles.photoAddTxt}>Cámara</Text>
              </Pressable>
              <Pressable onPress={pickPhotoFromLibrary} style={[styles.photoTile, styles.photoAdd]}>
                <Ionicons name="images-outline" size={22} color={colors.primary} />
                <Text style={styles.photoAddTxt}>Galería</Text>
              </Pressable>
            </View>
          </SectionCard>
        ) : null}

        {/* CTA */}
        {leafNode ? (
          <View style={{ marginTop: spacing.md }}>
            <Button
              label={submitting ? 'Enviando…' : 'Guardar reporte'}
              onPress={onSubmit}
              loading={submitting}
              disabled={!canSubmit}
              fullWidth
              icon={<Ionicons name="checkmark-circle" size={18} color="#fff" />}
            />
            {!canSubmit && !submitting ? (
              <Text style={styles.helpHint}>
                Captura el valor de medición requerido para habilitar el envío.
              </Text>
            ) : null}
          </View>
        ) : (
          path.length > 0 && !leafNode ? (
            <Text style={styles.helpHint}>Continúa la selección hasta llegar a un nodo hoja autorizado.</Text>
          ) : null
        )}
      </ScrollView>

      {/* Picker modal */}
      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            {pickerLevelIdx === 0 ? 'Selecciona nodo raíz' : `Dentro de "${levels[pickerLevelIdx]?.parentName || ''}"`}
          </Text>
          <FlatList
            data={levels[pickerLevelIdx]?.options || []}
            keyExtractor={(n) => n.id}
            renderItem={({ item }) => {
              const isLeaf = item.is_leaf && allowedLeafIds.has(item.id);
              const hasChildren = (item.children?.length || 0) > 0;
              return (
                <Pressable onPress={() => pickNode(item)} style={({ pressed }) => [styles.pickerOption, pressed && { backgroundColor: colors.primaryLight }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerOptionName}>{item.name}</Text>
                    <Text style={styles.pickerOptionMeta}>
                      {isLeaf ? `Hoja · ${MEASUREMENT_LABELS[item.measurement_type as MeasurementType] || item.measurement_type}` : `${item.children?.length || 0} hijo(s)`}
                    </Text>
                  </View>
                  {isLeaf ? (
                    <View style={styles.leafBadge}>
                      <Ionicons name="flag" size={11} color={colors.textInverse} />
                      <Text style={styles.leafBadgeTxt}>Hoja</Text>
                    </View>
                  ) : hasChildren ? (
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  ) : null}
                </Pressable>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            ListEmptyComponent={<Text style={styles.emptyTxt}>Sin opciones disponibles.</Text>}
            style={{ maxHeight: 380 }}
          />
        </View>
      </Modal>

      {/* Modal de éxito (Modo WhatsApp) */}
      <Modal visible={successOpen} animationType="fade" transparent onRequestClose={() => setSuccessOpen(false)}>
        <View style={styles.successBackdrop}>
          <View style={[styles.successCard, { marginTop: insets.top + spacing.xl }]}>
            <View style={styles.successHeader}>
              <View style={styles.successIcon}>
                <Ionicons name="checkmark" size={28} color={colors.textInverse} />
              </View>
              <Text style={styles.successTitle}>Reporte enviado</Text>
              <Text style={styles.successSubtitle}>
                Tus datos y fotos se guardaron en la base. Copia el texto o ábrelo directo en WhatsApp.
              </Text>
            </View>
            <ScrollView style={styles.successPreview} contentContainerStyle={{ padding: spacing.md }}>
              <Text style={styles.successPreviewTxt}>{waMessage}</Text>
            </ScrollView>
            <View style={{ gap: spacing.sm }}>
              <Button
                label="Enviar por WhatsApp"
                onPress={sendViaWhatsApp}
                fullWidth
                icon={<Ionicons name="logo-whatsapp" size={18} color="#fff" />}
              />
              <Button
                label="Copiar texto"
                variant="secondary"
                onPress={copyWhatsAppToClipboard}
                fullWidth
                icon={<Ionicons name="copy-outline" size={18} color={colors.primary} />}
              />
              <Button
                label="Nueva captura"
                variant="ghost"
                onPress={clearFormAndCloseSuccess}
                fullWidth
              />
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ============================================================================
// Sección de listas dinámicas (Personal / Equipo) con autocomplete.
// ============================================================================
function DynamicListSection({
  title, subtitle, icon, items, catalog,
  onAdd, onRemove, onInc, onChangeDesc, onChangeQty,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  items: DynItem[];
  catalog: string[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onInc: (id: string, delta: number) => void;
  onChangeDesc: (id: string, t: string) => void;
  onChangeQty: (id: string, q: number) => void;
}) {
  return (
    <SectionCard icon={icon} title={`${title} (${items.length})`} subtitle={subtitle}>
      {items.length === 0 ? (
        <Text style={styles.emptyInlineTxt}>Aún no agregaste items. Toca “Agregar” para iniciar.</Text>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {items.map((it) => (
            <DynamicItemRow
              key={it.id}
              item={it}
              catalog={catalog}
              catalogTitle={title}
              onRemove={() => onRemove(it.id)}
              onInc={(d) => onInc(it.id, d)}
              onChangeDesc={(t) => onChangeDesc(it.id, t)}
              onChangeQty={(q) => onChangeQty(it.id, q)}
            />
          ))}
        </View>
      )}
      <Pressable onPress={onAdd} style={styles.addItemBtn} hitSlop={6}>
        <Ionicons name="add" size={18} color={colors.primary} />
        <Text style={styles.addItemBtnTxt}>Agregar {title.toLowerCase()}</Text>
      </Pressable>
    </SectionCard>
  );
}

function DynamicItemRow({
  item, catalog, onRemove, onInc, onChangeDesc, onChangeQty, catalogTitle,
}: {
  item: DynItem;
  catalog: string[];
  onRemove: () => void;
  onInc: (delta: number) => void;
  onChangeDesc: (t: string) => void;
  onChangeQty: (q: number) => void;
  catalogTitle: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [search, setSearch] = useState('');
  const insets = useSafeAreaInsets();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((s) => s.toLowerCase().includes(q));
  }, [catalog, search]);

  const openPicker = () => {
    setSearch('');
    setCustomMode(false);
    setCustomDraft(item.desc || '');
    setPickerOpen(true);
  };

  const pickOption = (opt: string) => {
    onChangeDesc(opt);
    setPickerOpen(false);
  };

  const submitCustom = () => {
    const t = customDraft.trim();
    if (!t) return;
    onChangeDesc(t);
    setPickerOpen(false);
  };

  return (
    <View style={styles.dynRow}>
      <View style={styles.dynQtyBox}>
        <Pressable onPress={() => onInc(-1)} style={styles.qtyBtn} hitSlop={6} disabled={item.qty <= 1}>
          <Ionicons name="remove" size={16} color={item.qty <= 1 ? colors.textMuted : colors.text} />
        </Pressable>
        <TextInput
          style={styles.qtyInput}
          keyboardType="number-pad"
          value={String(item.qty)}
          onChangeText={(t) => {
            const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
            onChangeQty(Number.isFinite(n) && n > 0 ? n : 1);
          }}
        />
        <Pressable onPress={() => onInc(1)} style={styles.qtyBtn} hitSlop={6}>
          <Ionicons name="add" size={16} color={colors.text} />
        </Pressable>
      </View>

      {/* Selector tipo "select": muestra valor o placeholder y abre BottomSheet */}
      <Pressable
        onPress={openPicker}
        style={[styles.dynDescPicker, !item.desc && styles.dynDescPickerEmpty]}
        accessibilityRole="button"
      >
        <Text
          numberOfLines={1}
          style={[
            styles.dynDescPickerTxt,
            !item.desc && { color: colors.textMuted, fontWeight: '500' },
          ]}
        >
          {item.desc || `Elegir ${catalogTitle.toLowerCase()}…`}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.primary} />
      </Pressable>

      <Pressable onPress={onRemove} style={styles.removeBtn} hitSlop={6}>
        <Ionicons name="trash-outline" size={16} color={colors.error} />
      </Pressable>

      {/* BottomSheet con todo el catálogo */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => setPickerOpen(false)}
        />
        <View style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
          <View style={styles.pickerHandle} />
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Catálogo de {catalogTitle.toLowerCase()}</Text>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          {customMode ? (
            <View style={{ paddingHorizontal: 4 }}>
              <Text style={styles.pickerHint}>Escribe la descripción personalizada:</Text>
              <TextInput
                style={styles.pickerCustomInput}
                placeholder={`Ej. ${catalogTitle === 'Personal' ? 'Albañil' : 'Retro CAT 320'}`}
                placeholderTextColor={colors.textMuted}
                value={customDraft}
                onChangeText={setCustomDraft}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submitCustom}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Pressable
                  onPress={() => setCustomMode(false)}
                  style={[styles.pickerActionBtn, { backgroundColor: '#f1f5f9' }]}
                >
                  <Ionicons name="arrow-back" size={14} color={colors.text} />
                  <Text style={[styles.pickerActionTxt, { color: colors.text }]}>Catálogo</Text>
                </Pressable>
                <Pressable
                  onPress={submitCustom}
                  disabled={!customDraft.trim()}
                  style={[
                    styles.pickerActionBtn,
                    { backgroundColor: customDraft.trim() ? colors.primary : '#cbd5e1', flex: 1 },
                  ]}
                >
                  <Ionicons name="checkmark" size={14} color="#fff" />
                  <Text style={[styles.pickerActionTxt, { color: '#fff' }]}>Usar este texto</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              {catalog.length > 6 ? (
                <View style={styles.pickerSearchBox}>
                  <Ionicons name="search" size={14} color={colors.textMuted} />
                  <TextInput
                    style={styles.pickerSearchInput}
                    placeholder="Buscar..."
                    placeholderTextColor={colors.textMuted}
                    value={search}
                    onChangeText={setSearch}
                  />
                  {search ? (
                    <Pressable onPress={() => setSearch('')} hitSlop={10}>
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {catalog.length === 0 ? (
                <View style={styles.pickerEmpty}>
                  <Ionicons name="folder-open-outline" size={32} color={colors.textMuted} />
                  <Text style={styles.pickerEmptyTxt}>
                    Aún no hay {catalogTitle.toLowerCase()} en el catálogo del proyecto.
                  </Text>
                  <Text style={[styles.pickerEmptyTxt, { fontSize: 11, marginTop: 4 }]}>
                    Puedes escribir uno personalizado.
                  </Text>
                </View>
              ) : (
                <ScrollView
                  style={{ flexGrow: 1, maxHeight: Dimensions.get('window').height * 0.55 }}
                  contentContainerStyle={{ paddingVertical: 4 }}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  {filtered.length === 0 ? (
                    <Text style={[styles.pickerHint, { textAlign: 'center', paddingVertical: 16 }]}>
                      {`Sin resultados para "${search}".`}
                    </Text>
                  ) : (
                    filtered.map((opt) => {
                      const active = item.desc === opt;
                      return (
                        <Pressable
                          key={opt}
                          onPress={() => pickOption(opt)}
                          style={({ pressed }) => [
                            styles.catPickerOption,
                            active && styles.catPickerOptionActive,
                            pressed && { opacity: 0.6 },
                          ]}
                        >
                          <Ionicons
                            name={active ? 'checkmark-circle' : 'bookmark-outline'}
                            size={16}
                            color={active ? colors.primary : colors.textMuted}
                          />
                          <Text
                            style={[
                              styles.catPickerOptionTxt,
                              active && { color: colors.primary, fontWeight: '800' },
                            ]}
                            numberOfLines={2}
                          >
                            {opt}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              )}

              <Pressable
                onPress={() => { setCustomDraft(item.desc || ''); setCustomMode(true); }}
                style={styles.pickerCustomCta}
              >
                <Ionicons name="create-outline" size={14} color={colors.primary} />
                <Text style={styles.pickerCustomCtaTxt}>Escribir uno personalizado</Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

// ============================================================================
// Componentes auxiliares
// ============================================================================
function SectionCard({ icon, title, subtitle, children }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      <View>{children}</View>
    </View>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function AutoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.autoRow}>
      <Ionicons name={icon} size={14} color={colors.primary} style={{ marginRight: 8 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.autoLabel}>{label}</Text>
        <Text style={styles.autoValue} numberOfLines={2}>{value || '—'}</Text>
      </View>
    </View>
  );
}

function EmptyState({ icon, title, msg }: { icon: keyof typeof Ionicons.glyphMap; title: string; msg: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
      <Ionicons name={icon} size={32} color={colors.textMuted} />
      <Text style={[styles.fieldLabel, { marginTop: 8 }]}>{title}</Text>
      <Text style={styles.emptyTxt}>{msg}</Text>
    </View>
  );
}

// ----- Inputs de medición ---------------------------------------------------
function MeasurementInput({ type, value, onChange }: {
  type: MeasurementType;
  value: MeasurementValue;
  onChange: (v: MeasurementValue) => void;
}) {
  if (type === 'coord_latlon') {
    const latStr = value.lat != null && Number.isFinite(value.lat) ? String(value.lat) : '';
    const lonStr = value.lon != null && Number.isFinite(value.lon) ? String(value.lon) : '';
    const elevStr = value.elev != null && Number.isFinite(value.elev) ? String(value.elev) : '';
    return (
      <View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Field label="Latitud (Y)" hint="Pre-llenada desde el nodo. Editable.">
              <TextInput
                editable={true}
                keyboardType="numeric"
                placeholder="Ej. 19.432608"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={latStr}
                onChangeText={(t) => {
                  const trimmed = (t || '').trim();
                  if (!trimmed || trimmed === '-' || trimmed === '.') {
                    onChange({ ...value, lat: null });
                    return;
                  }
                  const num = parseFloat(trimmed.replace(',', '.'));
                  onChange({ ...value, lat: Number.isFinite(num) ? num : null });
                }}
              />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Longitud (X)" hint="Pre-llenada desde el nodo. Editable.">
              <TextInput
                editable={true}
                keyboardType="numeric"
                placeholder="Ej. -99.133209"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={lonStr}
                onChangeText={(t) => {
                  const trimmed = (t || '').trim();
                  if (!trimmed || trimmed === '-' || trimmed === '.') {
                    onChange({ ...value, lon: null });
                    return;
                  }
                  const num = parseFloat(trimmed.replace(',', '.'));
                  onChange({ ...value, lon: Number.isFinite(num) ? num : null });
                }}
              />
            </Field>
          </View>
        </View>
        {/* Tercer eje: Elevación (Z). Pre-llenada desde metadata.elev / "Elevación (TN)" del nodo. */}
        <Field label="Elevación (Z)" hint="Pre-llenada desde el nodo. Editable. Acepta decimales y negativos.">
          <TextInput
            editable={true}
            keyboardType="numeric"
            placeholder="Ej. 2240.5"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={elevStr}
            onChangeText={(t) => {
              const trimmed = (t || '').trim();
              if (!trimmed || trimmed === '-' || trimmed === '.') {
                onChange({ ...value, elev: null });
                return;
              }
              const num = parseFloat(trimmed.replace(',', '.'));
              onChange({ ...value, elev: Number.isFinite(num) ? num : null });
            }}
          />
        </Field>
      </View>
    );
  }
  if (type === 'cadenamiento') {
    return (
      <Field label="Cadenamiento (formato 5+100 o 5+100.50)">
        <TextInput
          placeholder="5+100"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          autoCapitalize="none"
          value={value.cadenamiento || ''}
          onChangeText={(t) => onChange({ cadenamiento: t })}
        />
      </Field>
    );
  }
  if (type === 'eje') {
    return (
      <Field label="Eje">
        <TextInput
          placeholder="A, B, 1-2…"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          autoCapitalize="characters"
          value={value.eje || ''}
          onChangeText={(t) => onChange({ eje: t })}
        />
      </Field>
    );
  }
  if (type === 'nivel') {
    return (
      <Field label="Nivel (m)">
        <TextInput
          placeholder="12.45"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          style={styles.input}
          value={value.nivel != null ? String(value.nivel) : ''}
          onChangeText={(t) => onChange({ nivel: parseFloatSafe(t) })}
        />
      </Field>
    );
  }
  return null;
}

// ============================================================================
// Helpers
// ============================================================================
function parseFloatSafe(t: string): number | string {
  const cleaned = t.replace(',', '.').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return cleaned;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : cleaned;
}

function parseFloatOrNull(t: string): number | null {
  const cleaned = (t || '').replace(',', '.').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function validateMeasurement(type: string | null | undefined, v: MeasurementValue): boolean {
  if (!type) return false;
  if (type === 'coord_latlon') {
    return typeof v.lat === 'number' && typeof v.lon === 'number'
      && Number.isFinite(v.lat) && Number.isFinite(v.lon);
  }
  if (type === 'cadenamiento') {
    return typeof v.cadenamiento === 'string' && /^\d+\+\d{1,4}(\.\d+)?$/.test(v.cadenamiento);
  }
  if (type === 'eje') {
    return typeof v.eje === 'string' && v.eje.trim().length > 0;
  }
  if (type === 'nivel') {
    return typeof v.nivel === 'number' && Number.isFinite(v.nivel);
  }
  return false;
}

function filterTreeByLeafScope(
  tree: LocationNodeTree[],
  allowed: Set<string>,
): LocationNodeTree[] {
  if (allowed.size === 0) return [];
  const recur = (nodes: LocationNodeTree[]): LocationNodeTree[] => {
    const out: LocationNodeTree[] = [];
    for (const n of nodes || []) {
      const filteredChildren = recur(n.children || []);
      const isAllowedLeaf = n.is_leaf && allowed.has(n.id);
      if (isAllowedLeaf || filteredChildren.length > 0) {
        out.push({ ...n, children: filteredChildren });
      }
    }
    return out;
  };
  return recur(tree);
}

// ============================================================================
// Styles
// ============================================================================
const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg, gap: spacing.sm },
  errorTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  errorMsg: { textAlign: 'center', color: colors.textBody, marginBottom: spacing.md },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  projName: { fontSize: 16, fontWeight: '800', color: colors.text },
  projMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  iconBtn: { padding: 8, borderRadius: radius.full, backgroundColor: colors.bg },

  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionIcon: {
    width: 28, height: 28, borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  sectionSubtitle: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  // Auto-data
  autoGrid: { gap: 8 },
  autoRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.md, padding: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  autoLabel: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
  autoValue: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 2 },

  cascadeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 56,
  },
  cascadeLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  cascadeValue: { fontSize: 15, color: colors.text, fontWeight: '700', marginTop: 2 },

  leafBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full,
  },
  leafBadgeTxt: { color: colors.textInverse, fontSize: 10, fontWeight: '800' },

  linkBtn: { color: colors.primary, fontWeight: '700', fontSize: 13 },

  fieldLabel: { fontSize: 12, color: colors.textBody, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  fieldHint: { fontSize: 11, color: colors.textMuted, marginBottom: 6, fontStyle: 'italic' },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 15,
    color: colors.text,
    minHeight: 44,
  },
  inputMulti: { minHeight: 90, textAlignVertical: 'top' },
  // Selector de severidad (semáforo)
  sevRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  sevChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: '#fff',
    minHeight: 36,
  },
  sevChipTxt: { fontSize: 13, fontWeight: '700', color: colors.text },

  selectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  selectorBtnTxt: { flex: 1, fontSize: 15, color: colors.text },

  // Selector de unidades (pills)
  unidadRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  unidadPill: {
    flex: 1,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
  },
  unidadPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  unidadPillTxt: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textBody,
    textTransform: 'lowercase',
    letterSpacing: 0.5,
  },
  unidadPillTxtActive: {
    color: colors.textInverse,
  },

  // Avance calculado en vivo
  avanceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    padding: 10,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  avanceLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textBody,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  avanceValue: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
    marginLeft: 'auto',
  },

  // Helper de histórico para Primera lectura
  histHelperBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 6,
    padding: 8,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  histHelperTxt: { fontSize: 12, color: colors.textBody, flex: 1 },
  histHelperVal: { fontWeight: '800', color: colors.primary },
  histHelperMuted: { fontSize: 11, color: colors.textMuted, marginTop: 4, fontStyle: 'italic' },

  // Dynamic list
  dynRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  dynQtyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    height: 44,
  },
  qtyBtn: {
    width: 32, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyInput: {
    width: 36, height: 44,
    textAlign: 'center',
    color: colors.text,
    fontWeight: '800',
    fontSize: 14,
    paddingVertical: 0,
  },
  dynDescInput: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 14,
    color: colors.text,
    height: 44,
  },
  removeBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addItemBtn: {
    marginTop: spacing.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    paddingVertical: 10, paddingHorizontal: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed',
  },
  addItemBtnTxt: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  emptyInlineTxt: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', paddingVertical: 4 },

  suggestionsBox: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
    zIndex: 10,
    maxHeight: 220,
    ...shadow.card,
  },
  suggestionItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  suggestionTxt: { fontSize: 13, color: colors.text, flex: 1 },

  // ── Selector tipo "select" (reemplaza al TextInput libre) ────────────────
  dynDescPicker: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12,
    height: 44,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  dynDescPickerEmpty: {
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  dynDescPickerTxt: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    fontWeight: '700',
  },

  // ── BottomSheet del catálogo (Personal / Equipo) ─────────────────────────
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  pickerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
    maxHeight: '85%',
  },
  pickerHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    marginBottom: 8,
  },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    marginBottom: 8,
  },
  pickerTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  pickerHint: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  pickerSearchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12,
    height: 40,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: 8,
  },
  pickerSearchInput: { flex: 1, fontSize: 14, color: colors.text },
  catPickerOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: 6,
    minHeight: 48,
  },
  catPickerOptionActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  catPickerOptionTxt: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '600' },
  pickerEmpty: { alignItems: 'center', paddingVertical: 28 },
  pickerEmptyTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
  pickerCustomCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed',
    marginTop: 4,
  },
  pickerCustomCtaTxt: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  pickerCustomInput: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 15,
    color: colors.text,
  },
  pickerActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: radius.md,
  },
  pickerActionTxt: { fontWeight: '800', fontSize: 13 },

  photoTile: {
    width: 88, height: 88, borderRadius: radius.md, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 22, height: 22, borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  photoAdd: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary, borderStyle: 'dashed',
    gap: 4,
  },
  photoAddTxt: { color: colors.primary, fontSize: 11, fontWeight: '700' },

  // ── Fotos con caption individual (nuevo layout ejecutivo, tope 2) ──
  photoWithCaption: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  photoWithCaptionHead: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
  },
  photoIndexBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  photoIndexBadgeTxt: {
    color: colors.textInverse, fontSize: 11, fontWeight: '800',
  },
  photoCaptionLabel: {
    fontSize: 12, fontWeight: '800', color: colors.text,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  photoCaptionHint: {
    fontSize: 11, color: colors.textMuted, marginTop: 2,
  },
  photoCaptionCounter: {
    fontSize: 10, color: colors.textMuted, textAlign: 'right',
    marginTop: -2,
  },
  photoExtraBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF3C7',
    borderRadius: radius.sm, borderWidth: 1, borderColor: '#FDE68A',
    padding: 8,
    marginTop: spacing.sm,
  },
  photoExtraTxt: {
    flex: 1, fontSize: 11, color: '#92400E', fontWeight: '600',
  },

  helpHint: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 12, textAlign: 'center' },

  // Picker modal
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  modalSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, marginBottom: spacing.sm,
  },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  pickerOption: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 12, paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  pickerOptionName: { fontSize: 14, fontWeight: '700', color: colors.text },
  pickerOptionMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  sep: { height: 1, backgroundColor: colors.border, marginLeft: spacing.sm },
  emptyTxt: { textAlign: 'center', color: colors.textMuted, padding: spacing.md, fontSize: 12 },

  // Success
  successBackdrop: { flex: 1, backgroundColor: colors.overlay, padding: spacing.md, justifyContent: 'flex-start' },
  successCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  successHeader: { alignItems: 'center', gap: 6 },
  successIcon: {
    width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  successTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  successSubtitle: { fontSize: 12, color: colors.textBody, textAlign: 'center' },
  successPreview: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    maxHeight: 280,
  },
  successPreviewTxt: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 12, color: colors.text, lineHeight: 18 },

  // Coordenadas objetivo
  coordsTargetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  coordsTargetItem: {
    flex: 1, minWidth: '30%',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md, padding: 10, gap: 4,
    borderWidth: 1, borderColor: colors.primary,
  },
  coordsTargetLabel: { fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 0.6 },
  coordsTargetValue: { fontSize: 14, fontWeight: '800', color: colors.text },
});
