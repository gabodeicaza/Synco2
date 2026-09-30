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
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="modulos" />
      <Stack.Screen name="forestal-arbolado" />
      <Stack.Screen name="seguridad-higiene" />
      <Stack.Screen name="gestion-riesgos" />
      <Stack.Screen name="estudios-proyecto" />
      <Stack.Screen name="impacto-ambiental" />
      <Stack.Screen name="tabla-resumen" />
      <Stack.Screen name="fotos-lidar" />
      <Stack.Screen name="tapial" />
      <Stack.Screen name="estado-tiempo" />
      <Stack.Screen name="control-obra" />
      <Stack.Screen name="plano-avance" />
      <Stack.Screen name="presentacion" />
      <Stack.Screen name="presentacion-preview" />
    </Stack>
  );
}
