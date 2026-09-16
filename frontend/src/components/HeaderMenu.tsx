// Menu desplegable (icono de 3 rayitas) compartido entre las pantallas de
// Inicio de Sub-coordinador y Especialista. Agrupa accesos que antes vivian
// sueltos en cada dashboard: Archivos de consulta, Fuerza de trabajo y
// Cerrar sesion.
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth-context';
import { api, ModulosConfig } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { modulosActivosPorArea } from '@/src/utils/modulos';

type HeaderMenuProps = {
  // Grupo de rutas desde el que se abre el menu, para navegar a la pantalla
  // correcta segun el rol (evita que el guard del layout redirija al usuario).
  basePath: '/(subcoord)' | '/(spec)';
  projectId?: string | null;
};

export function HeaderMenu({ basePath, projectId }: HeaderMenuProps) {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  // Acordeon del grupo "Catalogo de Conceptos" (3 sub-opciones) dentro del
  // mismo Modal — evita un segundo Modal anidado solo para agrupar items.
  const [catalogoOpen, setCatalogoOpen] = useState(false);
  const [actividadesOpen, setActividadesOpen] = useState(false);

  // Sistema Multi-Proyecto Modular: qué plantillas están encendidas para el
  // proyecto actual (ver src/utils/modulos.ts para el catálogo del lado del
  // cliente). Se resuelve al abrir el menú — no en cada render — para no
  // disparar un GET /projects/{pid} de más por cada vez que se pinta el
  // header. Si falla o el proyecto no tiene nada configurado, ningún módulo
  // piloto aparece (nunca se asume "encendido" por default).
  const [modulos, setModulos] = useState<ModulosConfig | null>(null);
  const fetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !projectId) return;
    if (fetchedForRef.current === projectId) return;
    fetchedForRef.current = projectId;
    api.getProject(projectId)
      .then((p) => setModulos(p.modulos || null))
      .catch(() => setModulos(null));
  }, [open, projectId]);

  function goTo(
    screen: string,
    extraParams?: Record<string, string>,
  ) {
    setOpen(false);
    setCatalogoOpen(false);
    setActividadesOpen(false);
    // Estas pantallas necesitan project_id para cargar (algunas, como
    // Acceso al Predio, se quedan en blanco sin él) — si el dashboard
    // todavía no terminó de cargar los proyectos, `projectId` llega null
    // y antes se navegaba igual a una pantalla rota. Mejor avisar y no
    // navegar, que dejar al usuario en una pantalla sin logo ni datos.
    if (!projectId) {
      Alert.alert('Un momento', 'El proyecto todavía se está cargando. Intenta de nuevo en unos segundos.');
      return;
    }
    router.push({
      pathname: `${basePath}/${screen}` as any,
      params: { project_id: projectId, ...(extraParams || {}) },
    });
  }

  async function onLogout() {
    setOpen(false);
    const ok = await confirm('Cerrar sesion', '¿Seguro que deseas salir?', {
      confirmText: 'Salir',
      destructive: true,
    });
    if (!ok) return;
    await logout();
    router.replace('/(auth)/login');
  }

  return (
    <>
      <Pressable hitSlop={10} style={styles.headerBtn} onPress={() => setOpen(true)} accessibilityLabel="Abrir menu">
        <Ionicons name="menu" size={22} color="#fff" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={[styles.menuCard, { top: insets.top + 56 }]}>
            {/* Mensajes y Calendario vivian como tabs de la barra inferior
                (subcoord y spec); se movieron aqui para liberar espacio. */}
            <MenuItem icon="chatbubbles-outline" label="Mensajes" onPress={() => goTo('mensajes')} />
            <MenuItem icon="calendar-outline" label="Calendario" onPress={() => goTo('calendario')} />
            <MenuItem icon="folder-open-outline" label="Archivos de consulta" onPress={() => goTo('archivos-consulta')} />
            <MenuItem icon="people-outline" label="Fuerza de trabajo" onPress={() => goTo('fuerza-de-trabajo')} />

            {/* Grupo "Catalogo de Conceptos": 3 sub-opciones (registrar avance
                es de uso diario/alta frecuencia, catalogo es consulta y
                administracion, visualizar avance es reporte por periodo). */}
            <MenuItem
              icon="albums-outline"
              label="Catálogo de Conceptos"
              onPress={() => setCatalogoOpen((v) => !v)}
              trailingIcon={catalogoOpen ? 'chevron-up' : 'chevron-down'}
            />
            {catalogoOpen ? (
              <View style={styles.submenu}>
                <MenuItem icon="create-outline" label="Registrar avance" onPress={() => goTo('registrar-avance')} indented />
                <MenuItem icon="list-outline" label="Catálogo de conceptos" onPress={() => goTo('catalogo-conceptos')} indented />
                <MenuItem icon="bar-chart-outline" label="Visualizar avance" onPress={() => goTo('visualizar-avance')} indented />
              </View>
            ) : null}

            {/* Grupo "Actividades Generales": vista curada de las actividades
                ya capturadas en reportes — Generales, o por Ubicación
                (fusiona los antiguos "Por Estación"/"Por Poste", ver
                ActividadesGeneralesScreen.tsx). */}
            <MenuItem
              icon="reader-outline"
              label="Actividades Generales"
              onPress={() => setActividadesOpen((v) => !v)}
              trailingIcon={actividadesOpen ? 'chevron-up' : 'chevron-down'}
            />
            {actividadesOpen ? (
              <View style={styles.submenu}>
                <MenuItem icon="globe-outline" label="Generales" onPress={() => goTo('actividades-generales', { nivel: 'GENERAL' })} indented />
                <MenuItem icon="location-outline" label="Por Ubicación" onPress={() => goTo('actividades-generales', { nivel: 'NODO' })} indented />
              </View>
            ) : null}

            {/* Vista ejecutiva de costo/tiempo (Valor Ganado) — no es una
                captura de campo, por eso vive suelto y no dentro del grupo
                "Catálogo de Conceptos". Ver src/components/DashboardEVM.tsx. */}
            <MenuItem icon="stats-chart-outline" label="Dashboard EVM" onPress={() => goTo('dashboard-evm')} />

            {/* Plano de Avance y Presentación — siempre visibles (como
                Dashboard EVM), no pasan por el toggle de módulos por
                proyecto (ver PlanoAvanceScreen.tsx / PresentacionScreen.tsx). */}
            <MenuItem icon="map-outline" label="Plano de Avance" onPress={() => goTo('plano-avance')} />
            <MenuItem icon="easel-outline" label="Presentación" onPress={() => goTo('presentacion')} />

            {basePath === '/(subcoord)' ? (
              // Edita acceso_predio/situacion_social por Subtramo — el backend
              // (PATCH /nodes) solo permite escribir estos campos a Coordinador
              // y Sub-Coordinador, por eso no se ofrece a Especialista.
              <MenuItem icon="shield-checkmark-outline" label="Acceso al Predio" onPress={() => goTo('acceso-predio')} />
            ) : null}

            {/* Sistema Multi-Proyecto Modular: solo aparecen los módulos que
                el Coordinador encendió para ESTE proyecto (ver `modulos` en
                GET /projects/{pid} y src/utils/modulos.ts), agrupados por
                área temática (Ambiental, Seguridad...) — NO por cadencia de
                captura, esa clasificación es solo interna/de la pantalla de
                configuración del Coordinador. Si `modulos` aún no cargó o el
                proyecto no tiene nada activo, esta sección no pinta nada —
                nunca se asume "encendido" por default. */}
            {modulosActivosPorArea(modulos).map(({ area, modulos: activos }) => (
              <View key={area}>
                <Text style={styles.groupLabel}>{area}</Text>
                {activos.map((m) => (
                  <MenuItem key={m.key} icon={m.icon} label={m.label} onPress={() => goTo(m.screen)} />
                ))}
              </View>
            ))}

            <View style={styles.divider} />
            {/* No pasa por goTo(): a diferencia del resto de items, no depende
                de projectId ni necesita esperar a que el proyecto cargue. */}
            <MenuItem
              icon="key-outline"
              label="Cambiar mi contraseña"
              onPress={() => { setOpen(false); router.push(`${basePath}/cambiar-password` as any); }}
            />
            <MenuItem icon="log-out-outline" label="Cerrar sesion" onPress={onLogout} destructive />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  destructive,
  trailingIcon,
  indented,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  indented?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, indented && styles.menuItemIndented, pressed && { backgroundColor: colors.bg }]}
    >
      <Ionicons name={icon} size={indented ? 16 : 19} color={destructive ? colors.error : colors.primary} />
      <Text style={[styles.menuItemTxt, indented && styles.menuItemTxtIndented, destructive && { color: colors.error }]}>{label}</Text>
      {trailingIcon ? (
        <Ionicons name={trailingIcon} size={16} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
  },
  menuCard: {
    position: 'absolute',
    left: spacing.md,
    width: 240,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  menuItemTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  submenu: {
    backgroundColor: colors.bg,
  },
  menuItemIndented: {
    paddingLeft: spacing.md + 20,
    paddingVertical: 10,
  },
  menuItemTxtIndented: {
    fontSize: 13,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: 2,
  },
});
