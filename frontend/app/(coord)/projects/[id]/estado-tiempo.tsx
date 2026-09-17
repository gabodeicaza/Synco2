import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import EstadoTiempoScreen from '@/src/components/EstadoTiempoScreen';

export default function EstadoTiempoRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <EstadoTiempoScreen projectId={pid} />;
}
