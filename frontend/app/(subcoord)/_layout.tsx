// SynCo _ Layout del Sub-coordinador con Bottom Tabs (paridad con (spec)).
// Tabs: Noticias _ Inicio _ Nuevo _ Mensajes _ Calendario.
import React, { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth-context';
import { ROLE_SUB } from '@/src/utils/roles';
import { colors, radius } from '@/src/theme';
import OfflineQueueIndicator from '@/src/components/OfflineQueueIndicator';

export default function SubCoordLayout() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/(auth)/login'); return; }
    if (user.role !== ROLE_SUB) {
      if (user.role === 'coordinador_general' || user.role === 'jefe_proyecto') {
        router.replace('/(coord)');
      } else {
        router.replace('/(spec)');
      }
    }
  }, [user, loading]);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
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
        {/* Pantalla legacy: el dashboard real ya se sirve mediante index.tsx (re-export). */}
        <Tabs.Screen name="dashboard" options={{ href: null }} />
        {/* Mensajes y Calendario se movieron al menu hamburgues (HeaderMenu) _
            siguen alcanzables via router.push, ya no ocupan tab visible. */}
        <Tabs.Screen name="mensajes" options={{ href: null }} />
        <Tabs.Screen name="calendario" options={{ href: null }} />
        {/* Fuerza de Trabajo (derivada de reportes) _ alcanzable via router.push, sin tab visible. */}
        <Tabs.Screen name="fuerza-de-trabajo" options={{ href: null }} />
        {/* Archivos de consulta _ alcanzable via router.push (menu), sin tab visible. */}
        <Tabs.Screen name="archivos-consulta" options={{ href: null }} />
        {/* Catalogo de Conceptos (grupo de 3 opciones del menu hamburgues), sin tab visible. */}
        <Tabs.Screen name="catalogo-conceptos" options={{ href: null }} />
        <Tabs.Screen name="registrar-avance" options={{ href: null }} />
        <Tabs.Screen name="visualizar-avance" options={{ href: null }} />
        {/* Actividades Generales (grupo de 3 opciones del menu hamburgues), sin tab visible. */}
        <Tabs.Screen name="actividades-generales" options={{ href: null }} />
        {/* Acceso al Predio _ alcanzable via router.push (menu hamburgues), sin tab visible.
            Expo Router auto-genera un tab para cualquier archivo dentro del
            grupo de Tabs que no este explicitamente registrado con href:
            null _ sin esto aparecia un boton "acceso-pre..." no deseado en
            la barra inferior, junto a "Minutas". */}
        <Tabs.Screen name="acceso-predio" options={{ href: null }} />
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
