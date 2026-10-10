// Sección "Programa de obra" (A-06): explica para qué sirve el programa desglosado,
// muestra la versión vigente y abre el importador desde Excel. Se inserta en
// Configuración del proyecto junto al importador del catálogo.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, ProgramaVersion } from '@/src/api';
import { ImportarProgramaModal } from '@/src/components/ImportarProgramaModal';
import { InlineError } from '@/src/components/InlineError';
import { t } from '@/src/i18n';
import { colors, radius } from '@/src/theme';
import { fmtFechaHora, ZonaProyecto } from '@/src/utils/fechas';
import { showToast } from '@/src/utils/toast';

interface Props {
  projectId: string;
  zona?: ZonaProyecto | null;
  /** Solo Coordinador General y Subcoordinador pueden importar (lo exige el servidor). */
  puedeImportar?: boolean;
  onImported?: () => void;
}

export function ProgramaObraSection({ projectId, zona, puedeImportar = true, onImported }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [versiones, setVersiones] = useState<ProgramaVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setError(null);
      setVersiones(await api.programaListVersiones(projectId));
    } catch {
      setVersiones([]);
      setError(t('programa.errorConsulta'));
    }
  }, [projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  const vigente = versiones?.find((v) => v.vigente) ?? null;

  return (
    <View style={styles.card}>
      <View style={styles.titulo}>
        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
        <Text style={styles.tituloTxt} accessibilityRole="header">{t('programa.seccionTitulo')}</Text>
      </View>
      <Text style={styles.ayuda}>{t('programa.seccionAyuda')}</Text>

      {versiones === null ? (
        <ActivityIndicator color={colors.primary} style={styles.cargando} />
      ) : vigente ? (
        <View style={styles.vigente} accessible accessibilityLabel={t('programa.versionVigente', { etiqueta: vigente.etiqueta })}>
          <Text style={styles.vigenteTitulo}>{t('programa.versionVigente', { etiqueta: vigente.etiqueta })}</Text>
          <Text style={styles.vigenteFecha}>{t('programa.versionFecha', { fecha: fmtFechaHora(vigente.fecha_importacion, zona) })}</Text>
        </View>
      ) : (
        <Text style={styles.sinVersion}>{t('programa.sinVersion')}</Text>
      )}

      <InlineError message={error} style={styles.error} />

      {puedeImportar ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('programa.importar')}
          style={styles.boton}
          onPress={() => setAbierto(true)}
        >
          <Ionicons name="cloud-upload-outline" size={18} color={colors.textInverse} />
          <Text style={styles.botonTxt}>{t('programa.importar')}</Text>
        </Pressable>
      ) : null}

      <ImportarProgramaModal
        visible={abierto}
        projectId={projectId}
        onClose={() => setAbierto(false)}
        onImported={() => {
          setAbierto(false);
          showToast(t('programa.importado'));
          cargar();
          onImported?.();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  titulo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tituloTxt: { fontSize: 15, fontWeight: '800', color: colors.text },
  ayuda: { fontSize: 13, color: colors.textBody, lineHeight: 18 },
  cargando: { alignSelf: 'flex-start' },
  vigente: { backgroundColor: colors.successBg, borderRadius: radius.md, padding: 10, gap: 2 },
  vigenteTitulo: { fontSize: 13, fontWeight: '700', color: colors.text },
  vigenteFecha: { fontSize: 12, color: colors.textBody },
  sinVersion: { fontSize: 13, color: colors.textMuted },
  error: { marginTop: 2 },
  boton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10,
  },
  botonTxt: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
});
