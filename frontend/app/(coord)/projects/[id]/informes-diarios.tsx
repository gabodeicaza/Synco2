// Informes diarios de ingenieros — Coordinador General / Jefe de Proyecto (ver src/components/InformesDiariosCoordScreen.tsx).
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { InformesDiariosCoordScreen } from '@/src/components/InformesDiariosCoordScreen';

export default function InformesDiariosRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <InformesDiariosCoordScreen projectId={pid} />;
}
