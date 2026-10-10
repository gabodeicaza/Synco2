// Carga masiva de invitaciones por Excel — flujo simple de 1 sola vuelta
// (a diferencia del wizard de catálogo/EVM, aquí no hace falta mapeo de
// columnas ni resolución de ambigüedad numérica): archivo → vista previa
// (todas las filas validadas de una vez, sin sesión resumible) → importar.
// Filas con error se corrigen en el Excel y se vuelve a subir el archivo.
import React, { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';

import { api, InvitationBulkRow, InvitationBulkCommitResult } from '@/src/api';
import { InlineError } from '@/src/components/InlineError';
import { useEnvio } from '@/src/hooks/useEnvio';
import { esErrorDeRed } from '@/src/utils/errores';
import { showToast } from '@/src/utils/toast';
import { colors, radius, spacing } from '@/src/theme';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { confirm } from '@/src/utils/confirm';
import { roleLabel } from '@/src/utils/roles';
import { a11y, t } from '@/src/i18n';

type Step = 'archivo' | 'revision' | 'resultado';

const ESTADO_COLOR: Record<string, string> = {
  ok: colors.success, error: colors.error, duplicado: colors.textMuted,
};
const ESTADO_LABEL: Record<string, string> = {
  ok: 'Lista', error: 'Error', duplicado: 'Ya invitado',
};

interface Props {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  onImported: () => void;
}

export function ImportarInvitacionesModal({ visible, projectId, onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>('archivo');
  const { guardando: busy, ejecutar } = useEnvio();
  const [descargandoPlantilla, setDescargandoPlantilla] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filas, setFilas] = useState<InvitationBulkRow[]>([]);
  const [resumen, setResumen] = useState<{ total: number; ok: number; error: number; duplicado: number } | null>(null);
  const [commitResult, setCommitResult] = useState<InvitationBulkCommitResult | null>(null);

  function reset() {
    setStep('archivo'); setError(null);
    setFilas([]); setResumen(null); setCommitResult(null);
  }

  function handleClose() { reset(); onClose(); }

  function fallo(e: unknown, respaldo: string) {
    if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
    setError(!esErrorDeRed(e) && (e as any)?.message ? (e as any).message : respaldo);
  }

  async function descargarPlantilla() {
    await ejecutar(async () => {
      setDescargandoPlantilla(true); setError(null);
      try {
        const { blob, filename } = await api.downloadInvitationsBulkPlantilla(projectId);
        await downloadBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } catch (e: any) {
        fallo(e, t('invitaciones.importar.plantillaError'));
      } finally {
        setDescargandoPlantilla(false);
      }
    });
  }

  async function pickFile() {
    await ejecutar(async () => {
      try {
        const result = await DocumentPicker.getDocumentAsync({
          type: [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
          ],
          copyToCacheDirectory: true,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];

        setError(null);
        const res = await api.invitationsBulkValidate(projectId, {
          uri: asset.uri, name: asset.name || 'invitaciones.xlsx', mimeType: asset.mimeType,
        });
        setResumen(res.resumen);
        setFilas(res.filas);
        setStep('revision');
      } catch (e: any) {
        fallo(e, t('invitaciones.importar.archivoError'));
      }
    });
  }

  async function importar() {
    await ejecutar(async () => {
      const listas = filas.filter((f) => f.estado === 'ok').length;
      if (listas === 0) {
        setError(t('invitaciones.importar.nadaQueImportar'));
        return;
      }
      const ok = await confirm(
        'Importar invitaciones',
        `Se crearán ${listas} invitación(es) nueva(s). Las filas con error o ya invitadas se omitirán. ¿Continuar?`,
      );
      if (!ok) return;
      try {
        setError(null);
        const res = await api.invitationsBulkCommit(projectId, filas);
        setCommitResult(res);
        setStep('resultado');
      } catch (e: any) {
        fallo(e, t('invitaciones.importar.importacionError'));
      }
    });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={handleClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>{t('invitaciones.importar.titulo')}</Text>
          <View style={{ width: 24 }} />
        </View>

        <InlineError message={error} style={styles.errorBox} />

        <ScrollView contentContainerStyle={styles.body}>
          {step === 'archivo' ? (
            <View style={styles.stepCenter}>
              <Ionicons name="document-attach-outline" size={48} color={colors.primary} />
              <Text style={styles.help}>
                Sube un Excel con columnas: No. de Control, Iniciales, Puesto, Área, Rol
                (especialista/subcoordinador) y Correo. La fila 1 debe ser el encabezado.
              </Text>
              <Pressable accessibilityRole="button" style={styles.linkBtnCenter} onPress={descargarPlantilla} disabled={descargandoPlantilla}>
                {descargandoPlantilla ? <ActivityIndicator color={colors.primary} /> : (
                  <>
                    <Ionicons name="download-outline" size={16} color={colors.primary} />
                    <Text style={styles.linkBtnTxt}>Descargar plantilla</Text>
                  </>
                )}
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={pickFile} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="folder-open-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnTxt}>Seleccionar archivo</Text>
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
                <ResumenChip label="Ya invitados" n={resumen.duplicado} color={colors.textMuted} />
              </View>

              <View style={{ gap: 8 }}>
                {filas.map((f) => (
                  <FilaBulk key={f.fila} fila={f} />
                ))}
              </View>

              <Pressable accessibilityRole="button" style={styles.smallBtn} onPress={pickFile} disabled={busy}>
                <Text style={styles.smallBtnTxt}>Subir otro archivo</Text>
              </Pressable>

              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={importar} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnTxt}>Importar {resumen.ok} lista(s)</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : null}

          {step === 'resultado' && commitResult ? (
            <View style={styles.stepCenter}>
              <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              <Text style={styles.resultTitle}>Importación completada</Text>
              <Text style={styles.help}>{commitResult.creados} invitación(es) creada(s)</Text>
              {commitResult.omitidos > 0 ? <Text style={styles.help}>{commitResult.omitidos} ya tenían invitación pendiente (omitidas)</Text> : null}
              {commitResult.con_error > 0 ? <Text style={[styles.help, { color: colors.error }]}>{commitResult.con_error} con error (no se importaron)</Text> : null}
              <Pressable accessibilityRole="button" style={styles.primaryBtn} onPress={() => { reset(); onImported(); onClose(); }}>
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

function FilaBulk({ fila }: { fila: InvitationBulkRow }) {
  const color = ESTADO_COLOR[fila.estado] || colors.textMuted;
  return (
    <View style={[styles.filaCard, { borderLeftColor: color, borderLeftWidth: 4 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.filaNombre} numberOfLines={1}>
          {fila.name || `Fila ${fila.fila}`} {fila.role ? `— ${roleLabel(fila.role)}` : ''}
        </Text>
        <Text style={styles.filaDetalle} numberOfLines={1}>{fila.email}</Text>
        {fila.motivo ? <Text style={[styles.filaMotivo, { color }]}>{fila.motivo}</Text> : null}
      </View>
      <Text style={[styles.filaEstado, { color }]}>{ESTADO_LABEL[fila.estado] || fila.estado}</Text>
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
  title: { fontSize: 16, fontWeight: '800', color: colors.text },

  errorBox: { marginHorizontal: spacing.md, marginTop: spacing.sm },

  body: { padding: spacing.md, paddingBottom: 60 },
  stepCenter: { alignItems: 'center', gap: 12, paddingTop: 30 },
  help: { fontSize: 13, color: colors.textBody, textAlign: 'center' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 20,
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14, textAlign: 'center' },

  smallBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, alignItems: 'center' },
  smallBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },

  linkBtnCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkBtnTxt: { fontSize: 13, fontWeight: '700', color: colors.primary },

  resumenRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resumenChip: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', minWidth: 80 },
  resumenChipN: { fontSize: 16, fontWeight: '800' },
  resumenChipLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '700' },

  filaCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 10 },
  filaNombre: { fontSize: 13, fontWeight: '700', color: colors.text },
  filaDetalle: { fontSize: 11, color: colors.textMuted },
  filaMotivo: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  filaEstado: { fontSize: 11, fontWeight: '800' },

  resultTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
});
