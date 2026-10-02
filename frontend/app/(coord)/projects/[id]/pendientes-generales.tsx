import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import PendientesGeneralesScreen from '@/src/components/PendientesGeneralesScreen';

export default function PendientesGeneralesScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <PendientesGeneralesScreen projectId={pid} />;
}
