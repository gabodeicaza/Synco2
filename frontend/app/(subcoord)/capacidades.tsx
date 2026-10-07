// Capacidades de Operadores (ver src/components/CapacidadesScreen.tsx).
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/src/auth-context';
import { CapacidadesScreen } from '@/src/components/CapacidadesScreen';

export default function CapacidadesRoute() {
  const { user } = useAuth();
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || (user?.project_ids || [])[0] || '';
  return <CapacidadesScreen projectId={pid} />;
}
