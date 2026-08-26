import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// Side-effect import obligatorio en Expo/RN antes de usar Gesture Handler.
// eslint-disable-next-line import/no-duplicates
import 'react-native-gesture-handler';
// eslint-disable-next-line import/no-duplicates
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Configuración global de zona horaria (CDMX)
import '@/src/utils/tz';

import { useIconFonts } from '@/src/hooks/use-icon-fonts';
import { AuthProvider } from '@/src/auth-context';
import { OfflineQueueProvider } from '@/src/offline-queue-context';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync().catch((err) => {
        if (__DEV__) console.warn('[RootLayout] Failed to hide splash screen:', err);
      });
    }
  }, [loaded, error]);

  // Fallback to hide splash screen after 3 seconds regardless of font state
  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <OfflineQueueProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F8FAFC' } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(coord)" />
              <Stack.Screen name="(subcoord)" />
              <Stack.Screen name="(spec)" />
            </Stack>
          </OfflineQueueProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
