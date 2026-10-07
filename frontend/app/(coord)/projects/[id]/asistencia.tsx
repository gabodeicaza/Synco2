// Asistencia — Coordinador General / Jefe de Proyecto (ver src/components/AsistenciaScreen.tsx).
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { AsistenciaScreen } from '@/src/components/AsistenciaScreen';

export default function AsistenciaRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <AsistenciaScreen projectId={pid} />;
}
