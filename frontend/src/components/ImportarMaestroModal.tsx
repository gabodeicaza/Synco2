// Importador Maestro de Control de Obra (Etapa EVM) — wizard de pasos:
//   archivo → hoja + mapeo (Clave/Descripción/Meta/Importe/Inicio/Fin) +
//   partida + convención → validar (todo el archivo) → revisar vista previa
//   paginada, corregir o descartar → importar (commit).
//
// Hermano de ImportarCatalogoModal.tsx (mismo wizard de 4 pasos, mismo
// backend "subir una sola vez y cachear en Mongo"), pero éste es el ÚNICO
// importador que también captura fecha_inicio/fecha_fin por concepto — ver
// server.py, sección "Importador Maestro de Control de Obra". Reemplaza a
// los dos flujos separados (catálogo + Programa desglosado): con este wizard
// los datos se importan una sola vez y ya quedan completos.
import React, { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, TextInput,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';

import {
  api, ConvencionDecimal, ImportFilaEvm, ImportHeadersResponse, ImportMappingEvm, ImportResumen, Partida,
} from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { isValidDecimalInput, formatCantidad } from '@/src/utils/money';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { confirm } from '@/src/utils/confirm';
import { a11y, t } from '@/src/i18n';
import {
  WizardStep, quedanFueraLabel, filasFueraCount, pasoSiguienteTrasSubir, pasoAnterior,
} from '@/src/utils/importWizard';

type MappingField = 'clave' | 'descripcion' | 'meta' | 'importe' | 'inicio' | 'fin';
const MAPPING_FIELDS: { key: MappingField; label: string }[] = [
  { key: 'clave', label: 'Clave' },
  { key: 'descripcion', label: 'Descripción' },
  { key: 'meta', label: 'Meta (cantidad)' },
  { key: 'importe', label: 'Importe' },
  { key: 'inicio', label: 'Fecha de inicio' },
  { key: 'fin', label: 'Fecha de fin' },
];

const CONVENCION_LABELS: Record<ConvencionDecimal, string> = {
  coma: 'Coma decimal (634,00 = 634.00)',
  punto: 'Punto decimal (634.00 = 634.00)',
};

const ESTADO_COLOR: Record<string, string> = {
  ok: colors.success, error: colors.error, duplicado: colors.primary, descartado: colors.textMuted,
};
const ESTADO_LABEL: Record<string, string> = {
  ok: 'Lista', error: 'Error', duplicado: 'Duplicada', descartado: 'Descartada',
};

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'archivo', label: '1. Archivo' },
  { key: 'mapeo', label: '2. Mapeo' },
  { key: 'revision', label: '3. Revisión' },
  { key: 'resultado', label: '4. Importar' },
];

function puedeValidarMapeoEvm(m: ImportMappingEvm, _partidaId?: string | null): boolean {
  // C-01: la partida destino es opcional; la jerarquía sale de la clave de cada fila.
  return !!(m.clave && m.descripcion && m.meta && m.importe && m.inicio && m.fin);
}

interface Props {
  visible: boolean;
  projectId: string;
  partidas: Partida[];
  onClose: () => void;
  onImported: () => void;
}

export function ImportarMaestroModal({ visible, projectId, partidas, onClose, onImported }: Props) {
  const [step, setStep] = useState<WizardStep>('archivo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Paso 1: archivo
  const [importId, setImportId] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);

  // Paso 2: mapeo + partida + convención
  const [headersResp, setHeadersResp] = useState<ImportHeadersResponse | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ImportMappingEvm>({});
  const [partidaId, setPartidaId] = useState<string | null>(null);
  const [convencion, setConvencion] = useState<ConvencionDecimal | undefined>(undefined);
  const [mostrarFilasCrudas, setMostrarFilasCrudas] = useState(false);

  // Paso 3: revisión (vista previa paginada)
  const [resumen, setResumen] = useState<ImportResumen | null>(null);
  const [filas, setFilas] = useState<ImportFilaEvm[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [duplicadosAccion, setDuplicadosAccion] = useState<'omitir' | 'actualizar'>('omitir');
  const [expandedFila, setExpandedFila] = useState<number | null>(null);

  // Paso 4: resultado
  const [commitResult, setCommitResult] = useState<{ creados: number; actualizados: number; omitidos: number; con_error: number; descartados: number } | null>(null);
  const [descargandoPlantilla, setDescargandoPlantilla] = useState(false);

  async function descargarPlantilla() {
    if (descargandoPlantilla) return;
    setDescargandoPlantilla(true);
    try {
      const { blob, filename } = await api.downloadImportEvmPlantilla();
      await downloadBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e: any) {
      Alert.alert('No se pudo descargar la plantilla', e?.message || 'Intentalo nuevamente.');
    } finally {
      setDescargandoPlantilla(false);
    }
  }

  function reset() {
    setStep('archivo'); setBusy(false); setError(null);
    setImportId(null); setSheetNames([]); setSelectedSheet(null);
    setHeadersResp(null); setMapping({}); setPartidaId(null); setConvencion(undefined); setMostrarFilasCrudas(false);
    setResumen(null); setFilas([]); setPage(1); setTotalPages(1); setDuplicadosAccion('omitir'); setExpandedFila(null);
    setCommitResult(null);
  }

  function handleClose() { reset(); onClose(); }

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
      const res = await api.importEvmUploadSheets(projectId, { uri: asset.uri, name: asset.name || 'catalogo.xlsx', mimeType: asset.mimeType });
      setImportId(res.import_id);
      setSheetNames(res.sheet_names);
      setConvencion(res.convencion_detectada || undefined);

      if (pasoSiguienteTrasSubir(res.requiere_seleccion_hoja) === 'hoja') {
        setStep('hoja');
      } else {
        await loadHeaders(res.import_id, res.sheet_names[0]);
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo subir el archivo');
    } finally {
      setBusy(false);
    }
  }

  async function loadHeaders(id: string, sheet: string, headerRowIndex?: number): Promise<boolean> {
    try {
      setBusy(true); setError(null);
      const resp = await api.importEvmHeaders(id, sheet, headerRowIndex);
      setSelectedSheet(sheet);
      setHeadersResp(resp);
      setMapping(resp.suggested_mapping as ImportMappingEvm);
      setStep('mapeo');
      return true;
    } catch (e: any) {
      setError(e?.message || 'No se pudo leer la hoja seleccionada');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function elegirFilaEncabezado(indice: number) {
    if (!importId || !selectedSheet) return;
    await loadHeaders(importId, selectedSheet, indice);
  }

  async function validar(convencionForzada?: ConvencionDecimal) {
    if (!importId || !selectedSheet) return;
    if (!puedeValidarMapeoEvm(mapping, partidaId)) {
      setError('Mapeo incompleto: asigna Clave, Descripción, Meta, Importe, Inicio y Fin.');
      return;
    }
    try {
      setBusy(true); setError(null);
      const res = await api.importEvmValidate(projectId, importId, {
        sheet: selectedSheet, header_row_index: headersResp?.header_row_index ?? 0,
        mapping, partida_id: partidaId ?? undefined,
        convencion: convencionForzada || convencion,
      });
      setResumen(res.resumen);
      if (res.convencion_usada) setConvencion(res.convencion_usada);
      setStep('revision');
      await cargarPagina(1);
    } catch (e: any) {
      setError(e?.message || 'La validación falló');
    } finally {
      setBusy(false);
    }
  }

  async function cargarPagina(nuevaPagina: number, idOverride?: string): Promise<boolean> {
    const id = idOverride || importId;
    if (!id) return false;
    try {
      setBusy(true); setError(null);
      const res = await api.importEvmPreview(id, { page: nuevaPagina, page_size: 20 });
      setResumen(res.resumen);
      setFilas(res.filas);
      setPage(res.page);
      setTotalPages(res.total_pages);
      setDuplicadosAccion(res.duplicados_accion);
      setExpandedFila(null);
      return true;
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar la página');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function aplicarCorreccion(fila: number, payload: { meta_cantidad?: string; importe_total_editable?: string; fecha_inicio?: string; fecha_fin?: string }) {
    if (!importId) return;
    try {
      const res = await api.importEvmCorrectRow(importId, fila, payload);
      setFilas((cur) => cur.map((f) => (f.fila === fila ? res.fila : f)));
      setResumen(res.resumen);
    } catch (e: any) {
      Alert.alert('No se pudo corregir', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function descartarFila(fila: number, descartar: boolean) {
    if (!importId) return;
    try {
      const res = await api.importEvmCorrectRow(importId, fila, { descartar });
      setFilas((cur) => cur.map((f) => (f.fila === fila ? res.fila : f)));
      setResumen(res.resumen);
    } catch (e: any) {
      Alert.alert('No se pudo descartar', e?.message || 'Intentalo nuevamente.');
    }
  }

  async function cambiarDuplicadosAccion(accion: 'omitir' | 'actualizar') {
    if (!importId) return;
    try {
      await api.importEvmSetDuplicadosAccion(importId, accion);
      setDuplicadosAccion(accion);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cambiar la opción');
    }
  }

  async function commit() {
    if (!importId) return;
    const quedanFuera = filasFueraCount(resumen);
    const ok = await confirm(
      'Importar catálogo',
      quedanFuera > 0
        ? `${quedanFuera} fila(s) quedarán fuera (con error o descartadas). El resto se importará, con sus fechas de inicio y fin. ¿Continuar?`
        : 'Se importarán todas las filas listas, con sus fechas de inicio y fin. ¿Continuar?',
    );
    if (!ok) return;
    try {
      setBusy(true); setError(null);
      const res = await api.importEvmCommit(projectId, importId);
      setCommitResult(res);
      setStep('resultado');
    } catch (e: any) {
      setError(e?.message || 'La importación falló');
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.key === (step === 'hoja' ? 'archivo' : step));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')}
            onPress={() => {
              if (step === 'archivo') handleClose();
              else setStep(pasoAnterior(step, sheetNames.length > 1));
            }}
            hitSlop={10}
          >
            <Ionicons name={step === 'archivo' ? 'close' : 'chevron-back'} size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Importar catálogo</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={handleClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
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
          {step === 'archivo' ? (
            <View style={styles.stepCenter}>
              <Ionicons name="document-attach-outline" size={48} color={colors.primary} />
              <Text style={styles.help}>
                Selecciona un archivo .xlsx, .xls o .csv con tu catálogo de conceptos. Esta es la única
                importación necesaria: clave, descripción, meta, importe, fecha de inicio y fecha de fin
                quedan guardados desde aquí.
              </Text>
              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={pickFile} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="folder-open-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnTxt}>Seleccionar archivo</Text>
                  </>
                )}
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={descargarPlantilla} disabled={descargandoPlantilla}>
                {descargandoPlantilla ? <ActivityIndicator color={colors.primary} /> : (
                  <Text style={styles.smallBtnTxt}>Descargar plantilla de ejemplo</Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {step === 'hoja' ? (
            <View>
              <Text style={styles.help}>Este archivo tiene varias hojas. ¿Cuál quieres importar?</Text>
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
              <Text style={styles.help}>Se detectaron {headersResp.total_rows} filas de datos. Asigna cada columna al campo correspondiente.</Text>

              <Pressable accessibilityRole="button" onPress={() => setMostrarFilasCrudas((v) => !v)} style={styles.linkRow}>
                <Ionicons name={mostrarFilasCrudas ? 'chevron-up' : 'help-circle-outline'} size={14} color={colors.primary} />
                <Text style={styles.linkRowTxt}>
                  {mostrarFilasCrudas ? 'Ocultar' : '¿Estos no son los encabezados correctos? Elige la fila correcta'}
                </Text>
              </Pressable>

              {mostrarFilasCrudas ? (
                <View style={styles.rawPreviewBox}>
                  <Text style={styles.helpSmall}>
                    Si el archivo trae un logo o título antes de la fila de encabezado real, tócala aquí abajo.
                  </Text>
                  {headersResp.preview_rows.map((row, idx) => {
                    const esLaActual = idx === headersResp.header_row_index;
                    const textoFila = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '').map((c) => String(c)).join(' · ') || '(fila vacía)';
                    return (
                      <Pressable accessibilityRole="button"
                        key={idx}
                        onPress={() => elegirFilaEncabezado(idx)}
                        style={[styles.rawPreviewRow, esLaActual && styles.rawPreviewRowActive]}
                        disabled={busy}
                      >
                        <Text style={[styles.rawPreviewIdx, esLaActual && { color: '#fff' }]}>{idx + 1}</Text>
                        <Text style={[styles.rawPreviewTxt, esLaActual && { color: '#fff' }]} numberOfLines={1}>{textoFila}</Text>
                        {esLaActual ? <Ionicons name="checkmark-circle" size={16} color="#fff" /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {MAPPING_FIELDS.map((f) => (
                <View key={f.key} style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>{f.label} *</Text>
                  {(f.key === 'inicio' || f.key === 'fin') ? (
                    <Text style={styles.helpSmall}>Debe ser una columna con celdas de fecha real de Excel (no texto).</Text>
                  ) : null}
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

              <Text style={styles.fieldLabel}>{t('importador.destinoTitulo')}</Text>
              <Text style={styles.helpSmall}>{t('importador.destinoAyuda')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <Pressable accessibilityRole="button" accessibilityState={{ selected: partidaId === null }} onPress={() => setPartidaId(null)} style={[styles.chip, partidaId === null && styles.chipActive]}>
                  <Text style={[styles.chipTxt, partidaId === null && styles.chipTxtActive]} numberOfLines={1}>{t('importador.sinDestino')}</Text>
                </Pressable>
                {partidas.map((p) => {
                  const active = partidaId === p.id;
                  return (
                    <Pressable accessibilityRole="button" key={p.id} onPress={() => setPartidaId(p.id)} style={[styles.chip, active && styles.chipActive]}>
                      <Text style={[styles.chipTxt, active && styles.chipTxtActive]} numberOfLines={1}>{p.clave} — {p.nombre}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.fieldLabel}>Convención decimal</Text>
              <View style={{ gap: 6 }}>
                {(['coma', 'punto'] as ConvencionDecimal[]).map((c) => {
                  const active = convencion === c;
                  const esDetectada = headersResp.convencion_detectada === c;
                  return (
                    <Pressable accessibilityRole="button" key={c} onPress={() => setConvencion(c)} style={[styles.optionRow, active && styles.optionRowActive]}>
                      <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={18} color={colors.primary} />
                      <Text style={styles.optionTxt}>{CONVENCION_LABELS[c]}{esDetectada ? ' (detectada)' : ''}</Text>
                    </Pressable>
                  );
                })}
                {!headersResp.convencion_detectada ? (
                  <Text style={styles.helpSmall}>No se pudo detectar automáticamente; si no eliges una, los números ambiguos ("1.234") se marcarán para que los resuelvas uno por uno en la revisión.</Text>
                ) : null}
              </View>

              <Pressable accessibilityRole="button"
                style={[styles.primaryBtn, (!puedeValidarMapeoEvm(mapping, partidaId) || busy) && { opacity: 0.5 }]}
                onPress={() => validar()}
                disabled={!puedeValidarMapeoEvm(mapping, partidaId) || busy}
              >
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnTxt}>Validar archivo completo</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {step === 'revision' && resumen ? (
            <View style={{ gap: 12 }}>
              <View style={styles.resumenRow}>
                <ResumenChip label="Listas" n={resumen.ok} color={colors.success} />
                <ResumenChip label="Error" n={resumen.error} color={colors.error} />
                <ResumenChip label="Duplicadas" n={resumen.duplicado} color={colors.primary} />
                <ResumenChip label="Descartadas" n={resumen.descartado} color={colors.textMuted} />
              </View>

              {resumen.duplicado > 0 ? (
                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>Claves ya existentes en el proyecto</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable accessibilityRole="button" onPress={() => cambiarDuplicadosAccion('omitir')} style={[styles.chip, duplicadosAccion === 'omitir' && styles.chipActive]}>
                      <Text style={[styles.chipTxt, duplicadosAccion === 'omitir' && styles.chipTxtActive]}>Omitir (no tocar)</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => cambiarDuplicadosAccion('actualizar')} style={[styles.chip, duplicadosAccion === 'actualizar' && styles.chipActive]}>
                      <Text style={[styles.chipTxt, duplicadosAccion === 'actualizar' && styles.chipTxtActive]}>Actualizar existentes</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.helpSmall}>Las claves duplicadas DENTRO del mismo archivo no se autoresuelven — hay que descartar todas menos una.</Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={() => validar('coma')} disabled={busy}>
                  <Text style={styles.smallBtnTxt}>Re-validar todo como coma decimal</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={() => validar('punto')} disabled={busy}>
                  <Text style={styles.smallBtnTxt}>Re-validar todo como punto decimal</Text>
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
                      onCorregir={aplicarCorreccion}
                      onDescartar={descartarFila}
                    />
                  ))}
                </View>
              )}

              <View style={styles.pagerRow}>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('paginaAnterior')} hitSlop={8} disabled={page <= 1} onPress={() => cargarPagina(page - 1)} style={[styles.pagerBtn, page <= 1 && { opacity: 0.4 }]}>
                  <Ionicons name="chevron-back" size={16} color={colors.primary} />
                </Pressable>
                <Text style={styles.pagerTxt}>Página {page} de {totalPages}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('paginaSiguiente')} hitSlop={8} disabled={page >= totalPages} onPress={() => cargarPagina(page + 1)} style={[styles.pagerBtn, page >= totalPages && { opacity: 0.4 }]}>
                  <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                </Pressable>
              </View>

              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={commit} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnTxt}>Importar{quedanFueraLabel(resumen)}</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {step === 'resultado' && commitResult ? (
            <View style={styles.stepCenter}>
              <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              <Text style={styles.resultTitle}>Importación completada</Text>
              <Text style={styles.help}>{commitResult.creados} creados · {commitResult.actualizados} actualizados</Text>
              {(commitResult as any).partidas_creadas > 0 ? <Text style={styles.help}>{t('importador.partidasCreadas', { n: (commitResult as any).partidas_creadas })}</Text> : null}
              {(commitResult as any).sin_partida > 0 ? <Text style={[styles.help, { color: colors.error }]}>{t('importador.sinPartida', { n: (commitResult as any).sin_partida })}</Text> : null}
              {commitResult.omitidos > 0 ? <Text style={styles.help}>{commitResult.omitidos} omitidos (duplicados)</Text> : null}
              {commitResult.con_error > 0 ? <Text style={[styles.help, { color: colors.error }]}>{commitResult.con_error} con error (no se importaron)</Text> : null}
              {commitResult.descartados > 0 ? <Text style={styles.help}>{commitResult.descartados} descartadas por ti</Text> : null}
              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={() => { reset(); onImported(); }}>
                <Text style={styles.primaryBtnTxt}>Listo</Text>
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
  fila, expanded, onToggle, onCorregir, onDescartar,
}: {
  fila: ImportFilaEvm;
  expanded: boolean;
  onToggle: () => void;
  onCorregir: (fila: number, payload: { meta_cantidad?: string; importe_total_editable?: string; fecha_inicio?: string; fecha_fin?: string }) => void;
  onDescartar: (fila: number, descartar: boolean) => void;
}) {
  const [draftMeta, setDraftMeta] = useState(fila.meta_cantidad_efectiva || '');
  const [draftImporte, setDraftImporte] = useState(fila.importe_total_editable_efectivo || '');
  const [draftInicio, setDraftInicio] = useState(fila.fecha_inicio_efectiva || '');
  const [draftFin, setDraftFin] = useState(fila.fecha_fin_efectiva || '');
  const color = ESTADO_COLOR[fila.estado] || colors.textMuted;

  return (
    <View style={[styles.filaCard, { borderLeftColor: color, borderLeftWidth: 4 }]}>
      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.filaHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.filaClave} numberOfLines={1}>{fila.clave || `Fila ${fila.fila}`} — {fila.descripcion || '(sin descripción)'}</Text>
          <Text style={[styles.filaEstado, { color }]}>{ESTADO_LABEL[fila.estado] || fila.estado}</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>

      {expanded ? (
        <View style={styles.filaDetail}>
          {fila.problemas_activos.map((p, idx) => (
            <View key={idx} style={styles.problemaBox}>
              <Text style={styles.problemaMotivo}>{p.motivo}</Text>
              {p.tipo === 'numero_ambiguo' ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <Pressable accessibilityRole="button"
                    style={styles.choiceBtn}
                    onPress={() => onCorregir(fila.fila, p.campo === 'importe' ? { importe_total_editable: p.lectura_miles } : { meta_cantidad: p.lectura_miles })}
                  >
                    <Text style={styles.choiceBtnTxt}>{p.lectura_miles}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button"
                    style={styles.choiceBtn}
                    onPress={() => onCorregir(fila.fila, p.campo === 'importe' ? { importe_total_editable: p.lectura_decimal } : { meta_cantidad: p.lectura_decimal })}
                  >
                    <Text style={styles.choiceBtnTxt}>{p.lectura_decimal}</Text>
                  </Pressable>
                </View>
              ) : null}
              {p.tipo === 'numero_ilegible' && (p.campo === 'meta' || p.campo === 'importe') ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <TextInput
                    value={p.campo === 'meta' ? draftMeta : draftImporte}
                    onChangeText={p.campo === 'meta' ? setDraftMeta : setDraftImporte}
                    keyboardType="decimal-pad"
                    placeholder="Valor correcto"
                    style={styles.editInput}
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('confirmar')} hitSlop={8}
                    onPress={() => {
                      const v = p.campo === 'meta' ? draftMeta : draftImporte;
                      if (!isValidDecimalInput(v)) { Alert.alert('Valor inválido', 'Ingresa un número con hasta 2 decimales.'); return; }
                      onCorregir(fila.fila, p.campo === 'meta' ? { meta_cantidad: v } : { importe_total_editable: v });
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                  </Pressable>
                </View>
              ) : null}
              {p.tipo === 'fecha_ilegible' && (p.campo === 'inicio' || p.campo === 'fin') ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <TextInput
                    value={p.campo === 'inicio' ? draftInicio : draftFin}
                    onChangeText={p.campo === 'inicio' ? setDraftInicio : setDraftFin}
                    placeholder="YYYY-MM-DD"
                    style={styles.editInput}
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={a11y('confirmar')} hitSlop={8}
                    onPress={() => {
                      const v = (p.campo === 'inicio' ? draftInicio : draftFin).trim();
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { Alert.alert('Fecha inválida', 'Usa el formato YYYY-MM-DD.'); return; }
                      onCorregir(fila.fila, p.campo === 'inicio' ? { fecha_inicio: v } : { fecha_fin: v });
                    }}
                  >
                    <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}

          <View style={styles.filaValoresRow}>
            <Text style={styles.filaValorTxt}>Meta: {fila.meta_cantidad_efectiva ? formatCantidad(fila.meta_cantidad_efectiva) : '—'}</Text>
            <Text style={styles.filaValorTxt}>Importe: {fila.importe_total_editable_efectivo || '—'}</Text>
            <Text style={styles.filaValorTxt}>Inicio: {fila.fecha_inicio_efectiva || '—'}</Text>
            <Text style={styles.filaValorTxt}>Fin: {fila.fecha_fin_efectiva || '—'}</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <Pressable accessibilityRole="button" onPress={() => onDescartar(fila.fila, fila.estado !== 'descartado')} style={styles.linkBtn}>
              <Ionicons name={fila.estado === 'descartado' ? 'refresh-outline' : 'trash-outline'} size={14} color={colors.error} />
              <Text style={[styles.linkBtnTxt, { color: colors.error }]}>{fila.estado === 'descartado' ? 'Recuperar fila' : 'Descartar fila'}</Text>
            </Pressable>
          </View>
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
  primaryBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14, textAlign: 'center' },

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
  chipTxtActive: { color: '#fff' },

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
  choiceBtn: { backgroundColor: colors.primaryLight, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 },
  choiceBtnTxt: { fontSize: 13, fontWeight: '800', color: colors.primaryDark },
  editInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13 },
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

export default ImportarMaestroModal;
