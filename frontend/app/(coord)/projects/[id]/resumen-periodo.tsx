import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ResumenPeriodoScreen from '@/src/components/ResumenPeriodoScreen';

export default function ResumenPeriodoScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <ResumenPeriodoScreen projectId={pid} />;
}
