/**
 * Noticias — Pantalla scoped al proyecto.
 * Se accede desde el dashboard del proyecto: /(coord)/projects/:id/announcements.
 * Simplemente lee el `pid` del route y renderiza el componente reutilizable.
 */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import AnnouncementsView from '@/src/components/AnnouncementsView';

export default function AnnouncementsProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';
  return <AnnouncementsView pid={pid} />;
}
