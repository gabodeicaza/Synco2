// Dirac · Layout del Especialista con Bottom Tabs.
// Replica el patron de la imagen objetivo: Noticias _ Inicio _ Nuevo _ Mensajes _ Calendario.
import React, { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import { ROLE_ESP } from '@/src/utils/roles';
import { colors, radius } from '@/src/theme';
import OfflineQueueIndicator from '@/src/components/OfflineQueueIndicator';

export default function SpecLayout() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/(auth)/login'); return; }
    if (user.role !== ROLE_ESP) {
      if (user.role === 'coordinador_general' || user.role === 'jefe_proyecto') {
        router.replace('/(coord)');
      } else {
        router.replace('/(subcoord)');
      }
    }
  }, [user, loading]);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          // G-07: pestañas perezosas y las inactivas congeladas; los polls corren solo con foco.
          lazy: true,
          freezeOnBlur: true,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: [
            styles.tabBar,
            { height: 60 + (insets.bottom > 0 ? insets.bottom : 8), paddingBottom: insets.bottom > 0 ? insets.bottom : 8 },
          ],
          tabBarLabelStyle: styles.tabLabel,
          tabBarItemStyle: { paddingVertical: 4 },
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen
          name="noticias"
          options={{
            title: 'Noticias',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="newspaper-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: 'Inicio',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="nuevo"
          options={{
            title: 'Nuevo',
            tabBarIcon: ({ focused }) => (
              <View style={[styles.fab, focused && styles.fabActive]}>
                <Ionicons name="add" size={26} color={colors.textInverse} />
              </View>
            ),
            tabBarLabelStyle: [styles.tabLabel, { marginTop: 2 }],
          }}
        />
        <Tabs.Screen
          name="minutas"
          options={{
            title: 'Minutas',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="clipboard-outline" size={size} color={color} />
            ),
          }}
        />
        {/* Fuerza de Trabajo y Archivos de consulta _ alcanzables via router.push (menu), sin tab visible. */}
        <Tabs.Screen name="fuerza-de-trabajo" options={{ href: null }} />
        <Tabs.Screen name="archivos-consulta" options={{ href: null }} />
        {/* Mensajes y Calendario se movieron al menu hamburgues (HeaderMenu) _
            siguen alcanzables via router.push, ya no ocupan tab visible. */}
        <Tabs.Screen name="mensajes" options={{ href: null }} />
        <Tabs.Screen name="calendario" options={{ href: null }} />
        {/* Catalogo de Conceptos: hub (menu hamburgues) + sus 3 pantallas destino, sin tab visible. */}
        <Tabs.Screen name="catalogo-conceptos-hub" options={{ href: null }} />
        <Tabs.Screen name="catalogo-conceptos" options={{ href: null }} />
        <Tabs.Screen name="registrar-avance" options={{ href: null }} />
        <Tabs.Screen name="visualizar-avance" options={{ href: null }} />
        {/* Actividades Generales (grupo de 3 opciones del menu hamburgues), sin tab visible. */}
        <Tabs.Screen name="actividades-generales" options={{ href: null }} />
        {/* Dashboard EVM (Valor Ganado) _ alcanzable via router.push (menu hamburgues), sin tab visible. */}
        <Tabs.Screen name="dashboard-evm" options={{ href: null }} />
        {/* Sistema Multi-Proyecto Modular: plantillas piloto, alcanzables
            solo via router.push desde el menu hamburgues (HeaderMenu),
            nunca como tab fijo. */}
        <Tabs.Screen name="forestal-arbolado" options={{ href: null }} />
        <Tabs.Screen name="seguridad-higiene" options={{ href: null }} />
        <Tabs.Screen name="gestion-riesgos" options={{ href: null }} />
        <Tabs.Screen name="estudios-proyecto" options={{ href: null }} />
        <Tabs.Screen name="impacto-ambiental" options={{ href: null }} />
        <Tabs.Screen name="tabla-resumen" options={{ href: null }} />
        <Tabs.Screen name="estado-tiempo" options={{ href: null }} />
        <Tabs.Screen name="control-obra" options={{ href: null }} />
        {/* Hub de módulos activos — alcanzable via router.push (menu hamburgues), sin tab visible. */}
        <Tabs.Screen name="modulos" options={{ href: null }} />
        {/* Plano de Avance y Presentación — siempre visibles (como
            Dashboard EVM), no pasan por el toggle de módulos por proyecto. */}
        <Tabs.Screen name="plano-avance" options={{ href: null }} />
        <Tabs.Screen name="presentacion" options={{ href: null }} />
        <Tabs.Screen name="presentacion-preview" options={{ href: null }} />
        {/* Cambiar mi contraseña — alcanzable via router.push (menu hamburgues), sin tab visible. */}
        <Tabs.Screen name="cambiar-password" options={{ href: null }} />
        {/* Mi perfil (Acerca de, legales, eliminar cuenta) — alcanzable via el menú hamburguesa. */}
        <Tabs.Screen name="profile" options={{ href: null }} />
      </Tabs>
      <OfflineQueueIndicator />
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -2 },
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -10,
    ...Platform.select({
      ios: {
        shadowColor: colors.primary,
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  fabActive: {
    backgroundColor: colors.primaryDark,
  },
});
