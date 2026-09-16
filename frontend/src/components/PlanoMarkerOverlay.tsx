// Overlay de marcadores sobre un Plano de Avance — a diferencia de
// PhotoAnnotator.tsx (dibujo libre que se APLANA en una foto nueva al
// guardar), estos marcadores tienen identidad propia y un estado editable
// en el tiempo: nunca se aplanan aquí, solo se leen/tocan y el cambio se
// manda al backend vía PATCH. Reusa la técnica de hit-testing de
// PhotoAnnotator.tsx (`distToSegment`) adaptada a marcadores punto/segmento
// en coordenadas FRACCIÓN (0-1) del tamaño de la imagen base.
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { colors } from '@/src/theme';
import type { PlanoMarker, PlanoMarkerEstatus } from '@/src/api';

export const PLANO_MARKER_ESTADO_COLOR: Record<PlanoMarkerEstatus, string> = {
  sin_iniciar: '#DC2626',
  en_proceso: '#D97706',
  terminado: '#16A34A',
};

export const PLANO_MARKER_ESTADO_LABEL: Record<PlanoMarkerEstatus, string> = {
  sin_iniciar: 'Sin iniciar',
  en_proceso: 'En proceso',
  terminado: 'Terminado',
};

// Distancia mínima de tolerancia al tocar un marcador (dedo grueso vs.
// marcador delgado) — mismo criterio (HIT_PAD) que PhotoAnnotator.tsx.
const HIT_PAD = 16;

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

interface Props {
  imageUri: string;
  markers: PlanoMarker[];
  width: number;
  height: number;
  markerRadius?: number;
  /** Marcador tocado (punto o segmento), o null si el toque no dio en ninguno. */
  onTap?: (marker: PlanoMarker | null, xFrac: number, yFrac: number) => void;
  /** Punto pendiente de un segmento en construcción (ver PlanoAvanceScreen). */
  draftPoint?: { x: number; y: number } | null;
}

export function PlanoMarkerOverlay({ imageUri, markers, width, height, markerRadius = 11, onTap, draftPoint }: Props) {
  function handleTouch(evt: any) {
    if (!onTap) return;
    const { locationX: x, locationY: y } = evt.nativeEvent;
    let hit: PlanoMarker | null = null;
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      const mx = m.x * width;
      const my = m.y * height;
      if (m.tipo === 'segmento' && m.x2 != null && m.y2 != null) {
        const mx2 = m.x2 * width;
        const my2 = m.y2 * height;
        if (distToSegment(x, y, mx, my, mx2, my2) <= HIT_PAD) { hit = m; break; }
      } else if (Math.hypot(x - mx, y - my) <= markerRadius + HIT_PAD) {
        hit = m;
        break;
      }
    }
    onTap(hit, width > 0 ? x / width : 0, height > 0 ? y / height : 0);
  }

  return (
    <View
      style={{ width, height }}
      onStartShouldSetResponder={() => !!onTap}
      onResponderRelease={handleTouch}
    >
      <Image source={{ uri: imageUri }} style={{ width, height }} resizeMode="contain" />
      <Svg width={width} height={height} style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {markers.map((m) => {
          const color = PLANO_MARKER_ESTADO_COLOR[m.estatus] || colors.textMuted;
          if (m.tipo === 'segmento' && m.x2 != null && m.y2 != null) {
            return (
              <Line
                key={m.id}
                x1={m.x * width} y1={m.y * height}
                x2={m.x2 * width} y2={m.y2 * height}
                stroke={color} strokeWidth={5} strokeLinecap="round"
              />
            );
          }
          return (
            <Circle
              key={m.id}
              cx={m.x * width} cy={m.y * height}
              r={markerRadius}
              fill={color} stroke="#FFFFFF" strokeWidth={2}
            />
          );
        })}
        {draftPoint ? (
          <Circle
            cx={draftPoint.x * width} cy={draftPoint.y * height}
            r={markerRadius * 0.7}
            fill="none" stroke={colors.primary} strokeWidth={3} strokeDasharray="4,3"
          />
        ) : null}
      </Svg>
    </View>
  );
}
