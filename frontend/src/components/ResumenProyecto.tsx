// Resumen del proyecto en la pestaña Configuración (P-06): constructora, contrato, cliente, objeto del
// contrato, tipo de obra, muestra del color institucional, fechas en el formato único y descripción.
// Los campos vacíos se omiten.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Project, TipoObraInfo } from '@/src/api';
import { t } from '@/src/i18n';
import { colors, spacing } from '@/src/theme';
import { esColorHexValido } from '@/src/utils/color';
import { fmtFecha } from '@/src/utils/fechas';
import { nombreTipoObra } from '@/src/utils/tipoObraModulos';

type Fila = { clave: string; icono: any; etiqueta: string; valor?: string; color?: string };

/** Filas que se muestran, en orden. Pura: se prueba sin renderizar. */
export function filasResumen(project: Project, catalogo?: TipoObraInfo[] | null): Fila[] {
  const texto = (v: string | null | undefined) => (v ?? '').trim();
  const filas: Fila[] = [];
  const agregar = (f: Fila) => {
    if (f.valor || f.color) filas.push(f);
  };
  agregar({ clave: 'constructora', icono: 'business-outline', etiqueta: t('proyectoPantalla.constructora'), valor: texto(project.constructora) });
  agregar({ clave: 'contrato', icono: 'document-text-outline', etiqueta: t('proyectoPantalla.contrato'), valor: texto(project.contract_number) });
  agregar({ clave: 'cliente', icono: 'people-outline', etiqueta: t('proyectoPantalla.resumenCliente'), valor: texto(project.cliente_principal) });
  agregar({ clave: 'objeto', icono: 'reader-outline', etiqueta: t('proyectoPantalla.resumenObjeto'), valor: texto(project.objeto_contrato) });
  agregar({ clave: 'tipoObra', icono: 'construct-outline', etiqueta: t('proyectoPantalla.resumenTipoObra'), valor: nombreTipoObra(project.tipo_obra, catalogo) });
  if (esColorHexValido(project.color_institucional)) {
    agregar({ clave: 'color', icono: 'color-palette-outline', etiqueta: t('proyectoPantalla.resumenColor'), color: (project.color_institucional as string).trim() });
  }
  agregar({ clave: 'inicio', icono: 'calendar-outline', etiqueta: t('proyectoPantalla.inicio'), valor: project.start_date ? fmtFecha(project.start_date) : '' });
  agregar({ clave: 'termino', icono: 'calendar-outline', etiqueta: t('proyectoPantalla.termino'), valor: project.end_date ? fmtFecha(project.end_date) : '' });
  agregar({ clave: 'descripcion', icono: 'chatbox-ellipses-outline', etiqueta: t('proyectoPantalla.descripcion'), valor: texto(project.description) });
  return filas;
}

export function ResumenProyecto({ project, catalogo }: { project: Project; catalogo?: TipoObraInfo[] | null }) {
  return (
    <View>
      {filasResumen(project, catalogo).map((f) => (
        <View key={f.clave} style={styles.row} testID={`resumen-${f.clave}`}>
          <Ionicons name={f.icono} size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{f.etiqueta}</Text>
            {f.color ? (
              <View
                style={[styles.muestra, { backgroundColor: f.color }]}
                accessible
                accessibilityLabel={t('proyectoPantalla.resumenColorMuestra')}
                testID="resumen-color-muestra"
              />
            ) : (
              <Text style={styles.rowValue}>{f.valor}</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  rowValue: { fontSize: 14, color: colors.text, fontWeight: '700' },
  muestra: { width: 44, height: 22, borderRadius: 6, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border },
});
