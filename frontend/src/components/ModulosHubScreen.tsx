// Hub de módulos — reemplaza la lista plana que antes vivía directo dentro
// del menú hamburguesa (HeaderMenu.tsx): con varios módulos encendidos a la
// vez esa lista rompía el layout del dropdown. Ahora el menú solo ofrece un
// botón "Módulos" que trae aquí, a una pantalla completa con espacio propio
// — misma fuente de datos (`modulosActivos`, sistema Multi-Proyecto Modular)
// que ya usan la pestaña Operación de Coordinador General y la pantalla de
// Configuración > Módulos.
//
// Dos niveles: primero las ÁREAS (las que el Coordinador General asignó a cada
// módulo en Configuración > Módulos, `project.modulos_areas`) y, al entrar a
// una, todas sus herramientas. Los módulos sin área van en "General". Si el
// Coordinador aún no asignó ninguna, se muestra la lista plana de siempre.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, Area, Project } from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { agruparModulosPorArea, modulosActivos, ModuloDef, SIN_AREA_ID } from '@/src/utils/modulos';

export default function ModulosHubScreen({
  projectId, basePath,
}: {
  projectId: string;
  basePath: '/(subcoord)' | '/(spec)';
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areaSel, setAreaSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      setLoading(true);
      const [p, a] = await Promise.all([api.getProject(projectId), api.listAreas(projectId).catch(() => [] as Area[])]);
      setProject(p);
      setAreas(a);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el proyecto.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const activos = modulosActivos(project?.modulos || null);
  const grupos = agruparModulosPorArea(activos, project?.modulos_areas, areas);
  // Sin áreas asignadas = un solo grupo "General": lista plana, sin nivel extra.
  const plano = grupos.length === 1 && grupos[0].areaId === SIN_AREA_ID;
  const grupoSel = !plano && areaSel ? grupos.find((g) => g.areaId === areaSel) || null : null;
  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const atras = useCallback(() => {
    if (grupoSel) setAreaSel(null);
    else router.back();
  }, [grupoSel]);

  // El botón "atrás" de Android también sale del área antes de salir del hub.
  useEffect(() => {
    if (!grupoSel) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setAreaSel(null); return true; });
    return () => sub.remove();
  }, [grupoSel]);

  const abrir = (m: ModuloDef) =>
    router.push({ pathname: `${basePath}/${m.screen}` as any, params: { project_id: projectId } });

  const tarjetaModulo = (m: ModuloDef) => (
    <Pressable key={m.key} style={styles.card} onPress={() => abrir(m)}>
      <View style={styles.cardIcon}>
        <Ionicons name={m.icon} size={20} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{m.label}</Text>
        <Text style={styles.cardSubtitle} numberOfLines={2}>{m.subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={atras} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>
            {grupoSel ? grupoSel.nombre : 'Módulos'}
          </Text>
          <View style={{ width: 32 }} />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          {activos.length === 0 ? (
            <Text style={styles.empty}>Tu Coordinador General aún no ha activado ningún módulo para este proyecto.</Text>
          ) : plano ? (
            grupos[0].modulos.map(tarjetaModulo)
          ) : grupoSel ? (
            grupoSel.modulos.map(tarjetaModulo)
          ) : (
            grupos.map((g) => (
              <Pressable key={g.areaId} style={styles.card} onPress={() => setAreaSel(g.areaId)}>
                <View style={[styles.cardIcon, { backgroundColor: g.color || colors.primary }]}>
                  <Ionicons name={g.areaId === SIN_AREA_ID ? 'apps-outline' : 'folder-open-outline'} size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{g.nombre}</Text>
                  <Text style={styles.cardSubtitle} numberOfLines={2}>
                    {g.modulos.length} {g.modulos.length === 1 ? 'herramienta' : 'herramientas'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleBar: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.md, gap: spacing.sm },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontStyle: 'italic' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.card,
  },
  cardIcon: {
    width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  cardSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
