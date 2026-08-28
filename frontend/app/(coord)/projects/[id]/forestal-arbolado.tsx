import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ForestalArboladoScreen from '@/src/components/ForestalArboladoScreen';

export default function ForestalArboladoRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <ForestalArboladoScreen projectId={pid} />;
}
