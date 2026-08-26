/**
 * Hub de Minutas _ Pantalla scoped al proyecto.
 * Se accede desde el dashboard del proyecto: /(coord)/projects/:id/minutas.
 * Simplemente lee el `pid` del route y renderiza el componente reutilizable.
 */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import MinutasView from '@/src/components/MinutasView';

export default function MinutasProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <MinutasView pid={pid} />;
}
