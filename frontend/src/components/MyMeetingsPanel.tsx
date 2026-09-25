// SynCo v2.0 _ Panel "Mis reuniones" para el tab Inicio.
// Presentacional: recibe las reuniones ya resueltas (asignadas al usuario
// como autor o asistente, ver `mine=1` en GET /projects/{pid}/events) y solo
// las pinta con hora + ubicacion. `project_name` es opcional: solo lo manda
// el Coordinador General, que agrega reuniones de varios proyectos a la vez.
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ProjectEvent } from '@/src/api';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { t } from '@/src/i18n';
import type { ZonaProyecto } from '@/src/utils/fechas';
import { etiquetaDiaReunion, horaReunion, ordenarReuniones } from '@/src/utils/reuniones';

export type MyMeetingItem = ProjectEvent & { project_name?: string };

interface Props {
  items: MyMeetingItem[];
  loading?: boolean;
  /** Zona del proyecto para el día y la hora (sin ella: CDMX). El Coordinador mezcla proyectos. */
  zona?: ZonaProyecto | null;
}

export function MyMeetingsPanel({ items, loading, zona }: Props) {
  const ordenadas = useMemo(() => ordenarReuniones(items, zona), [items, zona]);
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
        <Text style={styles.title}>{t('reuniones.titulo')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>{t('reuniones.vacio')}</Text>
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {ordenadas.map((it) => (
            <View
              key={it.id}
              style={styles.card}
              accessible
              accessibilityLabel={`${it.title}. ${t('reuniones.etiqueta', { dia: etiquetaDiaReunion(it, zona), hora: horaReunion(it, zona) })}`}
            >
              <View style={styles.timeBlock}>
                <Text style={styles.dayTxt}>{etiquetaDiaReunion(it, zona)}</Text>
                <Text style={styles.timeTxt}>{horaReunion(it, zona)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{it.title}</Text>
                {it.project_name ? (
                  <View style={styles.metaRow}>
                    <Ionicons name="briefcase-outline" size={11} color={colors.textMuted} />
                    <Text style={styles.metaTxt} numberOfLines={1}>{it.project_name}</Text>
                  </View>
                ) : null}
                {it.location ? (
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={11} color={colors.textMuted} />
                    <Text style={styles.metaTxt} numberOfLines={1}>{it.location}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  title: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  center: { paddingVertical: spacing.md, alignItems: 'center' },
  empty: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  emptyTxt: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  card: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing.sm + 2, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  timeBlock: {
    minWidth: 84, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryLight, borderRadius: radius.md,
    paddingVertical: 8, paddingHorizontal: 6,
  },
  dayTxt: { fontSize: 10, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  timeTxt: { fontSize: 13, fontWeight: '800', color: colors.primary },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaTxt: { fontSize: 11, color: colors.textMuted, flexShrink: 1 },
});
