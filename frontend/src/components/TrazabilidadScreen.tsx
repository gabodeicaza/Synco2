// Trazabilidad: el árbol de nodos del proyecto (el mismo de "Árbol de nodos") con
// archivos adjuntos en cada nodo — PDF, Excel, PowerPoint, DWG… — clasificados
// por categoría. Todos los roles lo consultan; el Coordinador General / Jefe de
// Proyecto sube, edita las características y administra las categorías.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { api, TrazData } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { CategoriasModal, NodoArchivosModal } from '@/src/components/trazabilidad/NodoModal';
import { ReferenceFilesList } from '@/src/components/ReferenceFilesList';
import {
  aplanar, conteoPorCategoria, EXT_ICONOS, indexar, TrazFila, visiblesPorFiltro,
} from '@/src/utils/trazabilidad';

interface Props {
  projectId: string;
  canEdit: boolean;
  fallbackHref?: Href;
  /** Pantalla del árbol de nodos, para quien necesite agregar o cambiar nodos. */
  arbolHref?: Href;
}

export function TrazabilidadScreen({ projectId, canEdit, fallbackHref = '/', arbolHref }: Props) {
  const [data, setData] = useState<TrazData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [consulta, setConsulta] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [nodoId, setNodoId] = useState<string | null>(null);
  const [verCategorias, setVerCategorias] = useState(false);
  const [verSueltos, setVerSueltos] = useState(false);
  const [sueltos, setSueltos] = useState(0);
  const [inicializado, setInicializado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setError(null);
      setData(await api.trazListar(projectId));
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar la trazabilidad');
    } finally {
      setCargando(false);
    }
  }, [projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Archivos que se subieron como "archivos de consulta" antes de existir la
  // trazabilidad: se siguen mostrando abajo para no perderlos de vista.
  useEffect(() => {
    api.getProject(projectId).then((p) => setSueltos((p.reference_files || []).length)).catch(() => {});
  }, [projectId]);

  const nodos = useMemo(() => data?.nodes ?? [], [data]);
  const archivos = useMemo(() => data?.files ?? [], [data]);
  const categorias = useMemo(() => data?.categorias ?? [], [data]);
  const ind = useMemo(() => indexar(nodos, archivos), [nodos, archivos]);
  const porCategoria = useMemo(() => conteoPorCategoria(archivos), [archivos]);
  const visibles = useMemo(
    () => visiblesPorFiltro(ind, nodos, consulta, categoria),
    [ind, nodos, consulta, categoria],
  );
  const filas = useMemo(() => aplanar(ind, abiertos, visibles), [ind, abiertos, visibles]);
  const nodosConArchivos = useMemo(() => [...ind.archivosDe.values()].filter((l) => l.length > 0).length, [ind]);
  const totalArchivos = useMemo(() => [...ind.archivosDe.values()].reduce((a, l) => a + l.length, 0), [ind]);
  const nodo = nodoId ? ind.porId.get(nodoId) || null : null;

  // Al primer cargue deja abierto el primer nivel para que se vea el árbol.
  useEffect(() => {
    if (inicializado || !data) return;
    setAbiertos(new Set((ind.hijos.get(null) || []).map((r) => r.id)));
    setInicializado(true);
  }, [data, ind, inicializado]);

  function alternar(id: string) {
    setAbiertos((prev) => {
      const sig = new Set(prev);
      if (sig.has(id)) sig.delete(id); else sig.add(id);
      return sig;
    });
  }

  const hayPadres = useMemo(() => nodos.filter((n) => (ind.hijos.get(n.id) || []).length > 0), [nodos, ind]);
  const todoAbierto = hayPadres.length > 0 && hayPadres.every((n) => abiertos.has(n.id));
  function alternarTodo() {
    setAbiertos(todoAbierto ? new Set() : new Set(hayPadres.map((n) => n.id)));
  }

  async function guardarCategorias(cats: string[]) {
    try {
      await api.trazGuardarCategorias(projectId, cats);
      setVerCategorias(false);
      if (categoria && !cats.includes(categoria)) setCategoria(null);
      await cargar();
    } catch (e: any) {
      Alert.alert('No se pudieron guardar las categorías', e?.message || 'Inténtalo de nuevo.');
    }
  }

  function renderFila({ item }: { item: TrazFila }) {
    const { nodo: n, nivel } = item;
    const hijos = ind.hijos.get(n.id) || [];
    const abierto = !!visibles || abiertos.has(n.id);
    const propios = ind.archivosDe.get(n.id) || [];
    const total = ind.total.get(n.id) || 0;
    const exts = Array.from(new Set(propios.map((f) => f.ext)));
    return (
      <View style={[s.fila, { paddingLeft: 6 + nivel * 16 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={abierto ? `Contraer ${n.name}` : `Expandir ${n.name}`}
          disabled={hijos.length === 0 || !!visibles}
          onPress={() => alternar(n.id)}
          hitSlop={6}
          style={s.chevron}
        >
          {hijos.length > 0 ? (
            <Ionicons name={abierto ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.primary} />
          ) : (
            <View style={s.hoja} />
          )}
        </Pressable>
        <Pressable accessibilityRole="button" style={s.filaCuerpo} onPress={() => setNodoId(n.id)}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.nombre, hijos.length > 0 && { fontWeight: '800' }]} numberOfLines={2}>{n.name}</Text>
            {hijos.length > 0 && total > 0 ? (
              <Text style={s.sub}>{total} archivo{total === 1 ? '' : 's'} en esta rama</Text>
            ) : null}
          </View>
          <View style={s.etiquetas}>
            {exts.slice(0, 4).map((e) => (
              <Text key={e} style={[s.ext, { color: (EXT_ICONOS[e] || { color: colors.textMuted }).color }]}>
                {(EXT_ICONOS[e] || { etiqueta: e.replace('.', '').toUpperCase() }).etiqueta}
              </Text>
            ))}
            {propios.length > 0 ? (
              <View style={s.badge}><Text style={s.badgeTxt}>{propios.length}</Text></View>
            ) : canEdit ? (
              <Ionicons name="add-circle-outline" size={20} color={colors.textMuted} />
            ) : null}
          </View>
        </Pressable>
      </View>
    );
  }

  const encabezado = (
    <View style={s.cabecera}>
      <View style={s.buscador}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={consulta}
          onChangeText={setConsulta}
          placeholder="Buscar nodo, archivo, oficio…"
          placeholderTextColor={colors.textMuted}
          style={s.buscadorInput}
          autoCorrect={false}
        />
        {consulta ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" onPress={() => setConsulta('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={s.panel}>
        {([
          ['Archivos', totalArchivos, colors.primary],
          ['Nodos con archivos', nodosConArchivos, '#7C3AED'],
          ['Categorías en uso', [...porCategoria.keys()].filter(Boolean).length, colors.success],
        ] as const).map(([etq, num, color]) => (
          <View key={etq} style={s.panelCelda}>
            <Text style={[s.panelNum, { color }]}>{num}</Text>
            <Text style={s.panelEtq}>{etq}</Text>
          </View>
        ))}
      </View>

      {categorias.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          <Pressable accessibilityRole="button" onPress={() => setCategoria(null)} style={[s.chip, !categoria && s.chipSel]}>
            <Text style={[s.chipTxt, !categoria && s.chipTxtSel]}>Todas</Text>
          </Pressable>
          {categorias.map((c) => {
            const num = porCategoria.get(c) || 0;
            if (!num && categoria !== c) return null;
            const sel = categoria === c;
            return (
              <Pressable key={c} accessibilityRole="button" onPress={() => setCategoria(sel ? null : c)} style={[s.chip, sel && s.chipSel]}>
                <Text style={[s.chipTxt, sel && s.chipTxtSel]} numberOfLines={1}>{c} · {num}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={s.herramientas}>
        {hayPadres.length > 0 ? (
          <Pressable accessibilityRole="button" style={s.herr} onPress={alternarTodo}>
            <Ionicons name={todoAbierto ? 'contract-outline' : 'expand-outline'} size={18} color={colors.primary} />
            <Text style={s.herrTxt}>{todoAbierto ? 'Contraer todo' : 'Expandir todo'}</Text>
          </Pressable>
        ) : null}
        {canEdit ? (
          <Pressable accessibilityRole="button" style={s.herr} onPress={() => setVerCategorias(true)}>
            <Ionicons name="pricetags-outline" size={18} color={colors.primary} />
            <Text style={s.herrTxt}>Categorías</Text>
          </Pressable>
        ) : null}
        {canEdit && arbolHref ? (
          <Pressable accessibilityRole="button" style={s.herr} onPress={() => router.push(arbolHref)}>
            <Ionicons name="git-branch-outline" size={18} color={colors.primary} />
            <Text style={s.herrTxt}>Editar nodos</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const pie = sueltos > 0 ? (
    <View style={s.sueltos}>
      <Pressable accessibilityRole="button" style={s.sueltosHead} onPress={() => setVerSueltos((v) => !v)}>
        <Ionicons name="folder-open-outline" size={18} color={colors.textMuted} />
        <Text style={s.sueltosTit}>Archivos de consulta anteriores ({sueltos})</Text>
        <Ionicons name={verSueltos ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </Pressable>
      {verSueltos ? <ReferenceFilesList projectId={projectId} /> : null}
    </View>
  ) : null;

  return (
    <View style={s.flex}>
      <ScreenHeader title="Trazabilidad" fallbackHref={fallbackHref} />
      {cargando ? (
        <View style={s.centro}><ActivityIndicator color={colors.primary} /></View>
      ) : error && !data ? (
        <View style={s.centro}>
          <Ionicons name="alert-circle-outline" size={22} color={colors.error} />
          <Text style={s.error}>{error}</Text>
          <Pressable accessibilityRole="button" style={s.herr} onPress={cargar}><Text style={s.herrTxt}>Reintentar</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={filas}
          keyExtractor={(f) => f.nodo.id}
          renderItem={renderFila}
          ListHeaderComponent={encabezado}
          ListFooterComponent={pie}
          ListEmptyComponent={
            <View style={s.vacio}>
              <Ionicons name="git-network-outline" size={26} color={colors.textMuted} />
              <Text style={s.vacioTxt}>
                {visibles
                  ? 'Nada coincide con la búsqueda.'
                  : 'Este proyecto todavía no tiene nodos. Créalos en el Árbol de nodos y aquí podrás adjuntarles archivos.'}
              </Text>
              {!visibles && canEdit && arbolHref ? (
                <Pressable accessibilityRole="button" style={s.vacioBtn} onPress={() => router.push(arbolHref)}>
                  <Ionicons name="git-branch-outline" size={20} color="#fff" />
                  <Text style={s.vacioBtnTxt}>Ir al Árbol de nodos</Text>
                </Pressable>
              ) : null}
            </View>
          }
          initialNumToRender={30}
          windowSize={9}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 60 }}
        />
      )}

      <NodoArchivosModal
        nodo={nodo}
        ind={ind}
        categorias={categorias}
        canEdit={canEdit}
        projectId={projectId}
        onClose={() => setNodoId(null)}
        onRecargar={cargar}
      />
      <CategoriasModal
        abierto={verCategorias}
        categorias={categorias}
        onClose={() => setVerCategorias(false)}
        onGuardar={guardarCategorias}
      />
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  centro: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  error: { color: colors.error, fontWeight: '600', textAlign: 'center' },
  cabecera: { padding: spacing.md, gap: spacing.sm },
  buscador: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 10,
  },
  buscadorInput: { flex: 1, paddingVertical: 9, fontSize: 14, color: colors.text },
  panel: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm },
  panelCelda: { flex: 1, alignItems: 'center' },
  panelNum: { fontSize: 20, fontWeight: '900' },
  panelEtq: { fontSize: 10, fontWeight: '700', color: colors.textMuted, marginTop: 1, textAlign: 'center' },
  chips: { gap: 6, paddingVertical: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, maxWidth: 260 },
  chipSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  chipTxtSel: { color: '#fff' },
  herramientas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  herr: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface,
  },
  herrTxt: { fontSize: 12, fontWeight: '800', color: colors.primary },
  fila: {
    flexDirection: 'row', alignItems: 'center', paddingRight: 8,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  chevron: { width: 30, height: 40, alignItems: 'center', justifyContent: 'center' },
  hoja: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  filaCuerpo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, minWidth: 0 },
  nombre: { fontSize: 14, fontWeight: '600', color: colors.text },
  sub: { fontSize: 11, color: colors.textMuted },
  etiquetas: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ext: { fontSize: 10, fontWeight: '900' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  vacio: { alignItems: 'center', gap: 8, padding: spacing.xl },
  vacioBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12, marginTop: 4 },
  vacioBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  vacioTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
  sueltos: { margin: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  sueltosHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sueltosTit: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textBody },
});
