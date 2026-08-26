// Visualizar avance — accesible desde la pestaña Configuración del detalle
// de proyecto. Ver src/components/VisualizarAvanceScreen.tsx.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import VisualizarAvanceScreen from '@/src/components/VisualizarAvanceScreen';

export default function VisualizarAvanceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <VisualizarAvanceScreen projectId={pid} />;
}
