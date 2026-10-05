// Importar registros desde Excel a un módulo personalizado. Flujo: (1) bajar la
// plantilla o elegir cualquier .xlsx cuyos encabezados coincidan con los campos,
// (2) se leen las filas en el dispositivo y se mapean por nombre de columna,
// (3) el servidor VALIDA todo sin guardar y muestra los errores por fila,
// (4) se confirma la importación (todo, o solo las filas válidas).
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, Pressable, ActivityIndicator, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { api, CustomCampo, CustomImportFila, CustomImportResult } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { camposImportables, filasParaImportar } from '@/src/utils/customModules';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function leerHoja(uri: string): Promise<any[][]> {
  const base64 = Platform.OS === 'web'
    ? await (async () => {
      const blob = await (await fetch(uri)).blob();
      const buf = await blob.arrayBuffer();
      let bin = '';
      new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
      return btoa(bin);
    })()
    : await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const wb = XLSX.read(base64.replace(/\s/g, ''), { type: 'base64', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];
}

export function ImportarRegistrosModal({
  visible, projectId, moduloId, campos, onClose, onImported,
}: {
  visible: boolean; projectId: string; moduloId: string; campos: CustomCampo[];
  onClose: () => void; onImported: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<string | null>(null);
  const [filas, setFilas] = useState<CustomImportFila[]>([]);
  const [ignoradas, setIgnoradas] = useState<string[]>([]);
  const [sinMapear, setSinMapear] = useState<string[]>([]);
  const [res, setRes] = useState<CustomImportResult | null>(null);
  const [hecho, setHecho] = useState<number | null>(null);

  function reset() { setArchivo(null); setFilas([]); setIgnoradas([]); setSinMapear([]); setRes(null); setHecho(null); setError(null); }
  function cerrar() { const fin = hecho !== null; reset(); onClose(); if (fin) onImported(); }

  async function plantilla() {
    try {
      setBusy(true);
      const { blob, filename } = await api.downloadCustomPlantilla(projectId, moduloId);
      await downloadBlob(blob, filename, XLSX_MIME);
    } catch (e: any) {
      Alert.alert('No se pudo descargar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setBusy(false);
    }
  }

  async function elegir() {
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: [XLSX_MIME, 'application/vnd.ms-excel'], copyToCacheDirectory: true,
      });
      if (r.canceled || !r.assets?.[0]) return;
      setBusy(true);
      reset();
      const asset = r.assets[0];
      const rows = await leerHoja(asset.uri);
      const { filas: f, columnasIgnoradas, mapeo } = filasParaImportar(rows, campos);
      setArchivo(asset.name || 'archivo.xlsx');
      setFilas(f);
      setIgnoradas(columnasIgnoradas);
      const mapeados = new Set(mapeo.filter(Boolean));
      setSinMapear(camposImportables(campos).filter((c) => !mapeados.has(c.id)).map((c) => c.etiqueta));
      if (f.length === 0) { setError('No se encontraron filas con datos. Revisa que la primera fila sean los encabezados.'); return; }
      // Validación inmediata (no guarda nada).
      setRes(await api.importCustomRecords(projectId, moduloId, { filas: f, simular: true }));
    } catch (e: any) {
      setError(e?.message || 'No se pudo leer el archivo.');
    } finally {
      setBusy(false);
    }
  }

  async function importar(soloValidas: boolean) {
    try {
      setBusy(true);
      setError(null);
      const r = await api.importCustomRecords(projectId, moduloId, { filas, importar_validas: soloValidas });
      if (r.importados > 0) setHecho(r.importados);
      else setRes(r);
    } catch (e: any) {
      setError(e?.message || 'No se pudo importar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={cerrar}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.head}>
            <Text style={styles.title}>Importar desde Excel</Text>
            <Pressable onPress={cerrar} hitSlop={10}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
          </View>

          {hecho !== null ? (
            <View style={styles.center}>
              <Ionicons name="checkmark-circle" size={44} color={colors.success} />
              <Text style={styles.big}>{hecho} registro{hecho === 1 ? '' : 's'} importado{hecho === 1 ? '' : 's'}</Text>
              <Button label="Listo" onPress={cerrar} style={{ alignSelf: 'stretch', marginTop: spacing.md }} />
            </View>
          ) : (
            <>
              <ScrollView contentContainerStyle={{ paddingBottom: spacing.md }}>
                <Text style={styles.help}>
                  Usa la plantilla (ya trae los encabezados y listas desplegables) o cualquier Excel con encabezados iguales a los
                  nombres de los campos. La primera hoja se lee; la columna «Fecha» es opcional (vacía = hoy).
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button label="Bajar plantilla" variant="secondary" onPress={plantilla} disabled={busy} style={{ flex: 1 }} />
                  <Button label={archivo ? 'Otro archivo' : 'Elegir archivo'} onPress={elegir} disabled={busy} style={{ flex: 1 }} />
                </View>
                {busy ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} /> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}

                {archivo ? (
                  <View style={styles.box}>
                    <Text style={styles.boxTitle}>{archivo}</Text>
                    <Text style={styles.meta}>{filas.length} fila{filas.length === 1 ? '' : 's'} con datos</Text>
                    {ignoradas.length > 0 ? <Text style={styles.warn}>Columnas sin campo (se ignoran): {ignoradas.join(', ')}</Text> : null}
                    {sinMapear.length > 0 ? <Text style={styles.meta}>Campos sin columna: {sinMapear.join(', ')}</Text> : null}
                  </View>
                ) : null}

                {res ? (
                  <View style={styles.box}>
                    <Text style={[styles.boxTitle, { color: res.n_errores ? colors.text : colors.success }]}>
                      {res.validas} válida{res.validas === 1 ? '' : 's'} · {res.n_errores} con error
                    </Text>
                    {res.errores.slice(0, 30).map((e, i) => (
                      <Text key={i} style={styles.errItem}>Fila {e.fila}: {e.mensaje}</Text>
                    ))}
                    {res.n_errores > 30 ? <Text style={styles.meta}>…y {res.n_errores - 30} errores más.</Text> : null}
                  </View>
                ) : null}
              </ScrollView>

              {res && res.validas > 0 ? (
                <View style={{ gap: spacing.sm }}>
                  {res.n_errores > 0 ? (
                    <Button label={`Importar solo las ${res.validas} válidas`} onPress={() => importar(true)} loading={busy} />
                  ) : (
                    <Button label={`Importar ${res.validas} registro${res.validas === 1 ? '' : 's'}`} onPress={() => importar(false)} loading={busy} />
                  )}
                  {res.n_errores > 0 ? <Text style={styles.meta}>O corrige el Excel y vuelve a elegirlo: nada se guarda hasta que confirmes.</Text> : null}
                </View>
              ) : null}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '92%', width: '100%' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  help: { fontSize: 13, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.md },
  center: { alignItems: 'center', paddingVertical: spacing.lg },
  big: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md, backgroundColor: colors.bg },
  boxTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 16 },
  warn: { fontSize: 12, color: '#92400E', marginTop: 4, lineHeight: 16 },
  errItem: { fontSize: 12, color: colors.error, marginTop: 4, lineHeight: 16 },
  error: { color: colors.error, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
});
