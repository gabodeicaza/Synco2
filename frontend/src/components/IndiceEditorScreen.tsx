// Indice editable de los informes PDF/PowerPoint — Coordinador y Sub-Coordinador.
// Cada categoria (Diario/Semanal/Mensual) tiene su propio indice: titulo,
// orden de las secciones, titulos personalizados y secciones ocultas. El
// servidor aplica el orden de verdad al generar el PDF/PPTX y calcula los
// numeros de pagina sobre el documento final, asi que el indice nunca se
// desfasa. La lista de secciones sale del ultimo informe generado (o de
// "Actualizar estructura", que lo recalcula con los datos de hoy).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert, Switch, TextInput, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, IndiceConfig, IndiceFormato, IndiceImagen, IndicePeriodo, IndicePreview, IndiceSeccion, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import {
  INDICE_CONFIG_DEFAULT, INDICE_PERIODOS, alternarOculta, moverSeccion, renombrarSeccion,
  seccionesOrdenadas,
} from '@/src/utils/indice';

type Borrador = { config: IndiceConfig; estructura: IndiceSeccion[]; sucio: boolean };

export default function IndiceEditorScreen({ projectId: pid }: { projectId: string }) {
  const insets = useSafeAreaInsets();

  const [project, setProject] = useState<Project | null>(null);
  const [periodo, setPeriodo] = useState<IndicePeriodo>('diario');
  const [borradores, setBorradores] = useState<Partial<Record<IndicePeriodo, Borrador>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const actual = borradores[periodo];

  // Vista previa: se pide al servidor con la config en edicion (sin guardar) cada vez
  // que cambia el borrador o la estructura, con una pausa corta para no saturar.
  const [preview, setPreview] = useState<IndicePreview | null>(null);
  const [previewCargando, setPreviewCargando] = useState(false);
  useEffect(() => {
    if (!pid || !actual) { setPreview(null); return undefined; }
    let vigente = true;
    setPreviewCargando(true);
    const t = setTimeout(() => {
      api.previewIndice(pid, periodo, actual.config)
        .then((r) => { if (vigente) setPreview(r); })
        .catch(() => { if (vigente) setPreview(null); })
        .finally(() => { if (vigente) setPreviewCargando(false); });
    }, 400);
    return () => { vigente = false; clearTimeout(t); };
  }, [pid, periodo, actual?.config, actual?.estructura]);

  // Imagen real de la hoja del indice como saldra en el PDF o en el PowerPoint.
  const [formato, setFormato] = useState<IndiceFormato>('pdf');
  const [imagen, setImagen] = useState<IndiceImagen | null>(null);
  const [imagenCargando, setImagenCargando] = useState(false);
  useEffect(() => {
    if (!pid || !actual) { setImagen(null); return undefined; }
    let vigente = true;
    setImagenCargando(true);
    const t = setTimeout(() => {
      api.previewIndiceImagen(pid, periodo, formato, actual.config)
        .then((r) => { if (vigente) setImagen(r); })
        .catch(() => { if (vigente) setImagen(null); })
        .finally(() => { if (vigente) setImagenCargando(false); });
    }, 600);
    return () => { vigente = false; clearTimeout(t); };
  }, [pid, periodo, formato, actual?.config, actual?.estructura]);

  // Recalcula la estructura (secciones y titulos por defecto) con los datos
  // actuales del proyecto: asi el editor siempre refleja lo que el informe va
  // a imprimir (datos generales con sus nombres, areas, reportes con el titulo
  // de los ingenieros...) y no una version vieja. No toca los cambios sin guardar.
  const refrescarEstructura = useCallback(async (p: IndicePeriodo, silencioso: boolean) => {
    try {
      setRefreshing(true);
      const r = await api.refreshIndiceEstructura(pid, p);
      setBorradores((b) => (b[p] ? { ...b, [p]: { ...b[p]!, estructura: r.estructura } } : b));
    } catch (e: any) {
      if (!silencioso) Alert.alert('No se pudo actualizar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setRefreshing(false);
    }
  }, [pid]);

  const cargar = useCallback(async (p: IndicePeriodo) => {
    try {
      setLoading(true);
      const r = await api.getIndiceConfig(pid, p);
      setBorradores((b) => ({ ...b, [p]: { config: r.config, estructura: r.estructura, sucio: false } }));
      refrescarEstructura(p, true);  // en segundo plano; mientras tanto se ve la ultima conocida
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el indice.');
    } finally {
      setLoading(false);
    }
  }, [pid, refrescarEstructura]);

  useEffect(() => {
    if (!pid) return;
    api.getProject(pid).then(setProject).catch(() => {});
  }, [pid]);

  // Carga cada periodo la primera vez que se abre; cambiar de pestana conserva
  // los cambios sin guardar de las demas.
  useEffect(() => {
    if (!pid) return;
    if (borradores[periodo]) { setLoading(false); return; }
    cargar(periodo);
  }, [pid, periodo, borradores, cargar]);

  function editar(fn: (c: IndiceConfig) => IndiceConfig) {
    setBorradores((b) => {
      const cur = b[periodo];
      if (!cur) return b;
      return { ...b, [periodo]: { ...cur, config: fn(cur.config), sucio: true } };
    });
  }

  async function guardar() {
    if (!actual) return;
    try {
      setSaving(true);
      const r = await api.putIndiceConfig(pid, periodo, actual.config);
      setBorradores((b) => ({ ...b, [periodo]: { ...actual, config: r.config, sucio: false } }));
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  function actualizarEstructura() {
    if (actual) refrescarEstructura(periodo, false);
  }

  const secciones = useMemo(
    () => (actual ? seccionesOrdenadas(actual.estructura, actual.config) : []),
    [actual],
  );

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);
  const config = actual?.config ?? INDICE_CONFIG_DEFAULT;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Índice de informes</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.helpTxt}>
          El índice se inserta después de la portada del PDF y del PowerPoint con los números de
          página reales. El orden que definas aquí es el orden en que quedan las secciones en el
          documento. El ojo tachado quita la sección del informe (no se imprime). Cada informe (Diario, Semanal, Mensual) tiene su propio índice.
        </Text>

        <View style={styles.tabs}>
          {INDICE_PERIODOS.map((p) => {
            const activo = p.value === periodo;
            return (
              <Pressable accessibilityRole="button"
                key={p.value}
                onPress={() => setPeriodo(p.value)}
                style={[styles.tab, activo && styles.tabActivo]}
              >
                <Text style={[styles.tabTxt, activo && styles.tabTxtActivo]}>
                  {p.label}{borradores[p.value]?.sucio ? ' •' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : !actual ? (
          <Pressable accessibilityRole="button" onPress={() => cargar(periodo)} style={{ alignItems: 'center', marginTop: spacing.xl }}>
            <Text style={styles.linkTxt}>No se pudo cargar. Toca para reintentar</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Incluir índice</Text>
                  <Text style={styles.rowSub}>Si lo apagas, el informe sale sin índice pero conserva el orden.</Text>
                </View>
                <Switch
                  value={config.enabled}
                  onValueChange={(v) => editar((c) => ({ ...c, enabled: v }))}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Portadillas por área</Text>
                  <Text style={styles.rowSub}>Si las apagas, el informe sale sin la hoja con el nombre de cada área.</Text>
                </View>
                <Switch
                  value={config.portadillas_area !== false}
                  onValueChange={(v) => editar((c) => ({ ...c, portadillas_area: v }))}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Título</Text>
                  <TextInput
                    value={config.titulo}
                    onChangeText={(t) => editar((c) => ({ ...c, titulo: t }))}
                    placeholder="ÍNDICE"
                    placeholderTextColor={colors.textMuted}
                    maxLength={80}
                    style={styles.input}
                  />
                </View>
              </View>
            </View>

            <View style={styles.seccionesHead}>
              <Text style={styles.sectionTitle}>Secciones ({secciones.length})</Text>
              <Pressable accessibilityRole="button" onPress={actualizarEstructura} disabled={refreshing} hitSlop={8} style={styles.linkBtn}>
                {refreshing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <Ionicons name="refresh" size={16} color={colors.primary} />
                    <Text style={styles.linkTxt}>Actualizar estructura</Text>
                  </>
                )}
              </Pressable>
            </View>

            {secciones.length === 0 ? (
              <Text style={styles.empty}>
                Aún no hay secciones. Toca "Actualizar estructura" (o genera un informe) para listarlas.
              </Text>
            ) : (
              <View style={styles.card}>
                {secciones.map((s, idx) => {
                  const oculta = config.hidden.includes(s.key);
                  return (
                    <View key={s.key} style={[styles.secRow, idx > 0 && styles.rowBorder]}>
                      <Text style={styles.secNum}>{idx + 1}</Text>
                      <TextInput
                        value={config.titles[s.key] ?? ''}
                        onChangeText={(t) => editar((c) => renombrarSeccion(c, s.key, t))}
                        placeholder={s.title}
                        placeholderTextColor={colors.textMuted}
                        maxLength={200}
                        style={[styles.input, styles.secInput, oculta && { opacity: 0.45 }]}
                      />
                      <Pressable accessibilityRole="button"
                        onPress={() => editar((c) => alternarOculta(c, s.key))}
                        hitSlop={6}
                        style={styles.secBtn}
                        accessibilityLabel={oculta ? 'Mostrar en el informe' : 'No imprimir en el informe'}
                      >
                        <Ionicons
                          name={oculta ? 'eye-off-outline' : 'eye-outline'}
                          size={20}
                          color={oculta ? colors.textMuted : colors.primary}
                        />
                      </Pressable>
                      <Pressable accessibilityRole="button"
                        onPress={() => editar((c) => moverSeccion(actual.estructura, c, s.key, -1))}
                        disabled={idx === 0}
                        hitSlop={6}
                        style={[styles.secBtn, idx === 0 && { opacity: 0.25 }]}
                        accessibilityLabel="Subir sección"
                      >
                        <Ionicons name="chevron-up" size={20} color={colors.text} />
                      </Pressable>
                      <Pressable accessibilityRole="button"
                        onPress={() => editar((c) => moverSeccion(actual.estructura, c, s.key, 1))}
                        disabled={idx === secciones.length - 1}
                        hitSlop={6}
                        style={[styles.secBtn, idx === secciones.length - 1 && { opacity: 0.25 }]}
                        accessibilityLabel="Bajar sección"
                      >
                        <Ionicons name="chevron-down" size={20} color={colors.text} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            <VistaPreviaIndice
              preview={preview} cargando={previewCargando} periodo={periodo} color={headerColor}
              imagen={imagen} imagenCargando={imagenCargando} formato={formato} onFormato={setFormato}
            />

            <Pressable accessibilityRole="button"
              onPress={guardar}
              disabled={saving || !actual.sucio}
              style={[styles.saveBtn, (saving || !actual.sucio) && { opacity: 0.5 }]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveTxt}>{actual.sucio ? 'Guardar índice' : 'Sin cambios'}</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const FILAS_PREVIEW = 14;

// Hoja de indice tal como saldra en el PDF: titulo, entradas con su numero de pagina y
// un resumen de paginas. Es un calculo del servidor, no una imagen: refleja el orden,
// los titulos y las secciones ocultas que se estan editando, aunque aun no se guarden.
function VistaPreviaIndice({ preview, cargando, periodo, color, imagen, imagenCargando, formato, onFormato }: {
  preview: IndicePreview | null; cargando: boolean; periodo: IndicePeriodo; color: string;
  imagen: IndiceImagen | null; imagenCargando: boolean; formato: IndiceFormato; onFormato: (f: IndiceFormato) => void;
}) {
  const hayImagen = !!imagen?.disponible && !!imagen.habilitado && !!imagen.paginas?.length;
  return (
    <View style={styles.previewWrap}>
      <View style={styles.seccionesHead}>
        <Text style={styles.sectionTitle}>Vista previa del índice</Text>
        {cargando || imagenCargando ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      <View style={styles.formatoRow}>
        {([['pdf', 'PDF'], ['pptx', 'PowerPoint']] as [IndiceFormato, string][]).map(([f, etiqueta]) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            onPress={() => onFormato(f)}
            style={[styles.formatoBtn, formato === f && styles.formatoBtnOn]}
          >
            <Text style={[styles.formatoTxt, formato === f && { color: '#fff' }]}>{etiqueta}</Text>
          </Pressable>
        ))}
      </View>
      {hayImagen ? (
        <>
          {imagen!.paginas!.map((uri, i) => (
            <Image
              key={`${formato}-${i}`}
              source={{ uri }}
              resizeMode="contain"
              style={[styles.hojaImagen, { aspectRatio: (imagen!.ancho || 4) / (imagen!.alto || 3) }]}
              accessibilityLabel={`Hoja ${i + 1} del índice en ${formato === 'pdf' ? 'PDF' : 'PowerPoint'}`}
            />
          ))}
          <Text style={styles.previewResumen}>
            {(imagen!.total_paginas_indice || 0) > imagen!.paginas!.length
              ? `Se muestran ${imagen!.paginas!.length} de ${imagen!.total_paginas_indice} hojas del índice. `
              : ''}
            {formato === 'pdf'
              ? 'Así se imprime en el PDF, con el fondo de tu plantilla.'
              : 'Así se acomoda en la diapositiva (no incluye el fondo del membrete del PowerPoint).'}
            {preview?.disponible ? ` Portada: ${preview.paginas_portada} pág. · Total aprox.: ${preview.total_paginas} pág.` : ''}
          </Text>
        </>
      ) : imagen?.disponible && imagen.habilitado === false ? (
        <Text style={styles.empty}>El informe saldrá sin índice (conserva el orden de las secciones).</Text>
      ) : !preview ? (
        <Text style={styles.empty}>
          {cargando ? 'Calculando...' : 'No se pudo calcular la vista previa.'}
        </Text>
      ) : !preview.disponible ? (
        <Text style={styles.empty}>
          Toca "Actualizar estructura" para calcular las páginas de cada sección y ver la vista previa.
        </Text>
      ) : (
        <>
          <View style={styles.hoja}>
            {preview.habilitado ? (
              <>
                <Text style={[styles.hojaTitulo, { color }]} numberOfLines={1}>{preview.titulo}</Text>
                <Text style={styles.hojaSub}>Reporte {periodo}</Text>
                <View style={[styles.hojaLinea, { backgroundColor: color }]} />
                {(preview.entradas || []).slice(0, FILAS_PREVIEW).map((e, i) => (
                  <View key={`${i}-${e.titulo}`} style={styles.hojaFila}>
                    <Text style={styles.hojaTxt} numberOfLines={1}>{e.titulo}</Text>
                    <View style={styles.hojaPuntos} />
                    <Text style={styles.hojaPag}>{e.pagina}</Text>
                  </View>
                ))}
                {(preview.entradas || []).length > FILAS_PREVIEW ? (
                  <Text style={styles.hojaMas}>
                    + {(preview.entradas || []).length - FILAS_PREVIEW} secciones más en las hojas siguientes
                  </Text>
                ) : null}
                {(preview.entradas || []).length === 0 ? (
                  <Text style={styles.hojaMas}>Todas las secciones están ocultas.</Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.hojaMas}>El informe saldra sin índice (conserva el orden de las secciones).</Text>
            )}
          </View>
          <Text style={styles.previewResumen}>
            Portada: {preview.paginas_portada} pág. · Índice: {preview.paginas_indice} pág. · Total aprox.: {preview.total_paginas} pág.
            {'\n'}Calculado con el último informe generado; las páginas se ajustan si cambian los reportes.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  previewWrap: { marginBottom: spacing.md },
  formatoRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
  formatoBtn: {
    minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  formatoBtnOn: { backgroundColor: colors.primary },
  formatoTxt: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  hojaImagen: {
    width: '100%', backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  hoja: {
    backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, ...shadow.card,
  },
  hojaTitulo: { fontSize: 18, fontWeight: '800', textAlign: 'center', letterSpacing: 1 },
  hojaSub: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  hojaLinea: { height: 2, marginVertical: spacing.sm, borderRadius: 1 },
  hojaFila: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 4, gap: 6 },
  hojaTxt: { flexShrink: 1, fontSize: 12, color: '#0F172A' },
  hojaPuntos: { flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: colors.border, marginBottom: 3 },
  hojaPag: { fontSize: 12, fontWeight: '800', color: '#0F172A', minWidth: 22, textAlign: 'right' },
  hojaMas: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: spacing.sm },
  previewResumen: { fontSize: 11, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 15 },
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleBar: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  scroll: { padding: spacing.md },
  helpTxt: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.md, lineHeight: 18 },
  tabs: {
    flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 4,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.md },
  tabActivo: { backgroundColor: colors.primary },
  tabTxt: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  tabTxtActivo: { color: '#fff' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    ...shadow.card, marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10,
    paddingVertical: 8, fontSize: 14, color: colors.text, backgroundColor: colors.bg, marginTop: 6,
  },
  seccionesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: {
    fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkTxt: { fontSize: 13, fontWeight: '700', color: colors.primary },
  empty: { textAlign: 'center', color: colors.textMuted, fontStyle: 'italic', marginVertical: spacing.lg },
  secRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  secNum: { width: 24, textAlign: 'center', fontSize: 12, fontWeight: '800', color: colors.textMuted },
  secInput: { flex: 1, marginTop: 0 },
  secBtn: { width: 30, height: 32, alignItems: 'center', justifyContent: 'center' },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: 14, alignItems: 'center',
  },
  saveTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
