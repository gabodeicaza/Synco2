import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ControlObraScreen from '@/src/components/ControlObraScreen';

export default function ControlObraRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <ControlObraScreen projectId={pid} />;
}
