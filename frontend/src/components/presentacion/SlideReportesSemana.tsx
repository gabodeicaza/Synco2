// Slide "Reportes de la semana" — los reportes que el usuario eligió destacar
// en el informe. Espejo simplificado de las láminas "ACTIVIDADES DE LA
// SEMANA" del PPTX: por reporte, título, ubicación/fecha, texto y fotos.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { Report } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';

function fotoUri(b64: string): string {
  return b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
}

export function SlideReportesSemana({ reportes, colorTema, pendientes }: { reportes: Report[]; colorTema: string; pendientes: boolean }) {
  if (!reportes.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTxt}>
          {pendientes ? 'Cargando reportes…' : 'Todavía no elegiste reportes para esta sección.'}
        </Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
      <Text style={[styles.kicker, { color: colorTema }]}>ACTIVIDADES DE LA SEMANA</Text>
      {reportes.map((r) => {
        const partes: [string, string | null | undefined][] = [
          ['Actividades', r.actividades], ['Avance', r.avance],
          ['Observaciones', r.observaciones], ['Incidencias', r.incidencias],
        ];
        const caps = r.photo_captions || [];
        return (
          <View key={r.id} style={styles.card}>
            <Text style={[styles.titulo, { color: colorTema }]}>{(r.title || '').trim() || 'Reporte'}</Text>
            <Text style={styles.meta}>
              {[(r.node_path_names || []).slice(-2).join(' › '), r.created_at ? r.created_at.slice(0, 10) : '', r.area_name || '']
                .filter(Boolean).join(' · ')}
            </Text>
            {partes.filter(([, v]) => (v || '').trim()).map(([rot, v]) => (
              <View key={rot} style={{ marginTop: 6 }}>
                <Text style={[styles.rot, { color: colorTema }]}>{rot.toUpperCase()}</Text>
                <Text style={styles.txt}>{(v || '').trim()}</Text>
              </View>
            ))}
            {(r.images || []).length ? (
              <View style={styles.fotos}>
                {r.images.slice(0, 4).map((im, i) => (
                  <View key={i} style={styles.fotoWrap}>
                    <Image source={{ uri: fotoUri(im) }} style={styles.foto} resizeMode="cover" />
                    {caps[i] ? <Text style={styles.cap} numberOfLines={2}>{caps[i]}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface },
  titulo: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  rot: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  txt: { fontSize: 12, color: colors.text, marginTop: 2 },
  fotos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  fotoWrap: { width: '48%' },
  foto: { width: '100%', height: 90, borderRadius: radius.sm },
  cap: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
});
