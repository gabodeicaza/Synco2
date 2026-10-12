// Slide "Información Particular" — una sección puede contener varios
// bloques (una Estación con acceso/situación/actividades + fotos, o un
// "Intertramo" solo con galería de fotos). Variante completa vs. solo-
// galería se decide en RENDER según si el bloque tiene node_id con datos de
// acceso_predio/situacion_social — ver Decisión de diseño 2 del plan.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { colors, radius, spacing } from '@/src/theme';
import type { InformacionParticularBloque, LocationNode, PresentacionSeccion } from '@/src/api';

const ACCESO_COLOR: Record<string, string> = {
  'con acceso': '#16A34A', 'acceso al predio': '#16A34A', liberado: '#16A34A', libre: '#16A34A', si: '#16A34A', sí: '#16A34A',
  'sin acceso': '#DC2626', bloqueado: '#DC2626', denegado: '#DC2626', no: '#DC2626',
  parcial: '#D97706', restringido: '#D97706', 'acceso parcial al predio': '#D97706',
};

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <Text style={styles.bulletEmpty}>{empty}</Text>;
  return (
    <>
      {items.map((t, i) => (
        <Text key={i} style={styles.bullet}>{'•'} {t}</Text>
      ))}
    </>
  );
}

function Bloque({ bloque, node }: { bloque: InformacionParticularBloque; node: LocationNode | null }) {
  const tieneDatosNodo = !!node && (!!node.acceso_predio || !!node.situacion_social);
  const situacionItems = (node?.situacion_social || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return (
    <View style={styles.bloqueCard}>
      <Text style={styles.bloqueTitulo}>{bloque.titulo}</Text>
      {tieneDatosNodo ? (
        <View style={styles.datosNodoRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionLabel}>Acceso al Predio</Text>
            <View style={[styles.accesoBadge, { backgroundColor: ACCESO_COLOR[(node?.acceso_predio || '').trim().toLowerCase()] || colors.textMuted }]}>
              <Text style={styles.accesoBadgeTxt}>{(node?.acceso_predio || 'Sin especificar').toUpperCase()}</Text>
            </View>
            <Text style={[styles.sectionLabel, { marginTop: spacing.sm }]}>Situación Social - Liberación Física del Predio</Text>
            <Bullets items={situacionItems} empty="Sin información registrada" />
          </View>
        </View>
      ) : null}
      <Text style={[styles.sectionLabel, { marginTop: spacing.sm }]}>Actividades</Text>
      <Bullets items={bloque.actividades} empty="Sin actividades capturadas" />
      {bloque.fotos.length ? (
        <View style={styles.fotoGrid}>
          {bloque.fotos.map((f, i) => (
            <View key={i} style={styles.fotoCell}>
              <Image source={{ uri: f.photo }} style={styles.fotoImg} resizeMode="cover" />
              {f.destacado ? (
                <View style={styles.destacadoBadge}>
                  <Text style={styles.destacadoTxt} numberOfLines={1}>{f.destacado_label || 'Destacado'}</Text>
                </View>
              ) : null}
              {f.caption ? (
                <View style={styles.captionBadge}>
                  <Text style={styles.captionTxt} numberOfLines={1}>{f.caption}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function SlideInformacionParticular({
  seccion, nodesById,
}: {
  seccion: PresentacionSeccion;
  nodesById: Record<string, LocationNode>;
}) {
  const bloques = seccion.bloques || [];
  if (!bloques.length) {
    return (
      <View style={[styles.wrap, styles.empty]}>
        <Text style={styles.emptyTxt}>Sección sin contenido todavía.</Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: spacing.md }}>
      {bloques.map((b, i) => (
        <Bloque key={i} bloque={b} node={b.node_id ? nodesById[b.node_id] || null : null} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  bloqueCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  bloqueTitulo: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  datosNodoRow: { flexDirection: 'row' },
  sectionLabel: { fontSize: 10, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  accesoBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm },
  accesoBadgeTxt: { color: '#fff', fontWeight: '800', fontSize: 11 },
  bullet: { fontSize: 12, color: colors.textBody, marginBottom: 2 },
  bulletEmpty: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  fotoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  fotoCell: { width: '31%', aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.border },
  fotoImg: { width: '100%', height: '100%' },
  destacadoBadge: { position: 'absolute', top: 4, left: 4, right: 4, backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#D97706', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  destacadoTxt: { fontSize: 8, fontWeight: '800', color: '#92400E', textAlign: 'center' },
  captionBadge: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.65)', paddingHorizontal: 4, paddingVertical: 2 },
  captionTxt: { fontSize: 8, color: '#fff', textAlign: 'center' },
});
