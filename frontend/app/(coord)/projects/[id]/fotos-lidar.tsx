import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import FotosLidarScreen from '@/src/components/FotosLidarScreen';

export default function FotosLidarScreenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <FotosLidarScreen projectId={pid} />;
}
