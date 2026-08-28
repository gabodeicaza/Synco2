import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import SeguridadHigieneScreen from '@/src/components/SeguridadHigieneScreen';

export default function SeguridadHigieneRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <SeguridadHigieneScreen projectId={pid} />;
}
