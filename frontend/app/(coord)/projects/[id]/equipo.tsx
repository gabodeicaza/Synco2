import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, TextInput,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { api, Project } from '@/src/api';
import { FormField } from '@/src/components/FormField';
import { InlineError } from '@/src/components/InlineError';
import { useColaDeEnvios } from '@/src/hooks/useEnvio';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { parseExcel, mapEquipoRows, EquipoRow } from '@/src/utils/excel';
import { esErrorDeRed } from '@/src/utils/errores';
import { normalizarNombre } from '@/src/utils/nombres';
import { showToast } from '@/src/utils/toast';
import { a11y, t } from '@/src/i18n';

/**
 * Delimitador para empaquetar datos estructurados en una sola cadena.
 * Formato: Nombre :: Marca :: Modelo :: Serie
 */
const PACK_SEP = ' :: ';

function pack(it: EquipoRow): string {
  const parts = [
    it.nombre,
    it.marca || '',
    it.modelo || '',
    it.serie || '',
  ];
  return parts.join(PACK_SEP);
}

function unpack(s: string): EquipoRow {
  if (!s.includes(PACK_SEP)) {
    return { nombre: s, marca: '', modelo: '', serie: '' };
  }
  const [nombre, marca, modelo, serie] = s.split(PACK_SEP);
  return {
    nombre: nombre || '',
    marca: marca || '',
    modelo: modelo || '',
    serie: serie || '',
  };
}

/** Dos equipos son el mismo si coinciden nombre y serie (sin acentos, mayúsculas ni espacios sobrantes). */
function claveEquipo(it: EquipoRow): string {
  return `${normalizarNombre(it.nombre)}|${normalizarNombre(it.serie)}`;
}

/**
 * Normaliza un nombre de equipo para agrupar variantes ("Retroexcavadora",
 * "RETROEXCAVADORA CAT", "Retro-excavadora") bajo la misma categoria.
 */
function normalizeKey(s: string): string {
  return normalizarNombre(s).replace(/[^a-z0-9]+/g, ' ').trim();
}

interface EquipoGroup {
  key: string;
  label: string;
  entries: { item: EquipoRow; idx: number }[];
}

function groupEquipo(list: EquipoRow[]): EquipoGroup[] {
  const map = new Map<string, EquipoGroup>();
  list.forEach((item, idx) => {
    const key = normalizeKey(item.nombre) || '_sin_nombre';
    let group = map.get(key);
    if (!group) {
      group = { key, label: item.nombre || t('equipo.sinNombre'), entries: [] };
      map.set(key, group);
    }
    group.entries.push({ item, idx });
  });
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

// Una captura pendiente de guardar. El formulario se limpia al encolarla; si el
// guardado falla, `campos` permite devolverle al usuario lo que había escrito.
interface Captura {
  nombre: string;
  campos?: EquipoRow;
  aplicar: (lista: EquipoRow[]) => EquipoRow[];
  alGuardar?: () => void;
}

export default function EquipmentManagementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = id as string;

  const [, setProject] = useState<Project | null>(null);
  const [list, setList] = useState<EquipoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importando, setImportando] = useState(false);
  const form = useFormErrors<'nombre' | 'serie'>();

  // Draft form
  const [nombre, setNombre] = useState('');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [serie, setSerie] = useState('');
  const nombreRef = useRef<TextInput>(null);

  // Última lista confirmada por el servidor (los guardados corren en serie sobre ella)
  // y capturas agregadas que aún esperan su turno (para detectar duplicados al escribir).
  const listaRef = useRef<EquipoRow[]>([]);
  const pendientesRef = useRef<EquipoRow[]>([]);

  const actualizarLista = useCallback((nueva: EquipoRow[]) => {
    listaRef.current = nueva;
    setList(nueva);
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const p = await api.getProject(pid);
      setProject(p);
      actualizarLista((p.categorias_equipo || []).map(unpack));
    } catch (e: any) {
      if (esErrorDeRed(e)) showToast(t('red.errorDeRed'));
      form.setErrorGeneral(e?.message || t('equipo.errorCargar'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, actualizarLista]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => groupEquipo(list), [list]);

  async function guardarCaptura(c: Captura) {
    try {
      const actual = listaRef.current;
      const siguiente = c.aplicar(actual);
      if (siguiente === actual) { c.alGuardar?.(); return; }
      const upd = await api.setProjectCatalogos(pid, { categorias_equipo: siguiente.map(pack) });
      const confirmada = (upd.categorias_equipo || []).map(unpack);
      setProject(upd);
      actualizarLista(confirmada);
      // El servidor descarta repetidos y recorta listas muy largas: si devolvió menos
      // de lo pedido, algo no se guardó y no debe pasar como éxito.
      if (confirmada.length < siguiente.length) throw new Error(t('equipo.noSeConfirmo'));
      c.alGuardar?.();
    } finally {
      if (c.campos) pendientesRef.current = pendientesRef.current.filter((x) => x !== c.campos);
    }
  }

  function alFallarCaptura(c: Captura, e: unknown) {
    if (c.campos && !nombre && !marca && !modelo && !serie) {
      setNombre(c.campos.nombre); setMarca(c.campos.marca || ''); setModelo(c.campos.modelo || ''); setSerie(c.campos.serie || '');
    }
    const red = esErrorDeRed(e);
    if (red) showToast(t('red.errorDeRed'));
    const motivo = !red && (e as any)?.message ? ` ${(e as any).message}` : '';
    form.setErrorGeneral(t('formulario.noSeGuardo', { nombre: c.nombre }) + motivo);
  }

  const { encolar, pendientes } = useColaDeEnvios<Captura>(guardarCaptura, alFallarCaptura);

  function onAdd() {
    const item: EquipoRow = {
      nombre: nombre.trim(),
      marca: marca.trim(),
      modelo: modelo.trim(),
      serie: serie.trim(),
    };
    const errores: { nombre?: string; serie?: string } = {};
    if (!item.nombre) {
      errores.nombre = t('equipo.nombreObligatorio');
    } else {
      const clave = claveEquipo(item);
      const repetido = [...listaRef.current, ...pendientesRef.current].some((it) => claveEquipo(it) === clave);
      if (repetido) errores[item.serie ? 'serie' : 'nombre'] = t('equipo.duplicado');
    }
    if (form.ponerTodos(errores)) return;

    pendientesRef.current = [...pendientesRef.current, item];
    setNombre(''); setMarca(''); setModelo(''); setSerie('');
    nombreRef.current?.focus();
    void encolar({
      nombre: item.nombre,
      campos: item,
      aplicar: (l) => {
        const clave = claveEquipo(item);
        if (l.some((it) => claveEquipo(it) === clave)) throw new Error(t('equipo.duplicado'));
        return [...l, item];
      },
    });
  }

  function onRemove(item: EquipoRow) {
    form.limpiarTodo();
    void encolar({
      nombre: item.nombre,
      aplicar: (l) => {
        const i = l.findIndex((it) => pack(it) === pack(item));
        return i < 0 ? l : l.filter((_, k) => k !== i);
      },
    });
  }

  async function onImport() {
    if (importando) return;
    form.limpiarTodo();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      setImportando(true);
      const asset = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });

      const rawRows = await parseExcel(base64);
      const newItems = mapEquipoRows(rawRows);

      if (newItems.length === 0) {
        form.setErrorGeneral(t('equipo.importVacia'));
        return;
      }

      const existentes = new Set([...listaRef.current, ...pendientesRef.current].map(claveEquipo));
      const filteredNew = newItems.filter((it) => !existentes.has(claveEquipo(it)));
      if (filteredNew.length === 0) {
        form.setErrorGeneral(t('equipo.importSinCambios'));
        return;
      }

      await encolar({
        nombre: t('equipo.importacion'),
        aplicar: (l) => {
          const ya = new Set(l.map(claveEquipo));
          const nuevos = filteredNew.filter((it) => !ya.has(claveEquipo(it)));
          return nuevos.length ? [...l, ...nuevos] : l;
        },
        alGuardar: () => showToast(t('equipo.importados', { n: filteredNew.length })),
      });
    } catch (e: any) {
      form.setErrorGeneral(t('equipo.importError', { motivo: e?.message || String(e) }));
    } finally {
      setImportando(false);
    }
  }

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')} onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t('equipo.titulo')}</Text>
        <Pressable accessibilityRole="button" onPress={onImport} disabled={importando} style={styles.importBtn}>
          <Ionicons name="download-outline" size={18} color={colors.primary} />
          <Text style={styles.importBtnTxt}>{t('equipo.importar')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.inputCard}>
          <Text style={styles.label}>{t('equipo.nuevoEquipo')}</Text>
          <FormField
            {...({ ref: nombreRef } as any)}
            label={t('equipo.nombre')}
            value={nombre}
            onChangeText={form.alCambiar<string>('nombre', setNombre)}
            error={form.errores.nombre}
            obligatorio
            returnKeyType="done"
            onSubmitEditing={onAdd}
            style={styles.campo}
          />
          <View style={styles.row}>
            <FormField
              label={t('equipo.marca')}
              value={marca}
              onChangeText={setMarca}
              returnKeyType="done"
              onSubmitEditing={onAdd}
              style={[styles.campo, { flex: 1 }]}
            />
            <FormField
              label={t('equipo.modelo')}
              value={modelo}
              onChangeText={setModelo}
              returnKeyType="done"
              onSubmitEditing={onAdd}
              style={[styles.campo, { flex: 1 }]}
            />
          </View>
          <FormField
            label={t('equipo.serie')}
            value={serie}
            onChangeText={form.alCambiar<string>('serie', setSerie)}
            error={form.errores.serie}
            returnKeyType="done"
            onSubmitEditing={onAdd}
            style={styles.campo}
          />
          <InlineError message={form.errorGeneral} />
          <Pressable accessibilityRole="button" onPress={onAdd} style={styles.addBtn}>
            <Ionicons name="add" size={20} color={colors.textInverse} />
            <Text style={styles.addBtnTxt}>{t('equipo.agregar')}</Text>
          </Pressable>
          {pendientes > 0 ? (
            <Text style={styles.pendientes} accessibilityLiveRegion="polite">{t('formulario.pendientes', { n: pendientes })}</Text>
          ) : null}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.list}>
            {groups.map((group) => (
              <View key={group.key} style={styles.group}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupHeaderText}>{group.label}</Text>
                  <View style={styles.groupBadge}>
                    <Text style={styles.groupBadgeText}>{group.entries.length}</Text>
                  </View>
                </View>
                <View style={styles.groupItems}>
                  {group.entries.map(({ item, idx }) => (
                    <View key={idx} style={styles.item}>
                      <View style={{ flex: 1, gap: 2 }}>
                        {(item.marca || item.modelo) && (
                          <Text style={styles.itemSub}>{item.marca || ''} {item.modelo || ''}</Text>
                        )}
                        {item.serie && (
                          <Text style={styles.itemSerie}>{t('equipo.numeroSerie', { serie: item.serie })}</Text>
                        )}
                        {!item.marca && !item.modelo && !item.serie && (
                          <Text style={styles.itemSub}>{t('equipo.sinDatos')}</Text>
                        )}
                      </View>
                      <Pressable accessibilityRole="button" accessibilityLabel={t('equipo.quitar', { nombre: item.nombre })} onPress={() => onRemove(item)} hitSlop={10}>
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            {list.length === 0 && (
              <Text style={styles.empty}>{t('equipo.vacio')}</Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.text },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  importBtnTxt: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  scroll: { padding: spacing.md, paddingBottom: 40 },
  inputCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.card, marginBottom: spacing.md, gap: 10 },
  label: { fontSize: 12, fontWeight: '800', color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase' },
  campo: { marginTop: 0 },
  row: { flexDirection: 'row', gap: 10 },
  addBtn: { height: 48, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  addBtnTxt: { color: colors.textInverse, fontWeight: '800', fontSize: 14 },
  pendientes: { fontSize: 12, color: colors.textMuted, fontWeight: '600', textAlign: 'center' },
  list: { gap: 16 },
  group: { gap: 6 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  groupHeaderText: { fontSize: 13, fontWeight: '800', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  groupBadge: { backgroundColor: colors.primaryLight, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, minWidth: 24, alignItems: 'center' },
  groupBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },
  groupItems: { gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 12 },
  itemTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  itemSub: { fontSize: 12, color: colors.textBody, fontWeight: '600' },
  itemSerie: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic' },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontStyle: 'italic' },
});
