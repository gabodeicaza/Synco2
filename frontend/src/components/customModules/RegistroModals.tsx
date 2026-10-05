// Modales de apoyo de la pantalla de captura de un módulo personalizado:
// historial de cambios de un registro, bitácora de eliminados y filtros.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { CustomBorrado, CustomCampo, CustomHistorial } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { FILTROS_VACIOS, FiltrosRegistros, campoEstatusDe, detalleRegistro, tituloRegistro } from '@/src/utils/customModules';
import { fechaCorta } from '@/src/utils/fecha';
import { Chip, ChipRow, FieldLabel, SwitchRow, inputStyle } from './ui';

function Hoja({ visible, titulo, onClose, children, pie }: {
  visible: boolean; titulo: string; onClose: () => void; children: React.ReactNode; pie?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.head}>
            <Text style={styles.title}>{titulo}</Text>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.md }}>{children}</ScrollView>
          {pie}
        </View>
      </View>
    </Modal>
  );
}

const cuando = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function HistorialModal({ visible, historial, onClose }: { visible: boolean; historial: CustomHistorial[]; onClose: () => void }) {
  const lista = [...historial].reverse();
  return (
    <Hoja visible={visible} titulo="Historial de cambios" onClose={onClose}>
      {lista.length === 0 ? <Text style={styles.empty}>Sin historial.</Text> : null}
      {lista.map((h, i) => (
        <View key={i} style={styles.item}>
          <View style={styles.itemHead}>
            <Ionicons name={h.accion === 'creado' ? 'add-circle-outline' : h.accion === 'importado' ? 'cloud-upload-outline' : 'create-outline'} size={16} color={colors.primary} />
            <Text style={styles.itemTitle}>
              {h.accion === 'creado' ? 'Creado' : h.accion === 'importado' ? 'Importado' : 'Editado'} por {h.by_name}
            </Text>
          </View>
          <Text style={styles.meta}>{cuando(h.at)}</Text>
          {h.cambios.map((c, j) => (
            <View key={j} style={styles.cambio}>
              <Text style={styles.cambioCampo}>{c.campo}</Text>
              <Text style={styles.cambioTxt}>
                <Text style={styles.antes}>{c.antes}</Text>{'  →  '}<Text style={styles.despues}>{c.despues}</Text>
              </Text>
            </View>
          ))}
        </View>
      ))}
    </Hoja>
  );
}

export function EliminadosModal({ visible, items, campos, onClose }: {
  visible: boolean; items: CustomBorrado[]; campos: CustomCampo[]; onClose: () => void;
}) {
  return (
    <Hoja visible={visible} titulo="Registros eliminados" onClose={onClose}>
      <Text style={styles.meta}>Bitácora de auditoría: qué se borró, quién y cuándo. No se pueden restaurar desde aquí.</Text>
      {items.length === 0 ? <Text style={styles.empty}>No se ha eliminado ningún registro.</Text> : null}
      {items.map((b) => {
        const fake: any = { id: b.record_id, fecha: b.fecha, valores: b.valores };
        return (
          <View key={b.id} style={styles.item}>
            <Text style={styles.itemTitle}>{b.folio ? `${b.folio} · ` : ''}{tituloRegistro(campos, fake)}</Text>
            {detalleRegistro(campos, fake) ? <Text style={styles.meta} numberOfLines={3}>{detalleRegistro(campos, fake)}</Text> : null}
            <Text style={styles.meta}>
              Fecha del registro: {fechaCorta(b.fecha)}{b.created_by_name ? ` · Capturó: ${b.created_by_name}` : ''}
            </Text>
            <Text style={[styles.meta, { color: colors.error }]}>Eliminado por {b.deleted_by_name} el {cuando(b.deleted_at)}</Text>
          </View>
        );
      })}
    </Hoja>
  );
}

export function FiltrosModal({ visible, filtros, campos, autores, onApply, onClose }: {
  visible: boolean; filtros: FiltrosRegistros; campos: CustomCampo[]; autores: string[];
  onApply: (f: FiltrosRegistros) => void; onClose: () => void;
}) {
  const [f, setF] = useState<FiltrosRegistros>(filtros);
  useEffect(() => { if (visible) setF(filtros); }, [visible, filtros]);
  const est = campoEstatusDe(campos);
  const campoSel = campos.find((c) => c.id === f.campoId);
  const filtrables = campos.filter((c) => (c.tipo === 'seleccion' || c.tipo === 'multiseleccion' || c.tipo === 'interruptor') && !c.estatus);
  const set = (p: Partial<FiltrosRegistros>) => setF((x) => ({ ...x, ...p }));

  return (
    <Hoja
      visible={visible} titulo="Filtrar registros" onClose={onClose}
      pie={(
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button label="Limpiar" variant="secondary" onPress={() => { setF({ ...FILTROS_VACIOS, texto: f.texto }); }} style={{ flex: 1 }} />
          <Button label="Aplicar" onPress={() => { onApply(f); onClose(); }} style={{ flex: 1 }} />
        </View>
      )}
    >
      <FieldLabel>Rango de fechas del registro</FieldLabel>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <TextInput value={f.desde} onChangeText={(t) => set({ desde: t })} placeholder="Desde (DD/MM/AAAA)" placeholderTextColor={colors.textMuted} style={[inputStyle, { flex: 1 }]} autoCapitalize="none" />
        <TextInput value={f.hasta} onChangeText={(t) => set({ hasta: t })} placeholder="Hasta" placeholderTextColor={colors.textMuted} style={[inputStyle, { flex: 1 }]} autoCapitalize="none" />
      </View>

      {autores.length > 0 ? (
        <>
          <FieldLabel>Registró</FieldLabel>
          <ChipRow>
            <Chip label="Todos" on={!f.autor} onPress={() => set({ autor: null })} />
            {autores.map((a) => <Chip key={a} label={a} on={f.autor === a} onPress={() => set({ autor: a })} />)}
          </ChipRow>
        </>
      ) : null}

      {est ? (
        <>
          <FieldLabel>{est.etiqueta}</FieldLabel>
          <ChipRow>
            <Chip label="Todos" on={!f.estatus} onPress={() => set({ estatus: null })} />
            {(est.opciones || []).map((o) => <Chip key={o} label={o} on={f.estatus === o} onPress={() => set({ estatus: o })} />)}
          </ChipRow>
          <SwitchRow label="Ocultar los cerrados" value={f.soloAbiertos} onChange={(v) => set({ soloAbiertos: v })} />
        </>
      ) : null}

      {filtrables.length > 0 ? (
        <>
          <FieldLabel>Filtrar por otro campo</FieldLabel>
          <ChipRow>
            <Chip label="Ninguno" on={!f.campoId} onPress={() => set({ campoId: null, campoValor: null })} />
            {filtrables.map((c) => <Chip key={c.id} label={c.etiqueta} on={f.campoId === c.id} onPress={() => set({ campoId: c.id, campoValor: null })} />)}
          </ChipRow>
          {campoSel ? (
            <>
              <View style={{ height: 6 }} />
              <ChipRow>
                {campoSel.tipo === 'interruptor' ? (
                  <>
                    <Chip label="Sí" on={f.campoValor === 'si'} onPress={() => set({ campoValor: 'si' })} />
                    <Chip label="No" on={f.campoValor === 'no'} onPress={() => set({ campoValor: 'no' })} />
                  </>
                ) : (campoSel.opciones || []).map((o) => <Chip key={o} label={o} on={f.campoValor === o} onPress={() => set({ campoValor: o })} />)}
              </ChipRow>
            </>
          ) : null}
        </>
      ) : null}
    </Hoja>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%', width: '100%' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg, fontSize: 13 },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemTitle: { fontSize: 13, fontWeight: '800', color: colors.text, flexShrink: 1 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
  cambio: { marginTop: 6, paddingLeft: 22 },
  cambioCampo: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase' },
  cambioTxt: { fontSize: 13, color: colors.text, marginTop: 1 },
  antes: { color: colors.error, textDecorationLine: 'line-through' },
  despues: { color: colors.success, fontWeight: '700' },
});
