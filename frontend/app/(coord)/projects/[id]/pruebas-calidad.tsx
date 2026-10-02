import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import PruebasCalidadScreen from '@/src/components/PruebasCalidadScreen';

export default function PruebasCalidadScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <PruebasCalidadScreen projectId={pid} />;
}
