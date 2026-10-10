// Preview NATIVO de una Presentación — páginas swipeables (FlatList
// horizontal con paging), una por sección, en vez de rasterizar un PDF/PPTX
// (no hay poppler/LibreOffice en este stack). Carga todos los datos que
// las secciones necesitan UNA sola vez aquí y los reparte como props a los
// componentes Slide* (dumb, sin fetch propio) — evita N+1 requests cuando
// hay muchas secciones del mismo tipo.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, FlatList, Alert, useWindowDimensions, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  api, AnalisisPeriodo, EstudioDisciplinaAvance, LocationNode, ModuloAutoOutline, PlanoAvance, Presentacion, PresentacionSeccionTipoAuto, Project, Report,
} from '@/src/api';
import { colors, radius, spacing, contrastText } from '@/src/theme';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { SlidePortada } from '@/src/components/presentacion/SlidePortada';
import { SlideMapaGeneral } from '@/src/components/presentacion/SlideMapaGeneral';
import { SlideDivisor } from '@/src/components/presentacion/SlideDivisor';
import { SlideFinanciero } from '@/src/components/presentacion/SlideFinanciero';
import { SlideSeguimientoEstudios } from '@/src/components/presentacion/SlideSeguimientoEstudios';
import { SlideCroquisEstacion } from '@/src/components/presentacion/SlideCroquisEstacion';
import { SlideInformacionParticular } from '@/src/components/presentacion/SlideInformacionParticular';
import { SlideAvanceGrafico } from '@/src/components/presentacion/SlideAvanceGrafico';
import { SlideReportesSemana } from '@/src/components/presentacion/SlideReportesSemana';
import { SlideCierre } from '@/src/components/presentacion/SlideCierre';
import { SlideModuloAuto } from '@/src/components/presentacion/SlideModuloAuto';
import { a11y } from '@/src/i18n';
import { periodoDePresentacion, textoRangoPeriodo } from '@/src/utils/finanzas';

const AUTO_TITULO: Record<PresentacionSeccionTipoAuto, string> = {
  ambiental: 'Ambiental', social: 'Social / Impacto urbano', seguridad: 'Seguridad',
  proyecto: 'Estudios y proyecto ejecutivo', calidad: 'Calidad', pendientes: 'Pendientes generales', electromecanico: 'Sistema electromecánico',
};
const isAuto = (t: string): t is PresentacionSeccionTipoAuto => t in AUTO_TITULO;

export default function PresentacionPreview({ projectId, presentacionId }: { projectId: string; presentacionId: string }) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [presentacion, setPresentacion] = useState<Presentacion | null>(null);
  const [nodesById, setNodesById] = useState<Record<string, LocationNode>>({});
  const [planosById, setPlanosById] = useState<Record<string, PlanoAvance>>({});
  const [disciplinaRows, setDisciplinaRows] = useState<EstudioDisciplinaAvance[]>([]);
  const [analisis, setAnalisis] = useState<AnalisisPeriodo | null>(null);
  const [presupuestoTotal, setPresupuestoTotal] = useState<string | null>(null);
  const [generalImages, setGeneralImages] = useState<string[]>([]);
  const [reportsById, setReportsById] = useState<Record<string, Report>>({});
  const [autoOutline, setAutoOutline] = useState<Record<string, ModuloAutoOutline[]>>({});
  const [exporting, setExporting] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  const load = useCallback(async () => {
    if (!projectId || !presentacionId) return;
    try {
      setLoading(true);
      const [proj, pres, nodes] = await Promise.all([
        api.getProject(projectId),
        api.getPresentacion(projectId, presentacionId),
        api.listNodes(projectId),
      ]);
      setProject(proj);
      setPresentacion(pres);
      const byId: Record<string, LocationNode> = {};
      nodes.forEach((n) => { byId[n.id] = n; });
      setNodesById(byId);

      const secciones = pres.secciones || [];
      const planoIds = Array.from(new Set(secciones.filter((s) => s.tipo === 'avance_grafico' && s.plano_id).map((s) => s.plano_id as string)));
      if (planoIds.length) {
        const planos = await Promise.all(planoIds.map((id) => api.getPlanoAvance(projectId, id)));
        const pById: Record<string, PlanoAvance> = {};
        planos.forEach((p) => { pById[p.id] = p; });
        setPlanosById(pById);
      } else {
        setPlanosById({});
      }

      if (secciones.some((s) => s.tipo === 'seguimiento_estudios')) {
        setDisciplinaRows(await api.listEstudioDisciplinaAvance(projectId));
      }

      if (secciones.some((s) => s.tipo === 'financiero')) {
        // Mismo servicio y mismo periodo que el tablero EVM (A-05): el servidor resuelve la ventana.
        const [an, pt] = await Promise.all([
          api.analisisPeriodoPorPeriodo(projectId, periodoDePresentacion(pres.periodo_financiero), pres.fecha).catch(() => null),
          api.analisisPeriodoPresupuestoTotal(projectId).catch(() => null),
        ]);
        setAnalisis(an);
        setPresupuestoTotal(pt?.presupuesto_total ?? null);
      }

      const reportIds = Array.from(new Set(secciones.filter((s) => s.tipo === 'reportes_semana').flatMap((s) => s.report_ids || [])));
      if (reportIds.length) {
        const reps = await Promise.all(reportIds.map((id) => api.getReport(id).catch(() => null)));
        const rById: Record<string, Report> = {};
        reps.forEach((r) => { if (r) rById[r.id] = r; });
        setReportsById(rById);
      } else {
        setReportsById({});
      }

      const autoTipos = Array.from(new Set(secciones.map((s) => s.tipo).filter(isAuto))) as PresentacionSeccionTipoAuto[];
      if (autoTipos.length) {
        const outs = await Promise.all(autoTipos.map((t) => api.previewPresentacionModuloAuto(projectId, presentacionId, t).catch(() => [] as ModuloAutoOutline[])));
        const o: Record<string, ModuloAutoOutline[]> = {};
        autoTipos.forEach((t, i) => { o[t] = outs[i]; });
        setAutoOutline(o);
      } else {
        setAutoOutline({});
      }

      if (secciones.some((s) => s.tipo === 'mapa_general')) {
        const gd = await api.getGeneralDataImages(projectId).catch(() => ({ general_data_images: [] }));
        setGeneralImages(gd.general_data_images || []);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el preview.');
    } finally {
      setLoading(false);
    }
  }, [projectId, presentacionId]);

  useEffect(() => { load(); }, [load]);

  const secciones = useMemo(
    () => [...(presentacion?.secciones || [])].sort((a, b) => a.orden - b.orden),
    [presentacion],
  );

  const pageW = winWidth;
  const pageH = winHeight - insets.top - insets.bottom - 56;

  async function onExport() {
    if (!presentacion) return;
    const url = api.presentacionExportUrl(projectId, presentacion.id);
    try {
      setExporting(true);
      if (Platform.OS === 'web') {
        Linking.openURL(url);
      } else {
        const can = await Linking.canOpenURL(url);
        if (can) await Linking.openURL(url);
        else Alert.alert('Exportar', 'No se pudo abrir el enlace de exportación.');
      }
    } catch (e: any) {
      Alert.alert('No se pudo exportar', e?.message || 'Inténtalo nuevamente.');
    } finally {
      setExporting(false);
    }
  }

  if (loading || !presentacion) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={presentacion.titulo}
        backgroundColor={headerColor}
        right={(
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('compartir')} onPress={onExport} hitSlop={10} style={styles.iconBtn} disabled={exporting}>
            {exporting ? <ActivityIndicator size="small" color={headerTextColor} /> : <Ionicons name="share-outline" size={20} color={headerTextColor} />}
          </Pressable>
        )}
      />

      {secciones.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTxt}>Esta Presentación todavía no tiene secciones.</Text>
        </View>
      ) : (
        <FlatList
          data={secciones}
          keyExtractor={(s) => s.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={{ width: pageW, height: pageH, padding: spacing.sm }}>
              <View style={styles.slideFrame}>
                {item.tipo === 'portada' ? (
                  <SlidePortada titulo={presentacion.titulo} fecha={presentacion.fecha} colorTema={headerColor} />
                ) : item.tipo === 'mapa_general' ? (
                  <SlideMapaGeneral images={generalImages} />
                ) : item.tipo === 'divisor' ? (
                  <SlideDivisor titulo={item.titulo || ''} colorTema={headerColor} />
                ) : item.tipo === 'financiero' ? (
                  <SlideFinanciero analisis={analisis} presupuestoTotal={presupuestoTotal} colorTema={headerColor} periodoTexto={textoRangoPeriodo(analisis?.start, analisis?.end)} />
                ) : item.tipo === 'seguimiento_estudios' ? (
                  <SlideSeguimientoEstudios rows={disciplinaRows} nodesById={nodesById} colorTema={headerColor} />
                ) : item.tipo === 'croquis_estacion' ? (
                  <SlideCroquisEstacion node={item.node_id ? nodesById[item.node_id] || null : null} />
                ) : item.tipo === 'informacion_particular' ? (
                  <SlideInformacionParticular seccion={item} nodesById={nodesById} />
                ) : item.tipo === 'avance_grafico' ? (
                  <SlideAvanceGrafico plano={item.plano_id ? planosById[item.plano_id] || null : null} />
                ) : item.tipo === 'reportes_semana' ? (
                  <SlideReportesSemana
                    reportes={(item.report_ids || []).map((id) => reportsById[id]).filter(Boolean)}
                    colorTema={headerColor}
                    pendientes={false}
                  />
                ) : isAuto(item.tipo) ? (
                  <SlideModuloAuto titulo={AUTO_TITULO[item.tipo]} outline={autoOutline[item.tipo] || null} colorTema={headerColor} loading={false} />
                ) : item.tipo === 'cierre' ? (
                  <SlideCierre leyenda={project?.objeto_contrato || project?.name || ''} colorTema={headerColor} />
                ) : null}
              </View>
            </View>
          )}
        />
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xs }]}>
        <Text style={styles.footerTxt}>{secciones.length} sección{secciones.length === 1 ? '' : 'es'} · desliza para navegar</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  emptyTxt: { color: colors.textMuted, fontSize: 13, textAlign: 'center', padding: spacing.lg },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  slideFrame: { flex: 1, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  footer: { alignItems: 'center', paddingTop: spacing.xs, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footerTxt: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
});
