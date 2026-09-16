import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import PresentacionScreen from '@/src/components/PresentacionScreen';

export default function PresentacionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <PresentacionScreen projectId={pid} />;
}
