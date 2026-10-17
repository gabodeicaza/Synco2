// Historial de recetas de Fuerza de Trabajo: lista las combinaciones de personal y maquinaria que el
// ingeniero ya reportó (de sus reportes anteriores) para reutilizarlas con un toque. Se usa tanto en
// "Nuevo reporte" como en la captura rápida.
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { InlineError } from '@/src/components/InlineError';
import { t } from '@/src/i18n';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { dayjs, CDMX_TZ } from '@/src/utils/tz';
import {
  Receta, recetasDesdeReportes, resumenReceta, textoEntrada,
} from '@/src/utils/recetasFuerzaTrabajo';

const REPORTES_A_REVISAR = 200;

function RecetaCard({ receta, onElegir }: { receta: Receta; onElegir: (r: Receta) => void }) {
  const { personas, equipos } = resumenReceta(receta);
  const resumen = [
    personas > 0 ? t(personas === 1 ? 'recetas.unaPersona' : 'recetas.personas', { n: personas }) : '',
    equipos > 0 ? t(equipos === 1 ? 'recetas.unEquipo' : 'recetas.equipos', { n: equipos }) : '',
  ].filter(Boolean).join(' · ');
  const fecha = dayjs.utc(receta.ultima).tz(CDMX_TZ).format('DD/MM/YYYY');
  const detalle = [...receta.personal, ...receta.equipo].map(textoEntrada).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('recetas.usarA11y', { resumen, fecha })}
      onPress={() => onElegir(receta)}
      style={styles.card}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardResumen}>{resumen}</Text>
        <Text style={styles.cardMeta}>{fecha}{receta.veces > 1 ? ` · ${t('recetas.veces', { n: receta.veces })}` : ''}</Text>
      </View>
      {receta.ubicacion ? <Text style={styles.cardUbic} numberOfLines={1}>{receta.ubicacion}</Text> : null}
      <Text style={styles.cardDetalle} numberOfLines={4}>{detalle}</Text>
    </Pressable>
  );
}

export function RecetasFuerzaTrabajo({
  projectId, visible, onClose, onElegir,
}: {
  projectId: string;
  visible: boolean;
  onClose: () => void;
  onElegir: (receta: Receta) => void;
}) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recetas, setRecetas] = useState<Receta[]>([]);

  useEffect(() => {
    if (!visible || !projectId) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    api.feed(projectId, 'all', REPORTES_A_REVISAR)
      .then((res) => { if (vivo) setRecetas(recetasDesdeReportes(res?.reports || [])); })
      .catch((e: any) => { if (vivo) setError(e?.message || t('recetas.errorCarga')); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [visible, projectId]);

  const vacio = useMemo(() => !cargando && !error && recetas.length === 0, [cargando, error, recetas]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fondo}>
        <View style={styles.hoja}>
          <View style={styles.encabezado}>
            <Text style={styles.titulo} accessibilityRole="header">{t('recetas.titulo')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('recetas.cerrar')} onPress={onClose} hitSlop={10} style={styles.cerrar}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.cuerpo}>
            <Text style={styles.ayuda}>{t('recetas.ayuda')}</Text>
            {cargando ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg }} /> : null}
            {error ? <InlineError message={error} /> : null}
            {vacio ? <Text style={styles.vacio}>{t('recetas.vacio')}</Text> : null}
            {recetas.map((r) => <RecetaCard key={r.id} receta={r} onElegir={onElegir} />)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Botón "Recetas anteriores" que va junto a los campos de personal y equipo. */
export function BotonRecetas({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('recetas.abrir')} onPress={onPress} style={styles.boton}>
      <Ionicons name="time-outline" size={16} color={colors.primary} />
      <Text style={styles.botonTxt}>{t('recetas.abrir')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  hoja: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    maxHeight: '88%', ...shadow.lg,
  },
  encabezado: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  titulo: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text },
  cerrar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cuerpo: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: 10 },
  ayuda: { fontSize: 13, color: colors.textBody, lineHeight: 19 },
  vacio: { fontSize: 13, color: colors.textMuted, paddingVertical: 8 },
  card: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, gap: 4,
    backgroundColor: colors.bg, minHeight: 44,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardResumen: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.text },
  cardMeta: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  cardUbic: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  cardDetalle: { fontSize: 12, color: colors.textBody, lineHeight: 17 },
  boton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44,
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 12,
  },
  botonTxt: { fontSize: 13, fontWeight: '800', color: colors.primary },
});
