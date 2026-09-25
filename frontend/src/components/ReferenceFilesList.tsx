// Vista de solo lectura de "Archivos de consulta" de un proyecto. Reutiliza
// los mismos archivos que el Coordinador General sube desde el detalle del
// proyecto, para que todos los ingenieros de campo (Sub-coordinadores y
// Especialistas) tengan la misma base de consulta.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, Project, ReferenceFile } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { unir } from '@/src/utils/texto';

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReferenceFilesList({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      setError('Proyecto no especificado');
      return;
    }
    try {
      setError(null);
      const p = await api.getProject(projectId);
      setProject(p);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los archivos');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function onOpenFile(f: ReferenceFile) {
    try {
      if (f.file_id) {
        setOpeningId(f.file_id);
        const { blob, filename, mime } = await api.downloadProjectFile(
          projectId,
          f.file_id,
          f.original_name || f.name || 'archivo',
        );
        await downloadBlob(blob, filename, mime || f.mime_type);
      } else if (f.url) {
        await Linking.openURL(f.url);
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo abrir el archivo. Revisa tu conexión.');
    } finally {
      setOpeningId(null);
    }
  }

  const files = project?.reference_files || [];

  if (loading) {
    return (
      <View style={styles.centerPad}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error && !project) {
    return (
      <View style={styles.errorBox}>
        <Ionicons name="alert-circle-outline" size={22} color={colors.error} />
        <Text style={styles.errorTxt}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.help}>
        Documentos y planos compartidos por el Coordinador General para consulta de todo el equipo en campo.
      </Text>

      {error ? (
        <View style={styles.inlineError}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
          <Text style={styles.inlineErrorTxt}>{error}</Text>
        </View>
      ) : null}

      {files.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={22} color={colors.textMuted} />
          <Text style={styles.emptyTxt}>Aún no hay archivos compartidos.</Text>
        </View>
      ) : (
        files.map((f, idx) => {
          const key = f.file_id || `${f.url}-${idx}`;
          const opening = !!(f.file_id && openingId === f.file_id);
          const subtitle = f.file_id
            ? unir([f.original_name, formatBytes(f.size)])
            : f.url;
          return (
            <Pressable accessibilityRole="button"
              key={key}
              onPress={() => onOpenFile(f)}
              disabled={opening}
              style={({ pressed }) => [styles.fileCard, pressed && { opacity: 0.9 }]}
            >
              <View style={styles.fileIcon}>
                <Ionicons name={f.file_id ? 'document-attach-outline' : 'link-outline'} size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                {!!subtitle && <Text style={styles.fileSub} numberOfLines={1}>{subtitle}</Text>}
              </View>
              {opening ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name={f.file_id ? 'cloud-download-outline' : 'open-outline'} size={20} color={colors.primary} />
              )}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centerPad: { padding: spacing.xl, alignItems: 'center' },
  help: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.errorBg, padding: spacing.md, borderRadius: radius.md,
  },
  errorTxt: { flex: 1, color: colors.error, fontSize: 13, fontWeight: '600' },
  inlineError: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.errorBg, padding: spacing.sm, borderRadius: radius.sm,
  },
  inlineErrorTxt: { flex: 1, color: colors.error, fontSize: 12, fontWeight: '600' },
  empty: {
    alignItems: 'center', gap: 8, paddingVertical: spacing.xl,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  emptyTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  fileCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  fileIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  fileName: { fontSize: 14, fontWeight: '700', color: colors.text },
  fileSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
