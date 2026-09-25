import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import OfflineQueueIndicator from '@/src/components/OfflineQueueIndicator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth-context';
import { ROLE_COORD, ROLE_JEFE } from '@/src/utils/roles';
import { colors } from '@/src/theme';

export default function CoordLayout() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/(auth)/login'); return; }
    // Coord layout es usado por coordinador_general y jefe_proyecto (read-only).
    if (user.role !== ROLE_COORD && user.role !== ROLE_JEFE) {
      router.replace(user.role === 'sub_coordinador' ? '/(subcoord)' : '/(spec)');
    }
  }, [user, loading]);

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        // G-07: las pestañas se montan al abrirlas y las inactivas se congelan (no se vuelven a pintar
        // ni gastan memoria en Android de gama baja). Los polls corren solo con la pantalla enfocada.
        lazy: true,
        freezeOnBlur: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 60 + (insets.bottom > 0 ? insets.bottom : 8),
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mensajes"
        options={{
          title: 'Mensajes',
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="minutas"
        options={{
          title: 'Minutas',
          tabBarIcon: ({ color, size }) => <Ionicons name="clipboard-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="noticias"
        options={{
          title: 'Noticias',
          tabBarIcon: ({ color, size }) => <Ionicons name="newspaper" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendario"
        options={{
          title: 'Calendario',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
        }}
      />
      <Tabs.Screen name="projects/new" options={{ href: null }} />
      <Tabs.Screen name="projects/[id]" options={{ href: null }} />
      <Tabs.Screen name="coordinators" options={{ href: null }} />
      <Tabs.Screen name="report-templates" options={{ href: null }} />
      {/* Cambiar mi contraseña — alcanzable desde Mi perfil, sin tab visible. */}
      <Tabs.Screen name="cambiar-password" options={{ href: null }} />
      <Tabs.Screen name="migracion-catalogo" options={{ href: null }} />
      {/* Solicitudes de "Olvidé mi contraseña" — alcanzable desde Mi perfil, sin tab visible. */}
      <Tabs.Screen name="password-resets" options={{ href: null }} />
    </Tabs>
    <OfflineQueueIndicator />
    </View>
  );
}
