// Editor de las matrices de seguimiento de estudios (entregables × estaciones con
// semáforo). Alimentan las láminas "Estatus de documentos", entregables TDR, etc. de la
// Presentación. Toca una celda para cambiar su estado; una fila que empieza con "# " es un
// encabezado de grupo (ej. "# SUPERESTRUCTURA").
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, EstudioMatriz, EstudioMatrizEstado } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';

const ESTADOS: EstudioMatrizEstado[] = ['pendiente', 'observaciones', 'revision', 'validado', 'na'];
const COLOR: Record<EstudioMatrizEstado, string> = {
  pendiente: '#FF0000', observaciones: '#FFC000', revision: '#0070C0', validado: '#00B050', na: '#D9D9D9',
};
const NOMBRE: Record<EstudioMatrizEstado, string> = {
  pendiente: 'Pendiente', observaciones: 'Con observaciones', revision: 'En revisión', validado: 'Validado', na: 'No aplica',
};

const lineas = (txt: string) => txt.split('\n').map((x) => x.trim()).filter(Boolean);

function nueva(): EstudioMatriz {
  return { titulo: 'Nueva matriz', forma: 'celdas', columnas: ['E1', 'E2', 'E3'], filas: ['Entregable 1', 'Entregable 2'], celdas: {}, notas: [] };
}

export default function EstudiosMatricesModal({ projectId, visible, onClose, puedeEscribir }: {
  projectId: string; visible: boolean; onClose: () => void; puedeEscribir: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [matrices, setMatrices] = useState<EstudioMatriz[]>([]);
  const [sel, setSel] = useState(0);
  const [celdaTxt, setCeldaTxt] = useState<{ r: number; c: number } | null>(null);
  // Los textos de columnas / filas se editan como bloque (una por línea).
  const [colTxt, setColTxt] = useState('');
  const [filaTxt, setFilaTxt] = useState('');

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        setLoading(true);
        const list = await api.listEstudiosMatrices(projectId);
        setMatrices(list);
        setSel(0);
        cargarTextos(list[0]);
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'No se pudieron cargar las matrices.');
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, projectId]);

  function cargarTextos(m?: EstudioMatriz) {
    setColTxt((m?.columnas || []).join('\n'));
    setFilaTxt((m?.filas || []).join('\n'));
  }

  const m = matrices[sel];

  function cambiar(patch: Partial<EstudioMatriz>) {
    setMatrices((cur) => cur.map((x, i) => (i === sel ? { ...x, ...patch } : x)));
  }

  function elegir(i: number) {
    aplicarTextos();
    setSel(i);
    cargarTextos(matrices[i]);
  }

  /** Vuelca los textos de columnas/filas a la matriz seleccionada. */
  function aplicarTextos(): EstudioMatriz[] {
    const next = matrices.map((x, i) => (i === sel ? { ...x, columnas: lineas(colTxt), filas: lineas(filaTxt) } : x));
    setMatrices(next);
    return next;
  }

  function ciclar(r: number, c: number) {
    if (!m || !puedeEscribir) return;
    const k = `${r},${c}`;
    const actual = (m.celdas[k] || 'pendiente') as EstudioMatrizEstado;
    const sig = ESTADOS[(ESTADOS.indexOf(actual) + 1) % ESTADOS.length];
    cambiar({ celdas: { ...m.celdas, [k]: sig } });
  }

  function agregar() {
    const next = [...aplicarTextos(), nueva()];
    setMatrices(next);
    setSel(next.length - 1);
    cargarTextos(next[next.length - 1]);
  }

  function quitar() {
    const next = matrices.filter((_, i) => i !== sel);
    setMatrices(next);
    const i = Math.max(0, sel - 1);
    setSel(i);
    cargarTextos(next[i]);
  }

  async function guardar() {
    const todas = aplicarTextos();
    try {
      setSaving(true);
      await api.setEstudiosMatrices(projectId, todas);
      Alert.alert('Guardado', 'Matrices actualizadas.');
      onClose();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  const cols = lineas(colTxt);
  const filas = lineas(filaTxt);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Matrices de seguimiento</Text>
          <View style={{ width: 22 }} />
        </View>
        {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} /> : (
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.sm }}>
                {matrices.map((x, i) => (
                  <Pressable accessibilityRole="button" key={i} onPress={() => elegir(i)} style={[styles.chip, i === sel && styles.chipOn]}>
                    <Text style={[styles.chipTxt, i === sel && { color: '#fff' }]} numberOfLines={1}>{x.titulo || 'Sin título'}</Text>
                  </Pressable>
                ))}
                {puedeEscribir ? (
                  <Pressable accessibilityRole="button" onPress={agregar} style={styles.chip}>
                    <Text style={styles.chipTxt}>+ Matriz</Text>
                  </Pressable>
                ) : null}
              </View>
            </ScrollView>

            {!m ? <Text style={styles.hint}>Aún no hay matrices. Toca "+ Matriz" para crear la primera.</Text> : (
              <View>
                <Text style={styles.label}>Título de la lámina</Text>
                <TextInput value={m.titulo} onChangeText={(v) => cambiar({ titulo: v })} editable={puedeEscribir} style={styles.input} />

                <Text style={styles.label}>Forma de las celdas</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(['celdas', 'puntos'] as const).map((f) => (
                    <Pressable accessibilityRole="button" key={f} disabled={!puedeEscribir} onPress={() => cambiar({ forma: f })}
                      style={[styles.chip, m.forma === f && styles.chipOn]}>
                      <Text style={[styles.chipTxt, m.forma === f && { color: '#fff' }]}>{f === 'celdas' ? 'Celdas de color' : 'Puntos de color'}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Columnas (estaciones / intertramos), una por línea. «Grupo | Estación» = encabezado de dos niveles</Text>
                <TextInput value={colTxt} onChangeText={setColTxt} editable={puedeEscribir} multiline style={[styles.input, { minHeight: 70 }]} />
                <Text style={styles.label}>Filas (entregables), una por línea. "# Texto" = encabezado de grupo</Text>
                <TextInput value={filaTxt} onChangeText={setFilaTxt} editable={puedeEscribir} multiline style={[styles.input, { minHeight: 90 }]} />
                <Text style={styles.hint}>Si cambias el orden de filas o columnas ya capturadas, revisa los colores.</Text>

                <Text style={styles.label}>Estados (toca una celda para cambiarla)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.xs }}>
                  {ESTADOS.map((e) => (
                    <View key={e} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <View style={[styles.dot, { backgroundColor: COLOR[e] }]} /><Text style={styles.hint}>{NOMBRE[e]}</Text>
                    </View>
                  ))}
                </View>
                <ScrollView horizontal>
                  <View>
                    <View style={{ flexDirection: 'row' }}>
                      <View style={[styles.celdaTxt, { backgroundColor: 'transparent' }]} />
                      {cols.map((c, ci) => <Text key={ci} style={[styles.celda, styles.colHead]} numberOfLines={1}>{c}</Text>)}
                    </View>
                    {filas.map((f, ri) => (
                      f.startsWith('#') ? (
                        <Text key={ri} style={styles.grupo}>{f.replace(/^#\s*/, '')}</Text>
                      ) : (
                        <View key={ri} style={{ flexDirection: 'row' }}>
                          <Text style={styles.celdaTxt} numberOfLines={1}>{f}</Text>
                          {cols.map((_, ci) => {
                            const est = (m.celdas[`${ri},${ci}`] || 'pendiente') as EstudioMatrizEstado;
                            return (
                              <Pressable accessibilityRole="button" key={ci} onPress={() => ciclar(ri, ci)}
                                onLongPress={puedeEscribir ? () => setCeldaTxt({ r: ri, c: ci }) : undefined}
                                style={[styles.celda, { backgroundColor: COLOR[est], alignItems: 'center', justifyContent: 'center' },
                                  celdaTxt && celdaTxt.r === ri && celdaTxt.c === ci && { borderWidth: 2, borderColor: colors.primary }]}>
                                {m.textos?.[`${ri},${ci}`] ? <Text style={{ fontSize: 11, fontWeight: '800', color: '#000' }}>T</Text> : null}
                              </Pressable>
                            );
                          })}
                        </View>
                      )
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.hint}>Mantén presionada una celda para escribir un texto dentro de ella (marcada con «T»).</Text>
                {celdaTxt ? (
                  <View style={{ marginTop: spacing.xs }}>
                    <Text style={styles.label}>
                      Texto de la celda · {(m.filas[celdaTxt.r] || '').replace(/^#\s*/, '')} / {m.columnas[celdaTxt.c]}
                    </Text>
                    <TextInput
                      value={m.textos?.[`${celdaTxt.r},${celdaTxt.c}`] || ''} editable={puedeEscribir} placeholder="Ej. 12/oct, Rev. 2"
                      placeholderTextColor={colors.textMuted} style={styles.input}
                      onChangeText={(v) => cambiar({ textos: { ...(m.textos || {}), [`${celdaTxt.r},${celdaTxt.c}`]: v } })}
                    />
                  </View>
                ) : null}

                <Text style={styles.label}>Descripción (solo en matrices largas, a un lado de la tabla)</Text>
                <TextInput value={m.descripcion || ''} onChangeText={(v) => cambiar({ descripcion: v })} editable={puedeEscribir}
                  multiline style={[styles.input, { minHeight: 60 }]} />

                <Text style={styles.label}>Recuadros de notas (En proceso, Pendientes, Aspectos que retrasan…)</Text>
                {(m.notas || []).map((n, ni) => (
                  <View key={ni} style={styles.nota}>
                    <TextInput value={n.titulo || ''} placeholder="Título" placeholderTextColor={colors.textMuted} editable={puedeEscribir}
                      onChangeText={(v) => cambiar({ notas: m.notas.map((x, j) => (j === ni ? { ...x, titulo: v } : x)) })} style={styles.input} />
                    <TextInput value={n.texto} placeholder="Una línea por viñeta" placeholderTextColor={colors.textMuted} editable={puedeEscribir}
                      onChangeText={(v) => cambiar({ notas: m.notas.map((x, j) => (j === ni ? { ...x, texto: v } : x)) })}
                      multiline style={[styles.input, { minHeight: 60, marginTop: 4 }]} />
                    {puedeEscribir ? (
                      <Pressable accessibilityRole="button" onPress={() => cambiar({ notas: m.notas.filter((_, j) => j !== ni) })} style={{ alignSelf: 'flex-end', marginTop: 4 }}>
                        <Text style={{ color: colors.error, fontWeight: '700', fontSize: 12 }}>Quitar</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {puedeEscribir && (m.notas || []).length < 6 ? (
                  <Pressable accessibilityRole="button" onPress={() => cambiar({ notas: [...(m.notas || []), { titulo: '', texto: '' }] })}>
                    <Text style={styles.link}>+ Agregar recuadro</Text>
                  </Pressable>
                ) : null}
                {puedeEscribir ? (
                  <Pressable accessibilityRole="button" onPress={quitar} style={{ marginTop: spacing.md }}>
                    <Text style={{ color: colors.error, fontWeight: '700' }}>Eliminar esta matriz</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
            {puedeEscribir ? <Button label="Guardar" loading={saving} onPress={guardar} style={{ marginTop: spacing.lg }} /> : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.md, marginBottom: 4 },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.text, backgroundColor: colors.surface, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, maxWidth: 200 },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  dot: { width: 12, height: 12, borderRadius: 6 },
  celda: { width: 38, height: 30, marginRight: 2, marginBottom: 2, borderRadius: 3 },
  colHead: { textAlign: 'center', fontSize: 10, fontWeight: '800', color: colors.textMuted, height: 18 },
  celdaTxt: { width: 130, height: 30, marginRight: 4, fontSize: 11, color: colors.text, textAlignVertical: 'center' },
  grupo: { fontSize: 11, fontWeight: '800', color: colors.primary, marginTop: 6, marginBottom: 2 },
  nota: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, backgroundColor: colors.surface },
  link: { fontSize: 13, fontWeight: '700', color: colors.primary, marginTop: 4 },
});
