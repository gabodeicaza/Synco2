// Overlay de marcadores sobre un Plano de Avance — a diferencia de
// PhotoAnnotator.tsx (dibujo libre que se APLANA en una foto nueva al
// guardar), estos marcadores tienen identidad propia y un estado editable
// en el tiempo: nunca se aplanan aquí, solo se leen/tocan y el cambio se
// manda al backend vía PATCH. Reusa la técnica de hit-testing de
// PhotoAnnotator.tsx (`distToSegment`) adaptada a marcadores punto/segmento/
// dado en coordenadas FRACCIÓN (0-1) del tamaño de la imagen base.
import React, { useMemo, useRef, useState } from 'react';
import { Image, PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
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
// Por debajo de este desplazamiento total (px), un gesto en modo 'mover' se
// trata como TAP normal (abre el modal de acciones) en vez de arrastre —
// evita que un toque con la mano ligeramente temblorosa dispare un PATCH.
const DRAG_TAP_THRESHOLD = 6;

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

/** Distancia mínima del punto (px,py) a una polilínea de vértices en píxeles. */
function distToPolyline(px: number, py: number, pts: number[][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  }
  return best;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

interface Props {
  imageUri: string;
  markers: PlanoMarker[];
  width: number;
  height: number;
  markerRadius?: number;
  /** Marcador tocado (punto, segmento o dado), o null si el toque no dio en ninguno. */
  onTap?: (marker: PlanoMarker | null, xFrac: number, yFrac: number) => void;
  /** Punto pendiente de un segmento en construcción (ver PlanoAvanceScreen). */
  draftPoint?: { x: number; y: number } | null;
  /** Vértices ya tocados de un TRAMO en construcción (Tapial) — se dibuja
   * como polilínea punteada con un círculo por vértice. */
  draftPuntos?: { x: number; y: number }[] | null;
  /** 'mover' habilita arrastrar marcadores tipo punto/dado (ver
   * PlanoAvanceScreen) — 'ver' (default, o prop omitida) es el
   * comportamiento de siempre: tap simple vía onTap, sin cambios. */
  mode?: 'ver' | 'mover';
  /** Se llama al soltar tras un ARRASTRE real (no un tap) en modo 'mover',
   * con la nueva posición en fracción 0-1. Solo aplica a punto/dado — los
   * segmentos no se arrastran directamente (ver nota de diseño en
   * PlanoAvanceScreen.onDragEndMarker). */
  onDragEnd?: (marker: PlanoMarker, newXFrac: number, newYFrac: number) => void;
}

export function PlanoMarkerOverlay({
  imageUri, markers, width, height, markerRadius = 11, onTap, draftPoint, draftPuntos, mode = 'ver', onDragEnd,
}: Props) {
  // Posición VISUAL temporal del marcador que se está arrastrando — no se
  // persiste hasta soltar (onDragEnd). Mientras exista, el render de ESE
  // marcador ignora su x/y real y usa este preview.
  const [dragPreview, setDragPreview] = useState<{ id: string; xFrac: number; yFrac: number } | null>(null);

  // El PanResponder (modo 'mover') se crea UNA sola vez (useMemo con deps
  // vacías) — sus callbacks leen siempre el valor más reciente de
  // markers/width/height/onTap/onDragEnd a través de este ref, en vez de
  // cerrar sobre valores obsoletos de un render anterior (patrón estándar
  // PanResponder + refs en React Native).
  const liveRef = useRef({ markers, width, height, markerRadius, onTap, onDragEnd });
  liveRef.current = { markers, width, height, markerRadius, onTap, onDragEnd };

  const draggingRef = useRef<{ marker: PlanoMarker; startXFrac: number; startYFrac: number } | null>(null);

  function hitTestPointOrDado(x: number, y: number): PlanoMarker | null {
    const { markers: ms, width: w, height: h, markerRadius: r } = liveRef.current;
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      if (m.tipo === 'segmento' || m.tipo === 'tramo') continue; // ver nota: segmentos/tramos no se arrastran directo.
      const mx = m.x * w;
      const my = m.y * h;
      if (Math.hypot(x - mx, y - my) <= r + HIT_PAD) return m;
    }
    return null;
  }

  // --- Modo 'ver': tap simple, comportamiento sin cambios respecto al original ---
  function handleTouch(evt: any) {
    if (!onTap) return;
    const { locationX: x, locationY: y } = evt.nativeEvent;
    let hit: PlanoMarker | null = null;
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      const mx = m.x * width;
      const my = m.y * height;
      if (m.tipo === 'tramo' && m.puntos && m.puntos.length >= 2) {
        const pts = m.puntos.map((q) => [q[0] * width, q[1] * height]);
        if (distToPolyline(x, y, pts) <= HIT_PAD) { hit = m; break; }
      } else if (m.tipo === 'segmento' && m.x2 != null && m.y2 != null) {
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

  // --- Modo 'mover': arrastrar un punto/dado; toques cortos siguen abriendo
  // el modal de acciones (mismo onTap que en modo 'ver') ---
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX: x, locationY: y } = evt.nativeEvent;
          const hit = hitTestPointOrDado(x, y);
          draggingRef.current = hit ? { marker: hit, startXFrac: hit.x, startYFrac: hit.y } : null;
        },
        onPanResponderMove: (_evt, gestureState) => {
          const dragging = draggingRef.current;
          if (!dragging) return;
          const { width: w, height: h } = liveRef.current;
          if (w <= 0 || h <= 0) return;
          setDragPreview({
            id: dragging.marker.id,
            xFrac: clamp01(dragging.startXFrac + gestureState.dx / w),
            yFrac: clamp01(dragging.startYFrac + gestureState.dy / h),
          });
        },
        onPanResponderRelease: (_evt, gestureState) => {
          const dragging = draggingRef.current;
          draggingRef.current = null;
          setDragPreview(null);
          if (!dragging) return;
          const total = Math.hypot(gestureState.dx, gestureState.dy);
          const { width: w, height: h, onTap: liveOnTap, onDragEnd: liveOnDragEnd } = liveRef.current;
          if (total < DRAG_TAP_THRESHOLD) {
            liveOnTap?.(dragging.marker, dragging.startXFrac, dragging.startYFrac);
            return;
          }
          if (w <= 0 || h <= 0) return;
          liveOnDragEnd?.(
            dragging.marker,
            clamp01(dragging.startXFrac + gestureState.dx / w),
            clamp01(dragging.startYFrac + gestureState.dy / h),
          );
        },
        onPanResponderTerminate: () => {
          draggingRef.current = null;
          setDragPreview(null);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const responderProps = mode === 'mover'
    ? panResponder.panHandlers
    : { onStartShouldSetResponder: () => !!onTap, onResponderRelease: handleTouch };

  return (
    <View style={{ width, height }} {...responderProps}>
      <Image source={{ uri: imageUri }} style={{ width, height }} resizeMode="contain" />
      <Svg width={width} height={height} style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {markers.map((m) => {
          const color = PLANO_MARKER_ESTADO_COLOR[m.estatus] || colors.textMuted;
          const preview = dragPreview && dragPreview.id === m.id ? dragPreview : null;
          const mx = (preview ? preview.xFrac : m.x) * width;
          const my = (preview ? preview.yFrac : m.y) * height;
          const label = (m.label || '').trim();

          if (m.tipo === 'tramo' && m.puntos && m.puntos.length >= 2) {
            const pts = m.puntos.map((q) => `${q[0] * width},${q[1] * height}`).join(' ');
            const mid = m.puntos[Math.floor(m.puntos.length / 2)];
            return (
              <React.Fragment key={m.id}>
                <Polyline
                  points={pts} fill="none" stroke={color} strokeWidth={5}
                  strokeLinecap="round" strokeLinejoin="round"
                />
                {label ? (
                  <SvgText
                    x={mid[0] * width} y={mid[1] * height - 8}
                    fontSize={10} fontWeight="bold" textAnchor="middle"
                    fill="#1A1A1A" stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke"
                  >
                    {label}
                  </SvgText>
                ) : null}
              </React.Fragment>
            );
          }

          if (m.tipo === 'segmento' && m.x2 != null && m.y2 != null) {
            const x2 = m.x2 * width;
            const y2 = m.y2 * height;
            return (
              <React.Fragment key={m.id}>
                <Line x1={mx} y1={my} x2={x2} y2={y2} stroke={color} strokeWidth={5} strokeLinecap="round" />
                {label ? (
                  <SvgText
                    x={(mx + x2) / 2} y={(my + y2) / 2 - 8}
                    fontSize={10} fontWeight="bold" textAnchor="middle"
                    fill="#1A1A1A" stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke"
                  >
                    {label}
                  </SvgText>
                ) : null}
              </React.Fragment>
            );
          }

          if (m.tipo === 'dado') {
            const side = markerRadius * 2.2;
            return (
              <React.Fragment key={m.id}>
                <Rect
                  x={mx - side / 2} y={my - side / 2} width={side} height={side}
                  fill={color} stroke="#FFFFFF" strokeWidth={2}
                />
                {label ? (
                  <SvgText
                    x={mx} y={my + side / 2 + 12}
                    fontSize={10} fontWeight="bold" textAnchor="middle"
                    fill="#1A1A1A" stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke"
                  >
                    {label}
                  </SvgText>
                ) : null}
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={m.id}>
              <Circle cx={mx} cy={my} r={markerRadius} fill={color} stroke="#FFFFFF" strokeWidth={2} />
              {label ? (
                <SvgText
                  x={mx} y={my + markerRadius + 12}
                  fontSize={10} fontWeight="bold" textAnchor="middle"
                  fill="#1A1A1A" stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke"
                >
                  {label}
                </SvgText>
              ) : null}
            </React.Fragment>
          );
        })}
        {draftPuntos && draftPuntos.length > 0 ? (
          <>
            {draftPuntos.length > 1 ? (
              <Polyline
                points={draftPuntos.map((q) => `${q.x * width},${q.y * height}`).join(' ')}
                fill="none" stroke={colors.primary} strokeWidth={3} strokeDasharray="6,4"
                strokeLinecap="round" strokeLinejoin="round"
              />
            ) : null}
            {draftPuntos.map((q, i) => (
              <Circle
                key={i} cx={q.x * width} cy={q.y * height} r={markerRadius * 0.55}
                fill="#FFFFFF" stroke={colors.primary} strokeWidth={2.5}
              />
            ))}
          </>
        ) : null}
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
