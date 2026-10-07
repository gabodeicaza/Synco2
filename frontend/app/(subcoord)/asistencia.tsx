// Asistencia — Sub-Coordinador (ver src/components/AsistenciaScreen.tsx).
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { AsistenciaScreen } from '@/src/components/AsistenciaScreen';

export default function AsistenciaRoute() {
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';
  return <AsistenciaScreen projectId={pid} />;
}
