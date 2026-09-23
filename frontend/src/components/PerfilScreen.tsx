// Perfil compartido por los tres roles (coord / subcoord / spec): datos de la
// cuenta, "Acerca de" (versión, soporte, notificaciones, enlaces legales),
// cerrar sesión y eliminar cuenta (requisito de Google Play y App Store).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/src/auth-context';
import { Button } from '@/src/components/Button';
import { EliminarCuentaModal } from '@/src/components/EliminarCuentaModal';
import { t } from '@/src/i18n';
import { colors, radius, spacing } from '@/src/theme';
import { SOPORTE_EMAIL, urlLegal, versionApp, PaginaLegal } from '@/src/utils/appInfo';
import { confirm } from '@/src/utils/confirm';
import { roleLabel } from '@/src/utils/roles';
import { showToast } from '@/src/utils/toast';

type BasePath = '/(coord)' | '/(subcoord)' | '/(spec)';

export function PerfilScreen({ basePath }: { basePath: BasePath }) {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [borrando, setBorrando] = useState(false);
  const [notif, setNotif] = useState<'activas' | 'inactivas' | 'desconocidas'>('desconocidas');
  const { version, build } = versionApp();

  useEffect(() => {
    let vivo = true;
    Notifications.getPermissionsAsync()
      .then((p) => { if (vivo) setNotif(p.granted ? 'activas' : p.status === 'undetermined' ? 'desconocidas' : 'inactivas'); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  async function onLogout() {
    const ok = await confirm(t('perfil.cerrarSesion'), t('perfil.cerrarSesionPregunta'), {
      confirmText: t('perfil.salir'),
      destructive: true,
    });
    if (!ok) return;
    await logout();
    router.replace('/(auth)/login');
  }

  async function abrir(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      showToast(t('acercaDe.abrirEnlaceFallo'));
    }
  }

  const abrirLegal = (p: PaginaLegal) => abrir(urlLegal(p));
  const esCoordGeneral = user?.role === 'coordinador_general';
  const notifTexto =
    notif === 'activas' ? t('acercaDe.notificacionesActivas')
    : notif === 'inactivas' ? t('acercaDe.notificacionesInactivas')
    : t('acercaDe.notificacionesDesconocidas');

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={t('perfil.volver')}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">{t('perfil.titulo')}</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.profileCard}>
          <View style={styles.bigAvatar}>
            <Text style={styles.bigAvatarText}>{(user?.name?.[0] || 'D').toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.roleBadge}>
            <Ionicons name="shield-checkmark" size={14} color={colors.primary} />
            <Text style={styles.roleBadgeText}>{roleLabel(user?.role, user?.area)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>{t('perfil.cuenta')}</Text>
          <Row icon="mail-outline" label={t('perfil.correo')} value={user?.email || '—'} />
          <Row icon="shield-outline" label={t('perfil.rol')} value={roleLabel(user?.role)} />
          <Row
            icon="folder-outline"
            label={t('perfil.proyectosAccesibles')}
            value={esCoordGeneral ? t('perfil.accesoTodosProyectos') : String(user?.project_ids?.length ?? 0)}
          />
        </View>

        {esCoordGeneral && (
          <ActionTile
            icon="people"
            title="Coordinadores Generales"
            sub="Crea y consulta a los Coord. Generales con gobernanza global"
            onPress={() => router.push('/(coord)/coordinators')}
          />
        )}
        {esCoordGeneral && (
          <ActionTile
            icon="mail-unread"
            title="Solicitudes de contraseña"
            sub="Respaldo administrativo: usuarios que piden una contraseña nueva"
            onPress={() => router.push('/(coord)/password-resets')}
          />
        )}
        {esCoordGeneral && (
          <ActionTile
            icon="list"
            title="Plantillas de reporte"
            sub={'Crea y edita los formularios dinámicos de "Tipo de reporte"'}
            onPress={() => router.push('/(coord)/report-templates')}
          />
        )}
        <ActionTile
          icon="key"
          title={t('perfil.cambiarPassword')}
          sub={t('perfil.cambiarPasswordDescripcion')}
          onPress={() => router.push(`${basePath}/cambiar-password` as any)}
        />

        <View style={styles.card}>
          <Text style={styles.cardLabel}>{t('acercaDe.titulo')}</Text>
          <Row icon="information-circle-outline" label={t('acercaDe.version')} value={version} />
          <Row icon="construct-outline" label={t('acercaDe.build')} value={build} />
          <LinkRow
            icon="help-buoy-outline"
            label={t('acercaDe.soporte')}
            value={SOPORTE_EMAIL}
            accesible={t('acercaDe.escribirSoporte')}
            onPress={() => abrir(`mailto:${SOPORTE_EMAIL}`)}
          />
          <LinkRow
            icon="notifications-outline"
            label={t('acercaDe.notificaciones')}
            value={notifTexto}
            onPress={() => Linking.openSettings().catch(() => showToast(t('acercaDe.abrirEnlaceFallo')))}
          />
          <LinkRow
            icon="document-text-outline"
            label={t('acercaDe.privacidad')}
            value=""
            onPress={() => abrirLegal('privacidad')}
          />
          <LinkRow
            icon="reader-outline"
            label={t('acercaDe.terminos')}
            value=""
            onPress={() => abrirLegal('terminos')}
          />
        </View>

        <Button label={t('perfil.cerrarSesion')} variant="danger" onPress={onLogout} fullWidth />

        <Pressable
          onPress={() => setBorrando(true)}
          style={({ pressed }) => [styles.deleteTile, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={t('cuenta.eliminar')}
          accessibilityHint={t('cuenta.eliminarDescripcion')}
        >
          <Ionicons name="trash-outline" size={20} color={colors.error} />
          <View style={{ flex: 1 }}>
            <Text style={styles.deleteTitle}>{t('cuenta.eliminar')}</Text>
            <Text style={styles.actionSub}>{t('cuenta.eliminarDescripcion')}</Text>
          </View>
        </Pressable>
      </ScrollView>

      <EliminarCuentaModal visible={borrando} onClose={() => setBorrando(false)} />
    </View>
  );
}

function Row({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

function LinkRow({
  icon, label, value, onPress, accesible,
}: { icon: any; label: string; value: string; onPress: () => void; accesible?: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.linkRow, pressed && { opacity: 0.7 }]}
      accessibilityRole="link"
      accessibilityLabel={accesible || (value ? `${label}. ${value}` : label)}
    >
      <Ionicons name={icon} size={18} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowValue}>{label}</Text>
        {value ? <Text style={styles.rowLabel}>{value}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function ActionTile({ icon, title, sub, onPress }: { icon: any; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionTile, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={sub}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },
  profileCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: 6, borderWidth: 1, borderColor: colors.border },
  bigAvatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  bigAvatarText: { color: colors.textInverse, fontWeight: '900', fontSize: 32 },
  name: { fontSize: 19, fontWeight: '900', color: colors.text, marginTop: 8 },
  email: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primaryLight, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, marginTop: 8 },
  roleBadgeText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  cardLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  linkRow: { minHeight: 44 },
  rowLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },
  rowValue: { fontSize: 14, color: colors.text, fontWeight: '700' },
  actionTile: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  actionIcon: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  actionTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  actionSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  deleteTile: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44,
    borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.error,
  },
  deleteTitle: { fontSize: 14, fontWeight: '800', color: colors.error },
});
