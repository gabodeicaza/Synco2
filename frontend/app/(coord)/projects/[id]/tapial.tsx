import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import PlanoAvanceScreen from '@/src/components/PlanoAvanceScreen';

export default function PlanoAvanceScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <PlanoAvanceScreen projectId={pid} categoria="tapial" />;
}
