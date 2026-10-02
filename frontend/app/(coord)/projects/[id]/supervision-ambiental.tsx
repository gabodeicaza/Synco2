import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import SupervisionAmbientalScreen from '@/src/components/SupervisionAmbientalScreen';

export default function SupervisionAmbientalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <SupervisionAmbientalScreen projectId={pid} />;
}
