// Detalle y edición de un nodo de Trazabilidad. Para un documento muestra sus
// características (oficios, fechas, revisiones…, según el esquema del backend),
// sus archivos adjuntos y, si el usuario puede editar, permite cambiarlo todo,
// moverlo a otra rama o eliminarlo.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { api, TrazGrupoCampos, TrazKind, TrazNodo } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { dmyAIso, isoADmy } from '@/src/utils/fecha';
import {
  destinosDeMovimiento, EXT_ICONOS, normalizar, rutaLegible, subarbol, TrazIndice,
} from '@/src/utils/trazabilidad';

const MAX_BYTES = 20 * 1024 * 1024;

export const COLOR_ESTATUS: Record<string, string> = {
  'Observaciones A': '#F59E0B',
  'Observaciones B': '#EA580C',
  'Validación técnica': '#1E40AF',
  'Firmado': '#10B981',
  'Escaneado': '#0F766E',
  'En revisión DIRAC': '#7C3AED',
};

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

interface Props {
  nodo: TrazNodo | null;
  nodos: TrazNodo[];
  ind: TrazIndice;
  esquema: TrazGrupoCampos[];
  estatusOpts: string[];
  canEdit: boolean;
  projectId: string;
  onClose: () => void;
  onRecargar: () => Promise<void>;
  onAgregarHijo: (padre: TrazNodo, kind: TrazKind) => void;
}

export function NodoModal({
  nodo, nodos, ind, esquema, estatusOpts, canEdit, projectId, onClose, onRecargar, onAgregarHijo,
}: Props) {
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<{ label: string; value: string }[]>([]);
  const [archivos, setArchivos] = useState<TrazNodo['files']>([]);
  const [vista, setVista] = useState<'detalle' | 'mover'>('detalle');
  const [consultaMover, setConsultaMover] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    if (!nodo) return;
    setCodigo(nodo.code);
    setNombre(nodo.name);
    const c: Record<string, string> = {};
    for (const g of esquema) {
      for (const f of g.campos) {
        const v = nodo.fields[f.k] || '';
        c[f.k] = f.tipo === 'fecha' ? isoADmy(v) : v;
      }
    }
    setCampos(c);
    setExtra(nodo.extra.map((e) => ({ ...e })));
    setArchivos(nodo.files);
    setVista('detalle');
    setConsultaMover('');
  }, [nodo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const destinos = useMemo(() => {
    if (!nodo || vista !== 'mover') return [];
    const q = normalizar(consultaMover).trim();
    return destinosDeMovimiento(ind, nodos, nodo.id)
      .filter((d) => !q || normalizar(`${d.code} ${d.name} ${rutaLegible(ind, d.id)}`).includes(q))
      .slice(0, 60);
  }, [nodo, vista, consultaMover, ind, nodos]);

  if (!nodo) return null;
  const esDoc = nodo.kind === 'documento';
  const hijosTotal = subarbol(ind, nodo.id).size - 1;

  async function guardar() {
    if (!nodo) return;
    const fields: Record<string, string> = {};
    for (const g of esquema) {
      for (const f of g.campos) {
        let v = (campos[f.k] || '').trim();
        if (f.tipo === 'fecha' && v) {
          const iso = dmyAIso(v);
          if (!iso) {
            Alert.alert('Fecha inválida', `“${f.label}” de ${g.label}: usa DD-MM-AAAA y una fecha que exista.`);
            return;
          }
          v = iso;
        }
        if (v !== (nodo.fields[f.k] || '')) fields[f.k] = v;
      }
    }
    if (!codigo.trim() && !nombre.trim()) {
      Alert.alert('Falta información', 'Indica al menos el código o el nombre.');
      return;
    }
    try {
      setOcupado('Guardando…');
      await api.trazEditar(projectId, nodo.id, {
        code: codigo, name: nombre, fields, extra: extra.filter((e) => e.label.trim()),
      });
      await onRecargar();
      onClose();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo de nuevo.');
    } finally {
      setOcupado(null);
    }
  }

  async function eliminar() {
    if (!nodo) return;
    const detalle = hijosTotal > 0 ? `Se eliminarán también ${hijosTotal} elemento(s) que cuelgan de él y todos sus archivos.` : 'Se eliminarán también sus archivos.';
    if (!(await confirm(`¿Eliminar “${nodo.name || nodo.code}”?`, `${detalle} Esta acción no se puede deshacer.`,
      { confirmText: 'Eliminar', destructive: true }))) return;
    try {
      setOcupado('Eliminando…');
      await api.trazBorrar(projectId, nodo.id);
      await onRecargar();
      onClose();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Inténtalo de nuevo.');
    } finally {
      setOcupado(null);
    }
  }

  async function mover(destinoId: string | null) {
    if (!nodo) return;
    try {
      setOcupado('Moviendo…');
      await api.trazEditar(projectId, nodo.id, { parent_id: destinoId });
      await onRecargar();
      onClose();
    } catch (e: any) {
      Alert.alert('No se pudo mover', e?.message || 'Inténtalo de nuevo.');
    } finally {
      setOcupado(null);
    }
  }

  async function abrirArchivo(f: TrazNodo['files'][number]) {
    try {
      setOcupado(`Descargando ${f.name}…`);
      const { blob, filename, mime } = await api.trazDescargarArchivo(projectId, f.file_id, f.name);
      await downloadBlob(blob, filename, mime);
    } catch (e: any) {
      Alert.alert('No se pudo abrir el archivo', e?.message || 'Revisa tu conexión.');
    } finally {
      setOcupado(null);
    }
  }

  async function quitarArchivo(f: TrazNodo['files'][number]) {
    if (!(await confirm('¿Eliminar archivo?', `“${f.name}” se eliminará de este documento.`,
      { confirmText: 'Eliminar', destructive: true }))) return;
    try {
      setOcupado('Eliminando…');
      const r = await api.trazBorrarArchivo(projectId, f.file_id);
      setArchivos(r.node.files);
      await onRecargar();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Inténtalo de nuevo.');
    } finally {
      setOcupado(null);
    }
  }

  async function subirArchivos() {
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
          const res = await api.trazSubirArchivo(projectId, nodo.id, { uri: a.uri, name: a.name, mimeType: a.mimeType });
          if (res.reemplazado) reemplazados++;
          setArchivos(res.node.files);
        } catch (e: any) {
          fallas.push(`${a.name}: ${e?.message || 'error'}`);
        }
      }
      await onRecargar();
      if (fallas.length || reemplazados) {
        Alert.alert(fallas.length ? 'Subida con detalles' : 'Archivos actualizados',
          [reemplazados ? `Reemplazados (mismo nombre): ${reemplazados}` : '', ...fallas].filter(Boolean).join('\n'));
      }
    } catch (e: any) {
      Alert.alert('No se pudo subir', e?.message || 'Inténtalo de nuevo.');
    } finally {
      setOcupado(null);
    }
  }

  const mostrar = (g: TrazGrupoCampos) => canEdit || g.campos.some((f) => (campos[f.k] || '').trim());
  const tituloModal = esDoc ? 'Documento' : nodo.kind === 'categoria' ? 'Categoría' : 'Grupo';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.head}>
            {vista === 'mover' ? (
              <Pressable accessibilityRole="button" onPress={() => setVista('detalle')} hitSlop={10} style={s.headBtn}>
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </Pressable>
            ) : <View style={s.headBtn} />}
            <Text style={s.headTitle} numberOfLines={1}>{vista === 'mover' ? 'Mover a…' : tituloModal}</Text>
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

          {vista === 'mover' ? (
            <View style={{ flex: 1, padding: spacing.md, gap: spacing.sm }}>
              <TextInput
                value={consultaMover}
                onChangeText={setConsultaMover}
                placeholder="Buscar destino (código o nombre)"
                placeholderTextColor={colors.textMuted}
                style={s.input}
              />
              <FlatList
                data={destinos}
                keyExtractor={(d) => d.id}
                ListHeaderComponent={
                  <Pressable accessibilityRole="button" style={s.destino} onPress={() => mover(null)} disabled={!!ocupado}>
                    <Ionicons name="home-outline" size={18} color={colors.primary} />
                    <Text style={s.destinoTxt}>Nivel superior (sin padre)</Text>
                  </Pressable>
                }
                renderItem={({ item }) => (
                  <Pressable accessibilityRole="button" style={s.destino} onPress={() => mover(item.id)} disabled={!!ocupado}>
                    <Ionicons name={item.kind === 'categoria' ? 'folder-outline' : 'albums-outline'} size={18} color={colors.primary} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.destinoTxt} numberOfLines={1}>{item.code ? `${item.code} · ` : ''}{item.name}</Text>
                      <Text style={s.destinoSub} numberOfLines={1}>{rutaLegible(ind, item.id) || 'Nivel superior'}</Text>
                    </View>
                  </Pressable>
                )}
                ListFooterComponent={destinos.length >= 60 ? <Text style={s.hint}>Mostrando 60; afina la búsqueda para ver más.</Text> : null}
              />
            </View>
          ) : (
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              {canEdit ? (
                <>
                  <Text style={s.label}>{esDoc ? 'Clave del plano' : 'Código'}</Text>
                  <TextInput value={codigo} onChangeText={setCodigo} style={s.input} autoCapitalize="characters" placeholderTextColor={colors.textMuted} />
                  <Text style={s.label}>{esDoc ? 'Nombre del plano' : 'Nombre'}</Text>
                  <TextInput value={nombre} onChangeText={setNombre} style={s.input} placeholderTextColor={colors.textMuted} />
                </>
              ) : (
                <View>
                  {!!nodo.code && <Text style={s.codigoGrande} selectable>{nodo.code}</Text>}
                  <Text style={s.nombreGrande}>{nodo.name}</Text>
                  {!!rutaLegible(ind, nodo.id) && <Text style={s.hint}>{rutaLegible(ind, nodo.id)}</Text>}
                </View>
              )}

              {esDoc ? (
                <>
                  {esquema.filter(mostrar).map((g) => (
                    <View key={g.id} style={s.grupo}>
                      <Text style={s.grupoTitulo}>{g.label}</Text>
                      {g.campos.map((f) => {
                        const valor = campos[f.k] || '';
                        if (f.tipo === 'estatus') {
                          return (
                            <View key={f.k}>
                              <Text style={s.label}>{f.label}</Text>
                              <View style={s.chips}>
                                {estatusOpts.map((op) => {
                                  const sel = valor === op;
                                  if (!canEdit && !sel) return null;
                                  return (
                                    <Pressable
                                      key={op}
                                      accessibilityRole="button"
                                      disabled={!canEdit}
                                      onPress={() => setCampos((c) => ({ ...c, [f.k]: sel ? '' : op }))}
                                      style={[s.chip, sel && { backgroundColor: COLOR_ESTATUS[op] || colors.primary, borderColor: COLOR_ESTATUS[op] || colors.primary }]}
                                    >
                                      <Text style={[s.chipTxt, sel && { color: '#fff' }]}>{op}</Text>
                                    </Pressable>
                                  );
                                })}
                                {!canEdit && !valor ? <Text style={s.hint}>—</Text> : null}
                              </View>
                            </View>
                          );
                        }
                        if (!canEdit) {
                          if (!valor.trim()) return null;
                          return (
                            <View key={f.k} style={s.lectura}>
                              <Text style={s.lecturaEtq}>{f.label}</Text>
                              <Text style={s.lecturaVal} selectable>{valor}</Text>
                            </View>
                          );
                        }
                        return (
                          <View key={f.k}>
                            <Text style={s.label}>{f.label}{f.tipo === 'fecha' ? ' (DD-MM-AAAA)' : ''}</Text>
                            <TextInput
                              value={valor}
                              onChangeText={(t) => setCampos((c) => ({ ...c, [f.k]: f.tipo === 'fecha' ? mascaraFecha(t) : t }))}
                              style={[s.input, f.tipo === 'largo' && { minHeight: 70, textAlignVertical: 'top' }]}
                              multiline={f.tipo === 'largo'}
                              keyboardType={f.tipo === 'fecha' ? 'numbers-and-punctuation' : 'default'}
                              placeholder={f.tipo === 'fecha' ? 'DD-MM-AAAA' : ''}
                              placeholderTextColor={colors.textMuted}
                            />
                          </View>
                        );
                      })}
                    </View>
                  ))}

                  {(canEdit || extra.length > 0) ? (
                    <View style={s.grupo}>
                      <Text style={s.grupoTitulo}>Otras características</Text>
                      {extra.map((e, i) => (
                        canEdit ? (
                          <View key={i} style={s.extraFila}>
                            <TextInput value={e.label} onChangeText={(t) => setExtra((x) => x.map((y, j) => (j === i ? { ...y, label: t } : y)))}
                              placeholder="Nombre" placeholderTextColor={colors.textMuted} style={[s.input, { flex: 1 }]} />
                            <TextInput value={e.value} onChangeText={(t) => setExtra((x) => x.map((y, j) => (j === i ? { ...y, value: t } : y)))}
                              placeholder="Valor" placeholderTextColor={colors.textMuted} style={[s.input, { flex: 1.4 }]} />
                            <Pressable accessibilityRole="button" accessibilityLabel="Quitar característica" hitSlop={8}
                              onPress={() => setExtra((x) => x.filter((_, j) => j !== i))}>
                              <Ionicons name="close-circle" size={22} color={colors.error} />
                            </Pressable>
                          </View>
                        ) : (
                          <View key={i} style={s.lectura}>
                            <Text style={s.lecturaEtq}>{e.label}</Text>
                            <Text style={s.lecturaVal} selectable>{e.value}</Text>
                          </View>
                        )
                      ))}
                      {canEdit ? (
                        <Pressable accessibilityRole="button" style={s.linkBtn} onPress={() => setExtra((x) => [...x, { label: '', value: '' }])}>
                          <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                          <Text style={s.linkBtnTxt}>Agregar característica</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={s.grupo}>
                    <Text style={s.grupoTitulo}>Archivos ({archivos.length})</Text>
                    {archivos.length === 0 ? <Text style={s.hint}>Sin archivos adjuntos.</Text> : null}
                    {archivos.map((f) => {
                      const meta = EXT_ICONOS[f.ext] || { icono: 'document-outline', color: colors.textMuted, etiqueta: f.ext.replace('.', '').toUpperCase() };
                      return (
                        <View key={f.file_id} style={s.archivo}>
                          <Pressable accessibilityRole="button" style={s.archivoMain} onPress={() => abrirArchivo(f)} disabled={!!ocupado}>
                            <Ionicons name={meta.icono as any} size={20} color={meta.color} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={s.archivoNombre} numberOfLines={1}>{f.name}</Text>
                              <Text style={s.hint} numberOfLines={1}>{[tamano(f.size), f.uploaded_at ? isoADmy(f.uploaded_at.slice(0, 10)) : ''].filter(Boolean).join(' · ')}</Text>
                            </View>
                            <Ionicons name="cloud-download-outline" size={20} color={colors.primary} />
                          </Pressable>
                          {canEdit ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={`Eliminar ${f.name}`} hitSlop={8} onPress={() => quitarArchivo(f)} disabled={!!ocupado}>
                              <Ionicons name="trash-outline" size={20} color={colors.error} />
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    })}
                    {canEdit ? (
                      <Pressable accessibilityRole="button" style={s.subirBtn} onPress={subirArchivos} disabled={!!ocupado}>
                        <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                        <Text style={s.subirBtnTxt}>Subir archivos (PDF, Excel, PowerPoint, DWG…)</Text>
                      </Pressable>
                    ) : null}
                    {canEdit ? <Text style={s.hint}>Subir un archivo con el mismo nombre lo reemplaza (nueva revisión).</Text> : null}
                  </View>
                </>
              ) : canEdit ? (
                <View style={s.grupo}>
                  <Text style={s.grupoTitulo}>Agregar dentro</Text>
                  <View style={s.chips}>
                    {nodo.kind === 'categoria' ? (
                      <Pressable accessibilityRole="button" style={s.chip} onPress={() => onAgregarHijo(nodo, 'categoria')}><Text style={s.chipTxt}>+ Subcategoría</Text></Pressable>
                    ) : null}
                    <Pressable accessibilityRole="button" style={s.chip} onPress={() => onAgregarHijo(nodo, 'grupo')}><Text style={s.chipTxt}>+ Grupo</Text></Pressable>
                    <Pressable accessibilityRole="button" style={s.chip} onPress={() => onAgregarHijo(nodo, 'documento')}><Text style={s.chipTxt}>+ Documento</Text></Pressable>
                  </View>
                </View>
              ) : null}
            </ScrollView>
          )}

          {canEdit && vista === 'detalle' ? (
            <View style={s.pie}>
              <Pressable accessibilityRole="button" style={[s.pieBtn, s.pieBtnPrimario, !!ocupado && { opacity: 0.6 }]} onPress={guardar} disabled={!!ocupado}>
                <Text style={s.pieBtnTxtPrimario}>Guardar</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Mover" style={s.pieBtn} onPress={() => setVista('mover')} disabled={!!ocupado}>
                <Ionicons name="swap-vertical-outline" size={18} color={colors.primary} />
                <Text style={s.pieBtnTxt}>Mover</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Eliminar" style={s.pieBtn} onPress={eliminar} disabled={!!ocupado}>
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

interface NuevoProps {
  abierto: boolean;
  padre: TrazNodo | null;
  kind: TrazKind;
  onClose: () => void;
  onCrear: (code: string, name: string) => Promise<void>;
}

/** Formulario corto para crear una categoría, grupo o documento. */
export function NuevoNodoModal({ abierto, padre, kind, onClose, onCrear }: NuevoProps) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (abierto) { setCode(''); setName(''); } }, [abierto]);
  if (!abierto) return null;
  const titulo = kind === 'categoria' ? (padre ? 'Nueva subcategoría' : 'Nueva categoría') : kind === 'grupo' ? 'Nuevo grupo' : 'Nuevo documento';
  const pideCodigo = kind !== 'grupo';

  async function crear() {
    if (!code.trim() && !name.trim()) {
      Alert.alert('Falta información', 'Escribe al menos un nombre.');
      return;
    }
    try {
      setGuardando(true);
      await onCrear(pideCodigo ? code : '', name);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[s.backdrop, { justifyContent: 'center', padding: spacing.md }]}>
        <View style={s.tarjetaNueva}>
          <Text style={s.headTitle}>{titulo}</Text>
          {padre ? <Text style={s.hint} numberOfLines={2}>Dentro de: {padre.code ? `${padre.code} · ` : ''}{padre.name}</Text> : null}
          {pideCodigo ? (
            <>
              <Text style={s.label}>{kind === 'documento' ? 'Clave del plano' : 'Código (ej. A101)'}</Text>
              <TextInput value={code} onChangeText={setCode} style={s.input} autoCapitalize="characters" placeholderTextColor={colors.textMuted} />
            </>
          ) : null}
          <Text style={s.label}>{kind === 'documento' ? 'Nombre del plano' : 'Nombre'}</Text>
          <TextInput value={name} onChangeText={setName} style={s.input} placeholderTextColor={colors.textMuted} />
          <View style={[s.pie, { borderTopWidth: 0, paddingHorizontal: 0 }]}>
            <Pressable accessibilityRole="button" style={s.pieBtn} onPress={onClose} disabled={guardando}><Text style={s.pieBtnTxt}>Cancelar</Text></Pressable>
            <Pressable accessibilityRole="button" style={[s.pieBtn, s.pieBtnPrimario, guardando && { opacity: 0.6 }]} onPress={crear} disabled={guardando}>
              <Text style={s.pieBtnTxtPrimario}>Crear</Text>
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
  // Tarjeta centrada del formulario "Nuevo": sin `flex` para que mida lo que
  // ocupa su contenido (con `flex: 0` en web se colapsaba a una franja).
  tarjetaNueva: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, width: '100%', maxWidth: 520, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: colors.text },
  ocupado: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.primaryLight },
  ocupadoTxt: { flex: 1, fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginTop: 6, marginBottom: 3 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.text,
  },
  codigoGrande: { fontSize: 12, fontWeight: '700', color: colors.primary },
  nombreGrande: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 2 },
  hint: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  grupo: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm + 2, gap: 2 },
  grupoTitulo: { fontSize: 13, fontWeight: '800', color: colors.primaryDark, marginBottom: 2 },
  lectura: { flexDirection: 'row', gap: 8, paddingVertical: 3 },
  lecturaEtq: { width: 96, fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  lecturaVal: { flex: 1, fontSize: 13, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  extraFila: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  linkBtnTxt: { fontSize: 13, fontWeight: '700', color: colors.primary },
  archivo: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  archivoMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  archivoNombre: { fontSize: 13, fontWeight: '700', color: colors.text },
  subirBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 11, marginTop: 6 },
  subirBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  pie: { flexDirection: 'row', gap: 8, padding: spacing.sm + 2, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  pieBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong },
  pieBtnPrimario: { flex: 1.4, backgroundColor: colors.primary, borderColor: colors.primary },
  pieBtnTxt: { fontSize: 13, fontWeight: '800', color: colors.primary },
  pieBtnTxtPrimario: { fontSize: 14, fontWeight: '800', color: '#fff' },
  destino: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  destinoTxt: { fontSize: 14, fontWeight: '700', color: colors.text },
  destinoSub: { fontSize: 11, color: colors.textMuted },
});
