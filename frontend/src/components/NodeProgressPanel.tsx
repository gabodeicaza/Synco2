// Panel "Progreso por nodo" con graficas circulares.
// Calcula el porcentaje = (reportes asociados al nodo) / meta * 100.
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CircularProgress from 'react-native-circular-progress-indicator';
import { api, FeedItem, LocationNode } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';

type Props = {
  projectId: string;
  reports?: FeedItem[] | null;
  // Si el padre ya tiene los nodos cargados (ej. dashboard del Sub-Coordinador),
  // se los pasa acá para evitar un segundo GET /nodes redundante en cada mount.
  nodes?: LocationNode[] | null;
};

export function NodeProgressPanel({ projectId, reports, nodes: nodesProp }: Props) {
  const safeReports: FeedItem[] = Array.isArray(reports) ? reports : [];
  const hasNodesProp = Array.isArray(nodesProp);
  const [fetchedNodes, setFetchedNodes] = useState<LocationNode[]>([]);
  const [loading, setLoading] = useState(!hasNodesProp);
  const [error, setError] = useState<string | null>(null);
  const nodes = hasNodesProp ? (nodesProp as LocationNode[]) : fetchedNodes;

  useEffect(() => {
    if (hasNodesProp) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      if (!projectId) return;
      try {
        setError(null);
        const list = await api.listNodes(projectId);
        if (!alive) return;
        setFetchedNodes(list || []);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'No se pudieron cargar los nodos');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId, hasNodesProp]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    // Fuente de verdad: avance_actual viene persistido del backend (MAX ultima_lectura).
    for (const n of nodes) {
      const anyN: any = n;
      const persisted = Number(anyN?.avance_actual);
      if (Number.isFinite(persisted) && persisted > 0) {
        map.set(n.id, persisted);
      }
    }
    // Si llegan reports recientes en memoria, dejamos que sobrescriban con el MAX local.
    for (const r of safeReports) {
      if (!r || !r.node_id) continue;
      const anyR: any = r;
      const reading = parseFloat(String(anyR.ultima_lectura ?? anyR.medicion ?? anyR.avance ?? ''));
      if (!Number.isFinite(reading)) continue;
      const prev = map.get(r.node_id) || 0;
      if (reading > prev) map.set(r.node_id, reading);
    }
    return map;
  }, [nodes, safeReports]);

  const items = useMemo(
    () => nodes
      .filter((n) => typeof n.meta === 'number' && (n.meta || 0) > 0)
      .sort((a, b) => (b.meta || 0) - (a.meta || 0))
      .slice(0, 12),
    [nodes],
  );

  if (loading) {
    return (
      <View style={styles.card}>
        <PanelHeader count={0} />
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.card}>
        <PanelHeader count={0} />
        <View style={styles.errBox}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
          <Text style={styles.errTxt}>{error}</Text>
        </View>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.card}>
        <PanelHeader count={0} />
        <View style={styles.emptyBox}>
          <Ionicons name="pie-chart-outline" size={20} color={colors.textMuted} />
          <Text style={styles.emptyTxt}>
            Aun no hay metas numericas en los nodos. Definilas en el arbol del proyecto para visualizar el avance.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <PanelHeader count={items.length} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: 2 }}
      >
        {items.map((n) => {
          const meta = n.meta || 0;
          const current = counts.get(n.id) || 0;
          const pctRaw = meta > 0 ? Math.min(100, Math.round((current / meta) * 100)) : 0;
          const tint = pctRaw >= 100 ? colors.success : pctRaw >= 50 ? colors.primary : colors.warning;
          return (
            <View key={n.id} style={styles.tile}>
              <CircularProgress
                value={pctRaw}
                radius={42}
                maxValue={100}
                duration={650}
                progressValueColor={colors.text}
                activeStrokeColor={tint}
                inActiveStrokeColor={colors.border}
                inActiveStrokeOpacity={0.5}
                inActiveStrokeWidth={8}
                activeStrokeWidth={9}
                valueSuffix="%"
                titleFontSize={9}
                progressValueFontSize={16}
              />
              <Text style={styles.tileName} numberOfLines={2}>{n.name}</Text>
              <Text style={styles.tileMeta}>{current} / {meta}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function PanelHeader({ count }: { count: number }) {
  return (
    <View style={styles.headerRow}>
      <View style={styles.headerIcon}>
        <Ionicons name="pie-chart" size={16} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Avance por nodo</Text>
        <Text style={styles.subtitle}>
          {count === 0 ? 'Configura metas numericas en los nodos' : `${count} nodos con meta activa`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadow.card,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerIcon: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontWeight: '600' },

  center: { padding: spacing.md, alignItems: 'center' },
  errBox: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.sm },
  errTxt: { color: colors.textBody, fontSize: 12, flex: 1 },

  emptyBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  emptyTxt: { fontSize: 12, color: colors.textMuted, flex: 1, lineHeight: 18 },

  tile: {
    width: 112,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  tileName: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginTop: 6,
  },
  tileMeta: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '700',
  },
});
