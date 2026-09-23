// Editor de anotaciones sobre fotos — círculos, cuadrados, flechas y texto
// en distintos colores, para señalar cosas en las fotos que se suben en los
// reportes. Dibuja sobre un overlay SVG encima de la imagen y, al guardar,
// aplana imagen+overlay en un solo JPEG (ver src/utils/captureView.ts/.web.ts
// — mismas librerías ya instaladas en el proyecto, no se agregó ninguna
// dependencia nueva aparte de exponer html2canvas, que ya venía como
// dependencia transitiva de react-native-view-shot).
//
// El resultado (`onSave`) es un nuevo data URI base64 que reemplaza a la
// foto original en el arreglo `images` del reporte; la foto original no se
// modifica hasta que el usuario toca "Guardar".
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, Image, ActivityIndicator,
  PanResponder, TextInput, useWindowDimensions, Platform, Alert, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Ellipse, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { captureViewAsDataUri } from '@/src/utils/captureView';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@/src/theme';
import { a11y } from '@/src/i18n';

type Tool = 'select' | 'circle' | 'rect' | 'arrow' | 'text';

type Shape =
  | { id: number; tool: 'circle'; color: string; x1: number; y1: number; x2: number; y2: number }
  | { id: number; tool: 'rect'; color: string; x1: number; y1: number; x2: number; y2: number }
  | { id: number; tool: 'arrow'; color: string; x1: number; y1: number; x2: number; y2: number }
  | { id: number; tool: 'text'; color: string; x: number; y: number; text: string };

const COLORS = ['#EF4444', '#F59E0B', '#22C55E', '#2563EB', '#FFFFFF', '#000000'];
const TOOLS: { key: Tool; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'select', label: a11y('herramientaMover'), icon: 'move-outline' },
  { key: 'circle', label: a11y('herramientaCirculo'), icon: 'ellipse-outline' },
  { key: 'rect', label: a11y('herramientaRectangulo'), icon: 'square-outline' },
  { key: 'arrow', label: a11y('herramientaFlecha'), icon: 'arrow-up-outline' },
  { key: 'text', label: a11y('herramientaTexto'), icon: 'text-outline' },
];

// Distancia mínima de tolerancia al tocar una figura (dedo grueso vs. trazo
// delgado de 4px) — misma tolerancia para el hit-test de todas las
// herramientas de la barra "mover".
const HIT_PAD = 14;

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

function boundingBoxOf(s: Shape): { x: number; y: number; w: number; h: number } {
  if (s.tool === 'text') {
    const w = Math.max(20, s.text.length * 11);
    return { x: s.x - 4, y: s.y - 24, w: w + 8, h: 30 };
  }
  const minX = Math.min(s.x1, s.x2);
  const maxX = Math.max(s.x1, s.x2);
  const minY = Math.min(s.y1, s.y2);
  const maxY = Math.max(s.y1, s.y2);
  return { x: minX - 6, y: minY - 6, w: maxX - minX + 12, h: maxY - minY + 12 };
}

function hitTestShape(s: Shape, x: number, y: number): boolean {
  if (s.tool === 'arrow') return distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= HIT_PAD;
  const box = boundingBoxOf(s);
  return x >= box.x - HIT_PAD && x <= box.x + box.w + HIT_PAD && y >= box.y - HIT_PAD && y <= box.y + box.h + HIT_PAD;
}

function hitTest(list: Shape[], x: number, y: number): number | null {
  for (let i = list.length - 1; i >= 0; i--) {
    if (hitTestShape(list[i], x, y)) return list[i].id;
  }
  return null;
}

interface Props {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
  onSave: (newUri: string) => void;
}

export function PhotoAnnotator({ visible, imageUri, onClose, onSave }: Props) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [tool, setTool] = useState<Tool>('circle');
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [textPrompt, setTextPrompt] = useState<{ x: number; y: number } | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const shotRef = useRef<View>(null);
  const shapesRef = useRef<Shape[]>([]);
  const idCounterRef = useRef(0);
  const dragRef = useRef<{ id: number; startX: number; startY: number; orig: Shape } | null>(null);

  useEffect(() => { shapesRef.current = shapes; }, [shapes]);

  // Al cambiar de herramienta se suelta cualquier selección — evita borrar
  // por accidente una figura que quedó seleccionada al tocar otra cosa.
  useEffect(() => { setSelectedId(null); dragRef.current = null; }, [tool]);

  // El editor ya NO se envuelve en <Modal>: en Android, Modal abre una
  // ventana nativa separada y react-native-view-shot no puede capturar
  // vistas que viven en otra ventana (el dibujo se ve perfecto en pantalla
  // porque es puro estado de React, pero "Guardar" fallaba en silencio).
  // Se simula el overlay a pantalla completa con position:absolute y se
  // maneja el botón físico de "atrás" a mano.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const maxWidth = winWidth - spacing.md * 2;
  const maxHeight = winHeight * 0.62;

  // Recalcula el tamaño del lienzo a partir de las dimensiones reales de la
  // foto para que las anotaciones queden alineadas 1:1 con la imagen.
  React.useEffect(() => {
    if (!visible || !imageUri) { setCanvasSize(null); return; }
    Image.getSize(
      imageUri,
      (w, h) => {
        const ratio = Math.min(maxWidth / w, maxHeight / h, 1);
        setCanvasSize({ width: w * ratio, height: h * ratio });
      },
      () => setCanvasSize({ width: maxWidth, height: maxWidth * 0.75 }),
    );
    setShapes([]); setDraft(null); setSelectedId(null); setTextPrompt(null); setTextDraft('');
    idCounterRef.current = 0;
    dragRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, imageUri]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX: x, locationY: y } = evt.nativeEvent;
        if (tool === 'select') {
          const hitId = hitTest(shapesRef.current, x, y);
          setSelectedId(hitId);
          const orig = hitId !== null ? shapesRef.current.find((s) => s.id === hitId) || null : null;
          dragRef.current = orig ? { id: hitId as number, startX: x, startY: y, orig } : null;
          return;
        }
        if (tool === 'text') {
          setTextPrompt({ x, y });
          setTextDraft('');
          return;
        }
        setDraft({ tool, color, id: -1, x1: x, y1: y, x2: x, y2: y } as Shape);
      },
      onPanResponderMove: (evt) => {
        const { locationX: x, locationY: y } = evt.nativeEvent;
        if (tool === 'select') {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = x - drag.startX;
          const dy = y - drag.startY;
          setShapes((cur) => cur.map((s) => {
            if (s.id !== drag.id) return s;
            if (drag.orig.tool === 'text' && s.tool === 'text') {
              return { ...s, x: drag.orig.x + dx, y: drag.orig.y + dy };
            }
            if (drag.orig.tool !== 'text' && s.tool !== 'text') {
              return { ...s, x1: drag.orig.x1 + dx, y1: drag.orig.y1 + dy, x2: drag.orig.x2 + dx, y2: drag.orig.y2 + dy };
            }
            return s;
          }));
          return;
        }
        if (tool === 'text') return;
        setDraft((d) => (d && d.tool !== 'text' ? { ...d, x2: x, y2: y } : d));
      },
      onPanResponderRelease: () => {
        if (tool === 'select') {
          dragRef.current = null;
          return;
        }
        setDraft((d) => {
          if (d && d.tool !== 'text') {
            const dx = Math.abs(d.x2 - d.x1);
            const dy = Math.abs(d.y2 - d.y1);
            // Ignora toques sin arrastre real (evita figuras invisibles de 0px).
            if (dx > 4 || dy > 4) setShapes((cur) => [...cur, { ...d, id: idCounterRef.current++ } as Shape]);
          }
          return null;
        });
      },
    }),
    [tool, color],
  );

  function confirmarTexto() {
    if (!textPrompt) return;
    const t = textDraft.trim();
    if (t) setShapes((cur) => [...cur, { tool: 'text', color, id: idCounterRef.current++, x: textPrompt.x, y: textPrompt.y, text: t }]);
    setTextPrompt(null);
    setTextDraft('');
  }

  function deshacer() {
    setShapes((cur) => cur.slice(0, -1));
    setSelectedId(null);
  }

  function borrarSeleccionado() {
    if (selectedId === null) return;
    setShapes((cur) => cur.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  }

  async function guardar() {
    if (!shotRef.current || saving) return;
    setSaving(true);
    try {
      const uri = await captureViewAsDataUri(shotRef, 0.9);
      onSave(uri);
    } catch (e: any) {
      // Si falla la captura no se pierde la foto original, pero hay que
      // avisar — antes este error se tragaba en silencio y parecía que
      // "Guardar" no hacía nada.
      console.error('PhotoAnnotator: fallo al capturar la anotación', e);
      Alert.alert('No se pudo guardar', 'No se pudieron aplicar las marcas a la foto. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  function renderShape(s: Shape, idx: number, selected: boolean) {
    const key = s.id === -1 ? `draft-${idx}` : s.id;
    const selectionOverlay = selected ? (() => {
      const box = boundingBoxOf(s);
      return <Rect x={box.x} y={box.y} width={box.w} height={box.h} stroke="#38BDF8" strokeWidth={1.5} strokeDasharray="4,4" fill="none" />;
    })() : null;

    if (s.tool === 'circle') {
      const rx = Math.abs(s.x2 - s.x1) / 2;
      const ry = Math.abs(s.y2 - s.y1) / 2;
      return (
        <React.Fragment key={key}>
          {selectionOverlay}
          <Ellipse
            cx={(s.x1 + s.x2) / 2} cy={(s.y1 + s.y2) / 2} rx={rx || 1} ry={ry || 1}
            stroke={s.color} strokeWidth={4} fill="none"
          />
        </React.Fragment>
      );
    }
    if (s.tool === 'rect') {
      const x = Math.min(s.x1, s.x2);
      const y = Math.min(s.y1, s.y2);
      const w = Math.abs(s.x2 - s.x1);
      const h = Math.abs(s.y2 - s.y1);
      return (
        <React.Fragment key={key}>
          {selectionOverlay}
          <Polygon
            points={`${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}`}
            stroke={s.color} strokeWidth={4} fill="none"
          />
        </React.Fragment>
      );
    }
    if (s.tool === 'arrow') {
      const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const headLen = 16;
      const p1x = s.x2 - headLen * Math.cos(angle - Math.PI / 7);
      const p1y = s.y2 - headLen * Math.sin(angle - Math.PI / 7);
      const p2x = s.x2 - headLen * Math.cos(angle + Math.PI / 7);
      const p2y = s.y2 - headLen * Math.sin(angle + Math.PI / 7);
      return (
        <React.Fragment key={key}>
          {selectionOverlay}
          <Line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={4} />
          <Polygon points={`${s.x2},${s.y2} ${p1x},${p1y} ${p2x},${p2y}`} fill={s.color} />
        </React.Fragment>
      );
    }
    // texto — contorno oscuro simulado con un segundo trazo detrás para que
    // se lea sobre fotos claras u oscuras por igual.
    return (
      <React.Fragment key={key}>
        {selectionOverlay}
        <SvgText
          x={s.x} y={s.y}
          fill={s.color} stroke="#00000080" strokeWidth={0.5}
          fontSize={22} fontWeight="bold"
        >
          {s.text}
        </SvgText>
      </React.Fragment>
    );
  }

  if (!visible) return null;

  return (
    <>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Marcar foto</Text>
          <Pressable accessibilityRole="button" onPress={guardar} disabled={saving || !canvasSize} hitSlop={10}>
            {saving ? <ActivityIndicator color={colors.primary} /> : (
              <Text style={styles.saveTxt}>Guardar</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.canvasArea}>
          {!canvasSize || !imageUri ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View
              ref={shotRef}
              collapsable={false}
              style={{ width: canvasSize.width, height: canvasSize.height }}
              {...panResponder.panHandlers}
            >
              <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
              <Svg width={canvasSize.width} height={canvasSize.height} style={StyleSheet.absoluteFill}>
                {shapes.map((s, i) => renderShape(s, i, s.id === selectedId))}
                {draft ? renderShape(draft, -1, false) : null}
              </Svg>
            </View>
          )}
        </View>

        <View style={[styles.toolbar, { paddingBottom: spacing.md + insets.bottom }]}>
          <View style={styles.toolRow}>
            {TOOLS.map((t) => (
              <Pressable accessibilityRole="button" accessibilityLabel={t.label} accessibilityState={{ selected: tool === t.key }} hitSlop={8}
                key={t.key}
                onPress={() => setTool(t.key)}
                style={[styles.toolBtn, tool === t.key && styles.toolBtnActive]}
              >
                <Ionicons name={t.icon} size={20} color={tool === t.key ? '#fff' : colors.textBody} />
              </Pressable>
            ))}
            <View style={styles.toolDivider} />
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('deshacer')} hitSlop={8} onPress={deshacer} disabled={shapes.length === 0} style={[styles.toolBtn, shapes.length === 0 && { opacity: 0.4 }]}>
              <Ionicons name="arrow-undo-outline" size={20} color={colors.textBody} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} hitSlop={8} onPress={borrarSeleccionado} disabled={selectedId === null} style={[styles.toolBtn, selectedId === null && { opacity: 0.4 }]}>
              <Ionicons name="trash-outline" size={20} color={selectedId === null ? colors.textBody : '#F87171'} />
            </Pressable>
          </View>
          <View style={styles.colorRow}>
            {COLORS.map((c) => (
              <Pressable accessibilityRole="button"
                key={c}
                onPress={() => setColor(c)}
                style={[
                  styles.colorDot,
                  { backgroundColor: c },
                  color === c && styles.colorDotActive,
                  c === '#FFFFFF' && styles.colorDotBorder,
                ]}
              />
            ))}
          </View>
        </View>
      </View>

      {/* Prompt de texto — modal chico centrado, funciona igual en iOS/Android
          (Alert.prompt no existe en Android). Este sí puede ser <Modal>: es
          un overlay pequeño que no pasa por captureRef. */}
      <Modal visible={!!textPrompt} transparent animationType="fade" onRequestClose={() => setTextPrompt(null)}>
        <View style={styles.textPromptBackdrop}>
          <View style={styles.textPromptCard}>
            <Text style={styles.textPromptLabel}>Texto a agregar</Text>
            <TextInput
              value={textDraft}
              onChangeText={setTextDraft}
              placeholder="Ej. Grieta aquí"
              placeholderTextColor={colors.textMuted}
              style={styles.textPromptInput}
              autoFocus
              onSubmitEditing={confirmarTexto}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable accessibilityRole="button" onPress={() => setTextPrompt(null)} style={[styles.textPromptBtn, { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }]}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={confirmarTexto} style={[styles.textPromptBtn, { backgroundColor: colors.primary }]}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Agregar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: Platform.select({ ios: 50, default: 20 }), paddingBottom: spacing.sm,
  },
  title: { fontSize: 15, fontWeight: '800', color: '#fff' },
  saveTxt: { fontSize: 15, fontWeight: '800', color: colors.primary },

  canvasArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  toolbar: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: 10, backgroundColor: '#111827' },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolBtn: {
    width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1F2937',
  },
  toolBtnActive: { backgroundColor: colors.primary },
  toolDivider: { width: 1, height: 24, backgroundColor: '#374151', marginHorizontal: 4 },

  colorRow: { flexDirection: 'row', gap: 10 },
  colorDot: { width: 28, height: 28, borderRadius: 14 },
  colorDotActive: { borderWidth: 3, borderColor: '#fff' },
  colorDotBorder: { borderWidth: 1, borderColor: '#374151' },

  textPromptBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  textPromptCard: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: radius.lg, padding: spacing.md },
  textPromptLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6 },
  textPromptInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text },
  textPromptBtn: { flex: 1, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' },
});

export default PhotoAnnotator;
