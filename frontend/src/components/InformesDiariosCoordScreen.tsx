// Informes diarios de los ingenieros — hub del equipo (Coordinador, Jefe, Sub-coordinadores y Especialistas).
// Lista, por día, el informe de cada ingeniero del proyecto (estado y si ya lo confirmó). Se puede
// buscar a una persona, filtrar por área e imprimir: el informe de una persona, el del día (de todas
// las áreas o de una sola) y el compilado de la semana (domingo a sábado) con hoja de firmas.
// Todos los PDF salen con portada.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Area, InformeDiario } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { BuscadorPersonas } from '@/src/components/BuscadorPersonas';
import { InformeEditor } from '@/src/components/InformeEditor';
import { colors, radius, spacing } from '@/src/theme';
import { filtrarPersonas } from '@/src/utils/buscarPersonas';
import { dayjs } from '@/src/utils/tz';
import { downloadBlob } from '@/src/utils/downloadBlob';

type Fila = Omit<InformeDiario, 'bloques'>;

const ESTADO: Record<string, { txt: string; fg: string; bg: string }> = {
  confirmado: { txt: 'Confirmado', fg: '#166534', bg: '#DCFCE7' },
  listo: { txt: 'Sin confirmar', fg: '#92400E', bg: '#FEF3C7' },
  pendiente: { txt: 'Preparando', fg: '#1E3A8A', bg: '#DBEAFE' },
  procesando: { txt: 'Preparando', fg: '#1E3A8A', bg: '#DBEAFE' },
  sin_actividad: { txt: 'Sin reportes', fg: '#475569', bg: '#E2E8F0' },
};

const SIN_AREA = '__sin_area__';

export function InformesDiariosCoordScreen({ projectId, onBack }: { projectId: string; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEditarClave = user?.role === 'coordinador_general';
  const [clave, setClave] = useState('');
  const [claveSugerida, setClaveSugerida] = useState('');
  const [claveEdit, setClaveEdit] = useState('');
  const [guardandoClave, setGuardandoClave] = useState(false);
  const [fecha, setFecha] = useState(dayjs().format('YYYY-MM-DD'));
  const [filas, setFilas] = useState<Fila[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areaSel, setAreaSel] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [editando, setEditando] = useState<Fila | null>(null);

  const cargar = useCallback(async () => {
    if (!projectId) return;
    try {
      setError(null);
      const r = await api.informesDiariosCumplimiento(projectId, fecha);
      setFilas(r.informes);
      setClave(r.clave || '');
      setClaveSugerida(r.clave_sugerida || '');
      setClaveEdit(r.clave || '');
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los informes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, fecha]);

  useEffect(() => { setLoading(true); cargar(); }, [cargar]);
  useEffect(() => { api.listAreas(projectId).then(setAreas).catch(() => setAreas([])); }, [projectId]);

  const bajar = async (clave: string, fn: () => Promise<{ blob: Blob; filename: string }>) => {
    setDescargando(clave);
    try {
      const r = await fn();
      await downloadBlob(r.blob, r.filename, 'application/pdf');
    } catch (e: any) {
      Alert.alert('No se pudo descargar', e?.message || 'Intenta de nuevo');
    } finally {
      setDescargando(null);
    }
  };

  const guardarClave = async () => {
    setGuardandoClave(true);
    try {
      const r = await api.informeDiarioGuardarClave(projectId, claveEdit.trim());
      setClave(r.clave);
      setClaveEdit(r.clave);
    } catch (e: any) {
      Alert.alert('No se pudo guardar la clave', e?.message || 'Intenta de nuevo');
    } finally {
      setGuardandoClave(false);
    }
  };

  const mover = (dias: number) => setFecha(dayjs(fecha).add(dias, 'day').format('YYYY-MM-DD'));
  const esHoy = fecha === dayjs().format('YYYY-MM-DD');

  // Áreas que se muestran como filtro: las del proyecto más las que traen los informes del día.
  const opcionesArea = useMemo(() => {
    const m = new Map<string, string>();
    areas.forEach((a) => m.set(a.id, a.name));
    filas.forEach((f) => { if (f.area_id && !m.has(f.area_id)) m.set(f.area_id, f.area_name || 'Área'); });
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [areas, filas]);
  const hayIngenierosSinArea = filas.some((f) => !f.area_id);

  const visibles = useMemo(() => {
    const porArea = filas.filter((f) => (areaSel === null ? true : areaSel === SIN_AREA ? !f.area_id : f.area_id === areaSel));
    return filtrarPersonas(
      porArea.map((f) => ({ ...f, name: f.user_name, puesto: f.user_puesto, area: f.area_name })), busqueda,
    ) as (Fila & { name: string })[];
  }, [filas, areaSel, busqueda]);

  // Quién puede corregir el texto: Coordinador General, Sub-coordinador, el Coordinador de área de esa persona
  // y la propia persona mientras no confirma (el servidor vuelve a validarlo).
  const puedeEditar = (f: Fila) =>
    f.estado === 'listo' && !!user && (
      user.role === 'coordinador_general' || user.role === 'sub_coordinador'
      || (f.user_id === user.id && !f.confirmado_en)
      || (!!user.es_coord_area && !!user.area_id && f.area_id === user.area_id));
  const confirmados = visibles.filter((f) => f.confirmado_en).length;
  const sinConfirmar = visibles.filter((f) => f.estado === 'listo' && !f.confirmado_en).length;
  const sinReportes = visibles.filter((f) => f.estado === 'sin_actividad').length;
  const nombreArea = areaSel && areaSel !== SIN_AREA ? opcionesArea.find((a) => a.id === areaSel)?.name : null;
  const areaParaPdf = areaSel && areaSel !== SIN_AREA ? areaSel : undefined;
  const hayListos = visibles.some((f) => f.estado === 'listo');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.md, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); cargar(); }} />}
      >
        <View style={styles.headRow}>
          <Pressable
            accessibilityRole="button" accessibilityLabel="Regresar al menú" hitSlop={10}
            onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/' as any))}
          >
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Informes diarios</Text>
            <Text style={styles.sub}>Corte automático a las 18:30</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.seccion}>Clave del informe (portada)</Text>
          {puedeEditarClave ? (
            <>
              <View style={styles.claveRow}>
                <TextInput
                  value={claveEdit} onChangeText={setClaveEdit} placeholder={claveSugerida || 'Ej. L4CB-ISM-011'}
                  placeholderTextColor={colors.textMuted} style={styles.claveInput} maxLength={120} autoCapitalize="characters"
                  accessibilityLabel="Clave del informe"
                />
                <Pressable
                  accessibilityRole="button" disabled={guardandoClave || claveEdit.trim() === clave}
                  onPress={guardarClave} style={[styles.claveBtn, (guardandoClave || claveEdit.trim() === clave) && { opacity: 0.5 }]}
                >
                  {guardandoClave ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Guardar</Text>}
                </Pressable>
              </View>
              <Text style={styles.muted}>Déjala vacía para usar la sugerida{claveSugerida ? ` (${claveSugerida})` : ''}. Solo el Coordinador General puede cambiarla.</Text>
            </>
          ) : (
            <Text style={styles.claveLectura}>{clave || claveSugerida || '—'}</Text>
          )}
        </View>

        <View style={styles.fechaCard}>
          <Pressable accessibilityRole="button" accessibilityLabel="Día anterior" onPress={() => mover(-1)} hitSlop={8} style={styles.flecha}>
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
          </Pressable>
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Text style={styles.fecha}>{dayjs(fecha).format('dddd DD [de] MMMM')}</Text>
            <Text style={styles.fechaAnio}>{dayjs(fecha).format('YYYY')}{esHoy ? ' · Hoy' : ''}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Día siguiente" onPress={() => mover(1)} hitSlop={8} style={styles.flecha}>
            <Ionicons name="chevron-forward" size={22} color={colors.primary} />
          </Pressable>
        </View>
        {!esHoy ? (
          <Pressable accessibilityRole="button" onPress={() => setFecha(dayjs().format('YYYY-MM-DD'))} style={styles.irHoy}>
            <Ionicons name="today-outline" size={14} color={colors.primary} />
            <Text style={styles.irHoyTxt}>Ir a hoy</Text>
          </Pressable>
        ) : null}

        <View style={styles.tiles}>
          <Tile n={visibles.length} etiqueta="Ingenieros" fg={colors.primary} bg={colors.primaryLight} />
          <Tile n={confirmados} etiqueta="Confirmados" fg="#166534" bg="#DCFCE7" />
          <Tile n={sinConfirmar} etiqueta="Sin confirmar" fg="#92400E" bg="#FEF3C7" />
          <Tile n={sinReportes} etiqueta="Sin reportes" fg="#475569" bg="#E2E8F0" />
        </View>

        <View style={styles.card}>
          <Text style={styles.seccion}>Buscar y filtrar</Text>
          <View style={{ marginHorizontal: -8 }}>
            <BuscadorPersonas value={busqueda} onChangeText={setBusqueda} placeholder="Buscar ingeniero por nombre, puesto o área" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <ChipFiltro txt="Todas las áreas" activo={areaSel === null} onPress={() => setAreaSel(null)} />
            {opcionesArea.map((a) => (
              <ChipFiltro key={a.id} txt={a.name} activo={areaSel === a.id} onPress={() => setAreaSel(areaSel === a.id ? null : a.id)} />
            ))}
            {hayIngenierosSinArea ? <ChipFiltro txt="Sin área" activo={areaSel === SIN_AREA} onPress={() => setAreaSel(areaSel === SIN_AREA ? null : SIN_AREA)} /> : null}
          </ScrollView>
        </View>

        <View style={styles.card}>
          <Text style={styles.seccion}>Imprimir (con portada)</Text>
          <Pressable
            accessibilityRole="button" disabled={!!descargando || areaSel === SIN_AREA}
            style={[styles.btn, (!!descargando || areaSel === SIN_AREA) && { opacity: 0.55 }]}
            onPress={() => bajar('dia', () => api.downloadInformesCompiladoPdf(projectId, { desde: fecha, areaId: areaParaPdf }))}
          >
            <Ionicons name="print-outline" size={18} color="#fff" />
            <Text style={styles.btnTxt}>
              {descargando === 'dia' ? 'Generando…' : nombreArea ? `Imprimir el día · ${nombreArea}` : 'Imprimir el día · todas las áreas'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button" disabled={!!descargando || areaSel === SIN_AREA}
            style={[styles.btnSec, (!!descargando || areaSel === SIN_AREA) && { opacity: 0.55 }]}
            onPress={() => bajar('semana', () => api.downloadInformesSemanaPdf(projectId, { fecha, areaId: areaParaPdf }))}
          >
            <Ionicons name="documents-outline" size={18} color={colors.primary} />
            <Text style={styles.btnSecTxt}>
              {descargando === 'semana' ? 'Generando…' : nombreArea ? `Semana para firmar · ${nombreArea}` : 'Semana para firmar · todas las áreas'}
            </Text>
          </Pressable>
          <Text style={styles.muted}>
            Para imprimir a una sola persona toca el icono de impresora de su tarjeta. La semana va de domingo a sábado y termina con la hoja de firmas.
          </Text>
          {!hayListos && !loading ? <Text style={styles.aviso}>Aún no hay informes listos con estos filtros.</Text> : null}
        </View>

        {loading ? <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && !filas.length ? (
          <Text style={styles.muted}>No hay informes de este día. Se generan automáticamente a las 18:30.</Text>
        ) : null}
        {!loading && filas.length > 0 && visibles.length === 0 ? (
          <Text style={styles.muted}>Ningún ingeniero coincide con la búsqueda o el área elegida.</Text>
        ) : null}

        {visibles.map((f) => {
          const clave = f.confirmado_en ? 'confirmado' : f.estado;
          const e = ESTADO[clave] || ESTADO.pendiente;
          const detalle = [f.user_puesto, f.area_name].filter(Boolean).join(' · ');
          return (
            <View key={f.id} style={styles.fila}>
              <View style={styles.avatar}><Text style={styles.avatarTxt}>{(f.user_name || '?').trim().charAt(0).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.nombre}>{f.user_name}</Text>
                {detalle ? <Text style={styles.detalle} numberOfLines={1}>{detalle}</Text> : null}
                <Text style={styles.muted}>{f.reportes_count} reporte(s)</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: e.bg }]}><Text style={[styles.chipTxt, { color: e.fg }]}>{e.txt}</Text></View>
              {puedeEditar(f) ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Editar informe de ${f.user_name}`} onPress={() => setEditando(f)} hitSlop={8}>
                  <Ionicons name="create-outline" size={22} color={colors.primary} />
                </Pressable>
              ) : null}
              {f.estado === 'listo' ? (
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`Imprimir informe de ${f.user_name}`} disabled={!!descargando}
                  onPress={() => bajar(f.id, () => api.downloadInformeDiarioPdf(projectId, f.id))} hitSlop={8}
                >
                  {descargando === f.id ? <ActivityIndicator color={colors.primary} />
                    : <Ionicons name="print-outline" size={22} color={colors.primary} />}
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <InformeEditor
        projectId={projectId} informeId={editando?.id ?? null} propio={editando?.user_id === user?.id}
        onClose={() => setEditando(null)} onSaved={() => { cargar(); }}
      />
    </View>
  );
}

function Tile({ n, etiqueta, fg, bg }: { n: number; etiqueta: string; fg: string; bg: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: bg }]}>
      <Text style={[styles.tileN, { color: fg }]}>{n}</Text>
      <Text style={[styles.tileTxt, { color: fg }]} numberOfLines={1}>{etiqueta}</Text>
    </View>
  );
}

function ChipFiltro({ txt, activo, onPress }: { txt: string; activo: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: activo }} onPress={onPress} style={[styles.chipFiltro, activo && styles.chipFiltroOn]}>
      <Text style={[styles.chipFiltroTxt, activo && { color: '#fff' }]}>{txt}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  h1: { fontSize: 22, fontWeight: '800', color: colors.textBody },
  sub: { fontSize: 12, color: colors.textMuted },
  fechaCard: {
    flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, backgroundColor: '#fff', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.sm,
  },
  flecha: { padding: 8 },
  fecha: { fontSize: 16, fontWeight: '800', color: colors.textBody, textTransform: 'capitalize' },
  fechaAnio: { fontSize: 12, color: colors.textMuted },
  irHoy: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, padding: 4 },
  irHoyTxt: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  tiles: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  tile: { flex: 1, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' },
  tileN: { fontSize: 20, fontWeight: '800' },
  tileTxt: { fontSize: 10, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md },
  seccion: { fontSize: 13, fontWeight: '800', color: colors.textBody, marginBottom: 4 },
  chips: { gap: 8, paddingVertical: 4 },
  chipFiltro: { borderRadius: 999, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' },
  chipFiltroOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipFiltroTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 14, flexShrink: 1 },
  btnSec: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, borderWidth: 1.5, borderColor: colors.primary },
  btnSecTxt: { color: colors.primary, fontWeight: '800', fontSize: 14, flexShrink: 1 },
  claveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  claveInput: { flex: 1, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.bg },
  claveBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 11, minWidth: 90, alignItems: 'center' },
  claveLectura: { fontSize: 15, fontWeight: '700', color: colors.textBody, marginTop: 2 },
  muted: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  aviso: { color: '#92400E', fontSize: 12, fontWeight: '600', marginTop: 6 },
  error: { color: colors.error, fontWeight: '600', marginTop: spacing.md },
  fila: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  nombre: { fontWeight: '700', color: colors.textBody, fontSize: 14 },
  detalle: { color: colors.textBody, fontSize: 12 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipTxt: { fontSize: 11, fontWeight: '800' },
});
