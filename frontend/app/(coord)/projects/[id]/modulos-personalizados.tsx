// Creador de módulos (solo Coordinador General) — ver
// src/components/customModules/CustomModulesAdminScreen.tsx.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import CustomModulesAdminScreen from '@/src/components/customModules/CustomModulesAdminScreen';

export default function ModulosPersonalizadosRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <CustomModulesAdminScreen projectId={pid} />;
}
