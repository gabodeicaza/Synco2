// Editor de items "cantidad + descripcion" (personal/equipo), extraído de
// la pantalla "Nuevo Reporte" ((spec)/nuevo.tsx: DynSectionRestored/DynRow)
// para reusarlo en la captura de Fuerza de Trabajo (WorkforceTracker.tsx),
// que reemplazó a la captura de personal/equipo dentro del reporte
// narrativo. Comportamiento idéntico al original: catálogo con búsqueda +
// opción de capturar un valor libre ("+ Usar ...").
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, FlatList, Modal, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, shadow } from '@/src/theme';

export interface PersonalEquipoItem {
  id: string;
  desc: any; // string | { nombre: string } | ''
  qty: number;
}

export function PersonalEquipoSection({
  title, items, onAdd, onRemove, onUpdate, catalog, isEquipo,
}: {
  title: string;
  items: PersonalEquipoItem[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<PersonalEquipoItem>) => void;
  catalog: any[];
  isEquipo?: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.cardLabel}>{title} ({items.length})</Text>
          <Text style={styles.cardHelp}>{isEquipo ? 'Cantidad + descripcion (ej. 1 Excavadora).' : 'Cantidad + descripcion (ej. 3 Albañiles).'}</Text>
        </View>
        <Pressable onPress={onAdd} style={styles.addSmallBtn}><Text style={styles.addSmallTxt}>+ Agregar</Text></Pressable>
      </View>
      {items.length === 0 ? (
        <View style={styles.emptyItems}>
          <Text style={styles.emptyItemsTxt}>Aun no agregaste items. Toca "Agregar" para iniciar.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          scrollEnabled={false} // Mantener scroll del contenedor padre
          renderItem={({ item }) => (
            <PersonalEquipoRow item={item} onRemove={() => onRemove(item.id)} onUpdate={(p) => onUpdate(item.id, p)} catalog={catalog} isEquipo={isEquipo} />
          )}
        />
      )}
    </View>
  );
}

function PersonalEquipoRow({
  item, onRemove, onUpdate, catalog, isEquipo,
}: {
  item: PersonalEquipoItem;
  onRemove: () => void;
  onUpdate: (patch: Partial<PersonalEquipoItem>) => void;
  catalog: any[];
  isEquipo?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = catalog.filter((c: any) => (typeof c === 'string' ? c : c.nombre).toLowerCase().includes(search.toLowerCase()));
  const display = useMemo(() => {
    if (!item.desc) return '';
    if (typeof item.desc === 'string') return item.desc;
    return item.desc.nombre;
  }, [item.desc]);

  return (
    <View style={styles.dynRow}>
      <View style={styles.dynQtyWrap}>
        <Pressable
          onPress={() => onUpdate({ qty: Math.max(1, (item.qty || 1) - 1) })}
          style={styles.qtyBtn}
          hitSlop={8}
        >
          <Ionicons name="remove" size={16} color={colors.primary} />
        </Pressable>
        <Text style={styles.qtyValue}>{item.qty}</Text>
        <Pressable
          onPress={() => onUpdate({ qty: (item.qty || 1) + 1 })}
          style={styles.qtyBtn}
          hitSlop={8}
        >
          <Ionicons name="add" size={16} color={colors.primary} />
        </Pressable>
      </View>
      <Pressable onPress={() => setModalOpen(true)} style={styles.descInput}>
        <Text numberOfLines={2} style={[styles.descTxt, !item.desc && { color: colors.textMuted }]}>
          {display || (isEquipo ? 'Buscar equipo...' : 'Buscar personal...')}
        </Text>
      </Pressable>
      <Pressable onPress={onRemove} hitSlop={12} style={styles.dynDelBtn}>
        <Ionicons name="trash-outline" size={18} color={colors.error} />
      </Pressable>
      <Modal visible={modalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}><View style={styles.modalContent}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>Buscar {isEquipo ? 'Equipo' : 'Personal'}</Text><Pressable onPress={() => setModalOpen(false)}><Ionicons name="close" size={24} /></Pressable></View>
          <TextInput value={search} onChangeText={setSearch} placeholder="Escribir para filtrar..." style={styles.input} autoFocus />
          <ScrollView style={{ marginTop: 10, maxHeight: 400 }}>
            {filtered.map((opt: any, idx: number) => (
              <Pressable key={idx} onPress={() => { onUpdate({ desc: opt }); setModalOpen(false); }} style={styles.optBtn}>
                <Ionicons name={isEquipo ? 'construct-outline' : 'person-outline'} size={16} color={colors.textMuted} />
                <Text style={styles.optTxt}>{typeof opt === 'string' ? opt : opt.nombre}</Text>
              </Pressable>
            ))}
            {search.trim().length > 0 && (
              <Pressable onPress={() => { onUpdate({ desc: isEquipo ? { nombre: search } : search }); setModalOpen(false); }} style={styles.customBtn}>
                <Text style={styles.customTxt}>+ Usar "{search}"</Text>
              </Pressable>
            )}
          </ScrollView>
        </View></View>
      </Modal>
    </View>
  );
}

// Junta el catálogo del proyecto (fijo) con el catálogo personal persistido
// en el dispositivo (histórico de valores libres capturados antes),
// deduplicado sin distinguir mayúsculas/minúsculas — mismo criterio que
// `effectiveCatalogPersonal`/`effectiveCatalogEquipo` en (spec)/nuevo.tsx.
export function mergeCatalog(projectCatalog: string[] | undefined, deviceCatalog: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...(projectCatalog || []), ...deviceCatalog]) {
    if (!s) continue;
    const k = s.toLowerCase().trim();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.trim());
  }
  return out;
}

export function mergeCatalogEquipo(projectCatalog: string[] | undefined, deviceCatalog: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const it of [...(projectCatalog || []), ...deviceCatalog]) {
    const item = typeof it === 'string' ? { nombre: it } : it;
    if (!item || !item.nombre) continue;
    const k = `${item.nombre}`.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// Convierte los items capturados en el formato "qty desc" que ya usa todo
// el sistema (reportes, resource_logs, `_parse_qty_desc` en server.py).
export function itemsToEntries(items: PersonalEquipoItem[]): string[] {
  return items
    .filter((it) => it.desc)
    .map((it) => `${it.qty} ${typeof it.desc === 'string' ? it.desc : it.desc.nombre}`);
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 24, ...shadow.card, borderWidth: 1, borderColor: '#F1F5F9', gap: 16, marginBottom: 32 },
  cardLabel: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  cardHelp: { fontSize: 11, color: '#64748B' },
  emptyItems: { padding: 20, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 8, borderStyle: 'dashed', borderWidth: 1, borderColor: '#CBD5E1' },
  emptyItemsTxt: { fontSize: 12, color: '#64748B', textAlign: 'center' },
  input: { minHeight: 48, backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0F172A' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addSmallBtn: { padding: 4 },
  addSmallTxt: { color: '#1E40AF', fontWeight: '800', fontSize: 12 },
  dynRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  dynQtyWrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: 108, height: 40, backgroundColor: '#F8FAFC', borderRadius: 20,
    borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 4,
  },
  qtyBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  qtyValue: { flex: 1, textAlign: 'center', fontWeight: '900', color: '#0F172A', fontSize: 15 },
  descInput: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  descTxt: { fontSize: 13, fontWeight: '700', color: '#1E293B', lineHeight: 18 },
  dynDelBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  optBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  optTxt: { fontSize: 13, color: '#334155', fontWeight: '600', flex: 1 },
  customBtn: { paddingVertical: 14, alignItems: 'center' },
  customTxt: { color: '#1E40AF', fontWeight: '800', fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 24, padding: 20, ...shadow.lg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
});
