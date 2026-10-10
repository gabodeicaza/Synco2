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
import { api, Area, CustomModule, Project } from '@/src/api';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { colors, radius, shadow, spacing } from '@/src/theme';
import {
  agruparModulosPorArea, asignacionesConPersonalizados, modulosActivos, modulosPersonalizadosDef, ModuloDef, SIN_AREA_ID,
} from '@/src/utils/modulos';

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
  const [personalizados, setPersonalizados] = useState<CustomModule[]>([]);
  const [areaSel, setAreaSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      setLoading(true);
      const [p, a, cm] = await Promise.all([
        api.getProject(projectId),
        api.listAreas(projectId).catch(() => [] as Area[]),
        api.listCustomModules(projectId).catch(() => [] as CustomModule[]),
      ]);
      setProject(p);
      setAreas(a);
      setPersonalizados(cm);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el proyecto.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Plantillas fijas encendidas + módulos creados con el Creador de módulos.
  const activos = [...modulosActivos(project?.modulos || null), ...modulosPersonalizadosDef(personalizados)];
  const grupos = agruparModulosPorArea(activos, asignacionesConPersonalizados(project?.modulos_areas, personalizados), areas);
  // Sin áreas asignadas = un solo grupo "General": lista plana, sin nivel extra.
  const plano = grupos.length === 1 && grupos[0].areaId === SIN_AREA_ID;
  const grupoSel = !plano && areaSel ? grupos.find((g) => g.areaId === areaSel) || null : null;
  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

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
    router.push({
      pathname: `${basePath}/${m.screen}` as any,
      params: m.customId ? { project_id: projectId, mid: m.customId } : { project_id: projectId },
    });

  const tarjetaModulo = (m: ModuloDef) => (
    <Pressable accessibilityRole="button" key={m.key} style={styles.card} onPress={() => abrir(m)}>
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
      <ScreenHeader title={grupoSel ? grupoSel.nombre : 'Módulos'} backgroundColor={headerColor} onBack={atras} fallbackHref={basePath} />

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
              <Pressable accessibilityRole="button" key={g.areaId} style={styles.card} onPress={() => setAreaSel(g.areaId)}>
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
