// Explicación previa al permiso de notificaciones (T-09). Antes la app lanzaba el
// diálogo del sistema al iniciar sesión, sin contexto. Ahora se explica para qué
// sirven los avisos y el diálogo del sistema solo aparece si la persona acepta.
// Se muestra una sola vez por dispositivo; después se puede cambiar en Perfil.
import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { useAuth } from '@/src/auth-context';
import { Button } from '@/src/components/Button';
import { t } from '@/src/i18n';
import { colors, radius, spacing } from '@/src/theme';
import { estadoNotificaciones, registerForPushNotificationsAsync } from '@/src/utils/pushNotifications';
import { storage } from '@/src/utils/storage';

export const CLAVE_AVISOS_VISTO = 'dirac_avisos_visto';

export function PedirNotificaciones() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user || Platform.OS === 'web') return;
    let vivo = true;
    (async () => {
      const visto = await storage.getItem<string>(CLAVE_AVISOS_VISTO, '');
      if (visto) return;
      const { estado, puedePreguntar } = await estadoNotificaciones();
      if (vivo && estado === 'sin_decidir' && puedePreguntar) setVisible(true);
    })();
    return () => { vivo = false; };
  }, [user?.id]);

  async function cerrar(activar: boolean) {
    setVisible(false);
    await storage.setItem(CLAVE_AVISOS_VISTO, '1');
    if (activar) await registerForPushNotificationsAsync({ pedirPermiso: true }).catch(() => null);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => cerrar(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.icono}>
            <Ionicons name="notifications-outline" size={28} color={colors.primary} />
          </View>
          <Text style={styles.titulo} accessibilityRole="header">{t('permisos.avisosTitulo')}</Text>
          <Text style={styles.cuerpo}>{t('permisos.avisosMensaje')}</Text>
          <View style={styles.acciones}>
            <Button label={t('permisos.avisosAhoraNo')} variant="secondary" onPress={() => cerrar(false)} style={{ flex: 1 }} />
            <Button label={t('permisos.avisosActivar')} onPress={() => cerrar(true)} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: 6 },
  icono: { alignSelf: 'center', width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  cuerpo: { fontSize: 13, color: colors.textMuted, lineHeight: 19, textAlign: 'center', marginBottom: spacing.sm },
  acciones: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
