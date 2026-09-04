import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import GestionRiesgosScreen from '@/src/components/GestionRiesgosScreen';

export default function GestionRiesgosRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <GestionRiesgosScreen projectId={pid} />;
}
