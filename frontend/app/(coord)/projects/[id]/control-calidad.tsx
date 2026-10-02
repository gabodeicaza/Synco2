import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ControlCalidadScreen from '@/src/components/ControlCalidadScreen';

export default function ControlCalidadScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <ControlCalidadScreen projectId={pid} />;
}
