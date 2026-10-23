// Trazabilidad: árbol de categorías → grupos → documentos (planos, memorias…)
// con sus características y archivos (PDF, Excel, PowerPoint, DWG…). Reemplaza a
// los antiguos "Archivos de consulta". Todos los roles lo consultan; el
// Coordinador General / Jefe de Proyecto lo edita (`canEdit`).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import type { Href } from 'expo-router';
import { api, TrazData, TrazKind, TrazNodo } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { COLOR_ESTATUS, NodoModal, NuevoNodoModal } from '@/src/components/trazabilidad/NodoModal';
import { ReferenceFilesList } from '@/src/components/ReferenceFilesList';
import {
  aplanar, EXT_ICONOS, indexar, TrazFila, visiblesPorBusqueda,
} from '@/src/utils/trazabilidad';

const MAX_BYTES = 20 * 1024 * 1024;
const XLSX_TIPOS = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'];

interface Props {
  projectId: string;
  canEdit: boolean;
  fallbackHref?: Href;
}

export function TrazabilidadScreen({ projectId, canEdit, fallbackHref = '/' }: Props) {
  const [data, setData] = useState<TrazData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [consulta, setConsulta] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<{ padre: TrazNodo | null; kind: TrazKind } | null>(null);
  const [verSueltos, setVerSueltos] = useState(false);
  const [sueltos, setSueltos] = useState(0);

  const cargar = useCallback(async () => {
    try {
      setError(null);
      setData(await api.trazListar(projectId));
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar la trazabilidad');
    } finally {
      setCargando(false);
    }
  }, [projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Archivos que se subieron como "archivos de consulta" antes de existir la
  // trazabilidad: se siguen mostrando abajo para no perderlos de vista.
  useEffect(() => {
    api.getProject(projectId).then((p) => setSueltos((p.reference_files || []).length)).catch(() => {});
  }, [projectId]);

  const nodos = useMemo(() => data?.nodes ?? [], [data]);
  const ind = useMemo(() => indexar(nodos), [nodos]);
  const visibles = useMemo(() => visiblesPorBusqueda(ind, nodos, consulta), [ind, nodos, consulta]);
  const filas = useMemo(() => aplanar(ind, abiertos, visibles), [ind, abiertos, visibles]);
  const totales = useMemo(() => {
    let docs = 0, conArchivo = 0;
    for (const r of ind.hijos.get(null) || []) {
      const c = ind.conteo.get(r.id);
      docs += c?.docs || 0;
      conArchivo += c?.conArchivo || 0;
    }
    return { docs, conArchivo };
  }, [ind]);
  const detalle = detalleId ? ind.porId.get(detalleId) || null : null;

  function alternar(id: string) {
    setAbiertos((prev) => {
      const sig = new Set(prev);
      if (sig.has(id)) sig.delete(id); else sig.add(id);
      return sig;
    });
  }

  async function importarExcel() {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: XLSX_TIPOS, copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      if (a.size && a.size > MAX_BYTES) {
        Alert.alert('Archivo demasiado grande', 'El Excel pesa más de 20 MB.');
        return;
      }
      setOcupado(`Importando ${a.name}…`);
      const res = await api.trazImportar(projectId, { uri: a.uri, name: a.name, mimeType: a.mimeType });
      await cargar();
      Alert.alert(
        'Trazabilidad actualizada',
        `Hoja: ${res.hoja}\nNuevos: ${res.creados}\nActualizados: ${res.actualizados}\nSin cambios: ${res.sin_cambios}\n\nNo se borró nada: lo capturado en la app y los archivos se conservan.`,
      );
    } catch (e: any) {
      Alert.alert('No se pudo importar', e?.message || 'Revisa que sea el Excel de trazabilidad (.xlsx).');
    } finally {
      setOcupado(null);
    }
  }

  // Sube varios archivos de una vez: cada uno se acomoda en el documento cuya
  // clave coincide con el nombre del archivo (CLAVE.pdf, CLAVE.dwg…).
  async function subirMasivo() {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: true });
      if (r.canceled || !r.assets?.length) return;
      let acomodados = 0, reemplazados = 0;
      const sin: string[] = [];
      for (let i = 0; i < r.assets.length; i++) {
        const a = r.assets[i];
        setOcupado(`Subiendo ${i + 1}/${r.assets.length}: ${a.name}`);
        if (a.size && a.size > MAX_BYTES) { sin.push(`${a.name} (pesa más de 20 MB)`); continue; }
        try {
          const res = await api.trazSubirAuto(projectId, { uri: a.uri, name: a.name, mimeType: a.mimeType });
          if (res.matched) { acomodados++; if (res.reemplazado) reemplazados++; }
          else sin.push(`${a.name} (${res.motivo || 'sin coincidencia'})`);
        } catch (e: any) {
          sin.push(`${a.name} (${e?.message || 'error'})`);
        }
      }
      await cargar();
      const lineas = [`Acomodados: ${acomodados}${reemplazados ? ` (${reemplazados} reemplazaron una revisión anterior)` : ''}`];
      if (sin.length) {
        lineas.push('', `Sin acomodar: ${sin.length}`, ...sin.slice(0, 8).map((x) => `· ${x}`));
        if (sin.length > 8) lineas.push(`· …y ${sin.length - 8} más`);
        lineas.push('', 'El nombre del archivo debe ser la clave del plano. También puedes subirlo desde el documento.');
      }
      Alert.alert('Subida terminada', lineas.join('\n'));
    } catch (e: any) {
      Alert.alert('No se pudo subir', e?.message || 'Inténtalo de nuevo.');
    } finally {
      setOcupado(null);
    }
  }

  async function crearNodo(code: string, name: string) {
    if (!nuevo) return;
    try {
      const n = await api.trazCrear(projectId, { parent_id: nuevo.padre?.id ?? null, kind: nuevo.kind, code, name });
      setNuevo(null);
      if (nuevo.padre) setAbiertos((p) => new Set(p).add(nuevo.padre!.id));
      await cargar();
      if (nuevo.kind === 'documento') setDetalleId(n.id);
    } catch (e: any) {
      Alert.alert('No se pudo crear', e?.message || 'Inténtalo de nuevo.');
    }
  }

  function renderFila({ item }: { item: TrazFila }) {
    const { nodo, nivel } = item;
    const esDoc = nodo.kind === 'documento';
    const abierto = !!visibles || abiertos.has(nodo.id);
    const c = ind.conteo.get(nodo.id);
    const exts = Array.from(new Set(nodo.files.map((f) => f.ext)));
    const estatus = nodo.fields.estatus;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => (esDoc ? setDetalleId(nodo.id) : alternar(nodo.id))}
        onLongPress={() => setDetalleId(nodo.id)}
        style={({ pressed }) => [s.fila, { paddingLeft: 10 + nivel * 14 }, nodo.kind === 'categoria' && s.filaCategoria, pressed && { opacity: 0.85 }]}
      >
        {esDoc ? (
          <Ionicons name="document-text-outline" size={18} color={nodo.files.length ? colors.primary : colors.textMuted} />
        ) : (
          <Ionicons name={abierto ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.primary} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {esDoc ? (
            <>
              <Text style={s.docNombre} numberOfLines={2}>{nodo.name || nodo.code}</Text>
              {!!nodo.code && !!nodo.name && <Text style={s.docClave} numberOfLines={1}>{nodo.code}</Text>}
            </>
          ) : (
            <>
              <Text style={[s.contNombre, nodo.kind === 'categoria' && { color: colors.primaryDark }]} numberOfLines={2}>
                {nodo.code ? `${nodo.code} · ` : ''}{nodo.name}
              </Text>
              {c && c.docs > 0 ? (
                <Text style={s.docClave}>{c.docs} documento{c.docs === 1 ? '' : 's'} · {c.conArchivo} con archivo</Text>
              ) : null}
            </>
          )}
        </View>
        {esDoc ? (
          <View style={s.etiquetas}>
            {estatus ? <View style={[s.punto, { backgroundColor: COLOR_ESTATUS[estatus] || colors.primary }]} /> : null}
            {exts.map((e) => (
              <Text key={e} style={[s.ext, { color: (EXT_ICONOS[e] || { color: colors.textMuted }).color }]}>
                {(EXT_ICONOS[e] || { etiqueta: e.replace('.', '').toUpperCase() }).etiqueta}
              </Text>
            ))}
          </View>
        ) : canEdit ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Opciones de ${nodo.name}`} hitSlop={10} onPress={() => setDetalleId(nodo.id)}>
            <Ionicons name="ellipsis-horizontal-circle-outline" size={22} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </Pressable>
    );
  }

  const encabezado = (
    <View style={s.cabecera}>
      <View style={s.buscador}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={consulta}
          onChangeText={setConsulta}
          placeholder="Buscar clave, nombre, oficio, archivo…"
          placeholderTextColor={colors.textMuted}
          style={s.buscadorInput}
          autoCorrect={false}
        />
        {consulta ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" onPress={() => setConsulta('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <Text style={s.resumen}>
        {totales.docs} documentos · {totales.conArchivo} con archivo
        {visibles ? ` · ${filas.filter((f) => f.nodo.kind === 'documento').length} coinciden` : ''}
      </Text>
      {canEdit ? (
        <View style={s.herramientas}>
          <Pressable accessibilityRole="button" style={s.herr} onPress={importarExcel} disabled={!!ocupado}>
            <Ionicons name="reload-circle-outline" size={18} color={colors.primary} />
            <Text style={s.herrTxt}>Importar / actualizar Excel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={s.herr} onPress={subirMasivo} disabled={!!ocupado}>
            <Ionicons name="cloud-upload-outline" size={18} color={colors.primary} />
            <Text style={s.herrTxt}>Subir archivos</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={s.herr} onPress={() => setNuevo({ padre: null, kind: 'categoria' })} disabled={!!ocupado}>
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={s.herrTxt}>Nueva categoría</Text>
          </Pressable>
        </View>
      ) : null}
      {ocupado ? (
        <View style={s.ocupado}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={s.ocupadoTxt} numberOfLines={1}>{ocupado}</Text>
        </View>
      ) : null}
    </View>
  );

  const pie = sueltos > 0 ? (
    <View style={s.sueltos}>
      <Pressable accessibilityRole="button" style={s.sueltosHead} onPress={() => setVerSueltos((v) => !v)}>
        <Ionicons name="folder-open-outline" size={18} color={colors.textMuted} />
        <Text style={s.sueltosTit}>Archivos de consulta anteriores ({sueltos})</Text>
        <Ionicons name={verSueltos ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </Pressable>
      {verSueltos ? <ReferenceFilesList projectId={projectId} /> : null}
    </View>
  ) : null;

  return (
    <View style={s.flex}>
      <ScreenHeader title="Trazabilidad" fallbackHref={fallbackHref} />
      {cargando ? (
        <View style={s.centro}><ActivityIndicator color={colors.primary} /></View>
      ) : error && !data ? (
        <View style={s.centro}>
          <Ionicons name="alert-circle-outline" size={22} color={colors.error} />
          <Text style={s.error}>{error}</Text>
          <Pressable accessibilityRole="button" style={s.herr} onPress={cargar}><Text style={s.herrTxt}>Reintentar</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={filas}
          keyExtractor={(f) => f.nodo.id}
          renderItem={renderFila}
          ListHeaderComponent={encabezado}
          ListFooterComponent={pie}
          ListEmptyComponent={
            <View style={s.vacio}>
              <Ionicons name="git-network-outline" size={26} color={colors.textMuted} />
              <Text style={s.vacioTxt}>
                {visibles ? 'Nada coincide con la búsqueda.' : canEdit
                  ? 'Aún no hay trazabilidad. Importa el Excel de trazabilidad para armar el árbol de categorías, o crea una categoría.'
                  : 'Aún no hay trazabilidad cargada para este proyecto.'}
              </Text>
            </View>
          }
          initialNumToRender={30}
          windowSize={9}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 60 }}
        />
      )}

      <NodoModal
        nodo={detalle}
        nodos={nodos}
        ind={ind}
        esquema={data?.esquema ?? []}
        estatusOpts={data?.estatus ?? []}
        canEdit={canEdit}
        projectId={projectId}
        onClose={() => setDetalleId(null)}
        onRecargar={cargar}
        onAgregarHijo={(padre, kind) => { setDetalleId(null); setNuevo({ padre, kind }); }}
      />
      <NuevoNodoModal
        abierto={!!nuevo}
        padre={nuevo?.padre ?? null}
        kind={nuevo?.kind ?? 'categoria'}
        onClose={() => setNuevo(null)}
        onCrear={crearNodo}
      />
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  centro: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  error: { color: colors.error, fontWeight: '600', textAlign: 'center' },
  cabecera: { padding: spacing.md, gap: spacing.sm },
  buscador: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 10,
  },
  buscadorInput: { flex: 1, paddingVertical: 9, fontSize: 14, color: colors.text },
  resumen: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  herramientas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  herr: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface,
  },
  herrTxt: { fontSize: 12, fontWeight: '800', color: colors.primary },
  ocupado: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  ocupadoTxt: { flex: 1, fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12, paddingVertical: 9,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  filaCategoria: { backgroundColor: '#EFF6FF' },
  contNombre: { fontSize: 14, fontWeight: '800', color: colors.text },
  docNombre: { fontSize: 13, fontWeight: '700', color: colors.text },
  docClave: { fontSize: 11, color: colors.textMuted },
  etiquetas: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ext: { fontSize: 10, fontWeight: '900' },
  punto: { width: 9, height: 9, borderRadius: 5 },
  vacio: { alignItems: 'center', gap: 8, padding: spacing.xl },
  vacioTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
  sueltos: { margin: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  sueltosHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sueltosTit: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textBody },
});
