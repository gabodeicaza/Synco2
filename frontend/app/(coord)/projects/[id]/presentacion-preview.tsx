import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import PresentacionPreview from '@/src/components/PresentacionPreview';

export default function PresentacionPreviewRoute() {
  const { id, presentacion_id } = useLocalSearchParams<{ id: string; presentacion_id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  const presId = (Array.isArray(presentacion_id) ? presentacion_id[0] : presentacion_id) || '';
  return <PresentacionPreview projectId={pid} presentacionId={presId} />;
}
