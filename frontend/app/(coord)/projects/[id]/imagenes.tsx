// Hub de Imágenes — Coordinador (ver src/components/ImagenesHubScreen.tsx).
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ImagenesHubScreen } from '@/src/components/ImagenesHubScreen';

export default function ImagenesRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <ImagenesHubScreen projectId={pid} />;
}
