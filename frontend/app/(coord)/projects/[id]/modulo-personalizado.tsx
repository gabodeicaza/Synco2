// Captura/consulta de un módulo creado con el Creador de módulos — ver
// src/components/customModules/CustomModuleScreen.tsx.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import CustomModuleScreen from '@/src/components/customModules/CustomModuleScreen';

export default function ModuloPersonalizadoRoute() {
  const { id, mid } = useLocalSearchParams<{ id: string; mid: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  const moduloId = (Array.isArray(mid) ? mid[0] : mid) || '';
  return <CustomModuleScreen projectId={pid} moduloId={moduloId} />;
}
