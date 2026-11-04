// Hub de Excel mensual de Fuerza de Trabajo (formato "A4.1 Avance de Obra por
// Partidas"). Personal y maquinaria salen solos de los reportes de campo; los
// materiales (por estación: insumo, unidad, total) se capturan aquí. El botón
// descarga UN solo Excel con las tres hojas (tabla PERSONAL, tabla maquinaria,
// tabla material). Solo Coordinador y Sub-Coordinador.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, MaterialFT } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';
import { dayjs } from '@/src/utils/tz';
import { downloadBlob } from '@/src/utils/downloadBlob';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function FuerzaTrabajoExcelHub({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const puede = user?.role === ROLE_COORD || user?.role === ROLE_SUB;
  const [abierto, setAbierto] = useState(false);
  const [mes, setMes] = useState(dayjs().format('YYYY-MM'));
  const [items, setItems] = useState<MaterialFT[]>([]);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [estacion, setEstacion] = useState('');
  const [insumo, setInsumo] = useState('');
  const [unidad, setUnidad] = useState('');
  const [cantidad, setCantidad] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setItems(await api.listMaterialesFT(projectId, mes));
    } catch (e: any) {
      Alert.alert('No se pudieron cargar los materiales', e?.message || 'Intenta de nuevo');
    } finally {
      setCargando(false);
    }
  }, [projectId, mes]);

  useEffect(() => { if (abierto) cargar(); }, [abierto, cargar]);

  const grupos = useMemo(() => {
    const m = new Map<string, MaterialFT[]>();
    items.forEach((i) => m.set(i.estacion, [...(m.get(i.estacion) || []), i]));
    return Array.from(m.entries());
  }, [items]);

  if (!puede) return null;

  function limpiar() {
    setEditId(null); setInsumo(''); setUnidad(''); setCantidad('');
  }

  async function guardar() {
    const qty = parseFloat(cantidad.replace(',', '.'));
    if (!estacion.trim() || !insumo.trim()) {
      Alert.alert('Faltan datos', 'Escribe la estación y el insumo.');
      return;
    }
    if (Number.isNaN(qty)) {
      Alert.alert('Faltan datos', 'La cantidad debe ser un número.');
      return;
    }
    setGuardando(true);
    try {
      const body = { mes, estacion: estacion.trim(), insumo: insumo.trim(), unidad: unidad.trim(), cantidad: qty };
      if (editId) await api.updateMaterialFT(projectId, editId, body);
      else await api.addMaterialFT(projectId, body);
      limpiar();
      await cargar();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intenta de nuevo');
    } finally {
      setGuardando(false);
    }
  }

  function editar(m: MaterialFT) {
    setEditId(m.id); setEstacion(m.estacion); setInsumo(m.insumo); setUnidad(m.unidad || ''); setCantidad(String(m.cantidad));
  }

  async function borrar(m: MaterialFT) {
    try {
      await api.deleteMaterialFT(projectId, m.id);
      if (editId === m.id) limpiar();
      await cargar();
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intenta de nuevo');
    }
  }

  async function exportar() {
    if (exportando) return;
    setExportando(true);
    try {
      const { blob, filename } = await api.downloadFuerzaTrabajoXlsx(projectId, mes);
      await downloadBlob(blob, filename, XLSX_MIME);
    } catch (e: any) {
      Alert.alert('No se pudo exportar', e?.message || 'Intenta de nuevo');
    } finally {
      setExportando(false);
    }
  }

  const mesLabel = dayjs(`${mes}-01`).format('MMMM YYYY');

  return (
    <>
      <Pressable style={styles.btnAbrir} onPress={() => setAbierto(true)} accessibilityRole="button">
        <Ionicons name="grid-outline" size={18} color={colors.primary} />
        <Text style={styles.btnAbrirTxt}>Excel mensual y materiales</Text>
      </Pressable>

      <Modal visible={abierto} animationType="slide" onRequestClose={() => setAbierto(false)}>
        <View style={styles.modal}>
          <View style={styles.head}>
            <Text style={styles.titulo}>Excel de Fuerza de Trabajo</Text>
            <Pressable onPress={() => setAbierto(false)} hitSlop={10} accessibilityLabel="Cerrar">
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.cuerpo} keyboardShouldPersistTaps="handled">
            <View style={styles.mesRow}>
              <Pressable onPress={() => setMes(dayjs(`${mes}-01`).subtract(1, 'month').format('YYYY-MM'))} hitSlop={10}>
                <Ionicons name="chevron-back" size={22} color={colors.primary} />
              </Pressable>
              <Text style={styles.mesTxt}>{mesLabel}</Text>
              <Pressable onPress={() => setMes(dayjs(`${mes}-01`).add(1, 'month').format('YYYY-MM'))} hitSlop={10}>
                <Ionicons name="chevron-forward" size={22} color={colors.primary} />
              </Pressable>
            </View>
            <Text style={styles.nota}>
              Personal y maquinaria se llenan solos con los reportes del mes. Captura aquí los materiales por
              estación; todo sale en un solo Excel (hojas: tabla PERSONAL, tabla maquinaria, tabla material).
            </Text>

            <Pressable style={[styles.btnExport, exportando && { opacity: 0.6 }]} onPress={exportar} disabled={exportando}>
              {exportando ? <ActivityIndicator color="#fff" /> : <Ionicons name="download-outline" size={18} color="#fff" />}
              <Text style={styles.btnExportTxt}>Descargar Excel de {mesLabel}</Text>
            </Pressable>

            <Text style={styles.seccion}>{editId ? 'Editar material' : 'Agregar material'}</Text>
            <TextInput style={styles.input} placeholder="Estación (ej. ESTACIÓN 2. CANTERA)" value={estacion} onChangeText={setEstacion} />
            {grupos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {grupos.map(([e]) => (
                  <Pressable key={e} style={styles.chip} onPress={() => setEstacion(e)}>
                    <Text style={styles.chipTxt}>{e}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            <TextInput style={styles.input} placeholder="Descripción del insumo" value={insumo} onChangeText={setInsumo} />
            <View style={styles.fila}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Unidad (m3, pza, ton…)" value={unidad} onChangeText={setUnidad} />
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Total" keyboardType="decimal-pad" value={cantidad} onChangeText={setCantidad} />
            </View>
            <View style={styles.fila}>
              <Pressable style={[styles.btnGuardar, guardando && { opacity: 0.6 }]} onPress={guardar} disabled={guardando}>
                <Text style={styles.btnGuardarTxt}>{editId ? 'Guardar cambios' : 'Agregar'}</Text>
              </Pressable>
              {editId ? (
                <Pressable style={styles.btnCancelar} onPress={limpiar}>
                  <Text style={styles.btnCancelarTxt}>Cancelar</Text>
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.seccion}>Materiales de {mesLabel}</Text>
            {cargando ? <ActivityIndicator color={colors.primary} /> : null}
            {!cargando && grupos.length === 0 ? <Text style={styles.nota}>Aún no hay materiales capturados este mes.</Text> : null}
            {grupos.map(([est, lista]) => (
              <View key={est} style={styles.card}>
                <Text style={styles.cardTitulo}>{est}</Text>
                {lista.map((m) => (
                  <View key={m.id} style={styles.item}>
                    <Pressable style={{ flex: 1 }} onPress={() => editar(m)}>
                      <Text style={styles.itemTxt}>{m.insumo}</Text>
                      <Text style={styles.itemSub}>{m.cantidad} {m.unidad}</Text>
                    </Pressable>
                    <Pressable onPress={() => borrar(m)} hitSlop={10} accessibilityLabel="Eliminar material">
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btnAbrir: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  btnAbrirTxt: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  modal: { flex: 1, backgroundColor: colors.bg, paddingTop: spacing.xl },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  titulo: { fontSize: 18, fontWeight: '800', color: colors.text },
  cuerpo: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 80 },
  mesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  mesTxt: { fontSize: 16, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },
  nota: { color: colors.textMuted, fontSize: 12 },
  btnExport: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12,
  },
  btnExportTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  seccion: { marginTop: spacing.md, fontWeight: '800', color: colors.text, fontSize: 14 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.text,
  },
  fila: { flexDirection: 'row', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.primaryLight },
  chipTxt: { color: colors.primaryDark, fontSize: 12, fontWeight: '600' },
  btnGuardar: { flex: 1, backgroundColor: colors.primaryDark, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center' },
  btnGuardarTxt: { color: '#fff', fontWeight: '700' },
  btnCancelar: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center' },
  btnCancelarTxt: { color: colors.textBody, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 6 },
  cardTitulo: { fontWeight: '800', color: colors.primaryDark, fontSize: 13 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 },
  itemTxt: { color: colors.text, fontSize: 14 },
  itemSub: { color: colors.textMuted, fontSize: 12 },
});
