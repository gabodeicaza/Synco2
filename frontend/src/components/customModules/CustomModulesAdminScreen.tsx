// Creador de módulos — pantalla de administración del Coordinador General:
// lista los módulos personalizados del proyecto, permite crear uno nuevo (desde
// una plantilla o en blanco), editarlo, encenderlo/apagarlo, reordenarlo,
// duplicarlo (en este proyecto o en otro) y borrarlo.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Modal, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, Area, CustomModule, CustomModuleInput, Project } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { PLANTILLAS, resumenSalida } from '@/src/utils/customModules';
import { Header } from './ui';
import { CustomModuleBuilder } from './CustomModuleBuilder';

export default function CustomModulesAdminScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [items, setItems] = useState<CustomModule[]>([]);
  const [eligiendo, setEligiendo] = useState(false); // selector de plantilla
  const [builder, setBuilder] = useState<{ inicial: CustomModuleInput | CustomModule; id: string | null; n: number } | null>(null);
  const [copiando, setCopiando] = useState<CustomModule | null>(null);
  const [proyectos, setProyectos] = useState<Project[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [p, a, list] = await Promise.all([
        api.getProject(projectId), api.listAreas(projectId).catch(() => [] as Area[]), api.listCustomModules(projectId, true),
      ]);
      setProject(p);
      setAreas(a);
      setItems(list);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar los módulos.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function toggleActivo(m: CustomModule, v: boolean) {
    setItems((l) => l.map((x) => (x.id === m.id ? { ...x, activo: v } : x)));
    try {
      await api.updateCustomModule(projectId, m.id, { activo: v });
    } catch (e: any) {
      setItems((l) => l.map((x) => (x.id === m.id ? { ...x, activo: !v } : x)));
      Alert.alert('No se pudo guardar', e?.message || 'Inténtalo nuevamente.');
    }
  }

  async function mover(idx: number, delta: number) {
    const j = idx + delta;
    if (j < 0 || j >= items.length) return;
    const copia = [...items];
    [copia[idx], copia[j]] = [copia[j], copia[idx]];
    setItems(copia);
    try {
      await api.reorderCustomModules(projectId, copia.map((m) => m.id));
    } catch (e: any) {
      Alert.alert('No se pudo reordenar', e?.message || 'Inténtalo nuevamente.');
      load();
    }
  }

  async function duplicar(m: CustomModule, destino?: string) {
    try {
      setOcupado(m.id);
      await api.duplicateCustomModule(projectId, m.id, destino);
      setCopiando(null);
      if (!destino || destino === projectId) await load();
      else Alert.alert('Listo', 'El módulo se copió al otro proyecto (apagado, para que lo revises).');
    } catch (e: any) {
      Alert.alert('No se pudo duplicar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setOcupado(null);
    }
  }

  async function abrirCopiar(m: CustomModule) {
    setCopiando(m);
    if (!proyectos.length) {
      try { setProyectos(await api.listProjects()); } catch { /* solo se ofrece "este proyecto" */ }
    }
  }

  async function borrar(m: CustomModule) {
    const n = m.n_registros || 0;
    const detalle = n > 0
      ? `Tiene ${n} registro${n === 1 ? '' : 's'} capturado${n === 1 ? '' : 's'} que se borrarán junto con el módulo. Si solo quieres ocultarlo, apágalo en vez de borrarlo. Esta acción no se puede deshacer.`
      : 'Esta acción no se puede deshacer.';
    const ok = await confirm('Borrar módulo', `¿Borrar «${m.nombre}»?\n\n${detalle}`, { confirmText: 'Borrar', destructive: true });
    if (!ok) return;
    try {
      setOcupado(m.id);
      await api.deleteCustomModule(projectId, m.id, n > 0);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo borrar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setOcupado(null);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Creador de módulos" color={headerColor} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl * 2 }]}>
        <Text style={styles.help}>
          Crea tus propios módulos: eliges los campos que se capturan (texto, números, listas, interruptores, fotos,
          cálculos…) y, para cada informe, si se imprime como texto, como tabla, como resumen, como fotos o si no se
          imprime. Los módulos activos aparecen en el menú de Módulos de tu equipo.
        </Text>

        <Button label="Nuevo módulo" icon={<Ionicons name="add" size={18} color="#fff" />} onPress={() => setEligiendo(true)} />
        <View style={{ height: spacing.md }} />

        {items.length === 0 ? (
          <View style={[styles.card, { alignItems: 'center', padding: spacing.lg }]}>
            <Ionicons name="construct-outline" size={30} color={colors.textMuted} />
            <Text style={styles.emptyTxt}>Aún no has creado módulos en este proyecto.</Text>
          </View>
        ) : null}

        {items.map((m, idx) => (
          <View key={m.id} style={[styles.card, !m.activo && { opacity: 0.7 }]}>
            <View style={styles.top}>
              <View style={styles.icon}><Ionicons name={(m.icono as any) || 'cube-outline'} size={20} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{m.nombre}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {m.campos.length} campo{m.campos.length === 1 ? '' : 's'} · {m.n_registros || 0} registro{m.n_registros === 1 ? '' : 's'}
                  {m.area_id ? ` · ${areas.find((a) => a.id === m.area_id)?.name || 'Área'}` : ''}
                </Text>
              </View>
              <Switch value={m.activo} onValueChange={(v) => toggleActivo(m, v)} trackColor={{ false: colors.border, true: colors.primary }} />
            </View>
            <Text style={styles.salida}>{resumenSalida(m.salida)}</Text>
            <View style={styles.actions}>
              <Pressable hitSlop={8} onPress={() => mover(idx, -1)} disabled={idx === 0}><Ionicons name="arrow-up" size={18} color={idx === 0 ? colors.border : colors.text} /></Pressable>
              <Pressable hitSlop={8} onPress={() => mover(idx, 1)} disabled={idx === items.length - 1}><Ionicons name="arrow-down" size={18} color={idx === items.length - 1 ? colors.border : colors.text} /></Pressable>
              <View style={{ flex: 1 }} />
              <Action icon="list-outline" label="Registros" onPress={() => router.push({ pathname: '/(coord)/projects/[id]/modulo-personalizado' as any, params: { id: projectId, mid: m.id } })} />
              <Action icon="create-outline" label="Editar" onPress={() => setBuilder({ inicial: m, id: m.id, n: m.n_registros || 0 })} />
              <Action icon="copy-outline" label="Copiar" onPress={() => abrirCopiar(m)} />
              {ocupado === m.id ? <ActivityIndicator size="small" color={colors.primary} /> : (
                <Pressable hitSlop={8} onPress={() => borrar(m)}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Selector de plantilla */}
      <Modal visible={eligiendo} transparent animationType="fade" onRequestClose={() => setEligiendo(false)}>
        <Pressable style={styles.backdrop} onPress={() => setEligiendo(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>¿Cómo quieres empezar?</Text>
            <ScrollView style={{ maxHeight: 440 }}>
              {PLANTILLAS.map((p) => (
                <Pressable
                  key={p.clave} style={styles.plantilla}
                  onPress={() => { setEligiendo(false); setBuilder({ inicial: p.crear(), id: null, n: 0 }); }}
                >
                  <View style={styles.icon}><Ionicons name={p.icon} size={20} color="#fff" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{p.nombre}</Text>
                    <Text style={styles.meta}>{p.descripcion}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Copiar */}
      <Modal visible={!!copiando} transparent animationType="fade" onRequestClose={() => setCopiando(null)}>
        <Pressable style={styles.backdrop} onPress={() => setCopiando(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Copiar «{copiando?.nombre}»</Text>
            <Text style={styles.meta}>Se copia la definición (campos y reglas de impresión), sin registros y apagada.</Text>
            <ScrollView style={{ maxHeight: 360, marginTop: spacing.sm }}>
              <Pressable style={styles.plantilla} onPress={() => copiando && duplicar(copiando)}>
                <Ionicons name="copy-outline" size={20} color={colors.primary} />
                <Text style={[styles.name, { flex: 1 }]}>En este proyecto</Text>
              </Pressable>
              {proyectos.filter((p) => p.id !== projectId).map((p) => (
                <Pressable key={p.id} style={styles.plantilla} onPress={() => copiando && duplicar(copiando, p.id)}>
                  <Ionicons name="business-outline" size={20} color={colors.primary} />
                  <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {builder ? (
        <CustomModuleBuilder
          projectId={projectId} inicial={builder.inicial} moduleId={builder.id} nRegistros={builder.n}
          areas={areas} headerColor={headerColor}
          onClose={() => setBuilder(null)}
          onSaved={async () => { setBuilder(null); await load(); }}
        />
      ) : null}
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.action}>
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={styles.actionTxt}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.md },
  help: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, ...shadow.card },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 38, height: 38, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 14, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  salida: { fontSize: 12, color: colors.textBody, marginTop: spacing.sm, lineHeight: 16 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  plantilla: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
});
