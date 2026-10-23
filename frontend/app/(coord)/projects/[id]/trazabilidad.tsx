import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TrazabilidadScreen } from '@/src/components/TrazabilidadScreen';

export default function TrazabilidadCoordRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <TrazabilidadScreen projectId={pid} canEdit fallbackHref={`/(coord)/projects/${pid}` as any} />;
}
