// Archivos de un nodo de Trazabilidad: lista agrupada por categoría, subida de
// archivos (PDF, Excel, PowerPoint, DWG…) y, para quien puede editar, cambio de
// las características de cada archivo (categoría, nombre, revisión, oficio,
// fecha y observaciones). También el editor de la lista de categorías.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { api, TrazArchivo, TrazNodo } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { dmyAIso, isoADmy } from '@/src/utils/fecha';
import { EXT_ICONOS, rutaLegible, TrazIndice } from '@/src/utils/trazabilidad';

const MAX_BYTES = 20 * 1024 * 1024;
const SIN_CATEGORIA = 'Sin categoría';

function mascaraFecha(t: string): string {
  const d = t.replace(/\D/g, '').slice(0, 8);
  if (d.length > 4) return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
  if (d.length > 2) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return d;
}

function tamano(b: number): string {
  if (!b) return '';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function detalleArchivo(f: TrazArchivo): string {
  return [
    f.rev ? `Rev. ${f.rev}` : '', f.oficio, f.fecha ? isoADmy(f.fecha) : '', tamano(f.size),
  ].filter(Boolean).join(' · ');
}

/** Desplegable de categoría: muestra la elegida y, al tocarlo, la lista para cambiarla. */
function SelectorCategoria({ valor, opciones, onChange }: {
  valor: string; opciones: string[]; onChange: (v: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const todas = valor && !opciones.includes(valor) ? [valor, ...opciones] : opciones;
  return (
    <View>
      <Pressable accessibilityRole="button" style={s.selector} onPress={() => setAbierto((v) => !v)}>
        <Text style={s.selectorTxt} numberOfLines={1}>{valor || SIN_CATEGORIA}</Text>
        <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>
      {abierto ? (
        <ScrollView style={s.selectorLista} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {['', ...todas].map((c) => (
            <Pressable key={c || '_'} accessibilityRole="button" style={[s.selectorOp, c === valor && { backgroundColor: colors.primaryLight }]}
              onPress={() => { onChange(c); setAbierto(false); }}>
              <Text style={s.selectorOpTxt}>{c || SIN_CATEGORIA}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

interface Props {
  nodo: TrazNodo | null;
  ind: TrazIndice;
  categorias: string[];
  canEdit: boolean;
  projectId: string;
  onClose: () => void;
  onRecargar: () => Promise<void>;
}

export function NodoArchivosModal({ nodo, ind, categorias, canEdit, projectId, onClose, onRecargar }: Props) {
  const [catSubida, setCatSubida] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [editando, setEditando] = useState<TrazArchivo | null>(null);
  const [eCat, setECat] = useState('');
  const [eName, setEName] = useState('');
  const [eRev, setERev] = useState('');
  const [eOficio, setEOficio] = useState('');
  const [eFecha, setEFecha] = useState('');
  const [eObs, setEObs] = useState('');

  useEffect(() => { setEditando(null); }, [nodo?.id]);

  const archivos = useMemo(() => (nodo ? ind.archivosDe.get(nodo.id) || [] : []), [nodo, ind]);
  const grupos = useMemo(() => {
    const orden = ['', ...categorias];
    const m = new Map<string, TrazArchivo[]>();
    for (const f of archivos) m.set(f.categoria, [...(m.get(f.categoria) || []), f]);
    const claves = [...m.keys()].sort((a, b) => {
      const ia = orden.indexOf(a), ib = orden.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    // "Sin categoría" al final.
    const sin = claves.filter((c) => c === '');
    return [...claves.filter((c) => c !== ''), ...sin].map((c) => ({ categoria: c, items: m.get(c) as TrazArchivo[] }));
  }, [archivos, categorias]);

  if (!nodo) return null;

  function empezarEdicion(f: TrazArchivo) {
    setEditando(f);
    setECat(f.categoria);
    setEName(f.name);
    setERev(f.rev);
    setEOficio(f.oficio);
    setEFecha(isoADmy(f.fecha));
    setEObs(f.obs);
  }

  async function abrir(f: TrazArchivo) {
    try {
      setOcupado(`Descargando ${f.name}…`);
      const { blob, filename, mime } = await api.trazDescargarArchivo(projectId, f.id, f.name);
      await downloadBlob(blob, filename, mime);
    } catch (e: any) {
      Alert.alert('No se pudo abrir el archivo', e?.message || 'Revisa tu conexión.');
    } finally {
      setOcupado(null);
    }
  }

  async function guardarEdicion() {
    if (!editando) return;
    let fecha = '';
    if (eFecha.trim()) {
      const iso = dmyAIso(eFecha);
      if (!iso) {
        Alert.alert('Fecha inválida', 'Usa DD-MM-AAAA y una fecha que exista.');
        return;
      }
      fecha = iso;
    }
    if (!eName.trim()) {
      Alert.alert('Falta el nombre', 'El archivo necesita un nombre.');
      return;
    }
    try {
      setOcupado('Guardando…');
      await api.trazEditarArchivo(projectId, editando.id, {
        categoria: eCat, name: eName, rev: eRev, oficio: eOficio, fecha, obs: eObs,
      });
      await onRecargar();
      setEditando(null);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo de nuevo.');
    } finally {
      setOcupado(null);
    }
  }

  async function borrar(f: TrazArchivo) {
    if (!(await confirm('¿Eliminar archivo?', `“${f.name}” se eliminará de este nodo. Esta acción no se puede deshacer.`,
      { confirmText: 'Eliminar', destructive: true }))) return;
    try {
      setOcupado('Eliminando…');
      await api.trazBorrarArchivo(projectId, f.id);
      await onRecargar();
      setEditando(null);
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Inténtalo de nuevo.');
    } finally {
      setOcupado(null);
    }
  }

  async function subir() {
    if (!nodo) return;
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: true });
      if (r.canceled || !r.assets?.length) return;
      const fallas: string[] = [];
      let reemplazados = 0;
      for (let i = 0; i < r.assets.length; i++) {
        const a = r.assets[i];
        setOcupado(`Subiendo ${i + 1}/${r.assets.length}: ${a.name}`);
        if (a.size && a.size > MAX_BYTES) { fallas.push(`${a.name}: pesa más de 20 MB`); continue; }
        try {
          const res = await api.trazSubirArchivo(projectId, nodo.id, { uri: a.uri, name: a.name, mimeType: a.mimeType }, catSubida);
          if (res.reemplazado) reemplazados++;
        } catch (e: any) {
          fallas.push(`${a.name}: ${e?.message || 'error'}`);
        }
      }
      await onRecargar();
      if (fallas.length || reemplazados) {
        Alert.alert(fallas.length ? 'Subida con detalles' : 'Archivos actualizados',
          [reemplazados ? `Reemplazados (mismo nombre y categoría): ${reemplazados}` : '', ...fallas].filter(Boolean).join('\n'));
      }
    } catch (e: any) {
      Alert.alert('No se pudo subir', e?.message || 'Inténtalo de nuevo.');
    } finally {
      setOcupado(null);
    }
  }

  const ruta = rutaLegible(ind, nodo.id);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.head}>
            {editando ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => setEditando(null)} hitSlop={10} style={s.headBtn}>
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </Pressable>
            ) : <View style={s.headBtn} />}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={s.headTitle} numberOfLines={1}>{editando ? 'Características del archivo' : nodo.name}</Text>
              {!editando && !!ruta && <Text style={s.hint} numberOfLines={1}>{ruta}</Text>}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} hitSlop={10} style={s.headBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          {ocupado ? (
            <View style={s.ocupado}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={s.ocupadoTxt} numberOfLines={1}>{ocupado}</Text>
            </View>
          ) : null}

          {editando ? (
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              <Text style={s.label}>Categoría</Text>
              <SelectorCategoria valor={eCat} opciones={categorias} onChange={setECat} />
              <Text style={s.label}>Nombre del archivo</Text>
              <TextInput value={eName} onChangeText={setEName} style={s.input} placeholderTextColor={colors.textMuted} />
              <Text style={s.label}>Revisión</Text>
              <TextInput value={eRev} onChangeText={setERev} style={s.input} placeholder="R00, A, B…" placeholderTextColor={colors.textMuted} />
              <Text style={s.label}>Oficio</Text>
              <TextInput value={eOficio} onChangeText={setEOficio} style={s.input} placeholderTextColor={colors.textMuted} />
              <Text style={s.label}>Fecha (DD-MM-AAAA)</Text>
              <TextInput value={eFecha} onChangeText={(t) => setEFecha(mascaraFecha(t))} style={s.input}
                keyboardType="numbers-and-punctuation" placeholder="DD-MM-AAAA" placeholderTextColor={colors.textMuted} />
              <Text style={s.label}>Observaciones</Text>
              <TextInput value={eObs} onChangeText={setEObs} style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} multiline placeholderTextColor={colors.textMuted} />
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              {archivos.length === 0 ? (
                <View style={s.vacio}>
                  <Ionicons name="folder-open-outline" size={24} color={colors.textMuted} />
                  <Text style={s.hint}>Este nodo todavía no tiene archivos.</Text>
                </View>
              ) : null}
              {grupos.map((g) => (
                <View key={g.categoria || '_'} style={s.grupo}>
                  <Text style={s.grupoTitulo}>{g.categoria || SIN_CATEGORIA} ({g.items.length})</Text>
                  {g.items.map((f) => {
                    const meta = EXT_ICONOS[f.ext] || { icono: 'document-outline', color: colors.textMuted, etiqueta: f.ext.replace('.', '').toUpperCase() };
                    return (
                      <View key={f.id} style={s.archivo}>
                        <Pressable accessibilityRole="button" style={s.archivoMain} onPress={() => abrir(f)} disabled={!!ocupado}>
                          <Ionicons name={meta.icono as any} size={20} color={meta.color} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={s.archivoNombre} numberOfLines={1}>{f.name}</Text>
                            {!!detalleArchivo(f) && <Text style={s.hint} numberOfLines={1}>{detalleArchivo(f)}</Text>}
                            {!!f.obs && <Text style={s.hint} numberOfLines={2}>{f.obs}</Text>}
                          </View>
                          <Ionicons name="cloud-download-outline" size={20} color={colors.primary} />
                        </Pressable>
                        {canEdit ? (
                          <Pressable accessibilityRole="button" accessibilityLabel={`Editar ${f.name}`} hitSlop={8} onPress={() => empezarEdicion(f)} disabled={!!ocupado}>
                            <Ionicons name="create-outline" size={20} color={colors.textBody} />
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}

              {canEdit ? (
                <View style={s.grupo}>
                  <Text style={s.grupoTitulo}>Subir archivos a este nodo</Text>
                  <Text style={s.label}>Categoría de lo que subas</Text>
                  <SelectorCategoria valor={catSubida} opciones={categorias} onChange={setCatSubida} />
                  <Pressable accessibilityRole="button" style={[s.subirBtn, !!ocupado && { opacity: 0.6 }]} onPress={subir} disabled={!!ocupado}>
                    <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                    <Text style={s.subirBtnTxt}>Elegir archivos (PDF, Excel, PowerPoint, DWG…)</Text>
                  </Pressable>
                  <Text style={s.hint}>Subir un archivo con el mismo nombre y categoría lo reemplaza (nueva revisión) y conserva sus características.</Text>
                </View>
              ) : null}
            </ScrollView>
          )}

          {canEdit && editando ? (
            <View style={s.pie}>
              <Pressable accessibilityRole="button" style={[s.pieBtn, s.pieBtnPrimario, !!ocupado && { opacity: 0.6 }]} onPress={guardarEdicion} disabled={!!ocupado}>
                <Text style={s.pieBtnTxtPrimario}>Guardar</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={s.pieBtn} onPress={() => borrar(editando)} disabled={!!ocupado}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
                <Text style={[s.pieBtnTxt, { color: colors.error }]}>Eliminar</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface CatProps {
  abierto: boolean;
  categorias: string[];
  onClose: () => void;
  onGuardar: (cats: string[]) => Promise<void>;
}

/** Editor de la lista de categorías del proyecto (agregar, renombrar, quitar). */
export function CategoriasModal({ abierto, categorias, onClose, onGuardar }: CatProps) {
  const [lista, setLista] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (abierto) setLista(categorias); }, [abierto, categorias]);
  if (!abierto) return null;

  async function guardar() {
    try {
      setGuardando(true);
      await onGuardar(lista.map((c) => c.trim()).filter(Boolean));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.head}>
            <View style={s.headBtn} />
            <Text style={[s.headTitle, { flex: 1, textAlign: 'center' }]}>Categorías</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} hitSlop={10} style={s.headBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Text style={s.hint}>Las categorías sirven para clasificar los archivos de cada nodo. Cambiar el nombre de una no actualiza los archivos que ya la usan.</Text>
            {lista.map((c, i) => (
              <View key={i} style={s.catFila}>
                <TextInput value={c} onChangeText={(t) => setLista((l) => l.map((x, j) => (j === i ? t : x)))}
                  style={[s.input, { flex: 1 }]} placeholderTextColor={colors.textMuted} />
                <Pressable accessibilityRole="button" accessibilityLabel="Quitar categoría" hitSlop={8}
                  onPress={() => setLista((l) => l.filter((_, j) => j !== i))}>
                  <Ionicons name="close-circle" size={22} color={colors.error} />
                </Pressable>
              </View>
            ))}
            <Pressable accessibilityRole="button" style={s.linkBtn} onPress={() => setLista((l) => [...l, ''])}>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={s.linkBtnTxt}>Agregar categoría</Text>
            </Pressable>
          </ScrollView>
          <View style={s.pie}>
            <Pressable accessibilityRole="button" style={s.pieBtn} onPress={onClose} disabled={guardando}><Text style={s.pieBtnTxt}>Cancelar</Text></Pressable>
            <Pressable accessibilityRole="button" style={[s.pieBtn, s.pieBtnPrimario, guardando && { opacity: 0.6 }]} onPress={guardar} disabled={guardando}>
              <Text style={s.pieBtnTxtPrimario}>Guardar</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    flex: 1, marginTop: 48, backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  ocupado: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.primaryLight },
  ocupadoTxt: { flex: 1, fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginTop: 6, marginBottom: 3 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.text,
  },
  hint: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  vacio: { alignItems: 'center', gap: 6, paddingVertical: spacing.lg },
  grupo: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm + 2, gap: 2 },
  grupoTitulo: { fontSize: 13, fontWeight: '800', color: colors.primaryDark, marginBottom: 2 },
  archivo: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  archivoMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  archivoNombre: { fontSize: 13, fontWeight: '700', color: colors.text },
  selector: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 10 },
  selectorTxt: { flex: 1, fontSize: 14, color: colors.text },
  selectorLista: { maxHeight: 220, marginTop: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  selectorOp: { paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  selectorOpTxt: { fontSize: 13, color: colors.text },
  subirBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 11, marginTop: 8 },
  subirBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  catFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  linkBtnTxt: { fontSize: 13, fontWeight: '700', color: colors.primary },
  pie: { flexDirection: 'row', gap: 8, padding: spacing.sm + 2, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  pieBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong },
  pieBtnPrimario: { flex: 1.4, backgroundColor: colors.primary, borderColor: colors.primary },
  pieBtnTxt: { fontSize: 13, fontWeight: '800', color: colors.primary },
  pieBtnTxtPrimario: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
