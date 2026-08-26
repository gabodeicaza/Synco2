import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '@/src/theme';

export default function ProjectLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="tree" />
      <Stack.Screen name="areas" />
      <Stack.Screen name="invitations" />
      <Stack.Screen name="announcements" />
      <Stack.Screen name="events" />
      <Stack.Screen name="minutas" />
      <Stack.Screen name="catalogo-conceptos" />
      <Stack.Screen name="registrar-avance" />
      <Stack.Screen name="visualizar-avance" />
      <Stack.Screen name="actividades-generales" />
    </Stack>
  );
}
