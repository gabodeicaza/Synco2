import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import IndicadoresSeguridadScreen from '@/src/components/IndicadoresSeguridadScreen';

export default function IndicadoresSeguridadScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <IndicadoresSeguridadScreen projectId={pid} />;
}
