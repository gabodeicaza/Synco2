// Capacidades de Operadores — Coordinador General / Jefe de Proyecto (ver src/components/CapacidadesScreen.tsx).
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { CapacidadesScreen } from '@/src/components/CapacidadesScreen';

export default function CapacidadesRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <CapacidadesScreen projectId={pid} />;
}
