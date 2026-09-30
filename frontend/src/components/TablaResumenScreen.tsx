// Módulo "Tabla Resumen" — matriz de avance (%) 100% configurable por
// proyecto, sin ningún catálogo fijo: el Coordinador/Sub-Coordinador arma
// las filas ("actividades") y columnas ("Estación" / "Inter-tramo") desde
// cero; cualquier rol con acceso al proyecto (incluido Especialista) puede
// capturar el % de cada celda. El "Total" por fila es el promedio de las
// celdas capturadas de esa actividad, calculado en cliente (nunca se
// guarda, para que no quede desactualizado). Calcado del formato de la
// hoja "TABLA DE AVANCE ACUMULADO POR ESTACIÓN E INTER-TRAMOS (%)":
// verde = Concluido (100%), celeste = En proceso (0-99%), vino = Sin
// iniciar (0%), blanco = sin capturar, gris = No aplica.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  api, TablaResumenActividad, TablaResumenColumna, TablaResumenCelda, Project,
} from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';
import { t } from '@/src/i18n';

const ACT_COL_W = 150;
const VAL_COL_W = 68;
const TOTAL_COL_W = 72;

const CELL = {
  blank: '#FFFFFF',
  blankTxt: colors.textMuted,
  noAplica: '#F1F5F9',
  noAplicaTxt: colors.textMuted,
  concluido: '#A9D18E',
  concluidoTxt: '#14532D',
  proceso: '#BDD7EE',
  procesoTxt: '#0F172A',
  sinIniciar: '#8B1E3F',
  sinIniciarTxt: '#FFFFFF',
  headerEstacion: '#EFEFEF',
  headerIntertramo: '#FAFAFA',
};

function celdaVisual(celda: TablaResumenCelda | undefined) {
  if (!celda || (celda.valor === null && !celda.no_aplica)) {
    return { bg: CELL.blank, txt: CELL.blankTxt, label: '' };
  }
  if (celda.no_aplica) {
    return { bg: CELL.noAplica, txt: CELL.noAplicaTxt, label: 'N/A' };
  }
  const v = celda.valor as number;
  const label = `${Number.isInteger(v) ? v : v.toFixed(2)}%`;
  if (v <= 0) return { bg: CELL.sinIniciar, txt: CELL.sinIniciarTxt, label };
  if (v >= 100) return { bg: CELL.concluido, txt: CELL.concluidoTxt, label };
  return { bg: CELL.proceso, txt: CELL.procesoTxt, label };
}

export default function TablaResumenScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const canEditEstructura = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [actividades, setActividades] = useState<TablaResumenActividad[]>([]);
  const [columnas, setColumnas] = useState<TablaResumenColumna[]>([]);
  const [celdas, setCeldas] = useState<TablaResumenCelda[]>([]);

  const [actForm, setActForm] = useState<{ open: boolean; editing: TablaResumenActividad | null; nombre: string; saving: boolean }>({
    open: false, editing: null, nombre: '', saving: false,
  });
  const [colForm, setColForm] = useState<{
    open: boolean; editing: TablaResumenColumna | null; label: string; tipo: 'estacion' | 'intertramo'; saving: boolean;
  }>({ open: false, editing: null, label: '', tipo: 'estacion', saving: false });
  const [celdaForm, setCeldaForm] = useState<{
    open: boolean; actividad: TablaResumenActividad | null; columna: TablaResumenColumna | null;
    valor: string; noAplica: boolean; saving: boolean;
  }>({ open: false, actividad: null, columna: null, valor: '', noAplica: false, saving: false });

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, data] = await Promise.all([api.getProject(projectId), api.getTablaResumen(projectId)]);
      setProject(proj);
      setActividades(data.actividades);
      setColumnas(data.columnas);
      setCeldas(data.celdas);
    } catch (e: any) {
      Alert.alert(t('nivelesGenero.errorTitulo'), e?.message || 'No se pudo cargar la Tabla Resumen.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

  const celdaMap = useMemo(() => {
    const m = new Map<string, TablaResumenCelda>();
    for (const c of celdas) m.set(`${c.actividad_id}|${c.columna_id}`, c);
    return m;
  }, [celdas]);

  function rowTotal(actividadId: string): string {
    const vals: number[] = [];
    for (const col of columnas) {
      const c = celdaMap.get(`${actividadId}|${col.id}`);
      if (c && c.valor !== null && !c.no_aplica) vals.push(c.valor);
    }
    if (vals.length === 0) return '—';
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return `${avg.toFixed(2)}%`;
  }

  // === Actividades (filas) ===
  function openActForm(editing: TablaResumenActividad | null) {
    setActForm({ open: true, editing, nombre: editing?.nombre || '', saving: false });
  }
  async function saveActividad() {
    const nombre = actForm.nombre.trim();
    if (!nombre) {
      Alert.alert(t('tablaResumen.faltaElNombre'), t('tablaResumen.ingresaNombreActividad'));
      return;
    }
    try {
      setActForm((s) => ({ ...s, saving: true }));
      if (actForm.editing) {
        await api.updateTablaResumenActividad(projectId, actForm.editing.id, { nombre });
      } else {
        await api.createTablaResumenActividad(projectId, { nombre, orden: actividades.length });
      }
      setActForm((s) => ({ ...s, open: false }));
      await load();
    } catch (e: any) {
      Alert.alert(t('nivelesGenero.noSePudoGuardar'), e?.message || 'Inténtalo nuevamente.');
    } finally {
      setActForm((s) => ({ ...s, saving: false }));
    }
  }
  function deleteActividad() {
    if (!actForm.editing) return;
    const act = actForm.editing;
    Alert.alert(t('tablaResumen.eliminarActividad'), t('tablaResumen.confirmaEliminarActividad', { nombre: act.nombre }), [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive', onPress: async () => {
          try {
            setActForm((s) => ({ ...s, saving: true }));
            await api.deleteTablaResumenActividad(projectId, act.id);
            setActForm((s) => ({ ...s, open: false }));
            await load();
          } catch (e: any) {
            Alert.alert(t('proyectoPantalla.noSePudoEliminar'), e?.message || 'Inténtalo nuevamente.');
          } finally {
            setActForm((s) => ({ ...s, saving: false }));
          }
        },
      },
    ]);
  }

  // === Columnas ===
  function openColForm(editing: TablaResumenColumna | null) {
    setColForm({ open: true, editing, label: editing?.label || '', tipo: editing?.tipo || 'estacion', saving: false });
  }
  async function saveColumna() {
    const label = colForm.label.trim();
    if (!label) {
      Alert.alert(t('tablaResumen.faltaElNombre'), t('tablaResumen.ingresaNombreColumna'));
      return;
    }
    try {
      setColForm((s) => ({ ...s, saving: true }));
      if (colForm.editing) {
        await api.updateTablaResumenColumna(projectId, colForm.editing.id, { label, tipo: colForm.tipo });
      } else {
        await api.createTablaResumenColumna(projectId, { label, tipo: colForm.tipo, orden: columnas.length });
      }
      setColForm((s) => ({ ...s, open: false }));
      await load();
    } catch (e: any) {
      Alert.alert(t('nivelesGenero.noSePudoGuardar'), e?.message || 'Inténtalo nuevamente.');
    } finally {
      setColForm((s) => ({ ...s, saving: false }));
    }
  }
  function deleteColumna() {
    if (!colForm.editing) return;
    const col = colForm.editing;
    Alert.alert(t('tablaResumen.eliminarColumna'), t('tablaResumen.confirmaEliminarColumna', { label: col.label }), [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive', onPress: async () => {
          try {
            setColForm((s) => ({ ...s, saving: true }));
            await api.deleteTablaResumenColumna(projectId, col.id);
            setColForm((s) => ({ ...s, open: false }));
            await load();
          } catch (e: any) {
            Alert.alert(t('proyectoPantalla.noSePudoEliminar'), e?.message || 'Inténtalo nuevamente.');
          } finally {
            setColForm((s) => ({ ...s, saving: false }));
          }
        },
      },
    ]);
  }

  // === Celdas (valores) ===
  function openCeldaForm(actividad: TablaResumenActividad, columna: TablaResumenColumna) {
    const c = celdaMap.get(`${actividad.id}|${columna.id}`);
    setCeldaForm({
      open: true, actividad, columna,
      valor: c && c.valor !== null ? String(c.valor) : '',
      noAplica: c?.no_aplica || false,
      saving: false,
    });
  }
  async function saveCelda() {
    if (!celdaForm.actividad || !celdaForm.columna) return;
    let valor: number | null = null;
    if (!celdaForm.noAplica) {
      const trimmed = celdaForm.valor.trim();
      if (trimmed) {
        const n = Number(trimmed);
        if (Number.isNaN(n) || n < 0 || n > 100) {
          Alert.alert(t('importadorUI.valorInvalido'), t('tablaResumen.ingresaUnPorcentajeEntre'));
          return;
        }
        valor = n;
      }
    }
    try {
      setCeldaForm((s) => ({ ...s, saving: true }));
      await api.upsertTablaResumenCelda(projectId, {
        actividad_id: celdaForm.actividad.id,
        columna_id: celdaForm.columna.id,
        valor,
        no_aplica: celdaForm.noAplica,
      });
      setCeldaForm((s) => ({ ...s, open: false }));
      await load();
    } catch (e: any) {
      Alert.alert(t('nivelesGenero.noSePudoGuardar'), e?.message || 'Inténtalo nuevamente.');
    } finally {
      setCeldaForm((s) => ({ ...s, saving: false }));
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t('modulosObra.modulos.tablaResumen.titulo')} backgroundColor={headerColor} />

      {canEditEstructura && (
        <View style={styles.toolbar}>
          <Pressable accessibilityRole="button" style={styles.toolBtn} onPress={() => openActForm(null)}>
            <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
            <Text style={styles.toolBtnTxt}>{t('tablaResumen.actividad')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.toolBtn} onPress={() => openColForm(null)}>
            <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
            <Text style={styles.toolBtnTxt}>{t('tablaResumen.columna')}</Text>
          </Pressable>
        </View>
      )}

      {actividades.length === 0 || columnas.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="grid-outline" size={28} color={colors.textMuted} />
          <Text style={styles.emptyTxt}>
            {canEditEstructura
              ? t('tablaResumen.agregaAlMenosUna')
              : t('tablaResumen.aunNoHayTabla')}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
            <View style={{ flex: 1 }}>
              <View style={styles.rowHeader}>
                <View style={[styles.cell, styles.cellActividad, styles.cellHeader]}>
                  <Text style={styles.headerTxt}>{t('tablaResumen.actividad')}</Text>
                </View>
                {columnas.map((col) => (
                  <Pressable accessibilityRole="button"
                    key={col.id}
                    onPress={() => canEditEstructura && openColForm(col)}
                    style={[
                      styles.cell, styles.cellValor, styles.cellHeader,
                      { backgroundColor: col.tipo === 'estacion' ? CELL.headerEstacion : CELL.headerIntertramo },
                    ]}
                  >
                    <Text style={styles.headerTxt} numberOfLines={2}>{col.label}</Text>
                  </Pressable>
                ))}
                <View style={[styles.cell, styles.cellTotal, styles.cellHeader]}>
                  <Text style={styles.headerTxt}>{t('controlObra.campoTotal')}</Text>
                </View>
              </View>

              <ScrollView style={{ flex: 1 }}>
                {actividades.map((act) => (
                  <View key={act.id} style={styles.row}>
                    <Pressable accessibilityRole="button"
                      onPress={() => canEditEstructura && openActForm(act)}
                      style={[styles.cell, styles.cellActividad]}
                    >
                      <Text style={styles.actTxt} numberOfLines={3}>{act.nombre}</Text>
                    </Pressable>
                    {columnas.map((col) => {
                      const celda = celdaMap.get(`${act.id}|${col.id}`);
                      const v = celdaVisual(celda);
                      return (
                        <Pressable accessibilityRole="button"
                          key={col.id}
                          onPress={() => openCeldaForm(act, col)}
                          style={[styles.cell, styles.cellValor, { backgroundColor: v.bg }]}
                        >
                          <Text style={[styles.valorTxt, { color: v.txt }]}>{v.label}</Text>
                        </Pressable>
                      );
                    })}
                    <View style={[styles.cell, styles.cellTotal]}>
                      <Text style={styles.totalTxt}>{rowTotal(act.id)}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          </ScrollView>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: CELL.concluido }]} />
              <Text style={styles.legendTxt}>{t('tablaResumen.concluido')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: CELL.proceso }]} />
              <Text style={styles.legendTxt}>{t('controlObra.campoEnProceso')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: CELL.sinIniciar }]} />
              <Text style={styles.legendTxt}>{t('tablaResumen.sinIniciar')}</Text>
            </View>
          </View>
        </View>
      )}

      {/* --- Modal: actividad (fila) --- */}
      <Modal visible={actForm.open} transparent animationType="slide" onRequestClose={() => setActForm((s) => ({ ...s, open: false }))}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{actForm.editing ? t('tablaResumen.editarActividad') : t('tablaResumen.nuevaActividad')}</Text>
            <Text style={styles.fieldLabel}>{t('catalogoForm.nombre')}</Text>
            <TextInput
              value={actForm.nombre}
              onChangeText={(v) => setActForm((s) => ({ ...s, nombre: v }))}
              placeholder={t('tablaResumen.ejVueloLidar')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              {actForm.editing && (
                <Button label={t('a11y.eliminar')} variant="danger" onPress={deleteActividad} loading={actForm.saving} style={{ flex: 1 }} />
              )}
              <Button label={t('cuenta.cancelar')} variant="secondary" onPress={() => setActForm((s) => ({ ...s, open: false }))} style={{ flex: 1 }} />
              <Button label={t('catalogo.guardar')} loading={actForm.saving} onPress={saveActividad} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* --- Modal: columna --- */}
      <Modal visible={colForm.open} transparent animationType="slide" onRequestClose={() => setColForm((s) => ({ ...s, open: false }))}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{colForm.editing ? t('tablaResumen.editarColumna') : t('tablaResumen.nuevaColumna')}</Text>
            <Text style={styles.fieldLabel}>{t('tablaResumen.tipo')}</Text>
            <View style={styles.segmentRow}>
              <Pressable accessibilityRole="button"
                onPress={() => setColForm((s) => ({ ...s, tipo: 'estacion' }))}
                style={[styles.segmentBtn, colForm.tipo === 'estacion' && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentTxt, colForm.tipo === 'estacion' && styles.segmentTxtActive]}>{t('tablaResumen.estacion')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button"
                onPress={() => setColForm((s) => ({ ...s, tipo: 'intertramo' }))}
                style={[styles.segmentBtn, colForm.tipo === 'intertramo' && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentTxt, colForm.tipo === 'intertramo' && styles.segmentTxtActive]}>{t('tablaResumen.interTramo')}</Text>
              </Pressable>
            </View>
            <Text style={styles.fieldLabel}>{t('catalogoForm.nombre')}</Text>
            <TextInput
              value={colForm.label}
              onChangeText={(v) => setColForm((s) => ({ ...s, label: v }))}
              placeholder={colForm.tipo === 'estacion' ? 'Ej. EST 1' : 'Ej. 01-feb'}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              {colForm.editing && (
                <Button label={t('a11y.eliminar')} variant="danger" onPress={deleteColumna} loading={colForm.saving} style={{ flex: 1 }} />
              )}
              <Button label={t('cuenta.cancelar')} variant="secondary" onPress={() => setColForm((s) => ({ ...s, open: false }))} style={{ flex: 1 }} />
              <Button label={t('catalogo.guardar')} loading={colForm.saving} onPress={saveColumna} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* --- Modal: valor de celda --- */}
      <Modal visible={celdaForm.open} transparent animationType="slide" onRequestClose={() => setCeldaForm((s) => ({ ...s, open: false }))}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {celdaForm.actividad?.nombre} · {celdaForm.columna?.label}
            </Text>
            <View style={styles.noAplicaRow}>
              <Text style={styles.fieldLabel}>{t('tablaResumen.noAplica')}</Text>
              <Switch
                value={celdaForm.noAplica}
                onValueChange={(v) => setCeldaForm((s) => ({ ...s, noAplica: v }))}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>
            {!celdaForm.noAplica && (
              <>
                <Text style={styles.fieldLabel}>{t('tablaResumen.porcentajeDeAvance0')}</Text>
                <TextInput
                  value={celdaForm.valor}
                  onChangeText={(v) => setCeldaForm((s) => ({ ...s, valor: v }))}
                  placeholder={t('tablaResumen.ej85')}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  style={styles.input}
                />
              </>
            )}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label={t('tablaResumen.borrarValor')}
                variant="secondary"
                onPress={() => setCeldaForm((s) => ({ ...s, valor: '', noAplica: false }))}
                style={{ flex: 1 }}
              />
              <Button label={t('cuenta.cancelar')} variant="secondary" onPress={() => setCeldaForm((s) => ({ ...s, open: false }))} style={{ flex: 1 }} />
              <Button label={t('catalogo.guardar')} loading={celdaForm.saving} onPress={saveCelda} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  toolbar: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  toolBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  toolBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: spacing.xl },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  cell: {
    borderWidth: 0.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, paddingVertical: 6,
  },
  cellHeader: { backgroundColor: colors.surface },
  cellActividad: { width: ACT_COL_W, alignItems: 'flex-start', backgroundColor: colors.surface },
  cellValor: { width: VAL_COL_W },
  cellTotal: { width: TOTAL_COL_W, backgroundColor: colors.bg },
  rowHeader: { flexDirection: 'row' },
  row: { flexDirection: 'row' },
  headerTxt: { fontSize: 10.5, fontWeight: '800', color: colors.text, textAlign: 'center' },
  actTxt: { fontSize: 11.5, fontWeight: '700', color: colors.text },
  valorTxt: { fontSize: 11, fontWeight: '700' },
  totalTxt: { fontSize: 11, fontWeight: '800', color: colors.text },
  legendRow: {
    flexDirection: 'row', gap: spacing.lg, justifyContent: 'center', paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendTxt: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  noAplicaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  segmentBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  segmentTxtActive: { color: '#fff' },
});
