// Importación del Programa desglosado — hermano de ImportarCatalogoModal.tsx:
// mismo wizard de pasos (archivo → hoja + mapeo → validar → revisión →
// commit), mismo criterio de sesión cacheada en el backend y de vista
// previa paginada. Lo que cambia es el destino: este wizard NO crea ni
// edita conceptos — adjunta una distribución mensual a conceptos que YA
// existen en el catálogo (emparejados por Código = clave), agrupada en una
// ProgramaVersion versionada. Por eso no hay selector de partida ni opción
// de duplicados: la única corrección posible es descartar una fila.
import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';

import {
  api, ConvencionDecimal, ProgramaImportFila, ProgramaImportHeadersResponse, ProgramaImportMapping,
  ProgramaImportResumen, ProgramaSesionPendiente,
} from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { formatMoney, sumDecimalStringsAsCents } from '@/src/utils/money';
import { confirm } from '@/src/utils/confirm';
import { a11y, t } from '@/src/i18n';
import {
  WizardStep, quedanFueraLabel, filasFueraCount, puedeValidar as puedeValidarMapeo,
  pasoSiguienteTrasSubir, pasoAnterior, pasoInicialDeSesionPendiente,
} from '@/src/utils/programaImportWizard';

const CONVENCION_LABELS: Record<ConvencionDecimal, string> = {
  coma: t('programa.convencionComa'),
  punto: t('programa.convencionPunto'),
};

const ESTADO_COLOR: Record<string, string> = {
  ok: colors.success, error: colors.error, descartado: colors.textMuted, sin_distribucion: colors.textMuted,
};
const ESTADO_LABEL: Record<string, string> = {
  ok: t('programa.estadoLista'), error: t('programa.estadoError'), descartado: t('programa.estadoDescartada'),
  sin_distribucion: t('programa.estadoSinDistribucion'),
};

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'archivo', label: t('programa.pasoArchivo') },
  { key: 'mapeo', label: t('programa.pasoMapeo') },
  { key: 'revision', label: t('programa.pasoRevision') },
  { key: 'resultado', label: t('programa.pasoImportar') },
];

interface Props {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  onImported: () => void;
}

export function ImportarProgramaModal({ visible, projectId, onClose, onImported }: Props) {
  const [step, setStep] = useState<WizardStep>('archivo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sesionPendiente, setSesionPendiente] = useState<ProgramaSesionPendiente | null | undefined>(undefined);
  const [resolviendoSesion, setResolviendoSesion] = useState(false);

  // Paso 1: archivo
  const [importId, setImportId] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);

  // Paso 2: mapeo + etiqueta + convención
  const [headersResp, setHeadersResp] = useState<ProgramaImportHeadersResponse | null>(null);
  const [mapping, setMapping] = useState<ProgramaImportMapping>({ meses: [] });
  const [etiqueta, setEtiqueta] = useState('');
  const [convencion, setConvencion] = useState<ConvencionDecimal | undefined>(undefined);
  const [mostrarFilasCrudas, setMostrarFilasCrudas] = useState(false);

  // Paso 3: revisión (vista previa paginada)
  const [resumen, setResumen] = useState<ProgramaImportResumen | null>(null);
  const [filas, setFilas] = useState<ProgramaImportFila[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedFila, setExpandedFila] = useState<number | null>(null);

  // Paso 4: resultado
  const [commitResult, setCommitResult] = useState<{ conceptos_importados: number; sin_distribucion: number } | null>(null);

  function reset() {
    setStep('archivo'); setBusy(false); setError(null);
    setImportId(null); setSheetNames([]); setSelectedSheet(null);
    setHeadersResp(null); setMapping({ meses: [] }); setEtiqueta(''); setConvencion(undefined); setMostrarFilasCrudas(false);
    setResumen(null); setFilas([]); setPage(1); setTotalPages(1); setExpandedFila(null);
    setCommitResult(null);
  }

  function resetCompleto() {
    reset();
    setSesionPendiente(undefined);
  }

  function handleClose() { resetCompleto(); onClose(); }

  useEffect(() => {
    if (!visible) return;
    let cancelado = false;
    (async () => {
      try {
        const pendiente = await api.programaImportSesionPendiente(projectId);
        if (!cancelado) setSesionPendiente(pendiente);
      } catch {
        if (!cancelado) setSesionPendiente(null);
      }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function continuarSesionPendiente() {
    const info = sesionPendiente;
    if (!info) return;
    setResolviendoSesion(true);
    setImportId(info.import_id);
    setSheetNames(info.sheet_names);
    setConvencion(info.convencion_usada || undefined);
    if (info.validated_mapping) setMapping(info.validated_mapping);

    const primerPaso = pasoInicialDeSesionPendiente(info);
    try {
      setBusy(true); setError(null);
      let ok = true;
      if (primerPaso === 'revision' && info.validated_sheet) {
        setSelectedSheet(info.validated_sheet);
        setStep('revision');
        ok = await cargarPagina(1, info.import_id);
      } else if (primerPaso === 'mapeo') {
        ok = await loadHeaders(info.import_id, info.sheet_names[0]);
      } else {
        setStep('hoja');
      }
      if (!ok) {
        reset();
        setError(t('programa.sesionExpirada'));
      }
      setSesionPendiente(null);
    } finally {
      setResolviendoSesion(false);
      setBusy(false);
    }
  }

  async function empezarDeNuevo() {
    const info = sesionPendiente;
    setResolviendoSesion(true);
    try {
      if (info) await api.programaImportDescartarSesion(projectId, info.import_id);
    } catch {
      /* best-effort: si ya no existe (el TTL la purgó), no pasa nada */
    } finally {
      setSesionPendiente(null);
      setResolviendoSesion(false);
    }
  }

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setBusy(true); setError(null);
      const res = await api.programaImportUploadSheets(projectId, { uri: asset.uri, name: asset.name || 'programa.xlsx', mimeType: asset.mimeType });
      setImportId(res.import_id);
      setSheetNames(res.sheet_names);
      setConvencion(res.convencion_detectada || undefined);

      if (pasoSiguienteTrasSubir(res.requiere_seleccion_hoja) === 'hoja') {
        setStep('hoja');
      } else {
        await loadHeaders(res.import_id, res.sheet_names[0]);
      }
    } catch (e: any) {
      setError(e?.message || t('programa.errorSubir'));
    } finally {
      setBusy(false);
    }
  }

  async function loadHeaders(id: string, sheet: string, headerRowIndex?: number): Promise<boolean> {
    try {
      setBusy(true); setError(null);
      const resp = await api.programaImportHeaders(id, sheet, headerRowIndex);
      setSelectedSheet(sheet);
      setHeadersResp(resp);
      setMapping(resp.suggested_mapping as ProgramaImportMapping);
      setStep('mapeo');
      return true;
    } catch (e: any) {
      setError(e?.message || t('programa.errorHoja'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function elegirFilaEncabezado(indice: number) {
    if (!importId || !selectedSheet) return;
    await loadHeaders(importId, selectedSheet, indice);
  }

  function toggleMes(header: string) {
    setMapping((m) => {
      const meses = m.meses.includes(header) ? m.meses.filter((h) => h !== header) : [...m.meses, header];
      // El orden de las columnas mapeadas determina el orden Mes 1..Mes N —
      // se conserva el orden en que aparecen en el encabezado, no el orden
      // en que el usuario las tocó, para no depender de la secuencia de taps.
      const ordenado = (headersResp?.headers || []).filter((h) => meses.includes(h));
      return { ...m, meses: ordenado };
    });
  }

  async function validar(convencionForzada?: ConvencionDecimal) {
    if (!importId || !selectedSheet) return;
    if (!puedeValidarMapeo(mapping)) {
      setError(t('programa.errorMapeo'));
      return;
    }
    try {
      setBusy(true); setError(null);
      const res = await api.programaImportValidate(projectId, importId, {
        sheet: selectedSheet, header_row_index: headersResp?.header_row_index ?? 0,
        mapping, convencion: convencionForzada || convencion, etiqueta,
      });
      setResumen(res.resumen);
      setEtiqueta(res.etiqueta);
      setStep('revision');
      await cargarPagina(1);
    } catch (e: any) {
      setError(e?.message || t('programa.errorValidar'));
    } finally {
      setBusy(false);
    }
  }

  async function cargarPagina(nuevaPagina: number, idOverride?: string): Promise<boolean> {
    const id = idOverride || importId;
    if (!id) return false;
    try {
      setBusy(true); setError(null);
      const res = await api.programaImportPreview(id, { page: nuevaPagina, page_size: 20 });
      setResumen(res.resumen);
      setFilas(res.filas);
      setPage(res.page);
      setTotalPages(res.total_pages);
      if (res.etiqueta) setEtiqueta(res.etiqueta);
      setExpandedFila(null);
      return true;
    } catch (e: any) {
      setError(e?.message || t('programa.errorPagina'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function descartarFila(fila: number, descartar: boolean) {
    if (!importId) return;
    try {
      const res = await api.programaImportCorrectRow(importId, fila, descartar);
      setFilas((cur) => cur.map((f) => (f.fila === fila ? res.fila : f)));
      setResumen(res.resumen);
    } catch (e: any) {
      setError(e?.message || t('programa.errorDescartar'));
    }
  }

  async function commit() {
    if (!importId) return;
    const quedanFuera = filasFueraCount(resumen);
    const ok = await confirm(
      t('programa.titulo'),
      quedanFuera > 0
        ? t('programa.confirmarConFuera', { n: quedanFuera, etiqueta })
        : t('programa.confirmarTodos', { etiqueta }),
    );
    if (!ok) return;
    try {
      setBusy(true); setError(null);
      const res = await api.programaImportCommit(projectId, importId);
      setCommitResult(res);
      setStep('resultado');
    } catch (e: any) {
      setError(e?.message || t('programa.errorImportar'));
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.key === (step === 'hoja' ? 'archivo' : step));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          {/* C-15: un solo botón de cerrar (a la derecha). "Atrás" solo aparece en los pasos intermedios. */}
          {step === 'archivo' || step === 'resultado' ? (
            <View style={styles.headerEspacio} />
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={t('catalogoNav.atrasPaso')}
              onPress={() => setStep(pasoAnterior(step, sheetNames.length > 1))}
              hitSlop={10}
              style={styles.atrasBtn}
            >
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
              <Text style={styles.atrasTxt}>{t('catalogoNav.atras')}</Text>
            </Pressable>
          )}
          <Text style={styles.title}>{t('programa.titulo')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('catalogoNav.cerrarImportador')} onPress={handleClose} hitSlop={10} style={styles.cerrarBtn}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.stepRow}>
          {STEPS.map((s, idx) => (
            <View key={s.key} style={styles.stepItem}>
              <View style={[styles.stepDot, idx <= stepIndex && styles.stepDotActive]} />
              <Text style={[styles.stepLabel, idx === stepIndex && styles.stepLabelActive]}>{s.label}</Text>
            </View>
          ))}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <ScrollView contentContainerStyle={styles.body}>
          {sesionPendiente ? (
            <View style={styles.stepCenter}>
              <Ionicons name="time-outline" size={44} color={colors.warning} />
              <Text style={styles.resultTitle}>{t('programa.sesionPendiente')}</Text>
              <Text style={styles.help}>
                {t('programa.sesionArchivo', {
                  archivo: sesionPendiente.filename || t('programa.sesionUnArchivo'),
                  estado: sesionPendiente.validado ? t('programa.sesionValidada') : t('programa.sesionSinValidar'),
                })}
              </Text>
              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={continuarSesionPendiente} disabled={resolviendoSesion}>
                {resolviendoSesion ? <ActivityIndicator color={colors.textInverse} /> : (
                  <>
                    <Ionicons name="play-forward-outline" size={18} color={colors.textInverse} />
                    <Text style={styles.primaryBtnTxt}>{t('programa.continuar')}</Text>
                  </>
                )}
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={empezarDeNuevo} disabled={resolviendoSesion}>
                <Text style={styles.smallBtnTxt}>{t('programa.empezarDeNuevo')}</Text>
              </Pressable>
            </View>
          ) : step === 'archivo' ? (
            <View style={styles.stepCenter}>
              <Ionicons name="calendar-outline" size={48} color={colors.primary} />
              <Text style={styles.help}>
                {t('programa.ayudaArchivo')}
              </Text>
              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={pickFile} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.textInverse} /> : (
                  <>
                    <Ionicons name="folder-open-outline" size={18} color={colors.textInverse} />
                    <Text style={styles.primaryBtnTxt}>{t('programa.seleccionarArchivo')}</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {step === 'hoja' ? (
            <View>
              <Text style={styles.help}>{t('programa.variasHojas')}</Text>
              {sheetNames.map((s) => (
                <Pressable accessibilityRole="button" key={s} style={styles.optionRow} onPress={() => loadHeaders(importId!, s)} disabled={busy}>
                  <Ionicons name="grid-outline" size={18} color={colors.primary} />
                  <Text style={styles.optionTxt}>{s}</Text>
                </Pressable>
              ))}
              {busy ? <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} /> : null}
            </View>
          ) : null}

          {step === 'mapeo' && headersResp ? (
            <View style={{ gap: 14 }}>
              <Text style={styles.help}>
                {t('programa.ayudaMapeo', { n: headersResp.total_rows })}
              </Text>

              <Pressable accessibilityRole="button" onPress={() => setMostrarFilasCrudas((v) => !v)} style={styles.linkRow}>
                <Ionicons name={mostrarFilasCrudas ? 'chevron-up' : 'help-circle-outline'} size={14} color={colors.primary} />
                <Text style={styles.linkRowTxt}>
                  {mostrarFilasCrudas ? t('programa.ocultar') : t('programa.encabezadosIncorrectos')}
                </Text>
              </Pressable>

              {mostrarFilasCrudas ? (
                <View style={styles.rawPreviewBox}>
                  <Text style={styles.helpSmall}>
                    {t('programa.ayudaFilaEncabezado')}
                  </Text>
                  {headersResp.preview_rows.map((row, idx) => {
                    const esLaActual = idx === headersResp.header_row_index;
                    const textoFila = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '').map((c) => String(c)).join(' · ') || t('programa.filaVacia');
                    return (
                      <Pressable accessibilityRole="button"
                        key={idx}
                        onPress={() => elegirFilaEncabezado(idx)}
                        style={[styles.rawPreviewRow, esLaActual && styles.rawPreviewRowActive]}
                        disabled={busy}
                      >
                        <Text style={[styles.rawPreviewIdx, esLaActual && { color: colors.textInverse }]}>{idx + 1}</Text>
                        <Text style={[styles.rawPreviewTxt, esLaActual && { color: colors.textInverse }]} numberOfLines={1}>{textoFila}</Text>
                        {esLaActual ? <Ionicons name="checkmark-circle" size={16} color={colors.textInverse} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {([
                { key: 'codigo' as const, label: t('programa.campoCodigo'), required: true },
                { key: 'importe' as const, label: t('programa.campoImporte'), required: true },
                { key: 'inicio' as const, label: t('programa.campoInicio'), required: false },
                { key: 'fin' as const, label: t('programa.campoFin'), required: false },
              ]).map((f) => (
                <View key={f.key} style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>{f.label}{f.required ? ' *' : ''}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {headersResp.headers.filter(Boolean).map((h) => {
                      const active = mapping[f.key] === h;
                      return (
                        <Pressable accessibilityRole="button"
                          key={h}
                          onPress={() => setMapping((m) => ({ ...m, [f.key]: active ? undefined : h }))}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          <Text style={[styles.chipTxt, active && styles.chipTxtActive]} numberOfLines={1}>{h}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ))}

              <View style={{ gap: 6 }}>
                <Text style={styles.fieldLabel}>{t('programa.columnasMes')} *</Text>
                <Text style={styles.helpSmall}>{t('programa.ayudaColumnasMes')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {headersResp.headers.filter(Boolean).map((h) => {
                    const active = mapping.meses.includes(h);
                    return (
                      <Pressable accessibilityRole="button" key={h} onPress={() => toggleMes(h)} style={[styles.chip, active && styles.chipActive]}>
                        <Text style={[styles.chipTxt, active && styles.chipTxtActive]} numberOfLines={1}>{h}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <Text style={styles.fieldLabel}>{t('programa.etiquetaVersion')}</Text>
              <TextInput
                value={etiqueta}
                onChangeText={setEtiqueta}
                placeholder={t('programa.etiquetaPlaceholder')}
                accessibilityLabel={t('programa.etiquetaVersion')}
                placeholderTextColor={colors.textMuted}
                style={styles.etiquetaInput}
              />

              <Text style={styles.fieldLabel}>{t('programa.convencionDecimal')}</Text>
              <View style={{ gap: 6 }}>
                {(['coma', 'punto'] as ConvencionDecimal[]).map((c) => {
                  const active = convencion === c;
                  const esDetectada = headersResp.convencion_detectada === c;
                  return (
                    <Pressable accessibilityRole="button" key={c} onPress={() => setConvencion(c)} style={[styles.optionRow, active && styles.optionRowActive]}>
                      <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={18} color={colors.primary} />
                      <Text style={styles.optionTxt}>{CONVENCION_LABELS[c]}{esDetectada ? t('programa.convencionDetectada') : ''}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable accessibilityRole="button"
                style={[styles.primaryBtn, (!puedeValidarMapeo(mapping) || busy) && { opacity: 0.5 }]}
                onPress={() => validar()}
                disabled={!puedeValidarMapeo(mapping) || busy}
              >
                {busy ? <ActivityIndicator color={colors.textInverse} /> : (
                  <>
                    <Ionicons name="checkmark-done-outline" size={18} color={colors.textInverse} />
                    <Text style={styles.primaryBtnTxt}>{t('programa.validarArchivo')}</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {step === 'revision' && resumen ? (
            <View style={{ gap: 12 }}>
              <View style={styles.resumenRow}>
                <ResumenChip label={t('programa.resumenListos')} n={resumen.ok} color={colors.success} />
                <ResumenChip label={t('programa.resumenError')} n={resumen.error} color={colors.error} />
                <ResumenChip label={t('programa.resumenSinDistribucion')} n={resumen.sin_distribucion} color={colors.textMuted} />
                <ResumenChip label={t('programa.resumenDescartados')} n={resumen.descartado} color={colors.textMuted} />
              </View>
              <Text style={styles.helpSmall}>
                {t('programa.ayudaSinDistribucion')}
              </Text>

              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={() => validar('coma')} disabled={busy}>
                  <Text style={styles.smallBtnTxt}>{t('programa.revalidarComa')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={() => validar('punto')} disabled={busy}>
                  <Text style={styles.smallBtnTxt}>{t('programa.revalidarPunto')}</Text>
                </Pressable>
              </View>

              {busy ? <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} /> : (
                <View style={{ gap: 8 }}>
                  {filas.map((f) => (
                    <FilaRevision
                      key={f.fila}
                      fila={f}
                      expanded={expandedFila === f.fila}
                      onToggle={() => setExpandedFila((cur) => (cur === f.fila ? null : f.fila))}
                      onDescartar={descartarFila}
                    />
                  ))}
                </View>
              )}

              <View style={styles.pagerRow}>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('paginaAnterior')} hitSlop={8} disabled={page <= 1} onPress={() => cargarPagina(page - 1)} style={[styles.pagerBtn, page <= 1 && { opacity: 0.4 }]}>
                  <Ionicons name="chevron-back" size={16} color={colors.primary} />
                </Pressable>
                <Text style={styles.pagerTxt}>{t('programa.pagina', { n: page, total: totalPages })}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('paginaSiguiente')} hitSlop={8} disabled={page >= totalPages} onPress={() => cargarPagina(page + 1)} style={[styles.pagerBtn, page >= totalPages && { opacity: 0.4 }]}>
                  <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                </Pressable>
              </View>

              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={commit} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.textInverse} /> : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={18} color={colors.textInverse} />
                    <Text style={styles.primaryBtnTxt}>{t('programa.crearVersion', { etiqueta, fuera: quedanFueraLabel(resumen) })}</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {step === 'resultado' && commitResult ? (
            <View style={styles.stepCenter}>
              <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              <Text style={styles.resultTitle}>{t('programa.resultadoTitulo')}</Text>
              <Text style={styles.help}>{t('programa.resultadoConceptos', { n: commitResult.conceptos_importados })}</Text>
              {commitResult.sin_distribucion > 0 ? (
                <Text style={styles.help}>{t('programa.resultadoSinDistribucion', { n: commitResult.sin_distribucion })}</Text>
              ) : null}
              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={() => { resetCompleto(); onImported(); }}>
                <Text style={styles.primaryBtnTxt}>{t('programa.listo')}</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function ResumenChip({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <View style={[styles.resumenChip, { borderColor: color }]}>
      <Text style={[styles.resumenChipN, { color }]}>{n}</Text>
      <Text style={styles.resumenChipLabel}>{label}</Text>
    </View>
  );
}

function FilaRevision({
  fila, expanded, onToggle, onDescartar,
}: {
  fila: ProgramaImportFila;
  expanded: boolean;
  onToggle: () => void;
  onDescartar: (fila: number, descartar: boolean) => void;
}) {
  const color = ESTADO_COLOR[fila.estado] || colors.textMuted;
  const sumaMesesCentavos = sumDecimalStringsAsCents(fila.meses.map((m) => m.importe));

  return (
    <View style={[styles.filaCard, { borderLeftColor: color, borderLeftWidth: 4 }]}>
      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.filaHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.filaClave} numberOfLines={1}>{fila.clave} — {formatMoney(fila.importe_concepto)}</Text>
          <Text style={[styles.filaEstado, { color }]}>{ESTADO_LABEL[fila.estado] || fila.estado}</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>

      {expanded ? (
        <View style={styles.filaDetail}>
          {!fila.concepto_id ? (
            <View style={styles.problemaBox}>
              <Text style={styles.problemaMotivo}>{t('programa.conceptoNoExiste')}</Text>
            </View>
          ) : null}
          {fila.problemas.map((p, idx) => (
            <View key={idx} style={styles.problemaBox}>
              <Text style={styles.problemaMotivo}>{p.motivo}</Text>
            </View>
          ))}

          {fila.tiene_distribucion_propia ? (
            <View style={styles.filaValoresRow}>
              <Text style={styles.filaValorTxt}>{t('programa.sumaMensual', { valor: formatMoney(sumaMesesCentavos) })}</Text>
              <Text style={styles.filaValorTxt}>{t('programa.importeConcepto', { valor: formatMoney(fila.importe_concepto) })}</Text>
            </View>
          ) : null}

          <Pressable accessibilityRole="button" onPress={() => onDescartar(fila.fila, fila.estado !== 'descartado')} style={styles.linkBtn}>
            <Ionicons name={fila.estado === 'descartado' ? 'refresh-outline' : 'trash-outline'} size={14} color={colors.error} />
            <Text style={[styles.linkBtnTxt, { color: colors.error }]}>{fila.estado === 'descartado' ? t('programa.recuperarFila') : t('programa.descartarFila')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: 50, paddingBottom: spacing.sm,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  headerEspacio: { width: 44, height: 44 },
  atrasBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 44, minWidth: 44, paddingRight: 8 },
  atrasTxt: { fontSize: 14, fontWeight: '700', color: colors.primary },
  cerrarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  stepItem: { alignItems: 'center', gap: 4, flex: 1 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border },
  stepDotActive: { backgroundColor: colors.primary },
  stepLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '600' },
  stepLabelActive: { color: colors.primary, fontWeight: '800' },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg,
    padding: 10, borderRadius: 10, marginHorizontal: spacing.md, marginTop: spacing.sm,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 12, fontWeight: '600' },

  body: { padding: spacing.md, paddingBottom: 60 },
  stepCenter: { alignItems: 'center', gap: 12, paddingTop: 30 },
  help: { fontSize: 13, color: colors.textBody, textAlign: 'center' },
  helpSmall: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 20,
  },
  primaryBtnTxt: { color: colors.textInverse, fontWeight: '700', fontSize: 14, textAlign: 'center' },

  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 8,
  },
  optionRowActive: { borderColor: colors.primary },
  optionTxt: { fontSize: 14, color: colors.text, fontWeight: '600', flex: 1 },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface, maxWidth: 220,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  chipTxtActive: { color: colors.textInverse },

  etiquetaInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: colors.text, backgroundColor: colors.surface,
  },

  smallBtn: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, alignItems: 'center' },
  smallBtnTxt: { fontSize: 11, fontWeight: '700', color: colors.primary, textAlign: 'center' },

  resumenRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resumenChip: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', minWidth: 64 },
  resumenChipN: { fontSize: 16, fontWeight: '800' },
  resumenChipLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '700' },

  filaCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  filaHeaderRow: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8 },
  filaClave: { fontSize: 13, fontWeight: '700', color: colors.text },
  filaEstado: { fontSize: 11, fontWeight: '800', marginTop: 2 },
  filaDetail: { borderTopWidth: 1, borderTopColor: colors.border, padding: 10, gap: 8 },
  problemaBox: { backgroundColor: colors.bg, borderRadius: radius.sm, padding: 8 },
  problemaMotivo: { fontSize: 12, color: colors.textBody },
  filaValoresRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  filaValorTxt: { fontSize: 11, color: colors.textMuted },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },

  pagerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  pagerBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  pagerTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },

  resultTitle: { fontSize: 16, fontWeight: '800', color: colors.text },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkRowTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  rawPreviewBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 8, gap: 4 },
  rawPreviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 8,
    borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  rawPreviewRowActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  rawPreviewIdx: { fontSize: 11, fontWeight: '800', color: colors.textMuted, width: 18 },
  rawPreviewTxt: { fontSize: 11, color: colors.textBody, flex: 1 },
});
