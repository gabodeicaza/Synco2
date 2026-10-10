// Editor de UN campo del módulo personalizado: etiqueta, tipo, interruptores
// (requerido / aparece en el informe), opciones de listas, fórmula de los
// campos calculados, valor por defecto, condición de visibilidad y cómo se
// totaliza en las tablas del informe.
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { CustomCampo, CustomCampoTipo } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import {
  CM_AGREGACIONES, CM_TIPOS, campoNuevo, cmTipoInfo, esNumerico, esNumericoOCalc, evaluarFormula,
  formulaDesdeTokens, formulaLegible, tokensFormula, TokenFormula,
} from '@/src/utils/customModules';
import { Chip, ChipRow, FieldLabel, SwitchRow, inputStyle } from './ui';

const OPERADORES: { v: string; label: string }[] = [
  { v: '+', label: '+' }, { v: '-', label: '−' }, { v: '*', label: '×' }, { v: '/', label: '÷' },
  { v: '(', label: '(' }, { v: ')', label: ')' },
];

function tokensSeguros(formula?: string): TokenFormula[] {
  try { return tokensFormula(formula || ''); } catch { return []; }
}

export function FieldEditorModal({
  campo, todos, esNuevo, onSave, onClose,
}: {
  campo: CustomCampo | null;
  todos: CustomCampo[]; // todos los campos del módulo (incluye este si ya existe)
  esNuevo: boolean;
  onSave: (c: CustomCampo) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<CustomCampo | null>(campo);
  const [numTxt, setNumTxt] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setD(campo); setNumTxt(''); setError(null); }, [campo]);

  const otros = useMemo(() => todos.filter((c) => c.id !== d?.id), [todos, d?.id]);
  if (!d) return null;

  const set = (patch: Partial<CustomCampo>) => setD((x) => (x ? { ...x, ...patch } : x));
  const tipo = d.tipo;
  const refsNumericas = otros.filter((c) => esNumerico(c.tipo));
  const tokens = tokensSeguros(d.formula);
  const pushToken = (t: TokenFormula) => set({ formula: formulaDesdeTokens([...tokens, t]) });
  const condCandidatos = otros.filter((c) => c.tipo === 'interruptor' || c.tipo === 'seleccion' || c.tipo === 'multiseleccion');
  const condCampo = d.visible_si ? otros.find((c) => c.id === d.visible_si!.campo) : undefined;

  function cambiarTipo(t: CustomCampoTipo) {
    const base = campoNuevo(t, d!.etiqueta);
    setD({
      ...base, id: d!.id, etiqueta: d!.etiqueta, ayuda: d!.ayuda, en_informe: d!.en_informe,
      requerido: t === 'calculado' || t === 'interruptor' ? false : d!.requerido, visible_si: d!.visible_si,
    });
  }

  function guardar() {
    if (!d!.etiqueta.trim()) { setError('Escribe el nombre del campo.'); return; }
    if ((tipo === 'seleccion' || tipo === 'multiseleccion') && !(d!.opciones || []).some((o) => o.trim())) {
      setError('Agrega al menos una opción.'); return;
    }
    if (tipo === 'calculado') {
      if (!tokens.length) { setError('Arma la fórmula con los campos numéricos.'); return; }
      const probe: Record<string, number> = {};
      tokens.forEach((t) => { if (t.k === 'ref') probe[t.v] = 1; });
      if (evaluarFormula(d!.formula || '', probe) === null && !(d!.formula || '').includes('/')) {
        setError('La fórmula no es válida (revisa operadores y paréntesis).'); return;
      }
    }
    onSave({
      ...d!, etiqueta: d!.etiqueta.trim(),
      opciones: d!.opciones ? Array.from(new Set(d!.opciones.map((o) => o.trim()).filter(Boolean))) : undefined,
    });
  }

  const aggOpciones = esNumericoOCalc(tipo)
    ? CM_AGREGACIONES
    : ['texto', 'seleccion', 'interruptor', 'fecha', 'ubicacion'].includes(tipo)
      ? CM_AGREGACIONES.filter((a) => a.agg === 'ninguna' || a.agg === 'conteo')
      : [];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.title}>{esNuevo ? 'Nuevo campo' : 'Editar campo'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.md }}>
            <FieldLabel>Nombre del campo</FieldLabel>
            <TextInput
              value={d.etiqueta} onChangeText={(t) => set({ etiqueta: t })} placeholder="Ej. Cantidad recibida"
              placeholderTextColor={colors.textMuted} style={inputStyle}
            />
            <FieldLabel>Ayuda para quien captura (opcional)</FieldLabel>
            <TextInput
              value={d.ayuda || ''} onChangeText={(t) => set({ ayuda: t })} placeholder="Ej. Según la nota de remisión"
              placeholderTextColor={colors.textMuted} style={inputStyle}
            />

            <FieldLabel>Tipo de campo</FieldLabel>
            <View style={styles.tipoGrid}>
              {CM_TIPOS.map((t) => (
                <Pressable accessibilityRole="button" key={t.tipo} onPress={() => cambiarTipo(t.tipo)} style={[styles.tipoCard, tipo === t.tipo && styles.tipoCardOn]}>
                  <Ionicons name={t.icon} size={18} color={tipo === t.tipo ? '#fff' : colors.primary} />
                  <Text style={[styles.tipoTxt, tipo === t.tipo && { color: '#fff' }]} numberOfLines={2}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>{cmTipoInfo(tipo).descripcion}</Text>

            <View style={styles.sep} />
            <SwitchRow
              label="Obligatorio" hint="No se puede guardar el registro sin llenarlo"
              value={d.requerido} onChange={(v) => set({ requerido: v })} disabled={tipo === 'calculado' || tipo === 'interruptor'}
            />
            <SwitchRow
              label="Aparece en el informe" hint="Apágalo para capturarlo solo como dato interno"
              value={d.en_informe} onChange={(v) => set({ en_informe: v })}
            />

            {(tipo === 'seleccion' || tipo === 'multiseleccion') ? (
              <>
                <FieldLabel>Opciones de la lista</FieldLabel>
                {(d.opciones || []).map((o, i) => (
                  <View key={i} style={styles.optRow}>
                    <TextInput
                      value={o} placeholder={`Opción ${i + 1}`} placeholderTextColor={colors.textMuted}
                      onChangeText={(t) => set({ opciones: (d.opciones || []).map((x, j) => (j === i ? t : x)) })}
                      style={[inputStyle, { flex: 1 }]}
                    />
                    <Pressable accessibilityRole="button" accessibilityLabel="Eliminar" hitSlop={8} onPress={() => set({ opciones: (d.opciones || []).filter((_, j) => j !== i) })}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  </View>
                ))}
                <Chip label="Agregar opción" icon="add" onPress={() => set({ opciones: [...(d.opciones || []), ''] })} />
                {tipo === 'seleccion' ? (
                  <>
                    <View style={styles.sep} />
                    <SwitchRow
                      label="Es un estatus de seguimiento"
                      hint="Guarda la fecha en que un registro pasa a «cerrado», muestra su avance en la lista y permite ocultar los cerrados del informe."
                      value={!!d.estatus}
                      onChange={(v) => set({ estatus: v, cierre: v ? (d.cierre?.length ? d.cierre : (d.opciones || []).slice(-1)) : [] })}
                    />
                    {d.estatus ? (
                      <>
                        <FieldLabel>Opciones que cuentan como «cerrado»</FieldLabel>
                        <ChipRow>
                          {(d.opciones || []).filter((o) => o.trim()).map((o) => {
                            const on = (d.cierre || []).includes(o);
                            return (
                              <Chip
                                key={o} label={o} on={on} icon={on ? 'checkmark' : undefined}
                                onPress={() => set({ cierre: on ? (d.cierre || []).filter((x) => x !== o) : [...(d.cierre || []), o] })}
                              />
                            );
                          })}
                        </ChipRow>
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            {esNumerico(tipo) ? (
              <>
                {tipo === 'numero' ? (
                  <>
                    <FieldLabel>Unidad (opcional)</FieldLabel>
                    <TextInput
                      value={d.unidad || ''} onChangeText={(t) => set({ unidad: t })} placeholder="m, m², m³, kg, pza…"
                      placeholderTextColor={colors.textMuted} style={inputStyle}
                    />
                  </>
                ) : null}
                <FieldLabel>Decimales (vacío = automático)</FieldLabel>
                <TextInput
                  value={d.decimales == null ? '' : String(d.decimales)} keyboardType="number-pad"
                  onChangeText={(t) => { const n = parseInt(t, 10); set({ decimales: Number.isFinite(n) ? Math.min(6, Math.max(0, n)) : null }); }}
                  placeholder="Ej. 2" placeholderTextColor={colors.textMuted} style={inputStyle}
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <FieldLabel>Mínimo permitido</FieldLabel>
                    <TextInput
                      value={d.minimo == null ? '' : String(d.minimo)} keyboardType="numbers-and-punctuation"
                      onChangeText={(t) => set({ minimo: t.trim() === '' || !Number.isFinite(Number(t)) ? null : Number(t) })}
                      placeholder="Sin límite" placeholderTextColor={colors.textMuted} style={inputStyle}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <FieldLabel>Máximo permitido</FieldLabel>
                    <TextInput
                      value={d.maximo == null ? '' : String(d.maximo)} keyboardType="numbers-and-punctuation"
                      onChangeText={(t) => set({ maximo: t.trim() === '' || !Number.isFinite(Number(t)) ? null : Number(t) })}
                      placeholder="Sin límite" placeholderTextColor={colors.textMuted} style={inputStyle}
                    />
                  </View>
                </View>
              </>
            ) : null}

            {tipo === 'calculado' ? (
              <>
                <FieldLabel>Fórmula</FieldLabel>
                <View style={styles.formulaBox}>
                  <Text style={styles.formulaTxt}>{tokens.length ? formulaLegible(d.formula || '', todos) : 'Toca los campos y operadores de abajo para armarla'}</Text>
                </View>
                {refsNumericas.length === 0 ? (
                  <Text style={styles.hint}>Primero agrega campos de tipo número, moneda o porcentaje para poder usarlos aquí.</Text>
                ) : (
                  <>
                    <Text style={styles.sub}>Campos</Text>
                    <ChipRow>
                      {refsNumericas.map((c) => (
                        <Chip key={c.id} label={c.etiqueta || '(sin nombre)'} onPress={() => pushToken({ k: 'ref', v: c.id })} />
                      ))}
                    </ChipRow>
                  </>
                )}
                <Text style={styles.sub}>Operadores</Text>
                <ChipRow>
                  {OPERADORES.map((o) => <Chip key={o.v} label={o.label} onPress={() => pushToken({ k: 'op', v: o.v })} />)}
                </ChipRow>
                <Text style={styles.sub}>Número fijo</Text>
                <View style={styles.optRow}>
                  <TextInput
                    value={numTxt} onChangeText={setNumTxt} keyboardType="decimal-pad" placeholder="Ej. 100"
                    placeholderTextColor={colors.textMuted} style={[inputStyle, { flex: 1 }]}
                  />
                  <Chip
                    label="Agregar" icon="add"
                    onPress={() => { const n = parseFloat(numTxt); if (Number.isFinite(n) && n >= 0) { pushToken({ k: 'num', v: n }); setNumTxt(''); } }}
                  />
                </View>
                <ChipRow>
                  <Chip label="Borrar último" icon="backspace-outline" onPress={() => set({ formula: formulaDesdeTokens(tokens.slice(0, -1)) })} />
                  <Chip label="Limpiar" tone="danger" onPress={() => set({ formula: '' })} />
                </ChipRow>
                <FieldLabel>El resultado se muestra como</FieldLabel>
                <ChipRow>
                  {(['numero', 'moneda', 'porcentaje'] as const).map((f) => (
                    <Chip key={f} label={f === 'numero' ? 'Número' : f === 'moneda' ? 'Moneda' : 'Porcentaje'} on={(d.formato || 'numero') === f} onPress={() => set({ formato: f })} />
                  ))}
                </ChipRow>
                <FieldLabel>Decimales (vacío = automático)</FieldLabel>
                <TextInput
                  value={d.decimales == null ? '' : String(d.decimales)} keyboardType="number-pad"
                  onChangeText={(t) => { const n = parseInt(t, 10); set({ decimales: Number.isFinite(n) ? Math.min(6, Math.max(0, n)) : null }); }}
                  placeholder="Ej. 2" placeholderTextColor={colors.textMuted} style={inputStyle}
                />
              </>
            ) : null}

            {/* Valor por defecto */}
            {tipo === 'interruptor' ? (
              <SwitchRow label="Empieza activado (Sí)" value={d.valor_defecto === true} onChange={(v) => set({ valor_defecto: v })} />
            ) : tipo === 'fecha' ? (
              <SwitchRow label="Empieza con la fecha de hoy" value={d.valor_defecto === 'hoy'} onChange={(v) => set({ valor_defecto: v ? 'hoy' : null })} />
            ) : tipo === 'seleccion' ? (
              <>
                <FieldLabel>Valor inicial</FieldLabel>
                <ChipRow>
                  <Chip label="Ninguno" on={!d.valor_defecto} onPress={() => set({ valor_defecto: null })} />
                  {(d.opciones || []).filter((o) => o.trim()).map((o) => (
                    <Chip key={o} label={o} on={d.valor_defecto === o} onPress={() => set({ valor_defecto: o })} />
                  ))}
                </ChipRow>
              </>
            ) : (tipo === 'texto' || tipo === 'texto_largo' || esNumerico(tipo)) ? (
              <>
                <FieldLabel>Valor inicial (opcional)</FieldLabel>
                <TextInput
                  value={d.valor_defecto == null ? '' : String(d.valor_defecto)} onChangeText={(t) => set({ valor_defecto: t })}
                  keyboardType={esNumerico(tipo) ? 'decimal-pad' : 'default'}
                  placeholderTextColor={colors.textMuted} style={inputStyle}
                />
              </>
            ) : null}

            {/* Totales en tablas / resumen */}
            {aggOpciones.length > 1 && d.en_informe ? (
              <>
                <FieldLabel>Totalizar en el informe</FieldLabel>
                <ChipRow>
                  {aggOpciones.map((a) => (
                    <Chip key={a.agg} label={a.label} on={(d.agregacion || 'ninguna') === a.agg} onPress={() => set({ agregacion: a.agg })} />
                  ))}
                </ChipRow>
                <Text style={styles.hint}>
                  En tablas agrega una fila de totales; en el modo Resumen es el dato que se muestra.
                  {tipo === 'interruptor' ? ' «Conteo» cuenta los registros con Sí.' : ''}
                </Text>
              </>
            ) : null}

            {/* Visibilidad condicional */}
            {condCandidatos.length > 0 ? (
              <>
                <FieldLabel>¿Cuándo se muestra este campo?</FieldLabel>
                <ChipRow>
                  <Chip label="Siempre" on={!d.visible_si} onPress={() => set({ visible_si: null })} />
                  {condCandidatos.map((c) => (
                    <Chip
                      key={c.id} label={`Según «${c.etiqueta || '(sin nombre)'}»`} on={d.visible_si?.campo === c.id}
                      onPress={() => set({ visible_si: { campo: c.id, igual: c.tipo === 'interruptor' ? true : (c.opciones || [])[0] || '' } })}
                    />
                  ))}
                </ChipRow>
                {condCampo ? (
                  <>
                    <Text style={styles.sub}>Mostrar solo cuando «{condCampo.etiqueta}» sea:</Text>
                    <ChipRow>
                      {condCampo.tipo === 'interruptor' ? (
                        <>
                          <Chip label="Sí" on={d.visible_si?.igual === true} onPress={() => set({ visible_si: { campo: condCampo.id, igual: true } })} />
                          <Chip label="No" on={d.visible_si?.igual === false} onPress={() => set({ visible_si: { campo: condCampo.id, igual: false } })} />
                        </>
                      ) : (condCampo.opciones || []).filter((o) => o.trim()).map((o) => (
                        <Chip key={o} label={o} on={d.visible_si?.igual === o} onPress={() => set({ visible_si: { campo: condCampo.id, igual: o } })} />
                      ))}
                    </ChipRow>
                  </>
                ) : null}
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Cancelar" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button label="Listo" onPress={guardar} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, maxHeight: '92%', width: '100%',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  tipoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tipoCard: {
    width: '31.5%', minHeight: 58, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6,
  },
  tipoCardOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tipoTxt: { fontSize: 11, fontWeight: '700', color: colors.text, textAlign: 'center' },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 6, lineHeight: 16 },
  sub: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.sm, marginBottom: 6 },
  sep: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  formulaBox: { backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  formulaTxt: { fontSize: 14, fontWeight: '700', color: colors.text },
  error: { color: colors.error, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
});
