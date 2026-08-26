// Catálogo de Conceptos — accesible desde la pestaña Configuración del
// detalle de proyecto. Ver src/components/CatalogoConceptosScreen.tsx.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import CatalogoConceptosScreen from '@/src/components/CatalogoConceptosScreen';

export default function CatalogoConceptosRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <CatalogoConceptosScreen projectId={pid} />;
}
