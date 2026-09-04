import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ImpactoAmbientalScreen from '@/src/components/ImpactoAmbientalScreen';

export default function ImpactoAmbientalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <ImpactoAmbientalScreen projectId={pid} />;
}
