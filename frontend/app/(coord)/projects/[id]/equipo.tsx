import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert, TextInput,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { api, Project } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { parseExcel, mapEquipoRows, EquipoRow } from '@/src/utils/excel';

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

/**
 * Normaliza un nombre de equipo para agrupar variantes ("Retroexcavadora",
 * "RETROEXCAVADORA CAT", "Retro-excavadora") bajo la misma categoria.
 */
function stripAccents(s: string): string {
  try {
    if (!s.normalize) return s;
    return s.normalize('NFD')
      .split('')
      .filter((ch) => { const code = ch.charCodeAt(0); return code < 0x0300 || code > 0x036f; })
      .join('');
  } catch {
    return s;
  }
}

function normalizeKey(s: string): string {
  const res = stripAccents(s.toLowerCase().trim());
  return res.replace(/[^a-z0-9]+/g, ' ').trim();
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
      group = { key, label: item.nombre || 'Sin nombre', entries: [] };
      map.set(key, group);
    }
    group.entries.push({ item, idx });
  });
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export default function EquipmentManagementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [list, setList] = useState<EquipoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Draft form
  const [nombre, setNombre] = useState('');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [serie, setSerie] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const p = await api.getProject(pid);
      setProject(p);
      const raw = p.categorias_equipo || [];
      setList(raw.map(unpack));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el equipo');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => groupEquipo(list), [list]);

  async function save(newList: EquipoRow[]) {
    if (busy) return;
    try {
      setBusy(true);
      const packedList = newList.map(pack);
      const upd = await api.setProjectCatalogos(pid, { categorias_equipo: packedList });
      setProject(upd);
      setList((upd.categorias_equipo || []).map(unpack));
      return true;
    } catch (e: any) {
      console.error('[Equipment] Save Error:', e);
      Alert.alert('Error', e?.message || 'No se pudo guardar la configuracion');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onAdd() {
    const n = nombre.trim();
    if (!n) return;
    const newItem: EquipoRow = {
      nombre: n,
      marca: marca.trim(),
      modelo: modelo.trim(),
      serie: serie.trim(),
    };
    // Basic dup check
    if (list.some((it) => it.nombre === n && it.serie === newItem.serie)) {
      Alert.alert('Duplicado', 'Ya existe un equipo con ese nombre y serie.');
      return;
    }
    const next = [...list, newItem];
    save(next);
    setNombre(''); setMarca(''); setModelo(''); setSerie('');
  }

  function onRemove(idx: number) {
    const next = list.filter((_, i) => i !== idx);
    save(next);
  }

  async function onImport() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      setBusy(true);
      const asset = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });

      const rawRows = await parseExcel(base64);
      const newItems = mapEquipoRows(rawRows);

      if (newItems.length === 0) {
        const firstRows = rawRows.slice(0, 3).map(r => r.join(' | ')).join('\n');
        Alert.alert(
          'Importacion vacia',
          `No se encontraron registros de equipo.\n\nFilas detectadas:\n${firstRows}\n\nAsegurate de que la columna "Nombre" tenga datos.`
        );
        return;
      }

      // Merge avoiding duplicates
      const filteredNew = newItems.filter(newIt =>
        !list.some(existing => existing.nombre === newIt.nombre && existing.serie === newIt.serie)
      );

      if (filteredNew.length === 0) {
        Alert.alert('Sin cambios', 'Todos los registros ya existen en el catalogo.');
        return;
      }

      const next = [...list, ...filteredNew];
      const ok = await save(next);
      if (ok) {
        Alert.alert('Exito', `Se importaron ${filteredNew.length} registros de equipo.`);
      }
    } catch (e: any) {
      console.error('[ExcelImport] Equipo Error:', e);
      Alert.alert('Error', `No se pudo procesar el archivo Excel: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Equipo</Text>
        <Pressable onPress={onImport} disabled={busy} style={styles.importBtn}>
          <Ionicons name="download-outline" size={18} color={colors.primary} />
          <Text style={styles.importBtnTxt}>Importar</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.inputCard}>
          <Text style={styles.label}>Nuevo equipo estructurado</Text>
          <TextInput
            value={nombre} onChangeText={setNombre}
            placeholder="Nombre / Descripcion *"
            style={styles.input}
          />
          <View style={styles.row}>
            <TextInput
              value={marca} onChangeText={setMarca}
              placeholder="Marca"
              style={[styles.input, { flex: 1 }]}
            />
            <TextInput
              value={modelo} onChangeText={setModelo}
              placeholder="Modelo"
              style={[styles.input, { flex: 1 }]}
            />
          </View>
          <TextInput
            value={serie} onChangeText={setSerie}
            placeholder="Serie / Placas"
            style={styles.input}
          />
          <Pressable onPress={onAdd} disabled={busy || !nombre.trim()} style={[styles.addBtn, !nombre.trim() && { opacity: 0.5 }]}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.addBtnTxt}>Agregar a catalogo</Text>
          </Pressable>
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
                          <Text style={styles.itemSerie}>S/N: {item.serie}</Text>
                        )}
                        {!item.marca && !item.modelo && !item.serie && (
                          <Text style={styles.itemSub}>Sin datos adicionales</Text>
                        )}
                      </View>
                      <Pressable onPress={() => onRemove(idx)} disabled={busy} hitSlop={10}>
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            {list.length === 0 && (
              <Text style={styles.empty}>Aun no hay equipo registrado.</Text>
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
  row: { flexDirection: 'row', gap: 10 },
  input: { height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15, color: colors.text, backgroundColor: colors.bg },
  addBtn: { height: 48, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  addBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
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
