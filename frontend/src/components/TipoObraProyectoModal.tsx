// Cambiar el tipo de obra de un proyecto existente (K-13 / T-10), solo para el Coordinador General.
// Cambiar el tipo NO reescribe los módulos ni las etapas ya configurados: solo cambia lo que se ofrece
// por defecto a futuro. "Aplicar módulos recomendados" es una acción aparte y con confirmación.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, Project } from '@/src/api';
import { InlineError } from '@/src/components/InlineError';
import { SelectorTipoObra } from '@/src/components/SelectorTipoObra';
import { useEnvio } from '@/src/hooks/useEnvio';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { a11y, t } from '@/src/i18n';
import { colors, radius, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { showToast } from '@/src/utils/toast';
import { esTipoElegible, moduloPayloadRecomendado, TipoObraElegible } from '@/src/utils/tipoObraModulos';

export function TipoObraProyectoModal({
  visible, project, onClose, onProjectUpdated,
}: {
  visible: boolean;
  project: Project | null;
  onClose: () => void;
  onProjectUpdated: (proyecto: Project) => void;
}) {
  const [elegido, setElegido] = useState<TipoObraElegible | null>(null);
  const { guardando, ejecutar } = useEnvio();
  const { errorGeneral, errorDeGuardado, limpiarTodo, setErrorGeneral } = useFormErrors();

  useEffect(() => {
    if (!visible) return;
    setElegido(esTipoElegible(project?.tipo_obra) ? project!.tipo_obra as TipoObraElegible : null);
    limpiarTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, project?.id]);

  const actual = project?.tipo_obra;
  const hayCambio = !!elegido && elegido !== actual;

  async function guardar() {
    if (!project) return;
    if (!elegido) { setErrorGeneral(t('proyectoPantalla.tipoObraSinElegir')); return; }
    await ejecutar(async () => {
      try {
        const upd = await api.updateProject(project.id, { tipo_obra: elegido });
        onProjectUpdated(upd);
        showToast(t('proyectoPantalla.tipoObraActualizado'));
        onClose();
      } catch (e) {
        errorDeGuardado(e, t('proyectoPantalla.tipoObraNoSePudoGuardar'));
      }
    });
  }

  async function aplicarModulos() {
    if (!project) return;
    if (!elegido) { setErrorGeneral(t('proyectoPantalla.tipoObraSinElegir')); return; }
    await ejecutar(async () => {
      try {
        const catalogo = await api.listTiposObra();
        const info = catalogo.find((x) => x.id === elegido);
        if (!info) { setErrorGeneral(t('proyectoPantalla.tipoObraNoCatalogo')); return; }
        const ok = await confirm(
          t('modulosObra.restablecerTitulo'),
          t('modulosObra.restablecerMensaje', { tipo: info.nombre }),
          { confirmText: t('modulosObra.restablecerConfirmar') },
        );
        if (!ok) return;
        const upd = await api.setProjectModulos(project.id, moduloPayloadRecomendado(info));
        onProjectUpdated(upd);
        showToast(t('modulosObra.restablecido'));
      } catch (e) {
        errorDeGuardado(e, t('modulosObra.noSePudoRestablecer'));
      }
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.titulo}>{t('tipoObra.titulo')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} style={styles.cerrar}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.lg }}>
            <Text style={styles.ayuda}>{t('proyectoPantalla.tipoObraModalAyuda')}</Text>
            <SelectorTipoObra value={elegido as TipoObraElegible} onChange={(x) => { setElegido(x); setErrorGeneral(null); }} disabled={guardando} />
            <InlineError message={errorGeneral} style={{ marginTop: spacing.sm }} />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('proyectoPantalla.tipoObraGuardar')}
              accessibilityState={{ disabled: !hayCambio || guardando, busy: guardando }}
              disabled={!hayCambio || guardando}
              onPress={guardar}
              style={[styles.primario, (!hayCambio || guardando) && styles.inactivo]}
            >
              {guardando ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primarioTxt}>{t('proyectoPantalla.tipoObraGuardar')}</Text>}
            </Pressable>

            <Text style={styles.ayuda}>{t('proyectoPantalla.aplicarModulosAyuda')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('proyectoPantalla.aplicarModulos')}
              accessibilityState={{ disabled: !elegido || guardando }}
              disabled={!elegido || guardando}
              onPress={aplicarModulos}
              style={[styles.secundario, (!elegido || guardando) && styles.inactivo]}
            >
              <Ionicons name="refresh" size={16} color={colors.primary} />
              <Text style={styles.secundarioTxt}>{t('proyectoPantalla.aplicarModulos')}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.md, maxHeight: '90%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  titulo: { fontSize: 18, fontWeight: '800', color: colors.text },
  cerrar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ayuda: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm },
  primario: {
    minHeight: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center',
    justifyContent: 'center', marginTop: spacing.md,
  },
  primarioTxt: { color: colors.textInverse, fontWeight: '800', fontSize: 15 },
  secundario: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
  },
  secundarioTxt: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  inactivo: { opacity: 0.5 },
});
