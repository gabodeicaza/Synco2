// Menu desplegable (icono de 3 rayitas) compartido entre las pantallas de
// Inicio de Sub-coordinador y Especialista. Agrupa accesos que antes vivian
// sueltos en cada dashboard: Archivos de consulta, Fuerza de trabajo y
// Cerrar sesion.
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth-context';
import { api, ModulosConfig } from '@/src/api';
import { EliminarCuentaModal } from '@/src/components/EliminarCuentaModal';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';
import { modulosActivos } from '@/src/utils/modulos';

type HeaderMenuProps = {
  // Grupo de rutas desde el que se abre el menu, para navegar a la pantalla
  // correcta segun el rol (evita que el guard del layout redirija al usuario).
  basePath: '/(subcoord)' | '/(spec)';
  projectId?: string | null;
};

export function HeaderMenu({ basePath, projectId }: HeaderMenuProps) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [borrando, setBorrando] = useState(false);

  // Sistema Multi-Proyecto Modular: qué plantillas están encendidas para el
  // proyecto actual (ver src/utils/modulos.ts para el catálogo del lado del
  // cliente). Se resuelve al abrir el menú — no en cada render — para no
  // disparar un GET /projects/{pid} de más por cada vez que se pinta el
  // header. Si falla o el proyecto no tiene nada configurado, ningún módulo
  // piloto aparece (nunca se asume "encendido" por default).
  const [modulos, setModulos] = useState<ModulosConfig | null>(null);
  const [hayPersonalizados, setHayPersonalizados] = useState(false); // módulos del Creador de módulos
  const fetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !projectId) return;
    if (fetchedForRef.current === projectId) return;
    fetchedForRef.current = projectId;
    api.getProject(projectId)
      .then((p) => setModulos(p.modulos || null))
      .catch(() => setModulos(null));
    api.listCustomModules(projectId)
      .then((l) => setHayPersonalizados(l.length > 0))
      .catch(() => setHayPersonalizados(false));
  }, [open, projectId]);

  function goTo(
    screen: string,
    extraParams?: Record<string, string>,
  ) {
    setOpen(false);
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
          <View style={[styles.menuCard, { top: insets.top + 56, maxHeight: winH - insets.top - insets.bottom - 64 }]}>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            {/* Mensajes y Calendario vivian como tabs de la barra inferior
                (subcoord y spec); se movieron aqui para liberar espacio. */}
            <MenuItem icon="chatbubbles-outline" label="Mensajes" onPress={() => goTo('mensajes')} />
            <MenuItem icon="calendar-outline" label="Calendario" onPress={() => goTo('calendario')} />
            <MenuItem icon="folder-open-outline" label="Archivos de consulta" onPress={() => goTo('archivos-consulta')} />
            <MenuItem icon="people-outline" label="Fuerza de trabajo" onPress={() => goTo('fuerza-de-trabajo')} />
            <MenuItem icon="ribbon-outline" label="Capacidades de operadores" onPress={() => goTo('capacidades')} />
            {basePath === '/(subcoord)' ? (
              // Asistencia: derivada de los reportes (hora y ubicación), con
              // resúmenes semanal y mensual. Solo Sub-Coordinador (y el
              // Coordinador, desde su pantalla de proyecto).
              <MenuItem icon="checkbox-outline" label="Asistencia" onPress={() => goTo('asistencia')} />
            ) : null}

            {/* Catálogo de Conceptos: antes un acordeón con 3 sub-opciones
                aquí mismo (registrar avance, catálogo, visualizar avance);
                mismo motivo que Módulos/Actividades Generales — un botón
                único que lleva a su propio hub (ver
                CatalogoConceptosHubScreen.tsx). */}
            <MenuItem icon="albums-outline" label="Catálogo de Conceptos" onPress={() => goTo('catalogo-conceptos-hub')} />

            {/* Actividades Generales: vista curada de las actividades ya
                capturadas en reportes — Generales, o por Ubicación (fusiona
                los antiguos "Por Estación"/"Por Poste"). Antes un acordeón
                con 2 sub-opciones aquí mismo; la pantalla destino ya tiene
                sus propios tabs para cambiar entre ambas
                (ActividadesGeneralesScreen.tsx), así que un solo botón
                basta — entra directo a "Generales". */}
            <MenuItem icon="reader-outline" label="Actividades Generales" onPress={() => goTo('actividades-generales', { nivel: 'GENERAL' })} />

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

            {/* Sistema Multi-Proyecto Modular: con varios módulos encendidos
                a la vez, listarlos aquí mismo (aunque fuera en una sola
                sección plana) rompía el layout del dropdown — ver
                ModulosHubScreen.tsx. Ahora un solo botón lleva a una
                pantalla propia con la lista completa. Solo aparece si el
                Coordinador encendió AL MENOS un módulo para este proyecto
                (ver `modulos` en GET /projects/{pid} y src/utils/modulos.ts)
                — nunca se asume "encendido" por default. */}
            {modulosActivos(modulos).length > 0 || hayPersonalizados ? (
              <MenuItem icon="apps-outline" label="Módulos" onPress={() => goTo('modulos')} />
            ) : null}

            {basePath === '/(subcoord)' ? (
              // Orden, títulos y secciones ocultas del índice de los informes
              // PDF/PPTX (Diario, Semanal y Mensual). El backend lo permite a
              // Coordinador y Sub-Coordinador.
              <MenuItem icon="list-outline" label="Índice de informes" onPress={() => goTo('indice')} />
            ) : null}

            <View style={styles.divider} />
            {/* No pasa por goTo(): a diferencia del resto de items, no depende
                de projectId ni necesita esperar a que el proyecto cargue. */}
            <MenuItem
              icon="key-outline"
              label="Cambiar mi contraseña"
              onPress={() => { setOpen(false); router.push(`${basePath}/cambiar-password` as any); }}
            />
            <MenuItem icon="log-out-outline" label="Cerrar sesion" onPress={onLogout} destructive />
            <MenuItem icon="trash-outline" label="Eliminar mi cuenta" onPress={() => { setOpen(false); setBorrando(true); }} destructive />
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
      <EliminarCuentaModal visible={borrando} onClose={() => setBorrando(false)} />
    </>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.bg }]}
    >
      <Ionicons name={icon} size={18} color={destructive ? colors.error : colors.primary} />
      <Text style={[styles.menuItemTxt, destructive && { color: colors.error }]}>{label}</Text>
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
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  menuItemTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
});
