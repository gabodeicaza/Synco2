import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import EstimacionesScreen from '@/src/components/EstimacionesScreen';

export default function EstimacionesScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <EstimacionesScreen projectId={pid} />;
}
