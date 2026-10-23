// Trazabilidad (antes "Archivos de consulta") — vista de solo lectura para Sub-coordinador.
// Es el mismo árbol de documentos que el Coordinador General arma y actualiza.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TrazabilidadScreen } from '@/src/components/TrazabilidadScreen';

export default function TrazabilidadSubcoordScreen() {
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || '';
  return <TrazabilidadScreen projectId={pid} canEdit={false} fallbackHref="/(subcoord)" />;
}
