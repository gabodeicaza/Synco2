// Actividades Generales — accesible desde la pestaña Configuración del
// detalle de proyecto. Ver src/components/ActividadesGeneralesScreen.tsx.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActividadesGeneralesScreen } from '@/src/components/ActividadesGeneralesScreen';
import { NivelActividad } from '@/src/api';

export default function ActividadesGeneralesRoute() {
  const { id, nivel } = useLocalSearchParams<{ id: string; nivel?: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  const nivelParam = (Array.isArray(nivel) ? nivel[0] : nivel) as NivelActividad | undefined;
  return <ActividadesGeneralesScreen projectId={pid} initialNivel={nivelParam} />;
}
