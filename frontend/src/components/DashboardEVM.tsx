// Dashboard EVM (Valor Ganado) — pantalla completa, mismo patrón "screen
// dueña de su propio header" que CatalogoConceptosScreen.tsx / RegistrarAvanceScreen.tsx
// (las rutas en app/(subcoord|spec|coord)/... solo resuelven projectId).
//
// 3 tarjetas de KPI (SPI/CPI/Variación de Costo), Curva S (Planeado/Ganado/
// Real) y Lista por Excepción — ver server.py, sección "Etapa EVM: Análisis
// de Periodos". Curva S se dibuja con react-native-svg (YA es dependencia
// del proyecto) en vez de una librería de charts nueva: victory-native
// moderno depende de @shopify/react-native-skia (nativo, exige rebuild EAS
// completo) y tiene soporte débil en el export a Web que este proyecto
// también usa — react-native-svg funciona igual en Android/iOS/Web sin
// tocar una sola dependencia nueva.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, FlatList, RefreshControl,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Line as SvgLine, Text as SvgText, Circle } from 'react-native-svg';
import * as DocumentPicker from 'expo-document-picker';

import { api, AnalisisPeriodo, CurvaS, ExcepcionEvm, ActividadEvm, ActividadesEvm, GastoReal, GastoRealImportResult, RegistroAvanceImportResult } from '@/src/api';
import { colors, spacing, radius, shadow } from '@/src/theme';
import { Button } from '@/src/components/Button';
import { confirm } from '@/src/utils/confirm';
import { formatMoney, isValidDecimalInput } from '@/src/utils/money';
import { downloadBlob } from '@/src/utils/downloadBlob';
import { dayjs, CDMX_TZ } from '@/src/utils/tz';
import { a11y } from '@/src/i18n';

const FECHA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
type TabActividades = 'pendientes' | 'actuales' | 'por_venir';
const TABS_ACTIVIDADES: { key: TabActividades; label: string }[] = [
  { key: 'pendientes', label: 'Pendientes' },
  { key: 'actuales', label: 'Actuales' },
  { key: 'por_venir', label: 'Por venir' },
];

type RangoRapido = 'mes_actual' | 'ultimos_3_meses' | 'proyecto_completo';

function rangoDesde(rango: RangoRapido, curva: CurvaS | null): { start: string; end: string } {
  const hoy = dayjs().tz(CDMX_TZ);
  if (rango === 'mes_actual') {
    return { start: hoy.startOf('month').format('YYYY-MM-DD'), end: hoy.format('YYYY-MM-DD') };
  }
  if (rango === 'ultimos_3_meses') {
    return { start: hoy.subtract(3, 'month').startOf('month').format('YYYY-MM-DD'), end: hoy.format('YYYY-MM-DD') };
  }
  // proyecto_completo: desde el primer mes con datos en la Curva S hasta hoy.
  const primerMes = curva && curva.meses.length ? `${curva.meses[0]}-01` : hoy.startOf('year').format('YYYY-MM-DD');
  return { start: primerMes, end: hoy.format('YYYY-MM-DD') };
}

/** SPI/CPI vienen como string decimal (ver server.py: quantize a 4
 * decimales, nunca la división cruda) — Number() aquí es seguro porque es
 * solo para decidir el color del semáforo, no para volver a calcular ni
 * guardar nada (la regla de "nunca float" es sobre dinero persistido). */
function colorIndice(valor: string | null): string {
  if (valor === null) return colors.textMuted;
  const n = Number(valor);
  if (n >= 1) return colors.success;
  if (n >= 0.9) return colors.warning;
  return colors.error;
}

function KpiCard({ label, valor, sub, color }: { label: string; valor: string; sub?: string; color: string }) {
  return (
    <View style={[styles.kpiCard, { borderColor: color }]}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValor, { color }]}>{valor}</Text>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

/** Compacta un monto a K/M/B SOLO para etiquetas del eje Y — nunca se usa
 * para dinero real (persistido, sumado, comparado); es puramente de
 * despliegue, igual que el resto de la geometría de este chart. */
function formatMoneyCompact(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Tamaño ~3x el original (320x160) a pedido del Coordinador, con ejes
// rotulados y un tick por MES (desglose completo) en vez de solo el primero
// y el último — con ancho fijo por mes y scroll horizontal para que nunca
// se amontonen las etiquetas, sin importar cuántos meses abarque el proyecto.
const CURVA_PAD_LEFT = 60;
const CURVA_PAD_RIGHT = 16;
const CURVA_PAD_TOP = 20;
const CURVA_PAD_BOTTOM = 40;
const CURVA_HEIGHT = 480;
const CURVA_PX_POR_MES = 56;
const CURVA_Y_TICKS = 5;

/** Curva S de 3 líneas (Planeado/Ganado/Real) dibujada a mano con
 * react-native-svg — los 3 arreglos de CurvaS ya vienen acumulados y en el
 * mismo orden de meses, así que solo hay que normalizar a coordenadas de
 * pantalla. Los valores de dinero se parsean a Number SOLO para geometría
 * del gráfico (posición de un punto en píxeles), nunca se recalculan ni se
 * guardan — no es el caso que la regla de Decimal-siempre está protegiendo. */
function CurvaSChart({ curva }: { curva: CurvaS }) {
  const { width: windowWidth } = useWindowDimensions();
  const n = curva.meses.length;
  const minInnerWidth = windowWidth - spacing.md * 2 - CURVA_PAD_LEFT - CURVA_PAD_RIGHT;
  const innerWidth = Math.max(minInnerWidth, (n <= 1 ? 1 : n - 1) * CURVA_PX_POR_MES);
  const width = innerWidth + CURVA_PAD_LEFT + CURVA_PAD_RIGHT;
  const height = CURVA_HEIGHT;

  const { series, max } = useMemo(() => {
    const planeado = curva.planeado_acumulado.map(Number);
    const ganado = curva.ganado_acumulado.map(Number);
    const real = curva.real_acumulado.map(Number);
    const maxVal = Math.max(1, ...planeado, ...ganado, ...real);
    const puntos = (serie: number[]) =>
      serie.map((v, i) => ({
        x: n <= 1 ? CURVA_PAD_LEFT : CURVA_PAD_LEFT + (i / (n - 1)) * innerWidth,
        y: height - CURVA_PAD_BOTTOM - (v / maxVal) * (height - CURVA_PAD_TOP - CURVA_PAD_BOTTOM),
      }));
    return {
      series: { planeado: puntos(planeado), ganado: puntos(ganado), real: puntos(real) },
      max: maxVal,
    };
  }, [curva, innerWidth, height, n]);

  // 3 líneas del mismo color de fondo (azul/gris/rojo) se vuelven
  // indistinguibles en cuanto dos series quedan muy cerca o una aplasta a
  // las otras en escala (ver caso real: Ganado en billones vs. Planeado/
  // Real en millones, las últimas dos se ven "pegadas" al eje X) — un
  // patrón de trazo distinto por serie SIGUE siendo legible aunque el
  // color no ayude, y los puntos marcan cada mes con dato real aunque la
  // línea se vea plana en esta escala.
  const puntosStr = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

  if (!curva.meses.length) {
    return (
      <View style={styles.curvaVacia}>
        <Text style={styles.curvaVaciaTxt}>Todavía no hay conceptos con fechas de inicio/fin capturadas para trazar la Curva S.</Text>
      </View>
    );
  }

  const yTicks = Array.from({ length: CURVA_Y_TICKS + 1 }, (_, i) => (max / CURVA_Y_TICKS) * i);

  return (
    <View>
      <Text style={styles.ejeYTitulo}>Importe acumulado (MXN)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <Svg width={width} height={height}>
          {yTicks.map((v, i) => {
            const y = height - CURVA_PAD_BOTTOM - (v / max) * (height - CURVA_PAD_TOP - CURVA_PAD_BOTTOM);
            return (
              <React.Fragment key={`y-${i}`}>
                <SvgLine x1={CURVA_PAD_LEFT} y1={y} x2={width - CURVA_PAD_RIGHT} y2={y} stroke={colors.border} strokeWidth={1} />
                <SvgText x={CURVA_PAD_LEFT - 6} y={y + 3} fontSize={10} fill={colors.textMuted} textAnchor="end">
                  {formatMoneyCompact(v)}
                </SvgText>
              </React.Fragment>
            );
          })}
          {curva.meses.map((mes, i) => {
            const x = n <= 1 ? CURVA_PAD_LEFT : CURVA_PAD_LEFT + (i / (n - 1)) * innerWidth;
            return (
              <React.Fragment key={mes}>
                <SvgLine x1={x} y1={CURVA_PAD_TOP} x2={x} y2={height - CURVA_PAD_BOTTOM} stroke={colors.border} strokeWidth={0.5} />
                <SvgText x={x} y={height - CURVA_PAD_BOTTOM + 16} fontSize={10} fill={colors.textMuted} textAnchor="middle">
                  {mes}
                </SvgText>
              </React.Fragment>
            );
          })}
          <Polyline points={puntosStr(series.planeado)} fill="none" stroke={colors.textMuted} strokeWidth={2.5} strokeDasharray="8,5" />
          <Polyline points={puntosStr(series.ganado)} fill="none" stroke={colors.primary} strokeWidth={2.5} />
          <Polyline points={puntosStr(series.real)} fill="none" stroke={colors.error} strokeWidth={2.5} strokeDasharray="1,4" strokeLinecap="round" />
          {series.planeado.map((p, i) => (
            <Circle key={`p-${i}`} cx={p.x} cy={p.y} r={2.5} fill={colors.textMuted} />
          ))}
          {series.real.map((p, i) => (
            <Circle key={`r-${i}`} cx={p.x} cy={p.y} r={2.5} fill={colors.error} />
          ))}
          {series.ganado.map((p, i) => (
            <Circle key={`g-${i}`} cx={p.x} cy={p.y} r={2.5} fill={colors.primary} />
          ))}
        </Svg>
      </ScrollView>
      <Text style={styles.ejeXTitulo}>Mes</Text>
      <View style={styles.leyendaRow}>
        <LeyendaItem color={colors.textMuted} label="Planeado" dash="8,5" valor={curva.planeado_acumulado[curva.planeado_acumulado.length - 1]} />
        <LeyendaItem color={colors.primary} label="Ganado" valor={curva.ganado_acumulado[curva.ganado_acumulado.length - 1]} />
        <LeyendaItem color={colors.error} label="Real" dash="1,4" valor={curva.real_acumulado[curva.real_acumulado.length - 1]} />
      </View>
    </View>
  );
}

/** El punto (línea sólida vs. punteada vs. discontinua) es un swatch
 * pequeño dibujado a mano con SVG en vez de solo un color de fondo —
 * el color por sí solo deja de servir en cuanto una serie aplasta a las
 * otras en escala (ver nota junto a CurvaSChart). El valor acumulado más
 * reciente junto a cada etiqueta hace evidente esa diferencia de escala
 * en números, no solo en píxeles. */
function LeyendaItem({ color, label, dash, valor }: { color: string; label: string; dash?: string; valor?: string }) {
  return (
    <View style={styles.leyendaItem}>
      <Svg width={18} height={10}>
        <SvgLine x1={0} y1={5} x2={18} y2={5} stroke={color} strokeWidth={2.5} strokeDasharray={dash} />
      </Svg>
      <Text style={styles.leyendaTxt}>{label}</Text>
      {valor !== undefined ? <Text style={styles.leyendaValor}>{formatMoneyCompact(Number(valor))}</Text> : null}
    </View>
  );
}

const EXCEPCION_META: Record<ExcepcionEvm['tipo'], { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  fuera_de_ventana: { icon: 'time-outline', color: colors.warning },
  sobre_meta: { icon: 'trending-up-outline', color: colors.error },
  atrasado: { icon: 'alert-circle-outline', color: colors.error },
};

function ExcepcionRow({ item }: { item: ExcepcionEvm }) {
  const meta = EXCEPCION_META[item.tipo];
  return (
    <View style={styles.excepcionRow}>
      <Ionicons name={meta.icon} size={18} color={meta.color} />
      <View style={{ flex: 1 }}>
        <Text style={styles.excepcionClave}>{item.clave} · {item.descripcion}</Text>
        <Text style={styles.excepcionDetalle}>{item.detalle}</Text>
      </View>
    </View>
  );
}

function ActividadCard({ item, tab }: { item: ActividadEvm; tab: TabActividades }) {
  const acento = tab === 'pendientes' ? colors.error : tab === 'actuales' ? colors.primary : colors.textMuted;
  return (
    <View style={[styles.actividadCard, { borderLeftColor: acento }]}>
      <Text style={styles.actividadClave}>{item.clave} · {item.descripcion}</Text>
      <Text style={styles.actividadFechas}>{item.fecha_inicio} → {item.fecha_fin}</Text>
      <View style={styles.actividadFooterRow}>
        <Text style={styles.actividadEjecutado}>{item.ejecutado} de {item.meta_cantidad} {item.unidad}</Text>
        <Text style={[styles.actividadPct, { color: acento }]}>{item.porcentaje_avance}%</Text>
      </View>
    </View>
  );
}

export default function DashboardEVM({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rango, setRango] = useState<RangoRapido>('mes_actual');
  const [analisis, setAnalisis] = useState<AnalisisPeriodo | null>(null);
  const [curva, setCurva] = useState<CurvaS | null>(null);
  const [excepciones, setExcepciones] = useState<ExcepcionEvm[]>([]);
  const [actividades, setActividades] = useState<ActividadesEvm | null>(null);
  const [tabActividades, setTabActividades] = useState<TabActividades>('pendientes');
  const [gastos, setGastos] = useState<GastoReal[]>([]);

  // Modal "Registrar gasto real (AC)" — fecha libre en vez de selector nativo
  // (mismo criterio que fecha_reunion en MinutasView.tsx): así se puede
  // capturar un gasto de un mes anterior que no se registró a tiempo, no
  // solo el gasto de hoy.
  const [gastoFormOpen, setGastoFormOpen] = useState(false);
  const [gastoFecha, setGastoFecha] = useState(() => dayjs().tz(CDMX_TZ).format('YYYY-MM-DD'));
  const [gastoMonto, setGastoMonto] = useState('');
  const [gastoDescripcion, setGastoDescripcion] = useState('');
  const [gastoClave, setGastoClave] = useState('');
  const [savingGasto, setSavingGasto] = useState(false);
  const [importandoGastos, setImportandoGastos] = useState(false);
  const [descargandoPlantilla, setDescargandoPlantilla] = useState(false);
  const [importandoAvances, setImportandoAvances] = useState(false);
  const [descargandoPlantillaAvance, setDescargandoPlantillaAvance] = useState(false);

  const cargar = useCallback(async (rangoActual: RangoRapido, curvaPrevia: CurvaS | null) => {
    if (!projectId) return;
    setError(null);
    try {
      // La Curva S se pide primero porque "proyecto completo" necesita su
      // primer mes para saber desde dónde arrancar la ventana de analisisPeriodo.
      const curvaResp = await api.analisisPeriodoCurvaS(projectId);
      setCurva(curvaResp);
      const { start, end } = rangoDesde(rangoActual, curvaResp || curvaPrevia);
      const [analisisResp, excepcionesResp, actividadesResp, gastosResp] = await Promise.all([
        api.analisisPeriodo(projectId, start, end),
        api.analisisPeriodoExcepciones(projectId),
        api.analisisPeriodoActividades(projectId),
        // Acotado al mismo rango que las tarjetas — un proyecto con miles de
        // gastos importados no debe renderizar todo el historial de golpe
        // (ver import_gastos_reales); "Proyecto completo" sí trae todo.
        api.listGastosReales(projectId, { desde: start, hasta: end }),
      ]);
      setAnalisis(analisisResp);
      setExcepciones(excepcionesResp);
      setActividades(actividadesResp);
      setGastos(gastosResp);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el dashboard EVM');
    }
  }, [projectId]);

  function openGastoForm() {
    setGastoFecha(dayjs().tz(CDMX_TZ).format('YYYY-MM-DD'));
    setGastoMonto('');
    setGastoDescripcion('');
    setGastoClave('');
    setGastoFormOpen(true);
  }

  async function onSaveGasto() {
    if (!FECHA_ISO_RE.test(gastoFecha)) {
      Alert.alert('Fecha inválida', 'Usa el formato AAAA-MM-DD, por ejemplo 2026-02-15.');
      return;
    }
    if (!isValidDecimalInput(gastoMonto) || Number(gastoMonto) <= 0) {
      Alert.alert('Monto inválido', 'Ingresa un número mayor a 0, con hasta 2 decimales.');
      return;
    }
    if (!gastoDescripcion.trim()) {
      Alert.alert('Falta información', 'Describe brevemente el gasto (ej. "Nómina semana 12").');
      return;
    }
    try {
      setSavingGasto(true);
      await api.createGastoReal(projectId, {
        fecha: gastoFecha, monto: gastoMonto, concepto_texto: gastoDescripcion.trim(),
        concepto_clave: gastoClave.trim() || undefined,
      });
      setGastoFormOpen(false);
      await cargar(rango, curva);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setSavingGasto(false);
    }
  }

  async function onDescargarPlantillaGastos() {
    if (descargandoPlantilla) return;
    setDescargandoPlantilla(true);
    try {
      const { blob, filename } = await api.downloadGastosRealesPlantilla();
      await downloadBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e: any) {
      Alert.alert('No se pudo descargar la plantilla', e?.message || 'Intentalo nuevamente.');
    } finally {
      setDescargandoPlantilla(false);
    }
  }

  async function onImportarGastosExcel() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setImportandoGastos(true);
      const res: GastoRealImportResult = await api.importGastosReales(projectId, {
        uri: asset.uri, name: asset.name || 'gasto_real.xlsx', mimeType: asset.mimeType,
      });
      const detalleErrores = res.errores.slice(0, 10).map((e) => `Fila ${e.fila}: ${e.motivo}`).join('\n');
      const masErrores = res.errores.length > 10 ? `\n...y ${res.errores.length - 10} más.` : '';
      const truncNota = res.errores_truncados ? '\n\n(Se muestran solo los primeros 200 errores del archivo.)' : '';
      const notaAvance = res.creados > 0
        ? '\n\nEsto solo registró el gasto (AC). El % de avance de estos conceptos no cambia con esta importación — captura o importa Registros de Avance por separado si también quieres actualizarlo.'
        : '';
      Alert.alert(
        res.creados > 0 ? 'Importación completada' : 'No se importó ningún gasto',
        `${res.creados} de ${res.total_filas} filas importadas.` +
          (res.errores.length > 0 ? `\n\n${res.errores.length} con error:\n${detalleErrores}${masErrores}${truncNota}` : '') +
          notaAvance,
      );
      if (res.creados > 0) await cargar(rango, curva);
    } catch (e: any) {
      Alert.alert('No se pudo importar el archivo', e?.message || 'Intentalo nuevamente.');
    } finally {
      setImportandoGastos(false);
    }
  }

  async function onDescargarPlantillaAvance() {
    if (descargandoPlantillaAvance) return;
    setDescargandoPlantillaAvance(true);
    try {
      const { blob, filename } = await api.downloadAvanceImportPlantilla(projectId);
      await downloadBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e: any) {
      Alert.alert('No se pudo descargar la plantilla', e?.message || 'Intentalo nuevamente.');
    } finally {
      setDescargandoPlantillaAvance(false);
    }
  }

  async function onImportarAvancesExcel() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setImportandoAvances(true);
      const res: RegistroAvanceImportResult = await api.importAvances(projectId, {
        uri: asset.uri, name: asset.name || 'registro_avance.xlsx', mimeType: asset.mimeType,
      });
      const detalleErrores = res.errores.slice(0, 10).map((e) => `Fila ${e.fila}: ${e.motivo}`).join('\n');
      const masErrores = res.errores.length > 10 ? `\n...y ${res.errores.length - 10} más.` : '';
      const truncNota = res.errores_truncados ? '\n\n(Se muestran solo los primeros 200 errores del archivo.)' : '';
      const notaRetrocesos = res.retrocesos > 0
        ? `\n\n${res.retrocesos} fila(s) tienen un avance MENOR al último capturado para ese concepto — se guardaron igual, pero conviene revisarlas (¿retroceso real o error de captura?).`
        : '';
      Alert.alert(
        res.creados > 0 ? 'Importación completada' : 'No se importó ningún avance',
        `${res.creados} de ${res.total_filas} filas importadas.` +
          (res.errores.length > 0 ? `\n\n${res.errores.length} con error:\n${detalleErrores}${masErrores}${truncNota}` : '') +
          notaRetrocesos,
      );
      if (res.creados > 0) await cargar(rango, curva);
    } catch (e: any) {
      Alert.alert('No se pudo importar el archivo', e?.message || 'Intentalo nuevamente.');
    } finally {
      setImportandoAvances(false);
    }
  }

  async function onDeleteGasto(g: GastoReal) {
    const ok = await confirm(
      'Borrar gasto real',
      `¿Borrar "${g.concepto_texto}" (${formatMoney(g.monto)}, ${g.fecha})? Esto afecta el AC y el CPI ya calculados.`,
      { confirmText: 'Borrar', destructive: true },
    );
    if (!ok) return;
    try {
      await api.deleteGastoReal(g.id);
      await cargar(rango, curva);
    } catch (e: any) {
      Alert.alert('No se pudo borrar', e?.message || 'Intentalo nuevamente.');
    }
  }

  useEffect(() => {
    setLoading(true);
    cargar(rango, curva).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, rango]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await cargar(rango, curva);
    setRefreshing(false);
  }, [cargar, rango, curva]);

  // Gasto Real (AC) y Registro de Avance (EV) son dos capturas totalmente
  // independientes (ver server.py: import_gastos_reales solo escribe en
  // gastos_reales, nunca en registros_avance) — importar gasto NUNCA mueve
  // el % de avance. Este mapa junta ambos por concepto_id solo para
  // mostrarlos lado a lado en la lista de abajo y que se note la brecha,
  // en vez de que el usuario asuma (como ya pasó) que cargar dinero
  // debería actualizar el avance físico.
  const avancePorConcepto = useMemo(() => {
    const map: Record<string, string> = {};
    if (actividades) {
      for (const lista of [actividades.pendientes, actividades.actuales, actividades.por_venir]) {
        for (const a of lista) map[a.concepto_id] = a.porcentaje_avance;
      }
    }
    return map;
  }, [actividades]);

  // Curva S: "Ganado" (EV) sale de registros_avance, "Real" (AC) sale de
  // gastos_reales — si solo se ha importado/capturado gasto y nunca avance
  // físico, Ganado se queda plano en 0 aunque sí haya gasto. Sin este aviso
  // se lee como "el proyecto no ha avanzado", cuando en realidad es que
  // nadie ha capturado avance todavía.
  const soloHayGastoSinAvance = useMemo(() => {
    if (!curva || !curva.meses.length) return false;
    const ganadoTotal = curva.ganado_acumulado.reduce((acc, v) => acc + Number(v), 0);
    const realTotal = curva.real_acumulado.reduce((acc, v) => acc + Number(v), 0);
    return ganadoTotal === 0 && realTotal > 0;
  }, [curva]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { paddingTop: insets.top + spacing.xs, backgroundColor: colors.primary }]}>
        <View style={styles.headerTopRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={a11y('volver')} onPress={() => router.back()} hitSlop={10} style={styles.headerBackBtn}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Control de Obra — Valor Ganado</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
      >
        <View style={styles.rangoRow}>
          {(['mes_actual', 'ultimos_3_meses', 'proyecto_completo'] as RangoRapido[]).map((r) => (
            <Pressable accessibilityRole="button"
              key={r}
              onPress={() => setRango(r)}
              style={[styles.rangoChip, rango === r && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={[styles.rangoChipTxt, rango === r && { color: '#fff' }]}>
                {r === 'mes_actual' ? 'Mes actual' : r === 'ultimos_3_meses' ? 'Últimos 3 meses' : 'Proyecto completo'}
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.error} />
            <Text style={styles.errorTxt}>{error}</Text>
          </View>
        ) : null}

        {analisis ? (
          <>
            <View style={styles.kpiRow}>
              <KpiCard
                label="SPI (tiempo)"
                valor={analisis.spi ?? '—'}
                sub={analisis.spi === null ? 'Sin planeado en el periodo' : undefined}
                color={colorIndice(analisis.spi)}
              />
              <KpiCard
                label="CPI (costo)"
                valor={analisis.cpi ?? '—'}
                sub={analisis.cpi === null ? 'Sin gasto real capturado' : undefined}
                color={colorIndice(analisis.cpi)}
              />
              <KpiCard
                label="Variación de costo"
                valor={formatMoney(analisis.variacion_costo)}
                sub="Ganado − Real"
                color={Number(analisis.variacion_costo) >= 0 ? colors.success : colors.error}
              />
            </View>

            <View style={styles.pvEvAcRow}>
              <Text style={styles.pvEvAcTxt}>PV {formatMoney(analisis.pv)}</Text>
              <Text style={styles.pvEvAcTxt}>EV {formatMoney(analisis.ev)}</Text>
              <Text style={styles.pvEvAcTxt}>AC {formatMoney(analisis.ac)}</Text>
            </View>
          </>
        ) : null}

        <View style={styles.seccionHeaderRow}>
          <Text style={styles.seccionTitulo}>Gasto real (AC)</Text>
          <Pressable accessibilityRole="button" onPress={openGastoForm} style={styles.addBtn}>
            <Ionicons name="add" size={16} color={colors.primary} />
            <Text style={styles.addBtnTxt}>Registrar gasto</Text>
          </Pressable>
        </View>
        <View style={styles.importRow}>
          <Pressable accessibilityRole="button" onPress={onImportarGastosExcel} disabled={importandoGastos} style={styles.importBtn}>
            {importandoGastos ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="document-attach-outline" size={16} color={colors.primary} />
            )}
            <Text style={styles.addBtnTxt}>Importar desde Excel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onDescargarPlantillaGastos} disabled={descargandoPlantilla} style={styles.importBtn}>
            <Ionicons name="download-outline" size={16} color={colors.textMuted} />
            <Text style={styles.plantillaTxt}>Descargar plantilla</Text>
          </Pressable>
        </View>
        <Text style={styles.gastoAvisoTxt}>
          Esto registra dinero gastado (AC), no avance físico. El % de avance de cada concepto solo cambia si capturas o
          importas un Registro de Avance — ver "Control de actividades" más abajo.
        </Text>
        {gastos.length === 0 ? (
          <Text style={styles.sinExcepciones}>
            Aún no has capturado ningún gasto real — por eso CPI y Variación de costo no reflejan nada. Registra uno,
            aunque sea de un mes anterior que no se haya capturado a tiempo, o importa un Excel con miles de una vez.
          </Text>
        ) : (
          <FlatList
            data={gastos}
            keyExtractor={(g) => g.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={styles.gastoRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gastoTxt}>
                    {item.concepto_clave ? `${item.concepto_clave} · ` : ''}{item.concepto_texto}
                  </Text>
                  <Text style={styles.gastoFecha}>
                    {item.fecha}
                    {item.concepto_id && avancePorConcepto[item.concepto_id] !== undefined
                      ? ` · Avance físico: ${avancePorConcepto[item.concepto_id]}%`
                      : item.concepto_id ? ' · Avance físico: sin capturar' : ''}
                  </Text>
                </View>
                <Text style={styles.gastoMonto}>{formatMoney(item.monto)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={a11y('eliminar')} onPress={() => onDeleteGasto(item)} hitSlop={8} style={{ marginLeft: 8 }}>
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                </Pressable>
              </View>
            )}
          />
        )}

        <Text style={styles.seccionTitulo}>Curva S</Text>
        {curva ? <CurvaSChart curva={curva} /> : null}
        {soloHayGastoSinAvance ? (
          <Text style={styles.gastoAvisoTxt}>
            La línea "Ganado" está en $0 porque todavía no se ha capturado ningún Registro de Avance en este proyecto —
            no significa que no haya avance real, solo que aún no se ha registrado en el sistema (distinto del gasto,
            que sí se ha capturado).
          </Text>
        ) : null}

        <Text style={styles.seccionTitulo}>Lista por excepción ({excepciones.length})</Text>
        {excepciones.length === 0 ? (
          <Text style={styles.sinExcepciones}>Sin anomalías: ningún avance fuera de ventana, concepto sobre meta, ni actividad atrasada.</Text>
        ) : (
          <FlatList
            data={excepciones}
            keyExtractor={(item, idx) => `${item.concepto_id}-${item.tipo}-${idx}`}
            renderItem={({ item }) => <ExcepcionRow item={item} />}
            scrollEnabled={false}
          />
        )}

        <Text style={styles.seccionTitulo}>Control de actividades</Text>
        <View style={styles.importRow}>
          <Pressable accessibilityRole="button" onPress={onImportarAvancesExcel} disabled={importandoAvances} style={styles.importBtn}>
            {importandoAvances ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="document-attach-outline" size={16} color={colors.primary} />
            )}
            <Text style={styles.addBtnTxt}>Importar avance desde Excel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onDescargarPlantillaAvance} disabled={descargandoPlantillaAvance} style={styles.importBtn}>
            <Ionicons name="download-outline" size={16} color={colors.textMuted} />
            <Text style={styles.plantillaTxt}>Descargar plantilla</Text>
          </Pressable>
        </View>
        <Text style={styles.gastoAvisoTxt}>
          Esto SÍ mueve el % de avance de cada concepto (EV) — es la importación complementaria a "Gasto real (AC)" de
          arriba, para cargar de golpe avance físico histórico en vez de capturarlo día por día desde la app.
        </Text>
        <View style={styles.tabsRow}>
          {TABS_ACTIVIDADES.map((t) => {
            const count = actividades ? actividades[t.key].length : 0;
            return (
              <Pressable accessibilityRole="button"
                key={t.key}
                onPress={() => setTabActividades(t.key)}
                style={[styles.tabBtn, tabActividades === t.key && styles.tabBtnActive]}
              >
                <Text style={[styles.tabTxt, tabActividades === t.key && styles.tabTxtActive]}>
                  {t.label} ({count})
                </Text>
              </Pressable>
            );
          })}
        </View>
        {!actividades || actividades[tabActividades].length === 0 ? (
          <Text style={styles.sinExcepciones}>
            {tabActividades === 'pendientes' ? 'Ninguna actividad atrasada.'
              : tabActividades === 'actuales' ? 'Ninguna actividad dentro de su ventana hoy.'
              : 'Ninguna actividad programada todavía sin empezar.'}
          </Text>
        ) : (
          <FlatList
            data={actividades[tabActividades]}
            keyExtractor={(item) => item.concepto_id}
            scrollEnabled={false}
            renderItem={({ item }) => <ActividadCard item={item} tab={tabActividades} />}
          />
        )}
      </ScrollView>

      <Modal visible={gastoFormOpen} transparent animationType="slide" onRequestClose={() => setGastoFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Registrar gasto real</Text>

            <Text style={styles.fieldLabel}>Fecha (AAAA-MM-DD)</Text>
            <TextInput
              value={gastoFecha}
              onChangeText={setGastoFecha}
              placeholder="2026-02-15"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Monto</Text>
            <TextInput
              value={gastoMonto}
              onChangeText={setGastoMonto}
              keyboardType="decimal-pad"
              placeholder="200000.00"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Descripción</Text>
            <TextInput
              value={gastoDescripcion}
              onChangeText={setGastoDescripcion}
              placeholder="Ej. Nómina semana 12, Factura #445..."
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Clave del concepto (opcional)</Text>
            <TextInput
              value={gastoClave}
              onChangeText={setGastoClave}
              placeholder="Ej. C-001 — déjalo vacío si es gasto general"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              style={styles.input}
            />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Cancelar" variant="secondary" onPress={() => setGastoFormOpen(false)} style={{ flex: 1 }} />
              <Button label="Guardar" loading={savingGasto} onPress={onSaveGasto} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBackBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff', flex: 1 },
  rangoRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.md },
  rangoChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  rangoChipTxt: { fontSize: 12, fontWeight: '600', color: colors.text },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg,
    borderRadius: radius.full, padding: 10, marginBottom: spacing.md,
  },
  errorTxt: { color: colors.error, flex: 1, fontSize: 13 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.md },
  kpiCard: {
    flex: 1, borderWidth: 1.5, borderRadius: 12, padding: 10, backgroundColor: colors.surface,
  },
  kpiLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  kpiValor: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  kpiSub: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  pvEvAcRow: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface,
    borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: spacing.md,
  },
  pvEvAcTxt: { fontSize: 12, fontWeight: '600', color: colors.textBody },
  seccionTitulo: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: 8 },
  curvaVacia: { padding: 16, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  curvaVaciaTxt: { color: colors.textMuted, fontSize: 12 },
  ejeYTitulo: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginBottom: 4, marginLeft: CURVA_PAD_LEFT },
  ejeXTitulo: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  leyendaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 8, justifyContent: 'center' },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leyendaTxt: { fontSize: 11, color: colors.textMuted },
  leyendaValor: { fontSize: 11, fontWeight: '700', color: colors.text },
  sinExcepciones: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  gastoAvisoTxt: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginBottom: 10, lineHeight: 15 },
  excepcionRow: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  excepcionClave: { fontSize: 13, fontWeight: '700', color: colors.text },
  excepcionDetalle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  seccionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.md, marginBottom: 8,
  },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.primary },
  importRow: { flexDirection: 'row', gap: spacing.md, marginBottom: 8 },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  plantillaTxt: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  gastoRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  gastoTxt: { fontSize: 13, fontWeight: '600', color: colors.text },
  gastoFecha: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  gastoMonto: { fontSize: 13, fontWeight: '700', color: colors.text },
  tabsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tabBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { fontSize: 12, fontWeight: '700', color: colors.text },
  tabTxtActive: { color: '#fff' },
  actividadCard: {
    backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 4, padding: 10, marginBottom: 8, ...shadow.card,
  },
  actividadClave: { fontSize: 13, fontWeight: '700', color: colors.text },
  actividadFechas: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  actividadFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  actividadEjecutado: { fontSize: 12, color: colors.textBody },
  actividadPct: { fontSize: 13, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
});
