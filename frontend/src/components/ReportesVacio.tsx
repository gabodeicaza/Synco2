// Estado vacío de Reportes (R-01), con una variante por rol:
//  - coord: el Coordinador General no captura reportes; se explica quién los captura y se
//    ofrece invitar a un especialista.
//  - sub: el Subcoordinador espera la actividad de su equipo.
//  - spec: el Especialista puede crear su primer reporte.
// Si hay filtros o búsqueda activos, se distingue "no hay reportes para este filtro" de
// "no hay reportes en el proyecto" y se ofrece quitar los filtros.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/src/i18n';
import { colors, radius, spacing } from '@/src/theme';

export type VarianteReportesVacio = 'coord' | 'sub' | 'spec';

export interface ReportesVacioProps {
  variante: VarianteReportesVacio;
  /** Hay filtros (nodo, área, tiempo, estado) distintos de "todo". */
  hayFiltros?: boolean;
  /** Texto de búsqueda activo. */
  busqueda?: string;
  onQuitarFiltros?: () => void;
  onInvitar?: () => void;
  onCrear?: () => void;
}

interface Contenido {
  icono: keyof typeof Ionicons.glyphMap;
  titulo: string;
  mensaje: string;
}

export function contenidoReportesVacio(p: ReportesVacioProps): Contenido {
  const texto = (p.busqueda || '').trim();
  if (texto) {
    return { icono: 'search-outline', titulo: t('reportesVacio.sinResultados'), mensaje: t('reportesVacio.busqueda', { texto }) };
  }
  if (p.hayFiltros) {
    return { icono: 'funnel-outline', titulo: t('reportesVacio.sinResultados'), mensaje: t('reportesVacio.filtro') };
  }
  if (p.variante === 'coord') {
    return { icono: 'document-text-outline', titulo: t('reportesVacio.coordTitulo'), mensaje: t('reportesVacio.coordMensaje') };
  }
  if (p.variante === 'sub') {
    return { icono: 'time-outline', titulo: t('reportesVacio.subTitulo'), mensaje: t('reportesVacio.subMensaje') };
  }
  return { icono: 'reader-outline', titulo: t('reportesVacio.specTitulo'), mensaje: t('reportesVacio.specMensaje') };
}

export function ReportesVacio(props: ReportesVacioProps) {
  const { variante, hayFiltros, busqueda, onQuitarFiltros, onInvitar, onCrear } = props;
  const c = contenidoReportesVacio(props);
  const filtrado = !!(hayFiltros || (busqueda || '').trim());

  return (
    <View style={styles.caja}>
      <View style={styles.icono}>
        <Ionicons name={c.icono} size={26} color={colors.primary} />
      </View>
      <Text style={styles.titulo} accessibilityRole="header">{c.titulo}</Text>
      <Text style={styles.mensaje}>{c.mensaje}</Text>

      {filtrado && onQuitarFiltros ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('reportesVacio.quitarFiltros')}
          onPress={onQuitarFiltros}
          style={styles.boton}
        >
          <Ionicons name="close-circle-outline" size={18} color={colors.textInverse} />
          <Text style={styles.botonTxt}>{t('reportesVacio.quitarFiltros')}</Text>
        </Pressable>
      ) : null}

      {!filtrado && variante === 'coord' && onInvitar ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('reportesVacio.invitar')}
          onPress={onInvitar}
          style={styles.boton}
        >
          <Ionicons name="person-add-outline" size={18} color={colors.textInverse} />
          <Text style={styles.botonTxt}>{t('reportesVacio.invitar')}</Text>
        </Pressable>
      ) : null}

      {!filtrado && variante === 'spec' && onCrear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('reportesVacio.crear')}
          onPress={onCrear}
          style={styles.boton}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.textInverse} />
          <Text style={styles.botonTxt}>{t('reportesVacio.crear')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caja: {
    alignItems: 'center', gap: 10, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.md, marginTop: spacing.md, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  icono: {
    width: 52, height: 52, borderRadius: radius.full, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  titulo: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center' },
  mensaje: { fontSize: 13, color: colors.textBody, textAlign: 'center', lineHeight: 19 },
  boton: {
    marginTop: 6, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, paddingHorizontal: 18, borderRadius: radius.md,
  },
  botonTxt: { color: colors.textInverse, fontWeight: '800', fontSize: 14 },
});
