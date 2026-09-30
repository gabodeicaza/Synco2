// Importación de catálogo desde Excel — wizard de pasos (solo SUBCOORDINADOR):
//   archivo → hoja + mapeo + partida + convención → VALIDAR (todo el archivo,
//   una sola vez) → revisar vista previa paginada, corregir o descartar →
//   importar (commit).
//
// El archivo se sube una sola vez (paso 1, multipart) y el backend lo cachea
// temporalmente (Mongo, no disco) para que los pasos siguientes no necesiten
// volver a subirlo. La validación completa vive en el backend
// (import_validate) — este modal solo la dispara y muestra el resultado ya
// paginado; nunca reparsea nada del lado del cliente.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';

import {
  api, ConvencionDecimal, ImportFila, ImportHeadersResponse, ImportMapping, ImportResumen, Partida, Project, SesionPendiente,
} from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { nombreConcepto, pluralizar } from '@/src/utils/nombresNivel';
import { unidadesDelProyecto } from '@/src/utils/unidades';
import { formatCantidad } from '@/src/utils/money';
import { DECIMALES_CANTIDAD, DECIMALES_IMPORTE, SeparadorDecimal, mensajeNumeroInvalido, parseNumeroEntrada } from '@/src/utils/numeros';
import { InlineError } from '@/src/components/InlineError';
import { confirm } from '@/src/utils/confirm';
import { a11y, t } from '@/src/i18n';
import {
  WizardStep, quedanFueraLabel, filasFueraCount, puedeValidar as puedeValidarMapeo,
  pasoSiguienteTrasSubir, pasoAnterior, pasoInicialDeSesionPendiente,
} from '@/src/utils/importWizard';

type MappingField = 'clave' | 'descripcion' | 'unidad' | 'cantidad' | 'precio_unitario' | 'importe' | 'deductiva';
const MAPPING_FIELDS: { key: MappingField; label: string; required: boolean }[] = [
  { key: 'clave', label: t('importadorUI.campoClave'), required: true },
  { key: 'descripcion', label: t('importadorUI.campoDescripcion'), required: true },
  { key: 'unidad', label: t('importadorUI.campoUnidad'), required: false },
  { key: 'cantidad', label: t('importadorUI.campoCantidad'), required: true },
  { key: 'precio_unitario', label: t('importadorUI.campoPrecioUnitario'), required: true },
  { key: 'importe', label: t('importadorUI.campoImporteReferencia'), required: false },
  { key: 'deductiva', label: t('importadorUI.campoDeductiva'), required: false },
];

const CONVENCION_LABELS: Record<ConvencionDecimal, string> = {
  coma: t('importadorUI.convencionComa'),
  punto: t('importadorUI.convencionPunto'),
};

const ESTADO_COLOR: Record<string, string> = {
  ok: colors.success, advertencia: colors.warning, error: colors.error,
  duplicado: colors.primary, descartado: colors.textMuted,
};
const ESTADO_LABEL: Record<string, string> = {
  ok: t('importadorUI.estadoLista'), advertencia: t('importadorUI.estadoAdvertencia'), error: t('importadorUI.estadoError'),
  duplicado: t('importadorUI.estadoDuplicada'), descartado: t('importadorUI.estadoDescartada'),
};

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'archivo', label: t('importadorUI.pasoArchivo') },
  { key: 'mapeo', label: t('importadorUI.pasoMapeo') },
  { key: 'revision', label: t('importadorUI.pasoRevision') },
  { key: 'resultado', label: t('importadorUI.pasoImportar') },
];

interface Props {
  visible: boolean;
  projectId: string;
  partidas: Partida[];
  /** Proyecto (para el nombre configurado del concepto en los textos); opcional. */
  project?: Pick<Project, 'nombre_nivel_concepto'> | null;
  onClose: () => void;
  onImported: () => void;
}

export function ImportarCatalogoModal({ visible, projectId, partidas, project, onClose, onImported }: Props) {
  const conceptosPlural = pluralizar(nombreConcepto(project)).toLowerCase();
  const [step, setStep] = useState<WizardStep>('archivo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sesión sin terminar detectada al abrir el modal (undefined = todavía
  // consultando, null = no hay ninguna, objeto = hay una para ofrecer retomar).
  const [sesionPendiente, setSesionPendiente] = useState<SesionPendiente | null | undefined>(undefined);
  const [resolviendoSesion, setResolviendoSesion] = useState(false);

  // C-04: unidades del proyecto (base + personalizadas) y separador decimal para corregir valores.
  const [unidadesPersonalizadas, setUnidadesPersonalizadas] = useState<string[]>([]);
  const [separador, setSeparador] = useState<SeparadorDecimal>('.');

  // Paso 1: archivo
  const [importId, setImportId] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);

  // Paso 2: mapeo + partida + convención (se conservan al retroceder)
  const [headersResp, setHeadersResp] = useState<ImportHeadersResponse | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [partidaId, setPartidaId] = useState<string | null>(null);
  const [convencion, setConvencion] = useState<ConvencionDecimal | undefined>(undefined);
  const [mostrarFilasCrudas, setMostrarFilasCrudas] = useState(false);

  // Paso 3: revisión (vista previa paginada)
  const [resumen, setResumen] = useState<ImportResumen | null>(null);
  const [filas, setFilas] = useState<ImportFila[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [duplicadosAccion, setDuplicadosAccion] = useState<'omitir' | 'actualizar'>('omitir');
  const [expandedFila, setExpandedFila] = useState<number | null>(null);

  const unidadesProyecto = useMemo(() => unidadesDelProyecto(unidadesPersonalizadas), [unidadesPersonalizadas]);

  // Paso 4: resultado
  const [commitResult, setCommitResult] = useState<{ creados: number; actualizados: number; omitidos: number; con_error: number; descartados: number } | null>(null);

  function reset() {
    setStep('archivo'); setBusy(false); setError(null);
    setImportId(null); setSheetNames([]); setSelectedSheet(null);
    setHeadersResp(null); setMapping({}); setPartidaId(null); setConvencion(undefined); setMostrarFilasCrudas(false);
    setResumen(null); setFilas([]); setPage(1); setTotalPages(1); setDuplicadosAccion('omitir'); setExpandedFila(null);
    setCommitResult(null);
  }

  function resetCompleto() {
    reset();
    setSesionPendiente(undefined); // vuelve a "sin consultar" para que el próximo open la revise de nuevo
  }

  function handleClose() { resetCompleto(); onClose(); }

  useEffect(() => {
    if (!visible) return;
    let vivo = true;
    api.getProject(projectId)
      .then((p) => {
        if (!vivo) return;
        setUnidadesPersonalizadas(p?.unidades_personalizadas || []);
        setSeparador(p?.separador_decimal === ',' ? ',' : '.');
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [visible, projectId]);

  // --- Sesión sin terminar: se consulta cada vez que el modal se abre --------
  useEffect(() => {
    if (!visible) return;
    let cancelado = false;
    (async () => {
      try {
        const pendiente = await api.importCatalogoSesionPendiente(projectId);
        if (!cancelado) setSesionPendiente(pendiente);
      } catch {
        if (!cancelado) setSesionPendiente(null); // best-effort: si falla la consulta, arranca en blanco
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
    setPartidaId(info.validated_partida_id);
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
        // La sesión pudo expirar justo entre que se detectó y que el
        // usuario eligió "Continuar" (TTL de 24h) — se avisa con claridad
        // y se arranca en blanco en vez de dejar el modal en un estado roto.
        // reset() primero (limpia error a null), el mensaje real se pone DESPUÉS.
        reset();
        setError(t('importadorUI.errImportacionExpirada'));
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
      if (info) await api.importCatalogoDescartarSesion(projectId, info.import_id);
    } catch {
      /* best-effort: si ya no existe (el TTL la purgó), no pasa nada */
    } finally {
      setSesionPendiente(null);
      setResolviendoSesion(false);
    }
  }

  // --- Paso 1: seleccionar archivo -------------------------------------------
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
      const res = await api.importCatalogoUploadSheets(projectId, { uri: asset.uri, name: asset.name || 'catalogo.xlsx', mimeType: asset.mimeType });
      setImportId(res.import_id);
      setSheetNames(res.sheet_names);
      setConvencion(res.convencion_detectada || undefined);

      if (pasoSiguienteTrasSubir(res.requiere_seleccion_hoja) === 'hoja') {
        setStep('hoja');
      } else {
        await loadHeaders(res.import_id, res.sheet_names[0]);
      }
    } catch (e: any) {
      setError(e?.message || t('importadorUI.errSubir'));
    } finally {
      setBusy(false);
    }
  }

  async function loadHeaders(id: string, sheet: string, headerRowIndex?: number): Promise<boolean> {
    try {
      setBusy(true); setError(null);
      const resp = await api.importCatalogoHeaders(id, sheet, headerRowIndex);
      setSelectedSheet(sheet);
      setHeadersResp(resp);
      // Si el usuario ya había armado un mapeo y solo está cambiando cuál
      // fila es el encabezado, se resetea (los nombres de columna cambiaron).
      setMapping(resp.suggested_mapping as ImportMapping);
      setStep('mapeo');
      return true;
    } catch (e: any) {
      setError(e?.message || t('importadorUI.errLeerHoja'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Cambiar cuál fila es el encabezado real (archivos con logo/título antes
  // del encabezado) — vuelve a pedir headers con esa fila, sin re-subir nada.
  async function elegirFilaEncabezado(indice: number) {
    if (!importId || !selectedSheet) return;
    await loadHeaders(importId, selectedSheet, indice);
  }

  // --- Paso 2 -> 3: validar (todo el archivo, una sola vez) ------------------
  async function validar(convencionForzada?: ConvencionDecimal) {
    if (!importId || !selectedSheet) return;
    if (!mapping.clave || !mapping.descripcion || !mapping.cantidad || !mapping.precio_unitario) {
      setError(t('importadorUI.errMapeoIncompleto'));
      return;
    }
    try {
      setBusy(true); setError(null);
      const res = await api.importCatalogoValidate(projectId, importId, {
        sheet: selectedSheet, header_row_index: headersResp?.header_row_index ?? 0,
        mapping, partida_id: partidaId ?? undefined,
        convencion: convencionForzada || convencion,
      });
      setResumen(res.resumen);
      if (res.convencion_usada) setConvencion(res.convencion_usada);
      setStep('revision');
      await cargarPagina(1);
    } catch (e: any) {
      setError(e?.message || t('importadorUI.errValidacion'));
    } finally {
      setBusy(false);
    }
  }

  async function cargarPagina(nuevaPagina: number, idOverride?: string): Promise<boolean> {
    const id = idOverride || importId;
    if (!id) return false;
    try {
      setBusy(true); setError(null);
      const res = await api.importCatalogoPreview(id, { page: nuevaPagina, page_size: 20 });
      setResumen(res.resumen);
      setFilas(res.filas);
      setPage(res.page);
      setTotalPages(res.total_pages);
      setDuplicadosAccion(res.duplicados_accion);
      setExpandedFila(null);
      return true;
    } catch (e: any) {
      setError(e?.message || t('importadorUI.errPagina'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // --- Correcciones en línea --------------------------------------------------
  async function aplicarCorreccion(fila: number, payload: { cantidad?: string; precio_unitario?: string; unidad?: string }) {
    if (!importId) return;
    try {
      const res = await api.importCatalogoCorrectRow(importId, fila, payload);
      setFilas((cur) => cur.map((f) => (f.fila === fila ? res.fila : f)));
      setResumen(res.resumen);
    } catch (e: any) {
      setError(e?.message || t('importadorUI.errCorregirFila'));
    }
  }

  async function descartarFila(fila: number, descartar: boolean) {
    if (!importId) return;
    try {
      const res = await api.importCatalogoCorrectRow(importId, fila, { descartar });
      setFilas((cur) => cur.map((f) => (f.fila === fila ? res.fila : f)));
      setResumen(res.resumen);
    } catch (e: any) {
      setError(e?.message || t('importadorUI.errDescartarFila'));
    }
  }

  async function revertirFila(fila: number) {
    if (!importId) return;
    try {
      const res = await api.importCatalogoRevertRow(importId, fila);
      setFilas((cur) => cur.map((f) => (f.fila === fila ? res.fila : f)));
      setResumen(res.resumen);
    } catch (e: any) {
      setError(e?.message || t('importadorUI.errRevertirFila'));
    }
  }

  async function cambiarDuplicadosAccion(accion: 'omitir' | 'actualizar') {
    if (!importId) return;
    try {
      await api.importCatalogoSetDuplicadosAccion(importId, accion);
      setDuplicadosAccion(accion);
    } catch (e: any) {
      setError(e?.message || t('importadorUI.errOpcion'));
    }
  }

  // --- Paso 4: commit ---------------------------------------------------------
  async function commit() {
    if (!importId) return;
    const quedanFuera = filasFueraCount(resumen);
    const ok = await confirm(
      t('importadorUI.titulo'),
      quedanFuera > 0
        ? t('importadorUI.confirmarConFuera', { n: quedanFuera })
        : t('importadorUI.confirmarTodas'),
    );
    if (!ok) return;
    try {
      setBusy(true); setError(null);
      const res = await api.importCatalogoCommit(projectId, importId);
      setCommitResult(res);
      setStep('resultado');
    } catch (e: any) {
      setError(e?.message || t('importadorUI.errImportacion'));
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
              onPress={() => {
                // pasoAnterior nunca toca mapping/partidaId/convencion — solo
                // cambia el paso (ver src/utils/importWizard.ts).
                setStep(pasoAnterior(step, sheetNames.length > 1));
              }}
              hitSlop={10}
              style={styles.atrasBtn}
            >
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
              <Text style={styles.atrasTxt}>{t('catalogoNav.atras')}</Text>
            </Pressable>
          )}
          <Text style={styles.title}>{t('importadorUI.titulo')}</Text>
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
              <Text style={styles.resultTitle}>{t('importadorUI.sesionPendienteTitulo')}</Text>
              <Text style={styles.help}>
                {t('importadorUI.sesionPendienteLinea', {
                  archivo: sesionPendiente.filename || t('importadorUI.archivoSinNombre'),
                  estado: sesionPendiente.validado ? t('importadorUI.sesionValidada') : t('importadorUI.sesionSinValidar'),
                })}
              </Text>
              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={continuarSesionPendiente} disabled={resolviendoSesion}>
                {resolviendoSesion ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="play-forward-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnTxt}>{t('importadorUI.continuarDondeQuede')}</Text>
                  </>
                )}
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={empezarDeNuevo} disabled={resolviendoSesion}>
                <Text style={styles.smallBtnTxt}>{t('importadorUI.empezarDeNuevo')}</Text>
              </Pressable>
            </View>
          ) : step === 'archivo' ? (
            <View style={styles.stepCenter}>
              <Ionicons name="document-attach-outline" size={48} color={colors.primary} />
              <Text style={styles.help}>{t('importadorUI.seleccionaArchivo', { conceptos: conceptosPlural })}</Text>
              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={pickFile} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="folder-open-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnTxt}>{t('importadorUI.seleccionarArchivo')}</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {step === 'hoja' ? (
            <View>
              <Text style={styles.help}>{t('importadorUI.variasHojas')}</Text>
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
              <Text style={styles.help}>{t('importadorUI.seDetectaron', { n: headersResp.total_rows })}</Text>

              <Pressable accessibilityRole="button" onPress={() => setMostrarFilasCrudas((v) => !v)} style={styles.linkRow}>
                <Ionicons name={mostrarFilasCrudas ? 'chevron-up' : 'help-circle-outline'} size={14} color={colors.primary} />
                <Text style={styles.linkRowTxt}>
                  {mostrarFilasCrudas ? t('importadorUI.ocultar') : t('importadorUI.encabezadosIncorrectos')}
                </Text>
              </Pressable>

              {mostrarFilasCrudas ? (
                <View style={styles.rawPreviewBox}>
                  <Text style={styles.helpSmall}>
                    {t('importadorUI.ayudaFilaEncabezado')}
                  </Text>
                  {headersResp.preview_rows.map((row, idx) => {
                    const esLaActual = idx === headersResp.header_row_index;
                    const textoFila = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '').map((c) => String(c)).join(' · ') || t('importadorUI.filaVacia');
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

              <Text style={styles.fieldLabel}>{t('importador.destinoTitulo')}</Text>
              <Text style={styles.helpSmall}>{t('importador.destinoAyuda')}</Text>
              <Text style={styles.helpSmall}>{t('importador.deductivaAyuda')}</Text>
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

              <Text style={styles.fieldLabel}>{t('importadorUI.convencionDecimal')}</Text>
              <View style={{ gap: 6 }}>
                {(['coma', 'punto'] as ConvencionDecimal[]).map((c) => {
                  const active = convencion === c;
                  const esDetectada = headersResp.convencion_detectada === c;
                  return (
                    <Pressable accessibilityRole="button" key={c} onPress={() => setConvencion(c)} style={[styles.optionRow, active && styles.optionRowActive]}>
                      <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={18} color={colors.primary} />
                      <Text style={styles.optionTxt}>{CONVENCION_LABELS[c]}{esDetectada ? t('importadorUI.detectada') : ''}</Text>
                    </Pressable>
                  );
                })}
                {!headersResp.convencion_detectada ? (
                  <Text style={styles.helpSmall}>{t('importadorUI.convencionNoDetectada')}</Text>
                ) : null}
              </View>

              <Pressable accessibilityRole="button"
                style={[styles.primaryBtn, (!puedeValidarMapeo(mapping, partidaId) || busy) && { opacity: 0.5 }]}
                onPress={() => validar()}
                disabled={!puedeValidarMapeo(mapping, partidaId) || busy}
              >
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnTxt}>{t('importadorUI.validarArchivo')}</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {step === 'revision' && resumen ? (
            <View style={{ gap: 12 }}>
              <View style={styles.resumenRow}>
                <ResumenChip label={t('importadorUI.resListas')} n={resumen.ok} color={colors.success} />
                <ResumenChip label={t('importadorUI.resAdvertencia')} n={resumen.advertencia} color={colors.warning} />
                <ResumenChip label={t('importadorUI.resError')} n={resumen.error} color={colors.error} />
                <ResumenChip label={t('importadorUI.resDuplicadas')} n={resumen.duplicado} color={colors.primary} />
                <ResumenChip label={t('importadorUI.resDescartadas')} n={resumen.descartado} color={colors.textMuted} />
              </View>

              {resumen.duplicado > 0 ? (
                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>{t('importadorUI.clavesExistentes')}</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable accessibilityRole="button" onPress={() => cambiarDuplicadosAccion('omitir')} style={[styles.chip, duplicadosAccion === 'omitir' && styles.chipActive]}>
                      <Text style={[styles.chipTxt, duplicadosAccion === 'omitir' && styles.chipTxtActive]}>{t('importadorUI.omitir')}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => cambiarDuplicadosAccion('actualizar')} style={[styles.chip, duplicadosAccion === 'actualizar' && styles.chipActive]}>
                      <Text style={[styles.chipTxt, duplicadosAccion === 'actualizar' && styles.chipTxtActive]}>{t('importadorUI.actualizarExistentes')}</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.helpSmall}>{t('importadorUI.duplicadasEnArchivo')}</Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.fieldLabel}>{t('importadorUI.numerosAmbiguos')}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={() => validar('coma')} disabled={busy}>
                  <Text style={styles.smallBtnTxt}>{t('importadorUI.revalidarComa')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={() => validar('punto')} disabled={busy}>
                  <Text style={styles.smallBtnTxt}>{t('importadorUI.revalidarPunto')}</Text>
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
                      onRevertir={revertirFila}
                      unidades={unidadesProyecto}
                      separador={separador}
                    />
                  ))}
                </View>
              )}

              <View style={styles.pagerRow}>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('paginaAnterior')} hitSlop={8} disabled={page <= 1} onPress={() => cargarPagina(page - 1)} style={[styles.pagerBtn, page <= 1 && { opacity: 0.4 }]}>
                  <Ionicons name="chevron-back" size={16} color={colors.primary} />
                </Pressable>
                <Text style={styles.pagerTxt}>{t('importadorUI.pagina', { page, total: totalPages })}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('paginaSiguiente')} hitSlop={8} disabled={page >= totalPages} onPress={() => cargarPagina(page + 1)} style={[styles.pagerBtn, page >= totalPages && { opacity: 0.4 }]}>
                  <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                </Pressable>
              </View>

              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={commit} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnTxt}>{t('importadorUI.importar')}{quedanFueraLabel(resumen)}</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {step === 'resultado' && commitResult ? (
            <View style={styles.stepCenter}>
              <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              <Text style={styles.resultTitle}>{t('importadorUI.importacionCompletada')}</Text>
              <Text style={styles.help}>{t('importadorUI.creadosActualizados', { creados: commitResult.creados, actualizados: commitResult.actualizados })}</Text>
              {(commitResult as any).partidas_creadas > 0 ? <Text style={styles.help}>{t('importador.partidasCreadas', { n: (commitResult as any).partidas_creadas })}</Text> : null}
              {(commitResult as any).sin_partida > 0 ? <Text style={[styles.help, { color: colors.error }]}>{t('importador.sinPartida', { n: (commitResult as any).sin_partida })}</Text> : null}
              {commitResult.omitidos > 0 ? <Text style={styles.help}>{t('importadorUI.omitidos', { n: commitResult.omitidos })}</Text> : null}
              {commitResult.con_error > 0 ? <Text style={[styles.help, { color: colors.error }]}>{t('importadorUI.conError', { n: commitResult.con_error })}</Text> : null}
              {commitResult.descartados > 0 ? <Text style={styles.help}>{t('importadorUI.descartadasPorTi', { n: commitResult.descartados })}</Text> : null}
              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={() => { resetCompleto(); onImported(); }}>
                <Text style={styles.primaryBtnTxt}>{t('importadorUI.listo')}</Text>
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

export function FilaRevision({
  fila, expanded, onToggle, onCorregir, onDescartar, onRevertir, unidades, separador,
}: {
  fila: ImportFila;
  expanded: boolean;
  onToggle: () => void;
  onCorregir: (fila: number, payload: { cantidad?: string; precio_unitario?: string; unidad?: string }) => void;
  onDescartar: (fila: number, descartar: boolean) => void;
  onRevertir: (fila: number) => void;
  unidades: string[];
  separador: SeparadorDecimal;
}) {
  const [draftCantidad, setDraftCantidad] = useState(fila.cantidad_efectiva || '');
  const [draftPu, setDraftPu] = useState(fila.precio_unitario_efectivo || '');
  const [errorCorreccion, setErrorCorreccion] = useState<string | null>(null);
  const color = ESTADO_COLOR[fila.estado] || colors.textMuted;

  return (
    <View style={[styles.filaCard, { borderLeftColor: color, borderLeftWidth: 4 }]}>
      <Pressable accessibilityRole="button" onPress={onToggle} style={styles.filaHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.filaClave} numberOfLines={1}>
            {fila.tipo_fila === 'partida' ? `[${t('importador.filaPartida')}] ` : ''}{fila.clave || t('importadorUI.fila', { n: fila.fila })} — {fila.descripcion || t('importadorUI.sinDescripcion')}
          </Text>
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
                    onPress={() => onCorregir(fila.fila, p.campo === 'precio_unitario' ? { precio_unitario: p.lectura_miles } : { cantidad: p.lectura_miles })}
                  >
                    <Text style={styles.choiceBtnTxt}>{p.lectura_miles}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button"
                    style={styles.choiceBtn}
                    onPress={() => onCorregir(fila.fila, p.campo === 'precio_unitario' ? { precio_unitario: p.lectura_decimal } : { cantidad: p.lectura_decimal })}
                  >
                    <Text style={styles.choiceBtnTxt}>{p.lectura_decimal}</Text>
                  </Pressable>
                </View>
              ) : null}
              {p.tipo === 'cantidad_no_positiva' ? <Text style={styles.helpSmall}>{t('importador.cantidadNoPositivaAyuda')}</Text> : null}
              {p.tipo === 'precio_unitario_cero' ? <Text style={styles.helpSmall}>{t('importador.precioCeroAyuda')}</Text> : null}
              {p.tipo === 'unidad_vacia' ? <Text style={styles.helpSmall}>{t('importador.unidadVaciaAyuda')}</Text> : null}
              {p.tipo === 'clave_duplicada_archivo' ? <Text style={styles.helpSmall}>{t('importador.duplicadaAyuda')}</Text> : null}
              {p.tipo === 'clave_duplicada_sin_gemela_valida' ? <Text style={styles.helpSmall}>{t('importador.sinGemelaAyuda')}</Text> : null}
              {p.tipo === 'clave_sin_prefijo_padre' ? <Text style={styles.helpSmall}>{t('importador.sinPrefijoAyuda')}</Text> : null}
              {(p.tipo === 'numero_ilegible' || p.tipo === 'cantidad_no_positiva' || p.tipo === 'precio_unitario_cero') && (p.campo === 'cantidad' || p.campo === 'precio_unitario') ? (
                <View style={{ marginTop: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TextInput
                      value={p.campo === 'cantidad' ? draftCantidad : draftPu}
                      onChangeText={(v) => { setErrorCorreccion(null); (p.campo === 'cantidad' ? setDraftCantidad : setDraftPu)(v); }}
                      keyboardType="decimal-pad"
                      placeholder={t('importador.valorCorrecto')}
                      placeholderTextColor={colors.textMuted}
                      accessibilityLabel={t('importador.valorCorrecto')}
                      style={[styles.editInput, errorCorreccion ? { borderColor: colors.error } : null]}
                    />
                    <Pressable accessibilityRole="button" accessibilityLabel={a11y('confirmar')} hitSlop={8}
                      onPress={() => {
                        const v = p.campo === 'cantidad' ? draftCantidad : draftPu;
                        const maxDecimales = p.campo === 'cantidad' ? DECIMALES_CANTIDAD : DECIMALES_IMPORTE;
                        const leido = parseNumeroEntrada(v, { separador, maxDecimales, permitirNegativo: true });
                        if (!leido.ok) {
                          setErrorCorreccion(mensajeNumeroInvalido(leido.motivo, maxDecimales, p.campo === 'cantidad' ? t('importadorUI.laCantidad') : t('importadorUI.elPrecioUnitario')));
                          return;
                        }
                        setErrorCorreccion(null);
                        onCorregir(fila.fila, p.campo === 'cantidad' ? { cantidad: leido.valor } : { precio_unitario: leido.valor });
                      }}
                    >
                      <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                    </Pressable>
                  </View>
                  <InlineError message={errorCorreccion} style={{ marginTop: 6 }} />
                </View>
              ) : null}
              {p.tipo === 'unidad_no_reconocida' || p.tipo === 'unidad_vacia' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 6 }}>
                  {unidades.map((u) => (
                    <Pressable accessibilityRole="button" key={u} style={styles.choiceBtn} onPress={() => onCorregir(fila.fila, { unidad: u })}>
                      <Text style={styles.choiceBtnTxt}>{u}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </View>
          ))}

          <View style={styles.filaValoresRow}>
            <Text style={styles.filaValorTxt}>{t('importadorUI.unidadValor', { valor: fila.unidad_efectiva })}</Text>
            <Text style={styles.filaValorTxt}>{t('importadorUI.cantidadValor', { valor: fila.cantidad_efectiva ? formatCantidad(fila.cantidad_efectiva) : '—' })}</Text>
            <Text style={styles.filaValorTxt}>{t('importadorUI.puValor', { valor: fila.precio_unitario_efectivo || '—' })}</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            {fila.correccion ? (
              <Pressable accessibilityRole="button" onPress={() => onRevertir(fila.fila)} style={styles.linkBtn}>
                <Ionicons name="arrow-undo-outline" size={14} color={colors.primary} />
                <Text style={styles.linkBtnTxt}>{t('importadorUI.revertir')}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => onDescartar(fila.fila, fila.estado !== 'descartado')} style={styles.linkBtn}>
              <Ionicons name={fila.estado === 'descartado' ? 'refresh-outline' : 'trash-outline'} size={14} color={colors.error} />
              <Text style={[styles.linkBtnTxt, { color: colors.error }]}>{fila.estado === 'descartado' ? t('importadorUI.recuperarFila') : t('importadorUI.descartarFila')}</Text>
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
