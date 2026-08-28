// Editor de anotaciones sobre fotos — círculos, cuadrados, flechas y texto
// en distintos colores, para señalar cosas en las fotos que se suben en los
// reportes. Dibuja sobre un overlay SVG encima de la imagen y, al guardar,
// aplana imagen+overlay en un solo JPEG con react-native-view-shot (mismas
// librerías ya instaladas en el proyecto — react-native-svg,
// react-native-view-shot — no se agregó ninguna dependencia nueva).
//
// El resultado (`onSave`) es un nuevo data URI base64 que reemplaza a la
// foto original en el arreglo `images` del reporte; la foto original no se
// modifica hasta que el usuario toca "Guardar".
import React, { useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, Image, ActivityIndicator,
  PanResponder, TextInput, useWindowDimensions, Platform,
} from 'react-native';
import Svg, { Ellipse, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@/src/theme';

type Tool = 'circle' | 'rect' | 'arrow' | 'text';

type Shape =
  | { tool: 'circle'; color: string; x1: number; y1: number; x2: number; y2: number }
  | { tool: 'rect'; color: string; x1: number; y1: number; x2: number; y2: number }
  | { tool: 'arrow'; color: string; x1: number; y1: number; x2: number; y2: number }
  | { tool: 'text'; color: string; x: number; y: number; text: string };

const COLORS = ['#EF4444', '#F59E0B', '#22C55E', '#2563EB', '#FFFFFF', '#000000'];
const TOOLS: { key: Tool; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'circle', icon: 'ellipse-outline' },
  { key: 'rect', icon: 'square-outline' },
  { key: 'arrow', icon: 'arrow-up-outline' },
  { key: 'text', icon: 'text-outline' },
];

interface Props {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
  onSave: (newUri: string) => void;
}

export function PhotoAnnotator({ visible, imageUri, onClose, onSave }: Props) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [tool, setTool] = useState<Tool>('circle');
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [textPrompt, setTextPrompt] = useState<{ x: number; y: number } | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const shotRef = useRef<View>(null);

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
    setShapes([]); setDraft(null); setTextPrompt(null); setTextDraft('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, imageUri]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX: x, locationY: y } = evt.nativeEvent;
        if (tool === 'text') {
          setTextPrompt({ x, y });
          setTextDraft('');
          return;
        }
        setDraft({ tool, color, x1: x, y1: y, x2: x, y2: y } as Shape);
      },
      onPanResponderMove: (evt) => {
        if (tool === 'text') return;
        const { locationX: x, locationY: y } = evt.nativeEvent;
        setDraft((d) => (d && d.tool !== 'text' ? { ...d, x2: x, y2: y } : d));
      },
      onPanResponderRelease: () => {
        setDraft((d) => {
          if (d && d.tool !== 'text') {
            const dx = Math.abs(d.x2 - d.x1);
            const dy = Math.abs(d.y2 - d.y1);
            // Ignora toques sin arrastre real (evita figuras invisibles de 0px).
            if (dx > 4 || dy > 4) setShapes((cur) => [...cur, d]);
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
    if (t) setShapes((cur) => [...cur, { tool: 'text', color, x: textPrompt.x, y: textPrompt.y, text: t }]);
    setTextPrompt(null);
    setTextDraft('');
  }

  function deshacer() {
    setShapes((cur) => cur.slice(0, -1));
  }

  async function guardar() {
    if (!shotRef.current || saving) return;
    setSaving(true);
    try {
      const uri = await captureRef(shotRef, { format: 'jpg', quality: 0.9, result: 'data-uri' });
      onSave(uri);
    } catch (e: any) {
      // best-effort: si falla la captura, no se pierde la foto original —
      // simplemente no se aplica la anotación.
    } finally {
      setSaving(false);
    }
  }

  function renderShape(s: Shape, idx: number) {
    if (s.tool === 'circle') {
      const rx = Math.abs(s.x2 - s.x1) / 2;
      const ry = Math.abs(s.y2 - s.y1) / 2;
      return (
        <Ellipse
          key={idx}
          cx={(s.x1 + s.x2) / 2} cy={(s.y1 + s.y2) / 2} rx={rx || 1} ry={ry || 1}
          stroke={s.color} strokeWidth={4} fill="none"
        />
      );
    }
    if (s.tool === 'rect') {
      const x = Math.min(s.x1, s.x2);
      const y = Math.min(s.y1, s.y2);
      const w = Math.abs(s.x2 - s.x1);
      const h = Math.abs(s.y2 - s.y1);
      return (
        <Polygon
          key={idx}
          points={`${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}`}
          stroke={s.color} strokeWidth={4} fill="none"
        />
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
        <React.Fragment key={idx}>
          <Line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={4} />
          <Polygon points={`${s.x2},${s.y2} ${p1x},${p1y} ${p2x},${p2y}`} fill={s.color} />
        </React.Fragment>
      );
    }
    // texto — contorno oscuro simulado con un segundo trazo detrás para que
    // se lea sobre fotos claras u oscuras por igual.
    return (
      <SvgText
        key={idx}
        x={s.x} y={s.y}
        fill={s.color} stroke="#00000080" strokeWidth={0.5}
        fontSize={22} fontWeight="bold"
      >
        {s.text}
      </SvgText>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Marcar foto</Text>
          <Pressable onPress={guardar} disabled={saving || !canvasSize} hitSlop={10}>
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
                {shapes.map(renderShape)}
                {draft ? renderShape(draft, -1) : null}
              </Svg>
            </View>
          )}
        </View>

        <View style={styles.toolbar}>
          <View style={styles.toolRow}>
            {TOOLS.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setTool(t.key)}
                style={[styles.toolBtn, tool === t.key && styles.toolBtnActive]}
              >
                <Ionicons name={t.icon} size={20} color={tool === t.key ? '#fff' : colors.textBody} />
              </Pressable>
            ))}
            <View style={styles.toolDivider} />
            <Pressable onPress={deshacer} disabled={shapes.length === 0} style={[styles.toolBtn, shapes.length === 0 && { opacity: 0.4 }]}>
              <Ionicons name="arrow-undo-outline" size={20} color={colors.textBody} />
            </Pressable>
          </View>
          <View style={styles.colorRow}>
            {COLORS.map((c) => (
              <Pressable
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
          (Alert.prompt no existe en Android). */}
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
              <Pressable onPress={() => setTextPrompt(null)} style={[styles.textPromptBtn, { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }]}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={confirmarTexto} style={[styles.textPromptBtn, { backgroundColor: colors.primary }]}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Agregar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
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
