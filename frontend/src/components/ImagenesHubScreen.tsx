// Hub "Imágenes" — todas las fotos de los reportes de un periodo, agrupadas por
// nodo. Miniaturas del mismo tamaño que las del inicio (64 px); al tocar una se
// abre el visor con la foto y la información del reporte. Con un periodo
// elegido se pueden descargar todas las fotos, a tamaño completo, en un ZIP
// (una carpeta por nodo). Coordinador y Sub-Coordinador.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ImagenHub } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { colors, contrastText, radius, spacing } from '@/src/theme';
import { homeRouteForRole } from '@/src/utils/roles';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { RangoFechasPicker } from '@/src/components/RangoFechasPicker';
import { downloadBlob } from '@/src/utils/downloadBlob';
import {
  formatearRangoLegible, rangoAyer, rangoEsteMes, rangoEstaSemana, rangoHoy, RangoFechas,
} from '@/src/utils/rangoFechas';

type FiltroRapido = 'hoy' | 'ayer' | 'semana' | 'mes' | 'custom';

const FILTROS_RAPIDOS: { key: Exclude<FiltroRapido, 'custom'>; label: string; rango: () => RangoFechas }[] = [
  { key: 'hoy', label: 'Hoy', rango: rangoHoy },
  { key: 'ayer', label: 'Ayer', rango: rangoAyer },
  { key: 'semana', label: 'Esta semana', rango: rangoEstaSemana },
  { key: 'mes', label: 'Este mes', rango: rangoEsteMes },
];

const PAGINA = 60;
const claveNodo = (it: ImagenHub) => it.node_path_names.join(' › ') || 'Sin nodo';

function fmtFecha(f: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(f || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}` : ''}` : f;
}

export function ImagenesHubScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [color, setColor] = useState<string | null>(null);
  const acento = color || colors.primary;
  const textoHeader = contrastText(acento);
  const chipBg = textoHeader !== '#FFFFFF' ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.18)';

  const [rango, setRango] = useState<RangoFechas>(() => rangoEstaSemana());
  const [filtro, setFiltro] = useState<FiltroRapido>('semana');
  const [rangoOpen, setRangoOpen] = useState(false);

  const [items, setItems] = useState<ImagenHub[]>([]);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  const [sel, setSel] = useState<ImagenHub | null>(null);
  const [selImg, setSelImg] = useState<string | null>(null);
  const [selCargando, setSelCargando] = useState(false);

  useEffect(() => {
    api.getProject(projectId).then((p) => setColor(p.color_institucional || p.color_tema || null)).catch(() => {});
  }, [projectId]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await api.listImagenesHub(projectId, rango.desde, rango.hasta, 0, PAGINA);
      setItems(r.items);
      setTotal(r.total);
      setHayMas(r.has_more);
    } catch (e: any) {
      setItems([]);
      setTotal(0);
      setHayMas(false);
      setError(e?.message || 'No se pudieron cargar las imágenes');
    } finally {
      setCargando(false);
    }
  }, [projectId, rango.desde, rango.hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  async function cargarMas() {
    if (cargandoMas || !hayMas) return;
    setCargandoMas(true);
    try {
      const r = await api.listImagenesHub(projectId, rango.desde, rango.hasta, items.length, PAGINA);
      setItems((prev) => [...prev, ...r.items]);
      setTotal(r.total);
      setHayMas(r.has_more);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar más imágenes');
    } finally {
      setCargandoMas(false);
    }
  }

  async function abrir(it: ImagenHub) {
    setSel(it);
    setSelImg(null);
    setSelCargando(true);
    try {
      const r = await api.getImagenHub(projectId, it.report_id, it.index);
      setSelImg(r.image);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar la imagen');
    } finally {
      setSelCargando(false);
    }
  }

  async function descargarZip() {
    if (descargando) return;
    setDescargando(true);
    try {
      const { blob, filename } = await api.downloadImagenesZip(projectId, rango.desde, rango.hasta);
      await downloadBlob(blob, filename, 'application/zip');
    } catch (e: any) {
      Alert.alert('No se pudo descargar', e?.message || 'Intenta de nuevo');
    } finally {
      setDescargando(false);
    }
  }

  const grupos = useMemo(() => {
    const m = new Map<string, ImagenHub[]>();
    for (const it of items) {
      const k = claveNodo(it);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return Array.from(m.entries());
  }, [items]);

  function elegirRapido(f: (typeof FILTROS_RAPIDOS)[number]) {
    setFiltro(f.key);
    setRango(f.rango());
  }

  const periodo = formatearRangoLegible(rango.desde, rango.hasta);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title="Imágenes"
        backgroundColor={acento}
        fallbackHref={homeRouteForRole(user?.role) as any}
        right={total > 0 ? (
          <Pressable
            accessibilityRole="button" accessibilityLabel="Descargar todas las imágenes (ZIP)"
            onPress={descargarZip} disabled={descargando} hitSlop={8} style={styles.descargaBtn}
          >
            {descargando
              ? <ActivityIndicator size="small" color={textoHeader} />
              : <Ionicons name="download-outline" size={22} color={textoHeader} />}
          </Pressable>
        ) : undefined}
      />
      <View style={[styles.filtros, { backgroundColor: acento }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {FILTROS_RAPIDOS.map((f) => (
            <Pressable
              accessibilityRole="button" key={f.key} onPress={() => elegirRapido(f)}
              style={[styles.chip, { backgroundColor: chipBg }, filtro === f.key && { backgroundColor: textoHeader }]}
            >
              <Text style={[styles.chipTxt, { color: textoHeader }, filtro === f.key && { color: acento }]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable accessibilityRole="button" style={[styles.rangoBtn, { backgroundColor: chipBg }]} onPress={() => setRangoOpen(true)}>
          <Ionicons name="calendar-outline" size={14} color={textoHeader} />
          <Text style={[styles.chipTxt, { color: textoHeader }]} numberOfLines={1}>{periodo}</Text>
        </Pressable>
      </View>

      {cargando ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorTxt}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={cargar} style={[styles.reintentar, { backgroundColor: acento }]}>
            <Text style={{ color: textoHeader, fontWeight: '800' }}>Reintentar</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="images-outline" size={28} color={colors.textMuted} />
          <Text style={styles.vacioTxt}>No hay imágenes en este periodo.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
          <Text style={styles.resumen}>
            {total} {total === 1 ? 'imagen' : 'imágenes'} · {grupos.length} {grupos.length === 1 ? 'nodo' : 'nodos'}
            {hayMas ? ` (mostrando ${items.length})` : ''}
          </Text>
          {grupos.map(([nodo, fotos]) => (
            <View key={nodo} style={styles.grupo}>
              <Text style={styles.grupoTitulo} numberOfLines={2}>{nodo}</Text>
              <View style={styles.grid}>
                {fotos.map((it) => (
                  <Pressable
                    accessibilityRole="button" accessibilityLabel={`Ver imagen: ${it.titulo}`}
                    key={`${it.report_id}-${it.index}`} onPress={() => abrir(it)} style={styles.thumbWrap}
                  >
                    {it.thumb ? (
                      <Image source={{ uri: it.thumb }} style={styles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbVacio]}>
                        <Ionicons name="image-outline" size={20} color={colors.textMuted} />
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          {hayMas ? (
            <Pressable accessibilityRole="button" onPress={cargarMas} disabled={cargandoMas} style={[styles.masBtn, { borderColor: acento }]}>
              {cargandoMas
                ? <ActivityIndicator color={colors.primary} />
                : <Text style={[styles.masTxt, { color: colors.primary }]}>Cargar más imágenes</Text>}
            </Pressable>
          ) : null}
        </ScrollView>
      )}

      <RangoFechasPicker
        visible={rangoOpen}
        desdeInicial={rango.desde}
        hastaInicial={rango.hasta}
        onCancelar={() => setRangoOpen(false)}
        onConfirmar={(d, h) => { setRango({ desde: d, hasta: h }); setFiltro('custom'); setRangoOpen(false); }}
      />

      <Modal visible={!!sel} transparent animationType="fade" onRequestClose={() => setSel(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {selCargando ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
              ) : selImg ? (
                <Image source={{ uri: selImg }} style={styles.grande} resizeMode="contain" />
              ) : sel?.thumb ? (
                <Image source={{ uri: sel.thumb }} style={styles.grande} resizeMode="contain" />
              ) : null}
              {sel ? <Info it={sel} /> : null}
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={() => setSel(null)} style={[styles.cerrar, { backgroundColor: acento }]}>
              <Text style={{ color: textoHeader, fontWeight: '800' }}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Info({ it }: { it: ImagenHub }) {
  const filas: [string, string | null | undefined][] = [
    ['Reporte', it.titulo],
    ['Nodo', it.node_path_names.join(' › ')],
    ['Fecha y hora', it.fecha ? fmtFecha(it.fecha) : null],
    ['Capturó', it.capturado_por],
    ['Área', it.area],
    ['Pie de foto', it.caption],
    ['Actividades', it.actividades],
    ['Observaciones', it.observaciones],
    ['Incidencias', it.incidencias],
    ['Foto', `${it.index + 1} de ${it.n_fotos_reporte} del reporte`],
  ];
  const hayGps = typeof it.lat === 'number' && typeof it.lon === 'number';
  return (
    <View style={{ marginTop: spacing.md, gap: 8 }}>
      {filas.filter(([, v]) => !!v).map(([k, v]) => (
        <View key={k}>
          <Text style={styles.infoK}>{k}</Text>
          <Text style={styles.infoV}>{v}</Text>
        </View>
      ))}
      {hayGps ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => Linking.openURL(`https://www.google.com/maps?q=${it.lat},${it.lon}`)}
          style={styles.gps}
        >
          <Ionicons name="location-outline" size={16} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
            Ver ubicación ({it.lat!.toFixed(5)}, {it.lon!.toFixed(5)})
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  filtros: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, marginRight: 6 },
  chipTxt: { fontSize: 12, fontWeight: '700' },
  rangoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, marginTop: spacing.xs, maxWidth: '100%',
  },
  descargaBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  errorTxt: { color: colors.error, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  vacioTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  reintentar: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md },
  resumen: { fontSize: 12, color: colors.textMuted, fontWeight: '700', marginBottom: spacing.sm },
  grupo: { marginBottom: spacing.md },
  grupoTitulo: { fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumbWrap: { width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bg },
  thumb: { width: '100%', height: '100%' },
  thumbVacio: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  masBtn: { borderWidth: 1, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', marginTop: spacing.sm },
  masTxt: { fontWeight: '800', fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, maxHeight: '92%' },
  grande: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.bg },
  cerrar: { marginTop: spacing.md, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' },
  infoK: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  infoV: { fontSize: 14, color: colors.text },
  gps: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
});
