import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import AspectosSocialesScreen from '@/src/components/AspectosSocialesScreen';

export default function AspectosSocialesScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <AspectosSocialesScreen projectId={pid} />;
}
