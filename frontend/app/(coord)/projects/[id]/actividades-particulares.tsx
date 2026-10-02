import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ActividadesParticularesScreen from '@/src/components/ActividadesParticularesScreen';

export default function ActividadesParticularesRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <ActividadesParticularesScreen projectId={pid} />;
}
