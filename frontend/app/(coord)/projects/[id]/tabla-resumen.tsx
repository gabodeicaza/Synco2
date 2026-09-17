import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import TablaResumenScreen from '@/src/components/TablaResumenScreen';

export default function TablaResumenRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <TablaResumenScreen projectId={pid} />;
}
