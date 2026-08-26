import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert, TextInput,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { api, Project } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { parseExcel, mapPersonalRows } from '@/src/utils/excel';

export default function PersonalManagementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const p = await api.getProject(pid);
      setProject(p);
      setList(p.categorias_personal || []);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el personal');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  async function save(newList: string[]) {
    if (busy) return;
    try {
      setBusy(true);
      const upd = await api.setProjectCatalogos(pid, { categorias_personal: newList });
      setProject(upd);
      setList(upd.categorias_personal || []);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  function onAdd() {
    const t = draft.trim();
    if (!t) return;
    if (list.includes(t)) {
      setDraft('');
      return;
    }
    const next = [...list, t];
    save(next);
    setDraft('');
  }

  function onRemove(item: string) {
    const next = list.filter((x) => x !== item);
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
      const newItems = mapPersonalRows(rawRows);

      if (newItems.length === 0) {
        Alert.alert('Importacion vacia', 'No se encontraron registros validos en el Excel.');
        return;
      }

      // Merge avoiding duplicates
      const merged = Array.from(new Set([...list, ...newItems]));
      await save(merged);
      Alert.alert('Exito', `Se importaron ${newItems.length} registros de personal.`);
    } catch (e: any) {
      console.error('[ExcelImport] Personal Error:', e);
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
        <Text style={styles.title}>Personal</Text>
        <Pressable onPress={onImport} disabled={busy} style={styles.importBtn}>
          <Ionicons name="download-outline" size={18} color={colors.primary} />
          <Text style={styles.importBtnTxt}>Importar</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.inputCard}>
          <Text style={styles.label}>Nueva categoria / rol</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Ej. Topografo, Residente..."
              style={styles.input}
              onSubmitEditing={onAdd}
            />
            <Pressable onPress={onAdd} disabled={busy} style={styles.addBtn}>
              <Ionicons name="add" size={24} color="#fff" />
            </Pressable>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.list}>
            {list.map((item, idx) => (
              <View key={`${item}-${idx}`} style={styles.item}>
                <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                <Text style={styles.itemTxt}>{item}</Text>
                <Pressable onPress={() => onRemove(item)} disabled={busy} hitSlop={10}>
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </Pressable>
              </View>
            ))}
            {list.length === 0 && (
              <Text style={styles.empty}>Aun no hay categorias de personal.</Text>
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
  inputCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.card, marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: '800', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase' },
  inputRow: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15, color: colors.text, backgroundColor: colors.bg },
  addBtn: { width: 48, height: 48, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  list: { gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 12 },
  itemTxt: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontStyle: 'italic' },
});
