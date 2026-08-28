// Dashboard EVM (Valor Ganado) — accesible desde la pestaña Configuración
// del detalle de proyecto. Ver src/components/DashboardEVM.tsx.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import DashboardEVM from '@/src/components/DashboardEVM';

export default function DashboardEvmRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <DashboardEVM projectId={pid} />;
}
