// Indicador compacto de clima/temperatura para la zona del proyecto.
// Usa las coordenadas del primer Tramo (nodo raiz) que tenga target_lat/lon.
// Si ningun tramo tiene coordenadas, o falla la consulta, no renderiza nada.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, getWeather, LocationNode, WeatherNow } from '@/src/api';
import { colors, radius } from '@/src/theme';

type Props = {
  projectId: string;
  // Si el padre ya tiene los nodos cargados, se los pasa acá para evitar un
  // GET /nodes redundante en cada mount.
  nodes?: LocationNode[] | null;
};

export function WeatherWidget({ projectId, nodes: nodesProp }: Props) {
  const [weather, setWeather] = useState<WeatherNow | null>(null);

  useEffect(() => {
    let alive = true;
    if (!projectId) return;

    const applyNodes = async (nodes: LocationNode[] | null | undefined) => {
      const withCoords = (nodes || []).find(
        (n) => !n.parent_id && n.target_lat != null && n.target_lon != null,
      );
      if (!withCoords || withCoords.target_lat == null || withCoords.target_lon == null) return;
      const w = await getWeather(withCoords.target_lat, withCoords.target_lon);
      if (alive) setWeather(w);
    };

    if (Array.isArray(nodesProp)) {
      applyNodes(nodesProp).catch(() => { /* silencioso: widget opcional */ });
    } else {
      api.listNodes(projectId)
        .then(applyNodes)
        .catch(() => { /* silencioso: widget opcional */ });
    }
    return () => { alive = false; };
  }, [projectId, nodesProp]);

  if (!weather) return null;

  return (
    <View style={styles.pill}>
      <Ionicons name={weather.icon as any} size={14} color={colors.primary} />
      <Text style={styles.temp}>{Math.round(weather.tempC)}°C</Text>
      <Text style={styles.label}>{weather.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  temp: { fontSize: 12, fontWeight: '800', color: colors.text },
  label: { fontSize: 11, fontWeight: '600', color: '#6B7280' },
});
