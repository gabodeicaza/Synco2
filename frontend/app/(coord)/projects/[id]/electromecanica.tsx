import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ElectromecanicaScreen from '@/src/components/ElectromecanicaScreen';

export default function ElectromecanicaScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <ElectromecanicaScreen projectId={pid} />;
}
