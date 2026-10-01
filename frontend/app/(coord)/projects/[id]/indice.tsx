import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import IndiceEditorScreen from '@/src/components/IndiceEditorScreen';

export default function IndiceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <IndiceEditorScreen projectId={pid} />;
}
