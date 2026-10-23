// Trazabilidad (antes "Archivos de consulta") — vista de solo lectura para Especialista.
// Es el mismo árbol de documentos que el Coordinador General arma y actualiza.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/src/auth-context';
import { TrazabilidadScreen } from '@/src/components/TrazabilidadScreen';

export default function TrazabilidadEspecialistaScreen() {
  const { user } = useAuth();
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const pid = (Array.isArray(project_id) ? project_id[0] : project_id) || (user?.project_ids || [])[0] || '';
  return <TrazabilidadScreen projectId={pid} canEdit={false} fallbackHref="/(spec)" />;
}
