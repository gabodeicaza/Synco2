// Módulo "Estado del Tiempo" — captura MANUAL de Temperatura/Viento/
// Precipitación/Calidad del aire por nodo Estación + día (fecha CDMX). Esa
// sección del resumen impreso por Subtramo (ver draw_subtramo_summary_page/
// `_slide` en server.py) se llenaba 100% automático vía Open-Meteo; esta
// captura tiene PRIORIDAD sobre esa consulta cuando existe para hoy (ver
// upsert_weather_log en server.py) — si no se captura nada aquí, el export
// sigue usando el fetch automático sin cambios.
//
// Solo aparecen los nodos que ya están habilitados como "Estación" en
// Acceso al Predio (acceso_predio_efectivo && tipo_nodo === "estacion",
// mismo criterio que AccesoPredioManager.tsx) — un Intertramo no tiene
// sección de clima en su formato impreso, por eso no se ofrece aquí.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, LocationNode, Project, WeatherLog } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';

function nodePathNames(nodeId: string, byId: Record<string, LocationNode>): string[] {
  const names: string[] = [];
  let current: LocationNode | undefined = byId[nodeId];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    names.unshift(current.name);
    seen.add(current.id);
    current = current.parent_id ? byId[current.parent_id] : undefined;
  }
  return names;
}

type Campo = 'temperature_c' | 'wind_kmh' | 'precipitation_mm' | 'us_aqi';
type Draft = Record<Campo, string>;

// Mismas etiquetas/unidades que ya imprime draw_subtramo_summary_page
// ("Temperatura:", "Viento:", "Precipitación:", "Calidad del aire:").
const CAMPOS: { campo: Campo; label: string; unidad: string; placeholder: string }[] = [
  { campo: 'temperature_c', label: 'Temperatura', unidad: '°C', placeholder: 'Ej. 24' },
  { campo: 'wind_kmh', label: 'Viento', unidad: 'km/hr', placeholder: 'Ej. 5.8' },
  { campo: 'precipitation_mm', label: 'Precipitación', unidad: 'mm', placeholder: 'Ej. 0.0' },
  { campo: 'us_aqi', label: 'Calidad del aire', unidad: 'ICA', placeholder: 'Ej. 53.8' },
];

function draftFromLog(log: WeatherLog | undefined): Draft {
  return {
    temperature_c: log?.temperature_c != null ? String(log.temperature_c) : '',
    wind_kmh: log?.wind_kmh != null ? String(log.wind_kmh) : '',
    precipitation_mm: log?.precipitation_mm != null ? String(log.precipitation_mm) : '',
    us_aqi: log?.us_aqi != null ? String(log.us_aqi) : '',
  };
}

function parseNum(s: string): number | null {
  const t = (s || '').trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function EstadoTiempoScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [allNodes, setAllNodes] = useState<LocationNode[]>([]);
  const [logs, setLogs] = useState<Record<string, WeatherLog>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const byId = useMemo(() => {
    const m: Record<string, LocationNode> = {};
    allNodes.forEach((n) => { m[n.id] = n; });
    return m;
  }, [allNodes]);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      setLoading(true);
      const [proj, nodes, logsRes] = await Promise.all([
        api.getProject(projectId), api.listNodes(projectId), api.listWeatherLogs(projectId),
      ]);
      setProject(proj);
      setAllNodes(nodes || []);
      const byNode: Record<string, WeatherLog> = {};
      (logsRes.logs || []).forEach((l) => { byNode[l.node_id] = l; });
      setLogs(byNode);
      const d: Record<string, Draft> = {};
      (nodes || []).forEach((n) => { d[n.id] = draftFromLog(byNode[n.id]); });
      setDrafts(d);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar Estado del Tiempo');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const estaciones = useMemo(
    () => allNodes.filter((n) => n.acceso_predio_efectivo && (n.tipo_nodo || 'estacion') === 'estacion'),
    [allNodes],
  );

  function isDirty(nodeId: string): boolean {
    const d = drafts[nodeId];
    if (!d) return false;
    const base = draftFromLog(logs[nodeId]);
    return CAMPOS.some(({ campo }) => (d[campo] || '') !== (base[campo] || ''));
  }

  async function save(nodeId: string) {
    if (busy[nodeId]) return;
    const d = drafts[nodeId];
    if (!d) return;
    setBusy((b) => ({ ...b, [nodeId]: true }));
    try {
      const updated = await api.upsertWeatherLog(projectId, {
        node_id: nodeId,
        temperature_c: parseNum(d.temperature_c),
        wind_kmh: parseNum(d.wind_kmh),
        precipitation_mm: parseNum(d.precipitation_mm),
        us_aqi: parseNum(d.us_aqi),
      });
      setLogs((prev) => ({ ...prev, [nodeId]: updated }));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo guardar el clima de hoy');
    } finally {
      setBusy((b) => ({ ...b, [nodeId]: false }));
    }
  }

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Estado del Tiempo</Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.help}>
          Captura manual de temperatura, viento, precipitación y calidad del aire de hoy por estación —
          reemplaza a la consulta automática en el resumen exportado (PDF/PPT) mientras exista una captura del día.
        </Text>

        {estaciones.length === 0 ? (
          <Text style={styles.empty}>No hay nodos tipo Estación habilitados en Acceso al Predio todavía.</Text>
        ) : (
          estaciones.map((n) => {
            const path = nodePathNames(n.id, byId);
            const breadcrumb = path.slice(0, -1).join(' › ') || 'Raíz';
            const d = drafts[n.id] || draftFromLog(undefined);
            const dirty = isDirty(n.id);
            const log = logs[n.id];
            return (
              <View key={n.id} style={styles.card}>
                <Text style={styles.tramoLabel} numberOfLines={1}>{breadcrumb}</Text>
                <Text style={styles.subtramoName} numberOfLines={2}>{n.name}</Text>
                <Text style={styles.updatedTxt}>
                  {log ? `Última captura: ${log.captured_by_name}` : 'Sin captura hoy — se usará el clima automático'}
                </Text>

                <View style={styles.camposRow}>
                  {CAMPOS.map(({ campo, label, unidad, placeholder }) => (
                    <View key={campo} style={styles.campoBox}>
                      <Text style={styles.campoLabel}>{label} ({unidad})</Text>
                      <TextInput
                        value={d[campo]}
                        onChangeText={(t) => setDrafts((prev) => ({
                          ...prev, [n.id]: { ...(prev[n.id] || draftFromLog(undefined)), [campo]: t },
                        }))}
                        placeholder={placeholder}
                        placeholderTextColor={colors.textMuted}
                        keyboardType="numeric"
                        style={styles.campoInput}
                        editable={!busy[n.id]}
                      />
                    </View>
                  ))}
                </View>

                {dirty ? (
                  <Pressable onPress={() => save(n.id)} disabled={!!busy[n.id]} style={styles.saveBtn}>
                    {busy[n.id] ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="save-outline" size={16} color="#fff" />
                        <Text style={styles.saveBtnTxt}>Guardar</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleBar: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  scroll: { padding: spacing.md, gap: spacing.md },
  help: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontStyle: 'italic' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.card, gap: 8 },
  tramoLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  subtramoName: { fontSize: 16, fontWeight: '800', color: colors.text },
  updatedTxt: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic' },
  camposRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  campoBox: { flexGrow: 1, minWidth: '45%' },
  campoLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  campoInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.md, backgroundColor: colors.primary,
  },
  saveBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
