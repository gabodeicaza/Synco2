// Formulario "Registrar gasto real (AC)" (X-03, A-07/X-05, K-08, K-09, A-08).
// Fecha libre (para capturar un gasto de un mes anterior), monto con el separador decimal
// del proyecto, errores en línea por campo, toast solo para errores de red y candado contra
// doble envío. NUNCA se bloquea un gasto porque supere el presupuesto: el sobrecosto se
// muestra en el tablero (EAC/ETC/VAC).
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, Project } from '@/src/api';
import { Button } from '@/src/components/Button';
import { FormField } from '@/src/components/FormField';
import { InlineError } from '@/src/components/InlineError';
import { useEnvio } from '@/src/hooks/useEnvio';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { t } from '@/src/i18n';
import { colors, radius, spacing } from '@/src/theme';
import { hoyProyecto } from '@/src/utils/fechas';
import { DECIMALES_IMPORTE, SeparadorDecimal } from '@/src/utils/numeros';
import { showToast } from '@/src/utils/toast';
import { validarGasto } from '@/src/utils/validacionGasto';

type Campo = 'fecha' | 'monto' | 'descripcion' | 'clave';

export function GastoRealForm({
  visible, projectId, onClose, onSaved,
}: {
  visible: boolean;
  projectId: string;
  onClose: () => void;
  /** Se llama tras guardar con éxito (el formulario ya quedó limpio). */
  onSaved: () => void | Promise<void>;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [fecha, setFecha] = useState(() => hoyProyecto());
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [clave, setClave] = useState('');
  const { errores, errorGeneral, poner, ponerTodos, limpiarTodo, alCambiar, errorDeGuardado } = useFormErrors<Campo>();
  const { guardando, ejecutar } = useEnvio();

  const separador: SeparadorDecimal = project?.separador_decimal === ',' ? ',' : '.';

  function reiniciar(zona?: Project | null) {
    setFecha(hoyProyecto(zona ?? project));
    setMonto('');
    setDescripcion('');
    setClave('');
    limpiarTodo();
  }

  useEffect(() => {
    if (!visible) return;
    reiniciar();
    let vivo = true;
    api.getProject(projectId)
      .then((p) => {
        if (!vivo) return;
        setProject(p);
        setFecha((actual) => (actual === hoyProyecto() ? hoyProyecto(p) : actual));
      })
      .catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, projectId]);

  async function guardar() {
    await ejecutar(async () => {
      const { errores: e, monto: montoOk } = validarGasto({ fecha, monto, descripcion, separador });
      if (ponerTodos(e) || !montoOk) return;
      try {
        await api.createGastoReal(projectId, {
          fecha: fecha.trim(),
          monto: montoOk,
          concepto_texto: descripcion.trim(),
          concepto_clave: clave.trim() || undefined,
        });
      } catch (err: any) {
        // 404: la clave escrita no existe en el catálogo; el aviso va junto a ese campo.
        if (err?.status === 404 && clave.trim()) poner('clave', err.message);
        else errorDeGuardado(err);
        return;
      }
      reiniciar();
      showToast(t('gasto.registrado'));
      await onSaved();
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title} accessibilityRole="header">{t('gasto.titulo')}</Text>

            <FormField
              label={t('gasto.fecha')} ayuda={t('gasto.fechaAyuda')} obligatorio
              value={fecha} onChangeText={alCambiar('fecha', setFecha)} error={errores.fecha}
              placeholder="2026-02-15" editable={!guardando} autoCorrect={false}
            />
            <FormField
              label={t('gasto.monto')} obligatorio
              value={monto} onChangeText={alCambiar('monto', setMonto)} error={errores.monto}
              numero={{ separador, maxDecimales: DECIMALES_IMPORTE, minDecimales: DECIMALES_IMPORTE }}
              placeholder={t('gasto.montoPlaceholder')} editable={!guardando}
            />
            <FormField
              label={t('gasto.descripcion')} obligatorio
              value={descripcion} onChangeText={alCambiar('descripcion', setDescripcion)} error={errores.descripcion}
              placeholder={t('gasto.descripcionPlaceholder')} editable={!guardando}
            />
            <FormField
              label={t('gasto.clave')}
              value={clave} onChangeText={alCambiar('clave', setClave)} error={errores.clave}
              placeholder={t('gasto.clavePlaceholder')} autoCapitalize="characters" autoCorrect={false}
              editable={!guardando} returnKeyType="done" onSubmitEditing={guardar}
            />

            <InlineError message={errorGeneral} style={{ marginTop: spacing.sm }} />

            <View style={styles.acciones}>
              <Button label={t('gasto.cancelar')} variant="secondary" onPress={onClose} disabled={guardando} style={{ flex: 1 }} />
              <Button label={t('gasto.guardar')} loading={guardando} onPress={guardar} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, maxHeight: '90%',
  },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  acciones: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
});
