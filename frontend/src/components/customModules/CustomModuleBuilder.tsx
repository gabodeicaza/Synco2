// Constructor de módulos personalizados (pantalla completa en modal). Cuatro
// pestañas: General (nombre, icono, área, interruptores), Campos (qué se
// captura), Informes (cómo se imprime en el Diario/Semanal/Mensual: texto,
// tabla, resumen, fotos o nada, más todas las opciones de impresión) y Vista
// previa (el informe tal como saldría, con los cambios aún sin guardar).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TextInput, Pressable, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  api, Area, CustomCampo, CustomModo, CustomModule, CustomModuleInput, CustomPreview, ModuloCategoria,
} from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import {
  CM_CATEGORIAS, CM_ICONOS, CM_MODOS, CM_PERIODOS, OPCIONES_DEFAULT, campoNuevo, cmTipoInfo,
  formulaLegible, moduloVacio, tokensFormula, validarDefinicion,
} from '@/src/utils/customModules';
import { Chip, ChipRow, FieldLabel, Section, SwitchRow, inputStyle } from './ui';
import { FieldEditorModal } from './FieldEditorModal';
import { GraficasEditor } from './GraficasEditor';
import { BloquesPreview } from './BloquesPreview';

type Tab = 'general' | 'campos' | 'informes' | 'vista';
const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'general', label: 'General', icon: 'settings-outline' },
  { key: 'campos', label: 'Campos', icon: 'list-outline' },
  { key: 'informes', label: 'Informes', icon: 'document-text-outline' },
  { key: 'vista', label: 'Vista previa', icon: 'eye-outline' },
];

function normaliza(m: CustomModuleInput | CustomModule): CustomModuleInput {
  const v = moduloVacio();
  return {
    ...v, ...m,
    salida: { ...v.salida!, ...(m.salida || {}) },
    opciones: { ...OPCIONES_DEFAULT, ...(m.opciones || {}) },
    campos: (m.campos || []).map((c) => ({ ...c })),
    graficas: (m.graficas || []).map((g) => ({ ...g })),
  };
}

export function CustomModuleBuilder({
  projectId, inicial, moduleId, areas, headerColor, nRegistros = 0, onClose, onSaved,
}: {
  projectId: string;
  inicial: CustomModuleInput | CustomModule;
  moduleId?: string | null; // presente = edición
  areas: Area[];
  headerColor: string;
  nRegistros?: number;
  onClose: () => void;
  onSaved: (m: CustomModule) => void;
}) {
  const insets = useSafeAreaInsets();
  const fg = contrastText(headerColor);
  const [d, setD] = useState<CustomModuleInput>(() => normaliza(inicial));
  const inicialJson = useRef(JSON.stringify(normaliza(inicial)));
  const [tab, setTab] = useState<Tab>('general');
  const [saving, setSaving] = useState(false);
  const [editando, setEditando] = useState<{ campo: CustomCampo; nuevo: boolean } | null>(null);

  const campos = d.campos || [];
  const op = d.opciones || OPCIONES_DEFAULT;
  const salida = d.salida!;
  const set = (patch: CustomModuleInput) => setD((x) => ({ ...x, ...patch }));
  const setOp = (patch: Partial<typeof OPCIONES_DEFAULT>) => setD((x) => ({ ...x, opciones: { ...(x.opciones || OPCIONES_DEFAULT), ...patch } }));
  const setModo = (cat: ModuloCategoria, patch: Partial<{ modo: CustomModo; periodo: any }>) =>
    setD((x) => ({ ...x, salida: { ...x.salida!, [cat]: { ...x.salida![cat], ...patch } } }));

  const modosUsados = useMemo(() => new Set(CM_CATEGORIAS.map(({ cat }) => salida[cat].modo)), [salida]);
  const hayTabla = modosUsados.has('tabla');
  const hayTexto = modosUsados.has('texto');
  const hayFotos = campos.some((c) => c.tipo === 'foto');
  const hayTotales = campos.some((c) => (c.agregacion || 'ninguna') !== 'ninguna');
  const hayEstatus = campos.some((c) => c.estatus);
  const camposAgrupables = campos.filter((c) => ['texto', 'seleccion', 'interruptor', 'fecha', 'ubicacion'].includes(c.tipo));

  async function cerrar() {
    if (JSON.stringify(d) !== inicialJson.current) {
      const ok = await confirm('Descartar cambios', 'Tienes cambios sin guardar en este módulo. ¿Salir sin guardarlos?', { confirmText: 'Descartar', destructive: true });
      if (!ok) return;
    }
    onClose();
  }

  // Paso previo a guardar: se valida y se abre la confirmación con la vista previa.
  const [confirmando, setConfirmando] = useState(false);

  function pedirConfirmacion() {
    const problema = validarDefinicion(d);
    if (problema) { Alert.alert('Revisa el módulo', problema); return; }
    // Arranca en el primer informe donde el módulo SÍ se imprime.
    const primero = CM_CATEGORIAS.find(({ cat }) => d.salida![cat].modo !== 'oculto');
    setCatPrev(primero ? primero.cat : 'reportes_semanales');
    setConfirmando(true);
  }

  async function guardar() {
    try {
      setSaving(true);
      const m = moduleId ? await api.updateCustomModule(projectId, moduleId, d) : await api.createCustomModule(projectId, d);
      setConfirmando(false);
      onSaved(m);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  // --- Campos ---------------------------------------------------------------
  function dependientes(id: string): string[] {
    const out: string[] = [];
    for (const c of campos) {
      if (c.id === id) continue;
      if (c.tipo === 'calculado' && c.formula) {
        try { if (tokensFormula(c.formula).some((t) => t.k === 'ref' && t.v === id)) out.push(`«${c.etiqueta}» (fórmula)`); } catch { /* fórmula rota: se ignora */ }
      }
      if (c.visible_si?.campo === id) out.push(`«${c.etiqueta}» (condición de visibilidad)`);
    }
    if (op.agrupar_por === id) out.push('Agrupar por (pestaña Informes)');
    if ((d.graficas || []).some((g) => g.categoria === id || g.valor === id)) out.push('una gráfica (pestaña Informes)');
    return out;
  }

  async function borrarCampo(c: CustomCampo) {
    const dep = dependientes(c.id);
    if (dep.length) {
      Alert.alert('No se puede quitar', `Otros elementos dependen de «${c.etiqueta}»:\n\n• ${dep.join('\n• ')}\n\nQuítalos o cámbialos primero.`);
      return;
    }
    const extra = nRegistros > 0 ? ' Los registros ya capturados conservan sus datos, pero este campo dejará de mostrarse e imprimirse.' : '';
    const ok = await confirm('Quitar campo', `¿Quitar «${c.etiqueta}» del módulo?${extra}`, { confirmText: 'Quitar', destructive: true });
    if (!ok) return;
    set({ campos: campos.filter((x) => x.id !== c.id) });
  }

  function mover(idx: number, delta: number) {
    const j = idx + delta;
    if (j < 0 || j >= campos.length) return;
    const copia = [...campos];
    [copia[idx], copia[j]] = [copia[j], copia[idx]];
    set({ campos: copia });
  }

  function guardarCampo(c: CustomCampo) {
    if (!editando) return;
    set({ campos: editando.nuevo ? [...campos, c] : campos.map((x) => (x.id === c.id ? c : x)) });
    setEditando(null);
  }

  // --- Vista previa -----------------------------------------------------------
  const [catPrev, setCatPrev] = useState<ModuloCategoria>('reportes_semanales');
  const [prev, setPrev] = useState<CustomPreview | null>(null);
  const [prevLoading, setPrevLoading] = useState(false);
  const [prevError, setPrevError] = useState<string | null>(null);
  const [prevMuestra, setPrevMuestra] = useState(false);

  const cargarPreview = useCallback(async () => {
    try {
      setPrevLoading(true);
      setPrevError(null);
      const res = await api.previewCustomModule(projectId, {
        definicion: d, module_id: moduleId || undefined, categoria: catPrev, muestra: prevMuestra,
      });
      setPrev(res);
    } catch (e: any) {
      setPrev(null);
      setPrevError(e?.message || 'No se pudo generar la vista previa.');
    } finally {
      setPrevLoading(false);
    }
  }, [projectId, d, moduleId, catPrev, prevMuestra]);

  // Se regenera al abrir la pestaña o cambiar de informe / ejemplo; los cambios del
  // borrador se aplican con «Actualizar vista previa» (cargarPreview cambia en cada edición).
  const cargarPreviewRef = useRef(cargarPreview);
  cargarPreviewRef.current = cargarPreview;
  useEffect(() => { if (tab === 'vista' || confirmando) cargarPreviewRef.current(); }, [tab, confirmando, catPrev, prevMuestra]);

  const nombreArea = areas.find((a) => a.id === d.area_id)?.name;

  return (
    <Modal visible animationType="slide" onRequestClose={cerrar}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={[styles.header, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={cerrar} hitSlop={10} style={styles.hBtn}><Ionicons name="close" size={22} color={fg} /></Pressable>
          <Text style={[styles.hTitle, { color: fg }]} numberOfLines={1}>{moduleId ? 'Editar módulo' : 'Nuevo módulo'}</Text>
          <Pressable accessibilityRole="button" onPress={pedirConfirmacion} disabled={saving} hitSlop={10} style={styles.hBtn}>
            {saving ? <ActivityIndicator size="small" color={fg} /> : <Text style={[styles.hSave, { color: fg }]}>Guardar</Text>}
          </Pressable>
        </View>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable accessibilityRole="button" key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabOn]}>
              <Ionicons name={t.icon} size={15} color={tab === t.key ? '#fff' : colors.text} />
              <Text style={[styles.tabTxt, tab === t.key && { color: '#fff' }]} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl * 2 }}>
          {/* ============ GENERAL ============ */}
          {tab === 'general' ? (
            <>
              <Section title="Identidad">
                <FieldLabel>Nombre del módulo</FieldLabel>
                <TextInput
                  value={d.nombre || ''} onChangeText={(t) => set({ nombre: t })} placeholder="Ej. Control de materiales"
                  placeholderTextColor={colors.textMuted} style={inputStyle}
                />
                <FieldLabel>Descripción (opcional)</FieldLabel>
                <TextInput
                  value={d.descripcion || ''} onChangeText={(t) => set({ descripcion: t })} placeholder="Para qué sirve este módulo"
                  placeholderTextColor={colors.textMuted} style={[inputStyle, { minHeight: 64, textAlignVertical: 'top' }]} multiline
                />
                <FieldLabel>Icono</FieldLabel>
                <View style={styles.iconGrid}>
                  {CM_ICONOS.map((ic) => (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Icono ${ic}`} hitSlop={6} key={ic} onPress={() => set({ icono: ic })} style={[styles.iconCell, d.icono === ic && styles.iconCellOn]}>
                      <Ionicons name={ic} size={20} color={d.icono === ic ? '#fff' : colors.primary} />
                    </Pressable>
                  ))}
                </View>
              </Section>

              <Section title="Dónde aparece" hint="Sub-Coordinadores y Especialistas lo ven en el hub de Módulos, dentro del área que elijas.">
                <ChipRow>
                  <Chip label="General (sin área)" on={!d.area_id} onPress={() => set({ area_id: null })} />
                  {areas.map((a) => <Chip key={a.id} label={a.name} on={d.area_id === a.id} onPress={() => set({ area_id: a.id })} />)}
                </ChipRow>
                {areas.length === 0 ? <Text style={styles.hint}>Este proyecto aún no tiene áreas; se mostrará en «General».</Text> : null}
                {nombreArea ? <Text style={styles.hint}>Área actual: {nombreArea}</Text> : null}
              </Section>

              <Section title="Interruptores del módulo">
                <SwitchRow
                  label="Módulo activo" value={d.activo !== false} onChange={(v) => set({ activo: v })}
                  hint="Apagado: se oculta del menú, no admite captura y no se imprime. Los datos se conservan."
                />
                <SwitchRow
                  label="Cada registro elige a qué informe llega" value={!!d.usar_jerarquia} onChange={(v) => set({ usar_jerarquia: v })}
                  hint="Al capturar se escoge Diario, Semanal, Mensual o Informativo. Apagado: un registro sale en todos los informes donde el módulo se imprima, según su fecha."
                />
                <SwitchRow
                  label="Solo la coordinación captura" value={!!d.solo_coordinacion} onChange={(v) => set({ solo_coordinacion: v })}
                  hint="Coordinador y Sub-Coordinador capturan; el resto solo consulta."
                />
              </Section>

              <Section title="Folio automático" hint="Un consecutivo por registro (p. ej. SEG-0042) para citarlo en minutas y reportes. Aplica a los registros nuevos.">
                <SwitchRow label="Asignar folio a cada registro" value={op.folio_activo} onChange={(v) => setOp({ folio_activo: v })} />
                {op.folio_activo ? (
                  <>
                    <FieldLabel>Prefijo (opcional)</FieldLabel>
                    <TextInput
                      value={op.folio_prefijo} onChangeText={(t) => setOp({ folio_prefijo: t.replace(/\s/g, '').slice(0, 12) })}
                      autoCapitalize="characters" placeholder="Ej. SEG-" placeholderTextColor={colors.textMuted} style={inputStyle}
                    />
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <FieldLabel>Dígitos</FieldLabel>
                        <TextInput
                          value={String(op.folio_digitos)} keyboardType="number-pad" placeholderTextColor={colors.textMuted} style={inputStyle}
                          onChangeText={(t) => { const n = parseInt(t.replace(/\D/g, ''), 10); setOp({ folio_digitos: Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 4 }); }}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <FieldLabel>Empezar en</FieldLabel>
                        <TextInput
                          value={String(op.folio_inicio)} keyboardType="number-pad" placeholderTextColor={colors.textMuted} style={inputStyle}
                          onChangeText={(t) => { const n = parseInt(t.replace(/\D/g, ''), 10); setOp({ folio_inicio: Number.isFinite(n) ? Math.min(999999, Math.max(1, n)) : 1 }); }}
                        />
                      </View>
                    </View>
                    <Text style={styles.hint}>
                      Ejemplo: {op.folio_prefijo}{String(op.folio_inicio).padStart(op.folio_digitos, '0')}
                    </Text>
                    <SwitchRow label="Mostrar el folio en el informe" value={op.mostrar_folio} onChange={(v) => setOp({ mostrar_folio: v })} />
                  </>
                ) : null}
              </Section>
            </>
          ) : null}

          {/* ============ CAMPOS ============ */}
          {tab === 'campos' ? (
            <>
              <Text style={styles.help}>
                Define lo que se captura en cada registro. Puedes mezclar textos, números, listas, interruptores, fotos y
                campos calculados. El orden de aquí es el orden de la captura y de las columnas de la tabla.
              </Text>
              {campos.length === 0 ? (
                <View style={[styles.card, { alignItems: 'center', padding: spacing.lg }]}>
                  <Ionicons name="list-outline" size={28} color={colors.textMuted} />
                  <Text style={styles.emptyTxt}>Aún no hay campos. Agrega el primero.</Text>
                </View>
              ) : null}
              {campos.map((c, i) => {
                const info = cmTipoInfo(c.tipo);
                return (
                  <View key={c.id} style={[styles.card, { marginBottom: spacing.sm }]}>
                    <Pressable accessibilityRole="button" style={styles.campoTop} onPress={() => setEditando({ campo: c, nuevo: false })}>
                      <View style={styles.campoIcon}><Ionicons name={info.icon} size={18} color="#fff" /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.campoName} numberOfLines={1}>{c.etiqueta || '(sin nombre)'}</Text>
                        <Text style={styles.hint} numberOfLines={2}>
                          {info.label}
                          {c.tipo === 'numero' && c.unidad ? ` · ${c.unidad}` : ''}
                          {c.tipo === 'calculado' ? ` · = ${formulaLegible(c.formula || '', campos)}` : ''}
                          {(c.tipo === 'seleccion' || c.tipo === 'multiseleccion') ? ` · ${(c.opciones || []).length} opciones` : ''}
                        </Text>
                      </View>
                      <Ionicons name="create-outline" size={18} color={colors.primary} />
                    </Pressable>
                    <View style={styles.badges}>
                      {c.requerido ? <Badge txt="Obligatorio" /> : null}
                      {!c.en_informe ? <Badge txt="No se imprime" muted /> : null}
                      {c.visible_si ? <Badge txt="Condicional" /> : null}
                      {(c.agregacion || 'ninguna') !== 'ninguna' ? <Badge txt={`Total: ${c.agregacion}`} /> : null}
                    </View>
                    <View style={styles.campoActions}>
                      <Pressable accessibilityRole="button" accessibilityLabel="Subir" hitSlop={8} onPress={() => mover(i, -1)} disabled={i === 0}><Ionicons name="arrow-up" size={18} color={i === 0 ? colors.border : colors.text} /></Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="Bajar" hitSlop={8} onPress={() => mover(i, 1)} disabled={i === campos.length - 1}><Ionicons name="arrow-down" size={18} color={i === campos.length - 1 ? colors.border : colors.text} /></Pressable>
                      <View style={{ flex: 1 }} />
                      <Pressable accessibilityRole="button" accessibilityLabel="Copiar" hitSlop={8} onPress={() => setEditando({ campo: { ...c, id: campoNuevo(c.tipo).id, etiqueta: `${c.etiqueta} (copia)` }, nuevo: true })}>
                        <Ionicons name="copy-outline" size={18} color={colors.primary} />
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="Eliminar" hitSlop={8} onPress={() => borrarCampo(c)}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
                    </View>
                  </View>
                );
              })}
              <Button
                label="Agregar campo" icon={<Ionicons name="add" size={18} color="#fff" />}
                onPress={() => setEditando({ campo: campoNuevo('texto'), nuevo: true })}
              />
            </>
          ) : null}

          {/* ============ INFORMES ============ */}
          {tab === 'informes' ? (
            <>
              <Text style={styles.help}>
                Elige, para cada informe, cómo sale este módulo. «No imprimir» lo deja fuera de ese informe aunque tenga datos.
                Un módulo sin registros en el período tampoco se imprime (salvo que lo actives abajo).
              </Text>
              {CM_CATEGORIAS.map(({ cat, label, icon }) => {
                const cfg = salida[cat];
                return (
                  <View key={cat} style={[styles.card, { marginBottom: spacing.md }]}>
                    <View style={styles.catHead}>
                      <Ionicons name={icon} size={18} color={colors.primary} />
                      <Text style={styles.catTitle}>Informe {label}</Text>
                    </View>
                    <View style={styles.modoGrid}>
                      {CM_MODOS.map((m) => {
                        const bloqueado = m.modo === 'fotos' && !hayFotos;
                        const on = cfg.modo === m.modo;
                        return (
                          <Pressable accessibilityRole="button"
                            key={m.modo} disabled={bloqueado} onPress={() => setModo(cat, { modo: m.modo })}
                            style={[styles.modoCard, on && styles.modoCardOn, bloqueado && { opacity: 0.4 }]}
                          >
                            <Ionicons name={m.icon} size={18} color={on ? '#fff' : colors.primary} />
                            <Text style={[styles.modoTxt, on && { color: '#fff' }]}>{m.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.hint}>
                      {CM_MODOS.find((m) => m.modo === cfg.modo)?.descripcion}
                      {!hayFotos ? ' (Fotos requiere un campo de tipo Foto.)' : ''}
                    </Text>
                    {cfg.modo !== 'oculto' ? (
                      <>
                        <FieldLabel>Qué registros entran</FieldLabel>
                        <ChipRow>
                          {CM_PERIODOS.map((p) => <Chip key={p.periodo} label={p.label} on={cfg.periodo === p.periodo} onPress={() => setModo(cat, { periodo: p.periodo })} />)}
                        </ChipRow>
                        <Text style={styles.hint}>{CM_PERIODOS.find((p) => p.periodo === cfg.periodo)?.descripcion}</Text>
                      </>
                    ) : null}
                  </View>
                );
              })}

              <Section title="Opciones de impresión" hint="Aplican a todos los informes donde el módulo se imprime.">
                <FieldLabel>Título en el informe (vacío = nombre del módulo)</FieldLabel>
                <TextInput value={op.titulo} onChangeText={(t) => setOp({ titulo: t })} placeholder={d.nombre || 'Título'} placeholderTextColor={colors.textMuted} style={inputStyle} />
                <FieldLabel>Texto introductorio (opcional)</FieldLabel>
                <TextInput value={op.intro} onChangeText={(t) => setOp({ intro: t })} placeholder="Aparece antes de los datos" placeholderTextColor={colors.textMuted} style={[inputStyle, { minHeight: 56, textAlignVertical: 'top' }]} multiline />
                <FieldLabel>Nota al pie (opcional)</FieldLabel>
                <TextInput value={op.nota_pie} onChangeText={(t) => setOp({ nota_pie: t })} placeholder="Aparece después de los datos" placeholderTextColor={colors.textMuted} style={[inputStyle, { minHeight: 56, textAlignVertical: 'top' }]} multiline />

                <View style={styles.sep} />
                <SwitchRow label="Mostrar la fecha de cada registro" value={op.mostrar_fecha} onChange={(v) => setOp({ mostrar_fecha: v })} />
                <SwitchRow label="Mostrar quién registró" value={op.mostrar_autor} onChange={(v) => setOp({ mostrar_autor: v })} />
                {hayTabla ? <SwitchRow label="Numerar las filas (tabla)" value={op.numerar} onChange={(v) => setOp({ numerar: v })} /> : null}
                {hayTabla ? (
                  <SwitchRow
                    label="Fila de totales (tabla)" value={op.mostrar_totales} onChange={(v) => setOp({ mostrar_totales: v })}
                    hint={hayTotales ? 'Usa lo que elegiste en «Totalizar en el informe» de cada campo.' : 'Aún ningún campo tiene totales: se define en cada campo numérico.'}
                  />
                ) : null}
                {hayFotos ? (
                  <SwitchRow
                    label="Agregar las fotos tras el texto o la tabla" value={op.incluir_fotos} onChange={(v) => setOp({ incluir_fotos: v })}
                    hint="Las fotos salen dos por hoja con su descripción."
                  />
                ) : null}
                <SwitchRow
                  label="Imprimir aunque no haya registros" value={op.imprimir_vacio} onChange={(v) => setOp({ imprimir_vacio: v })}
                  hint="Por defecto un módulo sin datos en el período no deja hoja en blanco."
                />
                {op.imprimir_vacio ? (
                  <>
                    <FieldLabel>Texto cuando no hay registros</FieldLabel>
                    <TextInput value={op.texto_vacio} onChangeText={(t) => setOp({ texto_vacio: t })} placeholderTextColor={colors.textMuted} style={inputStyle} />
                  </>
                ) : null}

                {hayEstatus ? (
                  <SwitchRow
                    label="Ocultar los registros cerrados" value={op.ocultar_cerrados} onChange={(v) => setOp({ ocultar_cerrados: v })}
                    hint="Un registro cerrado solo sale en el informe del período en que se cerró; los abiertos siempre salen."
                  />
                ) : null}

                <View style={styles.sep} />
                <FieldLabel>Orden de los registros</FieldLabel>
                <ChipRow>
                  <Chip label="Más antiguos primero" on={op.orden === 'asc'} onPress={() => setOp({ orden: 'asc' })} />
                  <Chip label="Más recientes primero" on={op.orden === 'desc'} onPress={() => setOp({ orden: 'desc' })} />
                </ChipRow>
                <FieldLabel>Máximo de registros (0 = todos; con límite entran los más recientes)</FieldLabel>
                <TextInput
                  value={String(op.limite || 0)} keyboardType="number-pad" placeholderTextColor={colors.textMuted} style={inputStyle}
                  onChangeText={(t) => { const n = parseInt(t.replace(/\D/g, ''), 10); setOp({ limite: Number.isFinite(n) ? Math.min(500, n) : 0 }); }}
                />
                {camposAgrupables.length > 0 && (hayTabla || hayTexto) ? (
                  <>
                    <FieldLabel>Agrupar por</FieldLabel>
                    <ChipRow>
                      <Chip label="Sin agrupar" on={!op.agrupar_por} onPress={() => setOp({ agrupar_por: null })} />
                      {camposAgrupables.map((c) => <Chip key={c.id} label={c.etiqueta} on={op.agrupar_por === c.id} onPress={() => setOp({ agrupar_por: c.id })} />)}
                    </ChipRow>
                    <Text style={styles.hint}>Cada grupo sale como su propia tabla o lista, con su encabezado.</Text>
                  </>
                ) : null}
              </Section>

              <Section title="Gráficas" hint="Imágenes con barras, pastel o línea que acompañan al módulo en el informe.">
                <GraficasEditor campos={campos} graficas={d.graficas || []} onChange={(g) => set({ graficas: g })} />
              </Section>

              {(hayTexto || modosUsados.has('fotos') || op.incluir_fotos) ? (
                <Section title="Plantilla de texto" hint="Opcional. Escribe la frase con que sale cada registro usando los campos entre llaves, p. ej. «Se recibieron {Cantidad} de {Material}». Vacío = «Campo: valor» automático.">
                  <TextInput
                    value={op.plantilla_texto} onChangeText={(t) => setOp({ plantilla_texto: t })} multiline
                    placeholder="Se recibieron {Cantidad} de {Material}" placeholderTextColor={colors.textMuted}
                    style={[inputStyle, { minHeight: 64, textAlignVertical: 'top' }]}
                  />
                  <FieldLabel>Toca para insertar un campo</FieldLabel>
                  <ChipRow>
                    {campos.filter((c) => c.tipo !== 'foto').map((c) => (
                      <Chip key={c.id} label={c.etiqueta} onPress={() => setOp({ plantilla_texto: `${op.plantilla_texto}${op.plantilla_texto && !op.plantilla_texto.endsWith(' ') ? ' ' : ''}{${c.etiqueta}}` })} />
                    ))}
                  </ChipRow>
                </Section>
              ) : null}
            </>
          ) : null}

          {/* ============ VISTA PREVIA ============ */}
          {tab === 'vista' ? (
            <>
              <Text style={styles.help}>
                Así saldría el módulo en el informe, con los cambios de arriba aunque aún no los guardes.
                {nRegistros === 0 ? ' Como todavía no hay registros se usan datos de ejemplo.' : ''}
              </Text>
              <ChipRow>
                {CM_CATEGORIAS.map(({ cat, label }) => <Chip key={cat} label={label} on={catPrev === cat} onPress={() => setCatPrev(cat)} />)}
              </ChipRow>
              {nRegistros > 0 ? (
                <SwitchRow label="Usar datos de ejemplo" hint="En vez de los registros reales del período actual." value={prevMuestra} onChange={setPrevMuestra} />
              ) : null}
              <View style={{ height: spacing.sm }} />
              {prevLoading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} /> : null}
              {prevError ? <Text style={styles.error}>{prevError}</Text> : null}
              {!prevLoading && prev ? (
                prev.seccion ? (
                  <>
                    {prev.muestra ? <Text style={styles.sampleTag}>Datos de ejemplo — no son registros reales</Text> : null}
                    <Text style={styles.hint}>Período: {prev.periodo.desde} → {prev.periodo.hasta}</Text>
                    <View style={{ height: spacing.xs }} />
                    <BloquesPreview titulo={prev.seccion.titulo} blocks={prev.seccion.blocks} />
                  </>
                ) : (
                  <View style={[styles.card, { alignItems: 'center', padding: spacing.lg }]}>
                    <Ionicons name={prev.modo === 'oculto' ? 'eye-off-outline' : 'document-outline'} size={28} color={colors.textMuted} />
                    <Text style={styles.emptyTxt}>
                      {prev.modo === 'oculto'
                        ? 'En este informe el módulo está en «No imprimir».'
                        : 'No se imprimiría nada: no hay registros en el período (o ninguno tiene fotos).'}
                    </Text>
                  </View>
                )
              ) : null}
              <View style={{ height: spacing.md }} />
              <Button label="Actualizar vista previa" variant="secondary" onPress={cargarPreview} loading={prevLoading} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={confirmando} transparent animationType="slide" onRequestClose={() => setConfirmando(false)}>
        <View style={styles.confBackdrop}>
          <View style={[styles.confSheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <Text style={styles.confTitle}>Revisa cómo saldrá en el informe</Text>
            <Text style={styles.hint}>
              {salida && CM_CATEGORIAS.every(({ cat }) => salida[cat].modo === 'oculto')
                ? 'Ahora mismo el módulo no se imprime en ningún informe (solo se captura).'
                : 'Esta es la vista previa con tu configuración. Si algo no te convence, vuelve a editar.'}
            </Text>
            <View style={{ height: spacing.sm }} />
            <ChipRow>
              {CM_CATEGORIAS.map(({ cat, label }) => (
                <Chip key={cat} label={`${label}${salida[cat].modo === 'oculto' ? ' · no imprime' : ''}`} on={catPrev === cat} onPress={() => setCatPrev(cat)} />
              ))}
            </ChipRow>
            <ScrollView style={{ marginTop: spacing.sm }} contentContainerStyle={{ paddingBottom: spacing.md }}>
              {prevLoading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} /> : null}
              {prevError ? <Text style={styles.error}>{prevError}</Text> : null}
              {!prevLoading && prev ? (
                prev.seccion ? (
                  <>
                    {prev.muestra ? <Text style={styles.sampleTag}>Datos de ejemplo — no son registros reales</Text> : null}
                    <BloquesPreview titulo={prev.seccion.titulo} blocks={prev.seccion.blocks} />
                  </>
                ) : (
                  <Text style={styles.emptyTxt}>
                    {prev.modo === 'oculto' ? 'En este informe el módulo está en «No imprimir».' : 'No se imprimiría nada: no hay registros en el período.'}
                  </Text>
                )
              ) : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button label="Volver a editar" variant="secondary" onPress={() => setConfirmando(false)} style={{ flex: 1 }} />
              <Button label={moduleId ? 'Guardar cambios' : 'Crear módulo'} loading={saving} onPress={guardar} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      <FieldEditorModal
        campo={editando?.campo || null} esNuevo={!!editando?.nuevo}
        todos={editando?.nuevo ? [...campos, editando.campo] : campos}
        onSave={guardarCampo} onClose={() => setEditando(null)}
      />
    </Modal>
  );
}

function Badge({ txt, muted }: { txt: string; muted?: boolean }) {
  return (
    <View style={[styles.badge, muted && { backgroundColor: colors.border }]}>
      <Text style={[styles.badgeTxt, muted && { color: colors.textMuted }]}>{txt}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  hBtn: { minWidth: 64, height: 32, justifyContent: 'center' },
  hTitle: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16 },
  hSave: { fontWeight: '800', fontSize: 14, textAlign: 'right' },
  tabs: { flexDirection: 'row', gap: 6, padding: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.bg },
  tabOn: { backgroundColor: colors.primary },
  tabTxt: { fontSize: 11, fontWeight: '800', color: colors.text },
  help: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 16 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadow.card },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  iconCell: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  iconCellOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  campoTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campoIcon: { width: 34, height: 34, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  campoName: { fontSize: 14, fontWeight: '800', color: colors.text },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: { backgroundColor: colors.primaryLight, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  campoActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm },
  catTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  modoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modoCard: { flexGrow: 1, minWidth: '30%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  modoCardOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  modoTxt: { fontSize: 12, fontWeight: '800', color: colors.text },
  confBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  confSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%', width: '100%' },
  confTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 4 },
  sep: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  error: { color: colors.error, fontSize: 13, fontWeight: '700', marginVertical: spacing.sm },
  sampleTag: { alignSelf: 'flex-start', backgroundColor: colors.warningBg, color: '#92400E', fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, marginBottom: 4, overflow: 'hidden' },
});
