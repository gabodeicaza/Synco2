// Crear un nodo del catálogo (partida) con error en línea por campo, sin dobles envíos
// y con validación de clave y nombre repetidos (X-03, K-07, K-08, K-09).
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, Partida, Project } from '@/src/api';
import { Button } from '@/src/components/Button';
import { FormField } from '@/src/components/FormField';
import { InlineError } from '@/src/components/InlineError';
import { useEnvio } from '@/src/hooks/useEnvio';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { t } from '@/src/i18n';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { concordanciaNivel } from '@/src/utils/nombresNivel';
import { showToast } from '@/src/utils/toast';
import { CampoPartida, validarNuevaPartida } from '@/src/utils/validacionCatalogo';

interface Props {
  visible: boolean;
  project: Project | null;
  depth: number;
  projectId: string;
  ordenSugerido: number;
  partidaPadreId: string | null;
  partidaPadreNombre: string | null;
  /** Partidas del nivel donde se crea (para no repetir nombres entre hermanas). */
  hermanas: Partida[];
  /** Todas las partidas del proyecto (para no repetir claves). */
  todas: Partida[];
  onClose: () => void;
  onCreada: () => void;
}

export function NuevaPartidaModal({
  visible, project, depth, projectId, ordenSugerido, partidaPadreId, partidaPadreNombre, hermanas, todas, onClose, onCreada,
}: Props) {
  const conc = concordanciaNivel(project, depth);
  const nivel = conc.nombre;
  const [clave, setClave] = useState('');
  const [nombre, setNombre] = useState('');
  const [contrato, setContrato] = useState<'obra' | 'supervision'>('obra');
  const { errores, errorGeneral, ponerTodos, alCambiar, errorDeGuardado, limpiarTodo } = useFormErrors<CampoPartida>();
  const { guardando, ejecutar } = useEnvio();

  useEffect(() => {
    if (visible) { setClave(''); setNombre(''); setContrato('obra'); limpiarTodo(); }
  }, [visible, limpiarTodo]);

  async function crear() {
    await ejecutar(async () => {
      if (ponerTodos(validarNuevaPartida({ clave, nombre }, hermanas, todas))) return;
      try {
        await api.createPartida({
          project_id: projectId, clave: clave.trim(), nombre: nombre.trim(), orden: ordenSugerido,
          partida_padre_id: partidaPadreId || undefined,
          // Solo las partidas raíz definen el contrato; las hijas lo heredan.
          contrato: partidaPadreId ? undefined : contrato,
        });
        showToast(t('catalogoForm.partidaCreada', { nivel, creado: conc.creado }));
        onCreada();
      } catch (e) {
        errorDeGuardado(e);
      }
    });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !guardando && onClose()}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">{t('catalogoForm.nuevaPartida', { nuevo: conc.nuevo, nivel: conc.minuscula })}</Text>
          <Text style={styles.padre}>
            {partidaPadreNombre
              ? t('catalogoForm.seCreaDentroDe', { padre: partidaPadreNombre })
              : t('catalogoForm.seCreaEnLaRaiz')}
          </Text>
          <FormField
            label={t('catalogoForm.clave')}
            value={clave}
            onChangeText={alCambiar<string>('clave', setClave)}
            error={errores.clave}
            placeholder={t('catalogoForm.claveEjemplo')}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!guardando}
            obligatorio
          />
          <FormField
            label={t('catalogoForm.nombre')}
            value={nombre}
            onChangeText={alCambiar<string>('nombre', setNombre)}
            error={errores.nombre}
            editable={!guardando}
            returnKeyType="done"
            onSubmitEditing={crear}
            obligatorio
          />
          {!partidaPadreId ? (
            <>
              <Text style={styles.contratoLabel}>Contrato</Text>
              <View style={styles.contratoRow}>
                {(['obra', 'supervision'] as const).map((c) => (
                  <Pressable
                    key={c}
                    accessibilityRole="button"
                    onPress={() => setContrato(c)}
                    disabled={guardando}
                    style={[styles.contratoChip, contrato === c && styles.contratoChipOn]}
                  >
                    <Text style={[styles.contratoChipTxt, contrato === c && { color: '#fff' }]}>
                      {c === 'obra' ? 'Obra' : 'Supervisión'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          <InlineError message={errorGeneral} style={styles.errorGeneral} />
          <View style={styles.botones}>
            <Button label={t('catalogoForm.cancelar')} variant="secondary" onPress={onClose} disabled={guardando} style={styles.boton} />
            <Button label={t('catalogoForm.crear')} onPress={crear} loading={guardando} style={styles.boton} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.lg },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 4 },
  padre: { fontSize: 12, color: colors.textMuted, marginBottom: 4, fontStyle: 'italic' },
  errorGeneral: { marginTop: 10 },
  contratoLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 10, marginBottom: 6 },
  contratoRow: { flexDirection: 'row', gap: 8 },
  contratoChip: {
    minHeight: 44, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  contratoChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  contratoChipTxt: { fontSize: 13, fontWeight: '700', color: colors.text },
  botones: { flexDirection: 'row', gap: 10, marginTop: 16 },
  boton: { flex: 1 },
});
