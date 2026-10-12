// Dirac · Pantalla "Nuevo Reporte" (RESTAURADA - PIXEL PERFECT + CRASH FIX)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert,
  TextInput, KeyboardAvoidingView, Platform, Modal, Image, TouchableOpacity, FlatList, Linking,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { pickPhotoDataUrl, recoverPendingPhoto } from '@/src/utils/photoPicker';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { api, Area, Project, LocationNode, LocationNodeTree, Report, ReportTemplate } from '@/src/api';
import { colors, radius, shadow, spacing, areaTone } from '@/src/theme';
import { storage } from '@/src/utils/storage';
import { useAuth } from '@/src/auth-context';
import { dayjs, CDMX_TZ } from '@/src/utils/tz';
import { shareWithAutoRecover } from '@/src/utils/share';
import { buildReportShareText } from '@/src/utils/reportText';
import { PhotoAnnotator } from '@/src/components/PhotoAnnotator';
import { requestCameraPermission } from '@/src/utils/permissions';
import { confirm } from '@/src/utils/confirm';
import { t, a11y } from '@/src/i18n';

// Persistence Keys
const CATALOG_PERSONAL_KEY = 'syncsite_catalog_personal';
const CATALOG_EQUIPO_KEY = 'syncsite_catalog_equipo';
const MAX_CATALOG_SIZE = 50;

interface DynItem {
  id: string;
  desc: any;
  qty: number;
}

export default function NewReportScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth(); // [FIX] Re-adding missing useAuth hook to prevent ReferenceError
  const params = useLocalSearchParams<{ project_id: string; node_id: string }>();

  // --- ESTRUCTURA ---
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<LocationNodeTree[]>([]);
  const [path, setPath] = useState<LocationNodeTree[]>([]);
  const [selectedLeaf, setSelectedLeaf] = useState<LocationNode | null>(null);
  const [history, setHistory] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTree, setLoadingTree] = useState(false);

  // --- FORM STATE ---
  const [nombre, setNombre] = useState('');
  // Selección múltiple: un reporte puede pertenecer a varios informes a la
  // vez (p.ej. Diario + Mensual). "Informativo" es excluyente: al elegirlo
  // se limpia cualquier otra selección, y viceversa.
  type SeveridadUI = 'Informativo' | 'Diario' | 'Semanal' | 'Mensual';
  const [severidadUI, setSeveridadUI] = useState<Set<SeveridadUI>>(new Set(['Informativo']));
  const toggleSeveridad = useCallback((key: SeveridadUI) => {
    setSeveridadUI((prev) => {
      if (key === 'Informativo') return new Set(['Informativo']);
      const next = new Set(prev);
      next.delete('Informativo');
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) next.add('Informativo');
      return next;
    });
  }, []);
  // El bloque de lecturas solo se despliega si el usuario marca que quiere
  // capturarlas (muchos reportes no llevan primera/ultima lectura).
  const [registrarLecturas, setRegistrarLecturas] = useState(false);
  const [unidad, setUnidad] = useState<'km' | 'm' | 'cm'>('m');
  const [primeraLectura, setPrimeraLectura] = useState('');
  const [ultimaLectura, setUltimaLectura] = useState('');
  const [actividades, setActividades] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [incidencias, setIncidencias] = useState('');
  const [avance, setAvance] = useState('');
  const [contratista, setContratista] = useState('');
  const [personal, setPersonal] = useState<DynItem[]>([]);
  const [equipo, setEquipo] = useState<DynItem[]>([]);
  // Lo que el Coordinador definió que captura el área del especialista:
  // Personal, Equipo y campos libres (p. ej. banderilleros). Sin área o sin
  // configuración, se captura Personal y Equipo como siempre.
  const [areaConfig, setAreaConfig] = useState<Area | null>(null);
  const [camposExtra, setCamposExtra] = useState<Record<string, string>>({});
  const capturaPersonal = areaConfig?.captura_personal !== false;
  const capturaEquipo = areaConfig?.captura_equipo !== false;
  const camposArea = areaConfig?.campos_extra || [];
  const [images, setImages] = useState<string[]>([]);
  const [captions, setCaptions] = useState<string[]>(['', '']);
  const [annotatorIdx, setAnnotatorIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [successReport, setSuccessReport] = useState<Report | null>(null);
  // Advertencias previas al guardado: si no hay fotos, o si hay fotos sin
  // descripcion, se pide confirmacion explicita antes de enviar el reporte.
  const [confirmWarning, setConfirmWarning] = useState<'no-photos' | 'no-captions' | null>(null);

  // --- REPORTE ESTRUCTURADO (plantilla dinámica) ---
  // Escoger una plantilla es obligatorio: "Reporte Libre" (code
  // "reporte_libre", categoría "General") es la plantilla base/general que se
  // preselecciona y que cubre los casos que no tienen una plantilla específica.
  const GENERAL_TEMPLATE_CODE = 'reporte_libre';
  const [reportTemplates, setReportTemplates] = useState<ReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [dynamicData, setDynamicData] = useState<Record<string, any>>({});
  const [tplPickerOpen, setTplPickerOpen] = useState(false);
  const selectedTemplate = useMemo(
    () => reportTemplates.find((t) => t.id === selectedTemplateId) || null,
    [reportTemplates, selectedTemplateId]
  );
  const generalTemplate = useMemo(
    () =>
      reportTemplates.find((t) => t.code === GENERAL_TEMPLATE_CODE) ||
      reportTemplates.find((t) => (t.category || '').toLowerCase() === 'general') ||
      reportTemplates[0] ||
      null,
    [reportTemplates]
  );
  // Si aun no hay plantilla elegida (recien cargaron las plantillas), cae en
  // automatico a la plantilla general/base.
  useEffect(() => {
    if (!selectedTemplateId && generalTemplate) setSelectedTemplateId(generalTemplate.id);
  }, [generalTemplate]);
  // Lista de plantillas especificas agrupada por área/categoría (Calidad,
  // Seguridad...), ordenada alfabeticamente. La plantilla general se excluye
  // de esta lista porque se muestra fija arriba como opcion base.
  const groupedTemplates = useMemo(() => {
    const byCat = new Map<string, ReportTemplate[]>();
    for (const t of reportTemplates) {
      if (generalTemplate && t.id === generalTemplate.id) continue;
      const cat = t.category || 'General';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(t);
    }
    return Array.from(byCat.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [reportTemplates, generalTemplate]);
  const setDynamicField = useCallback((key: string, value: any) => {
    setDynamicData((prev) => ({ ...prev, [key]: value }));
  }, []);

  // --- CATALOGS ---
  const [catalogPersonal, setCatalogPersonal] = useState<string[]>([]);
  const [catalogEquipo, setCatalogEquipo] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const list = await api.listProjects();
        setProjects(list || []);

        const activePid = params.project_id || (list && list.length > 0 ? list[0].id : '');
        if (activePid) {
          const p = await api.getProject(activePid);
          setProject(p);
          const t = await api.getTree(activePid);
          setTree(t || []);

          if (params.node_id) {
            const findAndSetLeaf = (nodes: LocationNodeTree[], targetId: string, currentPath: LocationNodeTree[] = []): boolean => {
              for (const n of nodes) {
                if (n.id === targetId) {
                  setPath([...currentPath, n]);
                  if (n.is_leaf) setSelectedLeaf(n);
                  return true;
                }
                if (n.children && findAndSetLeaf(n.children, targetId, [...currentPath, n])) return true;
              }
              return false;
            };
            findAndSetLeaf(t || [], params.node_id);
          }
        }

        const cp = await storage.getItem<string>(CATALOG_PERSONAL_KEY, '[]');
        const ce = await storage.getItem<string>(CATALOG_EQUIPO_KEY, '[]');
        try { setCatalogPersonal(JSON.parse(cp || '[]')); } catch { setCatalogPersonal([]); }
        try { setCatalogEquipo(JSON.parse(ce || '[]')); } catch { setCatalogEquipo([]); }

        try {
          const tpls = await api.getReportTemplates();
          setReportTemplates(tpls || []);
        } catch (e) { console.log('Error fetching report templates', e); }
      } catch (e) { Alert.alert(t('nuevoReporte.error'), t('nuevoReporte.noSePudoIniciar')); }
      finally { setLoading(false); }
    })();

    // Initialize with a clean form
    resetForm();

    return () => {
      // Auto-reset when screen is closed to ensure fresh start next time
      resetForm();
    };
  }, [params.project_id, params.node_id]);

  useEffect(() => {
    const pid = project?.id;
    const aid = user?.area_id;
    if (!pid || !aid) { setAreaConfig(null); return; }
    let vivo = true;
    api.listAreas(pid)
      .then((list) => { if (vivo) setAreaConfig((list || []).find((a) => a.id === aid) || null); })
      .catch(() => { if (vivo) setAreaConfig(null); });
    return () => { vivo = false; };
  }, [project?.id, user?.area_id]);

  const loadProjectTree = async (pid: string) => {
    setLoadingTree(true);
    try {
      const p = await api.getProject(pid);
      setProject(p);
      const t = await api.getTree(pid);
      setTree(t || []);
    } catch (e) { Alert.alert(t('nuevoReporte.error'), t('nuevoReporte.noSePudoCargarLa')); }
    finally { setLoadingTree(false); }
  };

  const onSelectNode = async (node: LocationNodeTree) => {
    const nextPath = [...path, node];
    setPath(nextPath);
    if (node.is_leaf) {
      setSelectedLeaf(node);
      try {
        const hist = await api.nodeHistory(project?.id || params.project_id, node.id);
        setHistory(hist);
      } catch (e) { console.log('Error fetching history', e); }
    }
  };

  const popPath = (index: number) => {
    const nextPath = path.slice(0, index);
    setPath(nextPath);
    setSelectedLeaf(null);
  };

  const resetForm = () => {
    setNombre('');
    setSeveridadUI(new Set(['Informativo']));
    setRegistrarLecturas(false);
    setUnidad('m');
    setPrimeraLectura('');
    setUltimaLectura('');
    setActividades('');
    setObservaciones('');
    setIncidencias('');
    setAvance('');
    setPersonal([]);
    setEquipo([]);
    setCamposExtra({});
    setImages([]);
    setCaptions(['', '']);
    setPath([]);
    setSelectedLeaf(null);
    setSuccessReport(null);
    // Vuelve a la plantilla general/base (nunca "sin plantilla": ver
    // `generalTemplate`). Si las plantillas aun no cargaron, el efecto que
    // observa `generalTemplate` la asigna en cuanto esten disponibles.
    setSelectedTemplateId(generalTemplate?.id || '');
    setDynamicData({});
  };

  const addItem = (type: 'personal' | 'equipo') => {
    const newItem: DynItem = { id: Math.random().toString(36).substring(7), desc: '', qty: 1 };
    if (type === 'personal') setPersonal([...personal, newItem]);
    else setEquipo([...equipo, newItem]);
  };

  const currentOptions = useMemo(() => {
    const list = path.length === 0 ? tree : (path[path.length - 1].children || []);
    return [...list].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [tree, path]);

  const avanceCalculado = useMemo(() => {
    const p = parseFloat(primeraLectura);
    const u = parseFloat(ultimaLectura);
    if (isNaN(p) || isNaN(u)) return '';
    const diff = Math.abs(u - p);
    return `${diff.toFixed(2)}${unidad}`;
  }, [primeraLectura, ultimaLectura, unidad]);

  const effectiveCatalogPersonal = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const source = [...(project?.categorias_personal || []), ...catalogPersonal];
    for (const s of source) {
      if (!s) continue;
      const k = s.toLowerCase().trim();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s.trim());
    }
    return out;
  }, [project, catalogPersonal]);

  const effectiveCatalogEquipo = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    const source = [...(project?.categorias_equipo || []), ...catalogEquipo];
    for (const it of source) {
      const item = typeof it === 'string' ? { nombre: it } : it;
      if (!item || !item.nombre) continue;
      const ukey = `${item.nombre}`.toLowerCase();
      if (seen.has(ukey)) continue;
      seen.add(ukey);
      out.push(item);
    }
    return out;
  }, [project, catalogEquipo]);

  // Antes de guardar, revisa si faltan fotos o descripciones de fotos y pide
  // confirmacion explicita en vez de enviar el reporte directo.
  function onSavePressed() {
    if (saving) return;
    if (!selectedLeaf) return Alert.alert(t('nuevoReporte.error'), t('nuevoReporte.seleccionaUnaUbicacion'));
    // Escoger un tipo de reporte es obligatorio; en el flujo normal ya viene
    // preseleccionada la plantilla general, esto es solo un respaldo (p.ej.
    // si el catalogo de plantillas quedo vacio o fallo al cargar).
    if (reportTemplates.length > 0 && !selectedTemplateId) {
      return Alert.alert(t('nuevoReporte.error'), t('nuevoReporte.seleccionaUnTipoDeReporte'));
    }

    if (images.length === 0) {
      setConfirmWarning('no-photos');
      return;
    }
    const relevantCaptions = captions.slice(0, Math.min(images.length, 2));
    if (relevantCaptions.some((c) => !c || !c.trim())) {
      setConfirmWarning('no-captions');
      return;
    }
    doSave();
  }

  async function doSave() {
    if (saving) return;
    if (!selectedLeaf) return Alert.alert(t('nuevoReporte.error'), t('nuevoReporte.seleccionaUnaUbicacion'));

    setSaving(true);
    try {
      let loc = null;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const res = await Location.getCurrentPositionAsync({});
        loc = { lat: res.coords.latitude, lon: res.coords.longitude, elev: res.coords.altitude };
      }

      const SEV_UI_TO_BACKEND: Record<SeveridadUI, string> = {
        Informativo: 'informativo',
        Diario: 'diario',
        Semanal: 'importante',
        Mensual: 'urgente',
      };
      const finalSeveridad = Array.from(severidadUI).map((k) => SEV_UI_TO_BACKEND[k]);

      // Convierte los valores de campos "number" (capturados como texto en el
      // TextInput) a numero real antes de enviarlos al backend.
      const finalDynamicData: Record<string, any> = {};
      if (selectedTemplate) {
        for (const f of selectedTemplate.fields) {
          const v = dynamicData[f.key];
          if (v === undefined || v === '' || v === null) continue;
          finalDynamicData[f.key] = f.type === 'number' ? (parseFloat(String(v).replace(',', '.')) || 0) : v;
        }
      }

      // Solo los campos que el área define y que se llenaron.
      const valoresCamposExtra: Record<string, string> = {};
      for (const c of camposArea) {
        const v = (camposExtra[c.id || ''] || '').trim();
        if (c.id && v) valoresCamposExtra[c.id] = v;
      }

      const payload = {
        project_id: project!.id,
        node_id: selectedLeaf.id,
        title: nombre.trim(),
        severidad: finalSeveridad as any,
        unidad,
        primera_lectura: registrarLecturas ? (parseFloat(primeraLectura) || 0) : 0,
        ultima_lectura: registrarLecturas ? (parseFloat(ultimaLectura) || 0) : 0,
        actividades: actividades.trim(),
        activities: actividades.trim(), // [P0] SEND BOTH FOR SERVER COMPAT
        observaciones: observaciones.trim(),
        incidencias: incidencias.trim(),
        avance: registrarLecturas ? (avanceCalculado || '0').toString() : '0',
        contratista: project?.constructora || '',
        campos_extra: valoresCamposExtra,
        personnel: !capturaPersonal ? [] : personal.filter(p => p.desc).map(p => `${p.qty} ${typeof p.desc === 'string' ? p.desc : p.desc.nombre}`),
        equipment: !capturaEquipo ? [] : equipo.filter(e => e.desc).map(e => `${e.qty} ${typeof e.desc === 'string' ? e.desc : e.desc.nombre}`),
        images,
        photo_captions: captions,
        measurement_value: {},
        measurement_type: selectedLeaf.measurement_type || 'cadenamiento',
        location: loc,
        template_id: selectedTemplate?.id || undefined,
        dynamic_data: finalDynamicData,
      };

      const res = await api.createReport(payload);
      // `res.node_path_names` solo viene calculado del backend cuando el
      // envio fue real; en modo encolado (offline) lo derivamos del `path`
      // local para que `buildReportShareText` funcione igual en los dos casos.
      // `campos_extra` y las marcas de captura se rearman localmente: si el
      // envio quedo encolado (sin senal) la respuesta trae solo los valores crudos.
      setSuccessReport({
        ...res,
        node_path_names: path.map((n) => n.name),
        campos_extra: camposArea
          .filter((c) => c.id && valoresCamposExtra[c.id])
          .map((c) => ({ ...c, valor: c.tipo === 'numero' ? Number(valoresCamposExtra[c.id!].replace(',', '.')) : valoresCamposExtra[c.id!] })),
        captura_personal: capturaPersonal,
        captura_equipo: capturaEquipo,
      });

      // Save catalogs
      const nextP = Array.from(new Set([...personal.map(p => p.desc).filter(Boolean), ...catalogPersonal])).slice(0, MAX_CATALOG_SIZE);
      await storage.setItem(CATALOG_PERSONAL_KEY, JSON.stringify(nextP));
      const nextE = [...equipo.map(e => e.desc).filter(it => it && (typeof it === 'string' ? it : it.nombre)), ...catalogEquipo].slice(0, MAX_CATALOG_SIZE);
      await storage.setItem(CATALOG_EQUIPO_KEY, JSON.stringify(nextE));
    } catch (e: any) {
      Alert.alert(t('nuevoReporte.error'), e?.message || 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  async function onPickImage(mode: 'cam' | 'gal') {
    const dataUrl = await pickPhotoDataUrl(mode === 'cam' ? 'camera' : 'library');
    if (dataUrl) setImages((cur) => [...cur, dataUrl]);
  }

  // Foto tomada justo antes de que Android cerrara la app por falta de memoria.
  useEffect(() => {
    recoverPendingPhoto().then((dataUrl) => {
      if (dataUrl) setImages((cur) => [...cur, dataUrl]);
    });
  }, []);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      {/* Header (Imagen 1) */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} hitSlop={8} onPress={() => router.back()} style={styles.headerBtn}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
        <Text style={styles.headerTitle}>{t('nuevoReporte.nuevoReporte')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* BLOQUE NOMBRE DEL REPORTE (Imagen 2) */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIconBox}><Ionicons name="pricetag" size={16} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>{t('nuevoReporte.nombreDelReporte')}</Text>
              <Text style={styles.cardHelp}>{t('nuevoReporte.opcionalSeUsaraParaBuscarlo')}</Text>
            </View>
          </View>
          <Text style={styles.inputLabelSmall}>{t('nuevoReporte.nombre')}</Text>
          <TextInput
            value={nombre} onChangeText={setNombre}
            placeholder={t('nuevoReporte.ejInspeccionDiariaDeArmado')}
            style={styles.inputGhost}
          />
        </View>

        {/* BLOQUE DATOS AUTOMATICOS (Imagen 2) */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIconBox}><Ionicons name="information-circle" size={18} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>{t('nuevoReporte.datosDelReporte')}</Text>
              <Text style={styles.cardHelp}>{t('nuevoReporte.informacionAutomaticaNoEditable')}</Text>
            </View>
          </View>
          <AutoRow icon="calendar" label={t('nuevoReporte.fecha')} value={dayjs().tz(CDMX_TZ).format('DD MMM YYYY')} />
          <AutoRow icon="person" label={t('nuevoReporte.capturadoPor')} value={user?.name || '—'} />
          <AutoRow icon="briefcase" label={t('nuevoReporte.rol')} value={user?.role || '—'} />
          <AutoRow icon="ribbon" label={t('nuevoReporte.puesto')} value={user?.puesto || '—'} />
          <AutoRow icon="document-text" label={t('nuevoReporte.noDeContrato')} value={project?.contract_number || '...'} />
          <AutoRow icon="git-branch" label={t('nuevoReporte.ubicacion')} value={(path.length > 0 ? path.map(n => n.name).join(' / ') : 'Sin seleccionar')} />
        </View>

        {/* BLOQUE SELECCION UBICACION (Imagen 3) */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardIconBox, { backgroundColor: colors.primaryLight }]}><Ionicons name="navigate" size={16} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>{t('nuevoReporte.seleccionaUbicacion')}</Text>
              <Text style={styles.cardHelp}>{t('nuevoReporte.navegaHastaElNodoHoja')}</Text>
            </View>
          </View>

          <LocationStep label={t('nuevoReporte.nivelRaiz')} value={path[0]?.name || t('nuevoReporte.seleccionar')} onPress={() => popPath(0)} />
          {path.length >= 1 && <LocationStep label={t('nuevoReporte.dentroDe', { nombre: path[0].name })} value={path[1]?.name || t('nuevoReporte.seleccionar')} onPress={() => popPath(1)} />}
          {path.length >= 2 && <LocationStep label={t('nuevoReporte.dentroDe', { nombre: path[1].name })} value={path[2]?.name || t('nuevoReporte.seleccionar')} onPress={() => popPath(2)} />}

          {!selectedLeaf && (
            <View style={styles.nodeGrid}>
              {currentOptions.map(n => (
                <Pressable accessibilityRole="button" key={n.id} onPress={() => onSelectNode(n)} style={styles.nodeItem}>
                  <Text style={styles.nodeItemTxt}>{n.name}</Text>
                  {n.is_leaf && <View style={styles.leafBadge}><Ionicons name="flag" size={10} color="#fff" /><Text style={styles.leafBadgeTxt}>{t('nuevoReporte.hoja')}</Text></View>}
                </Pressable>
              ))}
              {project?.id && currentOptions.length === 0 && <Text style={styles.emptyTxt}>{t('nuevoReporte.noHayMasSubniveles')}</Text>}
            </View>
          )}

          {path.length > 0 && <Pressable accessibilityRole="button" onPress={() => { setPath([]); setSelectedLeaf(null); }}><Text style={styles.resetTxt}>{t('nuevoReporte.reiniciarSeleccion')}</Text></Pressable>}
        </View>

        {/* BLOQUE REPORTE ESTRUCTURADO (plantilla dinámica) */}
        {selectedLeaf && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIconBox}><Ionicons name="list" size={16} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>{t('nuevoReporte.tipoDeReporte')}</Text>
                <Text style={styles.cardHelp}>{t('nuevoReporte.eligeLaPlantillaParaCapturar', { plantilla: generalTemplate?.name || t('nuevoReporte.reporteLibre') })}</Text>
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setTplPickerOpen(true)} style={styles.tplSelectorRow}>
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
              <Text style={styles.tplSelectorTxt}>{selectedTemplate?.name || generalTemplate?.name || 'Cargando...'}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>

            {selectedTemplate && (
              <View style={{ gap: 16, marginTop: 4 }}>
                {selectedTemplate.fields.map((f) => (
                  <DynamicTemplateField
                    key={f.key}
                    field={f}
                    value={dynamicData[f.key]}
                    onChange={(v: any) => setDynamicField(f.key, v)}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        <Modal visible={tplPickerOpen} animationType="slide" transparent>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalContent, { maxHeight: '80%' }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('nuevoReporte.tipoDeReporte')}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} hitSlop={8} onPress={() => setTplPickerOpen(false)}><Ionicons name="close" size={24} /></Pressable>
              </View>
              <ScrollView style={{ marginTop: 10 }}>
                {generalTemplate && (
                  <Pressable accessibilityRole="button"
                    onPress={() => { setSelectedTemplateId(generalTemplate.id); setDynamicData({}); setTplPickerOpen(false); }}
                    style={styles.optBtn}
                  >
                    <Ionicons name="document-text-outline" size={18} color={colors.primary} />
                    <Text style={styles.optTxt}>{generalTemplate.name} {t('nuevoReporte.general')}</Text>
                    {selectedTemplateId === generalTemplate.id && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                  </Pressable>
                )}
                {groupedTemplates.map(([category, tpls]) => (
                  <View key={category}>
                    <Text style={styles.tplGroupHeader}>{category}</Text>
                    {tpls.map((t) => (
                      <Pressable accessibilityRole="button"
                        key={t.id}
                        onPress={() => { setSelectedTemplateId(t.id); setDynamicData({}); setTplPickerOpen(false); }}
                        style={styles.optBtn}
                      >
                        <Ionicons name="document-text-outline" size={18} color={colors.textMuted} />
                        <Text style={styles.optTxt}>{t.name}</Text>
                        {selectedTemplateId === t.id && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                      </Pressable>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* BLOQUE LECTURAS (Imagen 5) */}
        {selectedLeaf && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIconBox}><Ionicons name="stats-chart" size={16} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>{t('nuevoReporte.lecturas')}</Text>
                <Text style={styles.cardHelp}>{t('nuevoReporte.capturaLaPrimeraYUltima')}</Text>
              </View>
            </View>

            <Pressable accessibilityRole="button" onPress={() => setRegistrarLecturas(!registrarLecturas)} style={styles.checkboxRow}>
              <Ionicons name={registrarLecturas ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
              <Text style={styles.checkboxTxt}>{t('nuevoReporte.esteReporteIncluyeLecturasPrimera')}</Text>
            </Pressable>

            {registrarLecturas && (
              <>
                <Text style={styles.inputLabelSmall}>{t('nuevoReporte.unidadDeMedida')}</Text>
                <View style={styles.unitRow}>
                  {(['km', 'm', 'cm'] as const).map(u => (
                    <Pressable accessibilityRole="button" key={u} onPress={() => setUnidad(u)} style={[styles.unitBtn, unidad === u && styles.unitBtnActive]}>
                      <Text style={[styles.unitBtnTxt, unidad === u && styles.unitBtnTxtActive]}>{u}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.inputLabelSmall}>{t('nuevoReporte.primeraLectura')}</Text>
                <TextInput value={primeraLectura} onChangeText={setPrimeraLectura} keyboardType="numeric" placeholder={t('nuevoReporte.ej1245')} style={styles.input} />
                <View style={styles.historyHint}>
                  <Ionicons name="time-outline" size={12} color={colors.primary} />
                  <Text style={styles.historyHintTxt}>
                    {t('nuevoReporte.ultimaLecturaRegistrada')} {history?.last_report?.ultima_lectura || 0}
                  </Text>
                </View>
                <Text style={styles.inputLabelSmall}>{t('nuevoReporte.ultimaLectura')}</Text>
                <TextInput value={ultimaLectura} onChangeText={setUltimaLectura} keyboardType="numeric" placeholder={t('nuevoReporte.ej1280')} style={styles.input} />
                {avanceCalculado !== '' && (
                  <View style={styles.avanceBox}>
                    <Ionicons name="speedometer-outline" size={14} color={colors.primary} />
                    <Text style={styles.avanceBoxTxt}>{t('nuevoReporte.avanceCalculado')} <Text style={{ fontWeight: '900' }}>{avanceCalculado}</Text></Text>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* BLOQUE REPORTE (Imagen 4) */}
        {selectedLeaf && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIconBox}><Ionicons name="document-text" size={16} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>{t('nuevoReporte.reporte')}</Text>
                <Text style={styles.cardHelp}>{t('nuevoReporte.actividadesYObservacionesDelDia')}</Text>
              </View>
            </View>
            <Text style={styles.inputLabelSmall}>{t('nuevoReporte.actividades')}</Text>
            <TextInput value={actividades} onChangeText={setActividades} multiline placeholder={t('nuevoReporte.describeLasActividadesDelDia')} style={[styles.input, { minHeight: 80 }]} />
            <Text style={styles.inputLabelSmall}>{t('nuevoReporte.observaciones')}</Text>
            <TextInput value={observaciones} onChangeText={setObservaciones} multiline placeholder={t('nuevoReporte.comentariosRetrasosLoQueOcurrio')} style={[styles.input, { minHeight: 80 }]} />
            <Text style={styles.inputLabelSmall}>{t('nuevoReporte.incidenciasOpcional')}</Text>
            <TextInput value={incidencias} onChangeText={setIncidencias} multiline placeholder={t('nuevoReporte.eventosRelevantesBloqueosFallasAccidentes')} style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]} />
          </View>
        )}

        {/* BLOQUE SEVERIDAD (SEMAFORO) - AISLADO PARA EVITAR QUE SE OCULTE */}
        {selectedLeaf && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIconBox}><Ionicons name="flag" size={16} color={colors.primary} /></View>
              <Text style={styles.cardLabel}>{t('nuevoReporte.severidadSemaforo')}</Text>
            </View>
            <Text style={styles.sevHint}>
              {t('nuevoReporte.puedesElegirVariasElReporte')}
            </Text>
            <View style={styles.sevRow}>
              <TouchableOpacity accessibilityRole="button"
                onPress={() => toggleSeveridad('Informativo')}
                style={[styles.sevBtn, { borderColor: '#1E40AF' }, severidadUI.has('Informativo') ? { backgroundColor: '#1E40AF' } : { backgroundColor: '#F8FAFC' }]}
              >
                <Ionicons name="information-circle" size={16} color={severidadUI.has('Informativo') ? '#fff' : '#1E40AF'} />
                <Text style={[styles.sevTxt, { color: severidadUI.has('Informativo') ? '#fff' : '#1E40AF' }]}>{t('nuevoReporte.informativo')}</Text>
              </TouchableOpacity>

              <TouchableOpacity accessibilityRole="button"
                onPress={() => toggleSeveridad('Diario')}
                style={[styles.sevBtn, { borderColor: '#10B981' }, severidadUI.has('Diario') ? { backgroundColor: '#10B981' } : { backgroundColor: '#F8FAFC' }]}
              >
                <Ionicons name="calendar" size={16} color={severidadUI.has('Diario') ? '#fff' : '#10B981'} />
                <Text style={[styles.sevTxt, { color: severidadUI.has('Diario') ? '#fff' : '#10B981' }]}>{t('nuevoReporte.diario')}</Text>
              </TouchableOpacity>

              <TouchableOpacity accessibilityRole="button"
                onPress={() => toggleSeveridad('Semanal')}
                style={[styles.sevBtn, { borderColor: '#D97706' }, severidadUI.has('Semanal') ? { backgroundColor: '#D97706' } : { backgroundColor: '#F8FAFC' }]}
              >
                <Ionicons name="alert-circle" size={16} color={severidadUI.has('Semanal') ? '#fff' : '#D97706'} />
                <Text style={[styles.sevTxt, { color: severidadUI.has('Semanal') ? '#fff' : '#D97706' }]}>{t('nuevoReporte.semanal')}</Text>
              </TouchableOpacity>

              <TouchableOpacity accessibilityRole="button"
                onPress={() => toggleSeveridad('Mensual')}
                style={[styles.sevBtn, { borderColor: '#DC2626' }, severidadUI.has('Mensual') ? { backgroundColor: '#DC2626' } : { backgroundColor: '#F8FAFC' }]}
              >
                <Ionicons name="flash" size={16} color={severidadUI.has('Mensual') ? '#fff' : '#DC2626'} />
                <Text style={[styles.sevTxt, { color: severidadUI.has('Mensual') ? '#fff' : '#DC2626' }]}>{t('nuevoReporte.mensual')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* PERSONAL & EQUIPO (Imagen 1, 4, 6) */}
        {selectedLeaf && (
          <>
            {capturaPersonal && <DynSectionRestored title={t('nuevoReporte.personal')} items={personal} onAdd={() => addItem('personal')} onRemove={(id: string) => setPersonal(personal.filter(x => x.id !== id))} onUpdate={(id: string, p: any) => setPersonal(prev => prev.map(it => it.id === id ? { ...it, ...p } : it))} catalog={effectiveCatalogPersonal} />}
            {capturaEquipo && <DynSectionRestored title={t('nuevoReporte.equipo')} items={equipo} onAdd={() => addItem('equipo')} onRemove={(id: string) => setEquipo(equipo.filter(x => x.id !== id))} onUpdate={(id: string, p: any) => setEquipo(prev => prev.map(it => it.id === id ? { ...it, ...p } : it))} catalog={effectiveCatalogEquipo} isEquipo />}
            {camposArea.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardIconBox}><Ionicons name="clipboard-outline" size={18} color={colors.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>{t('nuevoReporte.camposAdicionales')}</Text>
                  </View>
                </View>
                {camposArea.map((c) => (
                  <View key={c.id} style={{ marginTop: 8 }}>
                    <Text style={styles.cardHelp}>{c.nombre}{c.unidad ? ` (${c.unidad})` : ''}</Text>
                    <TextInput
                      style={styles.input}
                      value={camposExtra[c.id || ''] || ''}
                      onChangeText={(v) => setCamposExtra((prev) => ({ ...prev, [c.id || '']: v }))}
                      keyboardType={c.tipo === 'numero' ? 'decimal-pad' : 'default'}
                      placeholder={c.nombre}
                      placeholderTextColor={colors.textMuted}
                      accessibilityLabel={c.nombre}
                    />
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* FOTOS (Imagen 6) */}
        {selectedLeaf && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIconBox}><Ionicons name="camera" size={18} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>{t('nuevoReporte.fotos', { n: images.length })}</Text>
                <Text style={styles.cardHelp}>{t('nuevoReporte.maximo2FotosSeExportaran')}</Text>
              </View>
            </View>
            <View style={styles.row}>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('tomarFoto')} hitSlop={8} onPress={() => onPickImage('cam')} style={styles.photoActionBtn}><Ionicons name="camera" size={24} color={colors.textMuted} /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={a11y('elegirImagen')} hitSlop={8} onPress={() => onPickImage('gal')} style={styles.photoActionBtn}><Ionicons name="images" size={24} color={colors.textMuted} /></Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, marginTop: 10 }}>
              {images.map((img, idx) => (
                <View key={idx} style={{ width: 200 }}>
                  <View style={styles.photoWrapBig}>
                    <Image source={{ uri: img }} style={styles.photo} />
                    <Pressable accessibilityRole="button" accessibilityLabel={a11y('dibujar')} hitSlop={8} onPress={() => setAnnotatorIdx(idx)} style={styles.photoMark}>
                      <Ionicons name="brush" size={16} color="#fff" />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={a11y('quitar')} hitSlop={8} onPress={() => setImages(images.filter((_, i) => i !== idx))} style={styles.photoDel}>
                      <Ionicons name="close-circle" size={22} color={colors.error} />
                    </Pressable>
                  </View>
                  {idx < 2 && (
                    <TextInput
                      value={captions[idx]}
                      onChangeText={t => {
                        const newC = [...captions];
                        newC[idx] = t;
                        setCaptions(newC);
                      }}
                      placeholder={t('nuevoReporte.descripcionTecnicaDetallada')}
                      multiline
                      numberOfLines={3}
                      style={styles.captionInputBig}
                    />
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FOOTER GUARDAR (Imagen 6) */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable accessibilityRole="button" onPress={onSavePressed} disabled={saving || !selectedLeaf} style={styles.finalSaveBtn}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="checkmark-circle" size={20} color="#fff" /><Text style={styles.finalSaveBtnTxt}>{t('nuevoReporte.guardarReporte')}</Text></>}
        </Pressable>
      </View>

      {/* MODAL EXITO (Imagen 7) */}
      <SuccessModal visible={!!successReport} report={successReport} project={project} user={user} reportTemplates={reportTemplates} onClose={() => { resetForm(); router.back(); }} />

      {/* ADVERTENCIA: reporte sin fotos o sin descripciones de fotos */}
      <ConfirmWarningModal
        warning={confirmWarning}
        onCancel={() => setConfirmWarning(null)}
        onConfirm={() => { setConfirmWarning(null); doSave(); }}
      />

      <PhotoAnnotator
        visible={annotatorIdx !== null}
        imageUri={annotatorIdx !== null ? images[annotatorIdx] : null}
        onClose={() => setAnnotatorIdx(null)}
        onSave={(uri) => {
          if (annotatorIdx === null) return;
          setImages((cur) => cur.map((im, i) => (i === annotatorIdx ? uri : im)));
          setAnnotatorIdx(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function AutoRow({ icon, label, value }: any) {
  return (
    <View style={styles.autoRow}>
      <View style={styles.autoIconBox}><Ionicons name={icon} size={14} color={colors.textMuted} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.autoLabel}>{label}</Text>
        <Text style={styles.autoValue}>{value}</Text>
      </View>
    </View>
  );
}

function LocationStep({ label, value, onPress }: any) {
  return (
    <View style={styles.locStep}>
      <Text style={styles.locLabel}>{label}</Text>
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.locBtn}><Text style={styles.locValue}>{value}</Text><Ionicons name="chevron-down" size={16} color={colors.textMuted} /></Pressable>
    </View>
  );
}

function DynamicTemplateField({ field, value, onChange }: any) {
  if (field.type === 'boolean') {
    return (
      <View>
        <Text style={styles.inputLabelSmall}>{field.label.toUpperCase()}</Text>
        <View style={styles.unitRow}>
          {[{ v: true, label: 'Sí' }, { v: false, label: 'No' }].map((opt) => (
            <Pressable accessibilityRole="button"
              key={String(opt.v)}
              onPress={() => onChange(opt.v)}
              style={[styles.unitBtn, value === opt.v && styles.unitBtnActive]}
            >
              <Text style={[styles.unitBtnTxt, value === opt.v && styles.unitBtnTxtActive]}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  if (field.type === 'select') {
    return (
      <View>
        <Text style={styles.inputLabelSmall}>{field.label.toUpperCase()}</Text>
        <View style={styles.chipWrap}>
          {(field.options || []).map((opt: string) => (
            <Pressable accessibilityRole="button"
              key={opt}
              onPress={() => onChange(opt)}
              style={[styles.tplChip, value === opt && styles.tplChipActive]}
            >
              <Text style={[styles.tplChipTxt, value === opt && styles.tplChipTxtActive]}>{opt}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  if (field.type === 'multiselect') {
    const selected: string[] = Array.isArray(value) ? value : [];
    const toggle = (opt: string) => {
      onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);
    };
    return (
      <View>
        <Text style={styles.inputLabelSmall}>{field.label.toUpperCase()}</Text>
        <View style={styles.chipWrap}>
          {(field.options || []).map((opt: string) => (
            <Pressable accessibilityRole="button"
              key={opt}
              onPress={() => toggle(opt)}
              style={[styles.tplChip, selected.includes(opt) && styles.tplChipActive]}
            >
              <Text style={[styles.tplChipTxt, selected.includes(opt) && styles.tplChipTxtActive]}>{opt}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.inputLabelSmall}>{field.label.toUpperCase()}</Text>
      <TextInput
        value={value === undefined || value === null ? '' : String(value)}
        onChangeText={onChange}
        keyboardType={field.type === 'number' ? 'numeric' : 'default'}
        placeholder={field.label}
        style={styles.input}
      />
    </View>
  );
}

function DynSectionRestored({ title, items, onAdd, onRemove, onUpdate, catalog, isEquipo }: any) {
  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.cardLabel}>{title} ({items.length})</Text>
          <Text style={styles.cardHelp}>{isEquipo ? t('nuevoReporte.cantidadDescripcionEj1Excavadora') : t('nuevoReporte.cantidadDescripcionEj3Albaniles')}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onAdd} style={styles.addSmallBtn}><Text style={styles.addSmallTxt}>{t('nuevoReporte.agregar')}</Text></Pressable>
      </View>
      {items.length === 0 ? (
        <View style={styles.emptyItems}>
          <Text style={styles.emptyItemsTxt}>{t('nuevoReporte.aunNoAgregasteItemsToca')}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          scrollEnabled={false} // Mantener scroll del contenedor padre
          renderItem={({ item }) => (
            <DynRow item={item} onRemove={() => onRemove(item.id)} onUpdate={(p: any) => onUpdate(item.id, p)} catalog={catalog} isEquipo={isEquipo} />
          )}
        />
      )}
    </View>
  );
}

function DynRow({ item, onRemove, onUpdate, catalog, isEquipo }: any) {
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = catalog.filter((c: any) => (typeof c === 'string' ? c : c.nombre).toLowerCase().includes(search.toLowerCase()));
  const display = useMemo(() => {
    if (!item.desc) return '';
    if (typeof item.desc === 'string') return item.desc;
    return item.desc.nombre;
  }, [item.desc]);

  return (
    <View style={styles.dynRow}>
      <View style={styles.dynQtyWrap}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('disminuir')}
          onPress={() => onUpdate({ qty: Math.max(1, (item.qty || 1) - 1) })}
          style={styles.qtyBtn}
          hitSlop={8}
        >
          <Ionicons name="remove" size={16} color={colors.primary} />
        </Pressable>
        <Text style={styles.qtyValue}>{item.qty}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('agregar')}
          onPress={() => onUpdate({ qty: (item.qty || 1) + 1 })}
          style={styles.qtyBtn}
          hitSlop={8}
        >
          <Ionicons name="add" size={16} color={colors.primary} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={() => setModalOpen(true)} style={styles.descInput}>
        <Text numberOfLines={2} style={[styles.descTxt, !item.desc && { color: colors.textMuted }]}>
          {display || (isEquipo ? 'Buscar equipo...' : 'Buscar personal...')}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} onPress={onRemove} hitSlop={12} style={styles.dynDelBtn}>
        <Ionicons name="trash-outline" size={18} color={colors.error} />
      </Pressable>
      <Modal visible={modalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}><View style={styles.modalContent}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{t('nuevoReporte.buscar')} {isEquipo ? t('nuevoReporte.equipo2') : t('nuevoReporte.personal2')}</Text><Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} hitSlop={8} onPress={() => setModalOpen(false)}><Ionicons name="close" size={24} /></Pressable></View>
          <TextInput value={search} onChangeText={setSearch} placeholder={t('nuevoReporte.escribirParaFiltrar')} style={styles.input} autoFocus />
          <ScrollView style={{ marginTop: 10, maxHeight: 400 }}>
            {filtered.map((opt: any, idx: number) => (
              <Pressable accessibilityRole="button" key={idx} onPress={() => { onUpdate({ desc: opt }); setModalOpen(false); }} style={styles.optBtn}>
                <Ionicons name={isEquipo ? "construct-outline" : "person-outline"} size={16} color={colors.textMuted} />
                <Text style={styles.optTxt}>{typeof opt === 'string' ? opt : opt.nombre}</Text>
              </Pressable>
            ))}
            {search.trim().length > 0 && (
              <Pressable accessibilityRole="button" onPress={() => { onUpdate({ desc: isEquipo ? { nombre: search } : search }); setModalOpen(false); }} style={styles.customBtn}>
                <Text style={styles.customTxt}>{t('nuevoReporte.usar', { texto: search })}</Text>
              </Pressable>
            )}
          </ScrollView>
        </View></View>
      </Modal>
    </View>
  );
}

function ConfirmWarningModal({ warning, onCancel, onConfirm }: { warning: 'no-photos' | 'no-captions' | null; onCancel: () => void; onConfirm: () => void }) {
  if (!warning) return null;
  const message = warning === 'no-photos'
    ? '¿Estás seguro de que no quieres añadir fotos a tu reporte? Lo ideal es que lleve al menos 2.'
    : '¿Estás seguro de que no quieres añadir una descripción a las fotos de tu reporte?';

  return (
    <Modal visible={!!warning} animationType="fade" transparent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalContent, { padding: 24, alignItems: 'center' }]}>
          <View style={[styles.successIcon, { backgroundColor: '#D97706' }]}>
            <Ionicons name="alert" size={32} color="#fff" />
          </View>
          <Text style={styles.successTitle}>{t('nuevoReporte.espera')}</Text>
          <Text style={[styles.successSub, { marginBottom: 8 }]}>{message}</Text>
          <View style={{ width: '100%', alignItems: 'center' }}>
            <Pressable accessibilityRole="button" onPress={onConfirm} style={styles.waBtn}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              <Text style={styles.waBtnTxt}>{t('nuevoReporte.siEstoySeguro')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.copyBtn}>
              <Ionicons name="arrow-back-outline" size={18} color={colors.primary} />
              <Text style={styles.copyBtnTxt}>{t('nuevoReporte.regresar')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SuccessModal({ visible, report, project, user, reportTemplates, onClose }: any) {
  if (!report) return null;
  const queued = !!report._queued;
  const usedTemplate = (reportTemplates || []).find((t: ReportTemplate) => t.id === report.template_id);

  const shareText = buildReportShareText(report, {
    project,
    authorName: user?.name,
    authorPuesto: user?.puesto,
    useTodayAsDate: true,
    templateFields: usedTemplate?.fields,
  });

  const onCopy = async () => {
    await Clipboard.setStringAsync(shareText);
    Alert.alert(t('nuevoReporte.copiado'), t('nuevoReporte.textoCopiado'));
  };

  const onShareWA = async () => {
    const available = await Sharing.isAvailableAsync();
    if (!available) return;
    const fileUri = `${FileSystem.cacheDirectory}reporte.txt`;
    await FileSystem.writeAsStringAsync(fileUri, shareText, { encoding: FileSystem.EncodingType.UTF8 });
    await shareWithAutoRecover(fileUri, { mimeType: 'text/plain', dialogTitle: 'Compartir reporte' });
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalContent, { padding: 24, alignItems: 'center', maxHeight: '90%' }]}>
          <View style={{ alignItems: 'center' }}>
            <View style={[styles.successIcon, queued && { backgroundColor: '#D97706' }]}>
              <Ionicons name={queued ? 'cloud-offline-outline' : 'checkmark'} size={32} color="#fff" />
            </View>
            <Text style={styles.successTitle}>{queued ? t('nuevoReporte.guardadoSeEnviaraAlRecuperar') : t('nuevoReporte.reporteEnviado')}</Text>
            <Text style={styles.successSub}>
              {queued
                ? t('nuevoReporte.tuReporteYFotosSe')
                : t('nuevoReporte.tusDatosYFotosSe')}
            </Text>
          </View>
          <ScrollView style={styles.sharePreview} contentContainerStyle={{ padding: 16 }}>
            <Text style={styles.shareText}>{shareText}</Text>
          </ScrollView>
          <View style={{ width: '100%', alignItems: 'center' }}>
            <Pressable accessibilityRole="button" onPress={onShareWA} style={styles.waBtn}><Ionicons name="logo-whatsapp" size={18} color="#fff" /><Text style={styles.waBtnTxt}>{t('nuevoReporte.enviarPorWhatsapp')}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={onCopy} style={styles.copyBtn}><Ionicons name="copy-outline" size={18} color={colors.primary} /><Text style={styles.copyBtnTxt}>{t('nuevoReporte.copiarTexto')}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={{ marginTop: 20 }}><Text style={styles.changeTxt}>{t('nuevoReporte.nuevaCaptura')}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', gap: 12 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '900', color: '#0F172A' },
  saveBtn: { backgroundColor: '#1E40AF', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  saveBtnTxt: { color: '#fff', fontWeight: '800' },
  scroll: { padding: 16, paddingBottom: 100 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 24, ...shadow.card, borderWidth: 1, borderColor: '#F1F5F9', gap: 16, marginBottom: 32 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIconBox: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  cardHelp: { fontSize: 11, color: '#64748B' },
  inputLabelSmall: { fontSize: 10, fontWeight: '900', color: '#64748B', letterSpacing: 0.5 },
  inputGhost: { fontSize: 16, fontWeight: '600', color: '#0F172A', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  autoIconBox: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  autoLabel: { fontSize: 9, fontWeight: '900', color: '#94A3B8' },
  autoValue: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  locStep: { gap: 6 },
  locLabel: { fontSize: 9, fontWeight: '900', color: '#94A3B8' },
  locBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F8FAFC', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  locValue: { fontSize: 14, fontWeight: '800', color: '#1E293B' },
  nodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nodeItem: { width: '100%', backgroundColor: '#F8FAFC', padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nodeItemTxt: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  leafBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1E40AF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  leafBadgeTxt: { fontSize: 10, color: '#fff', fontWeight: '900' },
  resetTxt: { textAlign: 'center', color: '#1E40AF', fontWeight: '800', fontSize: 12, marginTop: 8 },
  emptyTxt: { textAlign: 'center', color: '#94A3B8', fontSize: 12, marginTop: 12, fontStyle: 'italic' },
  avanceBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F0F9FF', padding: 10, borderRadius: 6, marginTop: 4, borderWidth: 1, borderColor: '#BAE6FD' },
  avanceBoxTxt: { fontSize: 12, color: '#0369A1', fontWeight: '600' },
  captionInput: { fontSize: 11, color: '#475569', backgroundColor: '#F1F5F9', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 4, marginTop: 4 },
  emptyItems: { padding: 20, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 8, borderStyle: 'dashed', borderWidth: 1, borderColor: '#CBD5E1' },
  emptyItemsTxt: { fontSize: 12, color: '#64748B', textAlign: 'center' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkboxTxt: { fontSize: 13, fontWeight: '700', color: '#1E293B', flex: 1 },
  unitRow: { flexDirection: 'row', gap: 8 },
  unitBtn: { flex: 1, height: 44, borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  unitBtnActive: { backgroundColor: '#1E40AF', borderColor: '#1E40AF' },
  unitBtnTxt: { fontSize: 13, fontWeight: '800', color: '#64748B' },
  unitBtnTxtActive: { color: '#fff' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  tplChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  tplChipActive: { backgroundColor: '#1E40AF', borderColor: '#1E40AF' },
  tplChipTxt: { fontSize: 12, fontWeight: '800', color: '#64748B' },
  tplChipTxtActive: { color: '#fff' },
  tplSelectorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12 },
  tplSelectorTxt: { flex: 1, fontSize: 14, fontWeight: '700', color: '#1E293B' },
  tplGroupHeader: { fontSize: 11, fontWeight: '900', color: '#94A3B8', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 4 },
  input: { minHeight: 48, backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0F172A' },
  historyHint: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EFF6FF', padding: 10, borderRadius: 6 },
  historyHintTxt: { fontSize: 12, color: '#1D4ED8', fontWeight: '600' },
  sevHint: { fontSize: 11, color: '#64748B', marginTop: 6 },
  sevRow: { flexDirection: 'row', marginTop: 8, marginHorizontal: -4 },
  sevBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 22, borderWidth: 1.5, justifyContent: 'center', marginHorizontal: 4 },
  sevTxt: { fontSize: 10, fontWeight: '800', marginLeft: 4 },
  row: { flexDirection: 'row', gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addSmallBtn: { padding: 4 },
  addSmallTxt: { color: '#1E40AF', fontWeight: '800', fontSize: 12 },
  dynRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  dynQtyWrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: 108, height: 40, backgroundColor: '#F8FAFC', borderRadius: 20,
    borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 4,
  },
  qtyBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { flex: 1, textAlign: 'center', fontWeight: '900', color: '#0F172A', fontSize: 15 },
  descInput: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  descTxt: { fontSize: 13, fontWeight: '700', color: '#1E293B', lineHeight: 18 },
  dynDelBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  optBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  optTxt: { fontSize: 13, color: '#334155', fontWeight: '600', flex: 1 },
  customBtn: { paddingVertical: 14, alignItems: 'center' },
  customTxt: { color: '#1E40AF', fontWeight: '800', fontSize: 13 },
  photoActionBtn: { flex: 1, height: 80, borderRadius: 12, borderStyle: 'dashed', borderWidth: 1.5, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
  photoWrap: { width: 80, height: 80, borderRadius: 12, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  photoDel: { position: 'absolute', top: 2, right: 2 },
  photoMark: {
    position: 'absolute', bottom: 6, left: 6, width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.65)', alignItems: 'center', justifyContent: 'center',
  },
  incidencias: { fontSize: 12, color: '#64748B', textAlign: 'center' },
  photoWrapBig: { width: 200, height: 150, borderRadius: 12, overflow: 'hidden' },
  captionInputBig: { fontSize: 13, color: '#1E293B', backgroundColor: '#F1F5F9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8, minHeight: 80, borderWidth: 1, borderColor: '#E2E8F0' },
  footer: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  finalSaveBtn: { backgroundColor: '#1E40AF', paddingVertical: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  finalSaveBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '900' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 24, padding: 20, ...shadow.lg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  successIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  successSub: { fontSize: 13, color: '#64748B', textAlign: 'center', marginTop: 8 },
  sharePreview: { backgroundColor: '#F8FAFC', borderRadius: 12, marginVertical: 20, borderWidth: 1, borderColor: '#E2E8F0', width: '100%', flexGrow: 0, flexShrink: 1 },
  shareText: { fontSize: 12, color: '#334155', lineHeight: 18 },
  waBtn: { width: '100%', backgroundColor: '#1E40AF', paddingVertical: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  waBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  copyBtn: { width: '100%', backgroundColor: '#fff', paddingVertical: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10, borderWidth: 1.5, borderColor: '#1E40AF' },
  copyBtnTxt: { color: '#1E40AF', fontSize: 15, fontWeight: '800' },
  changeTxt: { color: '#1E40AF', fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
