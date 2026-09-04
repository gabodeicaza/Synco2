import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import EstudiosProyectoScreen from '@/src/components/EstudiosProyectoScreen';

export default function EstudiosProyectoRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <EstudiosProyectoScreen projectId={pid} />;
}
