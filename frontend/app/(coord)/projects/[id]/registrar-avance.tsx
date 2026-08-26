// Registrar avance — accesible desde la pestaña Configuración del detalle
// de proyecto. Ver src/components/RegistrarAvanceScreen.tsx.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import RegistrarAvanceScreen from '@/src/components/RegistrarAvanceScreen';

export default function RegistrarAvanceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <RegistrarAvanceScreen projectId={pid} />;
}
