// Asistencia — Coordinador y Sub-Coordinador.
// La asistencia del Especialista se deriva del primer reporte del día (con su
// hora y la ubicación donde reportó). El Sub-Coordinador puede justificar una
// inasistencia (o corregir el día) y registrar la suya; el Coordinador puede
// editar a cualquiera. Tres vistas: Hoy (con hora y ubicación), Semana y Mes
// (tabla de personas × días con palomita/tache).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { api, AsistenciaEstado, AsistenciaPersona, AsistenciaRegistro, AsistenciaResp } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { colors, radius, spacing } from '@/src/theme';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';
import { dayjs } from '@/src/utils/tz';
import { downloadBlob } from '@/src/utils/downloadBlob';

type Vista = 'hoy' | 'semana' | 'mes';
type Celda = 'ok' | 'just' | 'no' | 'pend' | 'na';

const VISTAS: { value: Vista; label: string }[] = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mes' },
];
const DIA_LETRA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIA_NOMBRE = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const FUENTE_TXT: Record<string, string> = {
  reporte: 'Primer reporte del día',
  registro: 'Registrada por la persona',
  manual: 'Editada manualmente',
};

const ymd = (d: dayjs.Dayjs) => d.format('YYYY-MM-DD');

function rango(vista: Vista, ancla: string, hoy: string): { desde: string; hasta: string } {
  if (vista === 'hoy') return { desde: hoy, hasta: hoy };
  const a = dayjs(ancla);
  if (vista === 'semana') {
    const lunes = a.subtract((a.day() + 6) % 7, 'day');
    return { desde: ymd(lunes), hasta: ymd(lunes.add(6, 'day')) };
  }
  return { desde: ymd(a.startOf('month')), hasta: ymd(a.endOf('month')) };
}

function dias(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let d = dayjs(desde); !d.isAfter(hasta, 'day'); d = d.add(1, 'day')) out.push(ymd(d));
  return out;
}

function celdaDe(p: AsistenciaPersona, fecha: string, data: AsistenciaResp): Celda {
  const reg = data.registros[`${p.id}|${fecha}`];
  if (reg) return reg.estado === 'asistio' ? 'ok' : reg.estado === 'justificada' ? 'just' : 'no';
  if (fecha > data.hoy) return 'na';
  if (fecha === data.hoy) return 'pend';        // el día aún no termina
  if (dayjs(fecha).day() === 0) return 'na';    // domingo sin reporte: descanso
  if (p.alta && fecha < p.alta) return 'na';    // aún no estaba dado de alta
  return 'no';
}

function CeldaIcon({ c, size = 20 }: { c: Celda; size?: number }) {
  if (c === 'ok') return <Ionicons name="checkmark-circle" size={size} color={colors.success} />;
  if (c === 'no') return <Ionicons name="close-circle" size={size} color={colors.error} />;
  if (c === 'just') {
    return (
      <View style={[styles.just, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.justTxt, { fontSize: size * 0.55 }]}>J</Text>
      </View>
    );
  }
  return <Text style={[styles.na, { fontSize: size * 0.8 }]}>{c === 'pend' ? '·' : '–'}</Text>;
}

function tituloPeriodo(vista: Vista, desde: string, hasta: string): string {
  const a = dayjs(desde);
  if (vista === 'mes') return `${MESES[a.month()]} ${a.year()}`;
  const b = dayjs(hasta);
  return `${a.date()} ${MESES[a.month()].slice(0, 3)} – ${b.date()} ${MESES[b.month()].slice(0, 3)} ${b.year()}`;
}

export function AsistenciaScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const esCoord = user?.role === ROLE_COORD;
  const esSub = user?.role === ROLE_SUB;

  const [vista, setVista] = useState<Vista>('hoy');
  const [ancla, setAncla] = useState<string>(ymd(dayjs()));
  const [data, setData] = useState<AsistenciaResp | null>(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ p: AsistenciaPersona; fecha: string } | null>(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  const [exportando, setExportando] = useState(false);

  const hoyLocal = ymd(dayjs());
  const { desde, hasta } = useMemo(() => rango(vista, ancla, data?.hoy || hoyLocal), [vista, ancla, data?.hoy, hoyLocal]);

  const cargar = useCallback(async (silencioso = false) => {
    if (!projectId) return;
    if (!silencioso) setCargando(true);
    setError(null);
    try {
      setData(await api.getAsistencia(projectId, desde, hasta));
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar la asistencia');
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, [projectId, desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  function cambiarVista(v: Vista) {
    setVista(v);
    setAncla(ymd(dayjs()));
  }
  function mover(delta: number) {
    setAncla(ymd(dayjs(ancla).add(delta, vista === 'mes' ? 'month' : 'week')));
  }

  function puedeEditar(p: AsistenciaPersona, fecha: string): boolean {
    if (!data || fecha > data.hoy) return false;
    if (esCoord) return true;
    // Sub-Coordinador: a los Especialistas y a sí mismo (no a otros Sub-Coordinadores).
    return esSub && (p.role !== ROLE_SUB || p.id === user?.id);
  }

  function abrir(p: AsistenciaPersona, fecha: string) {
    setNota(data?.registros[`${p.id}|${fecha}`]?.nota || '');
    setSel({ p, fecha });
  }

  async function guardar(estado: AsistenciaEstado | 'auto') {
    if (!sel || guardando) return;
    setGuardando(true);
    try {
      await api.setAsistencia(projectId, sel.p.id, sel.fecha, { estado, nota: estado === 'auto' ? undefined : nota.trim() });
      setSel(null);
      await cargar(true);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intenta de nuevo');
    } finally {
      setGuardando(false);
    }
  }

  // Excel del periodo en pantalla (hoy / semana / mes) o el acumulado total.
  async function exportar(v: Vista | 'total') {
    if (exportando) return;
    setExportando(true);
    try {
      const { blob, filename } = await api.downloadAsistenciaXlsx(projectId, v, desde, hasta);
      await downloadBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e: any) {
      Alert.alert('No se pudo exportar', e?.message || 'Intenta de nuevo');
    } finally {
      setExportando(false);
    }
  }

  async function registrarMia() {
    if (registrando) return;
    setRegistrando(true);
    try {
      let lat: number | null = null;
      let lon: number | null = null;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({});
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
        }
      } catch {
        // Sin ubicación: se registra igual, solo con la hora.
      }
      await api.registrarMiAsistencia(projectId, { lat, lon });
      await cargar(true);
    } catch (e: any) {
      Alert.alert('No se pudo registrar', e?.message || 'Intenta de nuevo');
    } finally {
      setRegistrando(false);
    }
  }

  const personas = data?.personas || [];
  const subs = personas.filter((p) => p.role === ROLE_SUB);
  const esps = personas.filter((p) => p.role !== ROLE_SUB);
  const miRegistroHoy = data && user ? data.registros[`${user.id}|${data.hoy}`] : undefined;

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>Asistencia</Text>
        {exportando ? <ActivityIndicator color={colors.primary} style={{ width: 32 }} /> : (
          <Pressable onPress={() => exportar(vista)} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="download-outline" size={22} color={colors.primary} />
          </Pressable>
        )}
      </View>

      <View style={styles.exportRow}>
        <Pressable onPress={() => exportar(vista)} disabled={exportando} style={styles.exportBtn}>
          <Ionicons name="document-text-outline" size={14} color={colors.primary} />
          <Text style={styles.exportTxt}>Excel · {vista === 'hoy' ? 'diaria' : vista === 'semana' ? 'semanal' : 'mensual'}</Text>
        </Pressable>
        <Pressable onPress={() => exportar('total')} disabled={exportando} style={styles.exportBtn}>
          <Ionicons name="documents-outline" size={14} color={colors.primary} />
          <Text style={styles.exportTxt}>Excel · total</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {VISTAS.map((v) => (
          <Pressable key={v.value} onPress={() => cambiarVista(v.value)} style={[styles.tab, vista === v.value && styles.tabOn]}>
            <Text style={[styles.tabTxt, vista === v.value && styles.tabTxtOn]}>{v.label}</Text>
          </Pressable>
        ))}
      </View>

      {vista !== 'hoy' ? (
        <View style={styles.nav}>
          <Pressable onPress={() => mover(-1)} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
          </Pressable>
          <Text style={styles.navTxt}>{tituloPeriodo(vista, desde, hasta)}</Text>
          <Pressable onPress={() => mover(1)} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="chevron-forward" size={22} color={colors.primary} />
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => { setRefrescando(true); cargar(true); }} />}
      >
        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {cargando && !data ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} /> : null}

        {data && vista === 'hoy' ? (
          <>
            {esSub && !miRegistroHoy ? (
              <Pressable onPress={registrarMia} disabled={registrando} style={({ pressed }) => [styles.checkin, pressed && { opacity: 0.85 }]}>
                {registrando ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="location" size={20} color={colors.textInverse} />}
                <Text style={styles.checkinTxt}>Registrar mi asistencia</Text>
              </Pressable>
            ) : null}
            <ResumenHoy data={data} />
            {subs.length ? <SeccionHoy titulo="Sub-Coordinadores" personas={subs} data={data} onTap={abrir} /> : null}
            {esps.length ? <SeccionHoy titulo="Especialistas" personas={esps} data={data} onTap={abrir} /> : null}
          </>
        ) : null}

        {data && vista !== 'hoy' ? (
          <Tabla data={data} subs={subs} esps={esps} onTap={abrir} />
        ) : null}

        {data && !personas.length ? (
          <Text style={styles.vacio}>Este proyecto aún no tiene Especialistas ni Sub-Coordinadores.</Text>
        ) : null}

        {data ? (
          <View style={styles.leyenda}>
            <Leyenda c="ok" txt="Asistió" /><Leyenda c="just" txt="Justificada" /><Leyenda c="no" txt="Falta" /><Leyenda c="pend" txt="Pendiente / descanso" />
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="fade" onRequestClose={() => setSel(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSel(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {sel && data ? (
              <Detalle
                sel={sel} data={data} nota={nota} setNota={setNota} guardando={guardando}
                editable={puedeEditar(sel.p, sel.fecha)} onGuardar={guardar} onCerrar={() => setSel(null)}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ResumenHoy({ data }: { data: AsistenciaResp }) {
  const total = data.personas.length;
  const ok = data.personas.filter((p) => ['ok', 'just'].includes(celdaDe(p, data.hoy, data))).length;
  return (
    <Text style={styles.resumen}>
      {ok} de {total} con asistencia hoy · {dayjs(data.hoy).date()} de {MESES[dayjs(data.hoy).month()]}
    </Text>
  );
}

function SeccionHoy({ titulo, personas, data, onTap }: {
  titulo: string; personas: AsistenciaPersona[]; data: AsistenciaResp; onTap: (p: AsistenciaPersona, f: string) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.seccion}>{titulo}</Text>
      {personas.map((p) => {
        const c = celdaDe(p, data.hoy, data);
        const reg = data.registros[`${p.id}|${data.hoy}`];
        return (
          <Pressable key={p.id} onPress={() => onTap(p, data.hoy)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
            <CeldaIcon c={c} size={26} />
            <View style={{ flex: 1 }}>
              <Text style={styles.nombre} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[p.puesto, p.area_name].filter(Boolean).join(' · ') || ' '}</Text>
              {reg && reg.estado !== 'falta' && (reg.hora || reg.ubicacion) ? (
                <Text style={styles.det} numberOfLines={2}>
                  {reg.hora ? `${reg.hora} h` : ''}{reg.hora && reg.ubicacion ? ' · ' : ''}{reg.ubicacion || ''}
                </Text>
              ) : c === 'pend' ? <Text style={styles.det}>Sin reporte todavía</Text> : null}
              {reg?.estado === 'justificada' && reg.nota ? <Text style={styles.det} numberOfLines={2}>{reg.nota}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

const COL_NOMBRE = 120;
const COL_DIA = 32;
const FILA_H = 38;

function Tabla({ data, subs, esps, onTap }: {
  data: AsistenciaResp; subs: AsistenciaPersona[]; esps: AsistenciaPersona[];
  onTap: (p: AsistenciaPersona, f: string) => void;
}) {
  const lista = dias(data.desde, data.hasta);
  const filas = [...subs, ...esps];
  function total(p: AsistenciaPersona): string {
    let ok = 0; let n = 0;
    for (const f of lista) {
      const c = celdaDe(p, f, data);
      if (c === 'ok' || c === 'just') { ok++; n++; } else if (c === 'no') n++;
    }
    return `${ok}/${n}`;
  }
  return (
    <View style={styles.tabla}>
      <View>
        <View style={[styles.fila, styles.filaHead, { width: COL_NOMBRE }]}><Text style={styles.th}>Nombre</Text></View>
        {filas.map((p) => (
          <View key={p.id} style={[styles.fila, { width: COL_NOMBRE }]}>
            <Text style={styles.celdaNombre} numberOfLines={2}>{p.name}</Text>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={[styles.fila, styles.filaHead]}>
            {lista.map((f) => (
              <View key={f} style={[styles.celda, f === data.hoy && styles.celdaHoy]}>
                <Text style={styles.thDia}>{DIA_LETRA[dayjs(f).day()]}</Text>
                <Text style={styles.th}>{dayjs(f).date()}</Text>
              </View>
            ))}
            <View style={[styles.celda, { width: 48 }]}><Text style={styles.th}>Total</Text></View>
          </View>
          {filas.map((p) => (
            <View key={p.id} style={styles.fila}>
              {lista.map((f) => (
                <Pressable key={f} onPress={() => onTap(p, f)} style={[styles.celda, f === data.hoy && styles.celdaHoy]}>
                  <CeldaIcon c={celdaDe(p, f, data)} size={18} />
                </Pressable>
              ))}
              <View style={[styles.celda, { width: 48 }]}><Text style={styles.total}>{total(p)}</Text></View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Leyenda({ c, txt }: { c: Celda; txt: string }) {
  return (
    <View style={styles.leyItem}>
      <CeldaIcon c={c} size={16} />
      <Text style={styles.leyTxt}>{txt}</Text>
    </View>
  );
}

function Detalle({ sel, data, nota, setNota, guardando, editable, onGuardar, onCerrar }: {
  sel: { p: AsistenciaPersona; fecha: string }; data: AsistenciaResp; nota: string; setNota: (s: string) => void;
  guardando: boolean; editable: boolean; onGuardar: (e: AsistenciaEstado | 'auto') => void; onCerrar: () => void;
}) {
  const reg: AsistenciaRegistro | undefined = data.registros[`${sel.p.id}|${sel.fecha}`];
  const c = celdaDe(sel.p, sel.fecha, data);
  const d = dayjs(sel.fecha);
  const estadoTxt = c === 'ok' ? 'Asistió' : c === 'just' ? 'Falta justificada' : c === 'no' ? 'Falta' : c === 'pend' ? 'Sin reporte todavía' : 'Sin registro';
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.detHead}>
        <CeldaIcon c={c} size={28} />
        <View style={{ flex: 1 }}>
          <Text style={styles.nombre}>{sel.p.name}</Text>
          <Text style={styles.sub}>{DIA_NOMBRE[d.day()]} {d.date()} de {MESES[d.month()]} · {estadoTxt}</Text>
        </View>
        <Pressable onPress={onCerrar} hitSlop={8}><Ionicons name="close" size={22} color={colors.textMuted} /></Pressable>
      </View>

      {reg?.hora ? <Text style={styles.det}>Hora: {reg.hora} h</Text> : null}
      {reg?.ubicacion ? <Text style={styles.det}>Ubicación: {reg.ubicacion}</Text> : null}
      {reg?.lat != null && reg?.lon != null ? (
        <Pressable onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${reg.lat},${reg.lon}`)}>
          <Text style={styles.link}>Ver en el mapa</Text>
        </Pressable>
      ) : null}
      {reg ? <Text style={styles.det}>{FUENTE_TXT[reg.fuente]}{reg.editado_por ? ` (${reg.editado_por})` : ''}</Text> : null}
      {reg?.nota ? <Text style={styles.det}>Nota: {reg.nota}</Text> : null}

      {editable ? (
        <>
          <TextInput
            value={nota} onChangeText={setNota} placeholder="Motivo / nota (opcional)" placeholderTextColor={colors.textMuted}
            style={styles.input} maxLength={300}
          />
          <View style={styles.btnRow}>
            <BtnEstado txt="Asistió" color={colors.success} onPress={() => onGuardar('asistio')} disabled={guardando} />
            <BtnEstado txt="Justificada" color={colors.warning} onPress={() => onGuardar('justificada')} disabled={guardando} />
            <BtnEstado txt="Falta" color={colors.error} onPress={() => onGuardar('falta')} disabled={guardando} />
          </View>
          {reg?.fuente === 'manual' ? (
            <Pressable onPress={() => onGuardar('auto')} disabled={guardando} style={styles.reset}>
              <Text style={styles.resetTxt}>Restablecer a lo que dicen los reportes</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function BtnEstado({ txt, color, onPress, disabled }: { txt: string; color: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.btnEstado, { backgroundColor: color }, (pressed || disabled) && { opacity: 0.7 }]}>
      <Text style={styles.btnEstadoTxt}>{txt}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  exportRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: colors.primary,
  },
  exportTxt: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: colors.text },
  tabs: {
    flexDirection: 'row', marginHorizontal: spacing.lg, backgroundColor: colors.border, borderRadius: radius.md, padding: 3,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.md - 2 },
  tabOn: { backgroundColor: colors.surface },
  tabTxt: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  tabTxtOn: { color: colors.primary },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  navTxt: { fontSize: 15, fontWeight: '800', color: colors.text, textTransform: 'capitalize' },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: 10,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 13, fontWeight: '600' },
  checkin: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.lg,
  },
  checkinTxt: { color: colors.textInverse, fontSize: 15, fontWeight: '800' },
  resumen: { fontSize: 13, fontWeight: '700', color: colors.textBody },
  seccion: { fontSize: 12, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  nombre: { fontSize: 14, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  det: { fontSize: 12, color: colors.textBody, marginTop: 2 },
  vacio: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.lg, fontSize: 13 },
  just: { backgroundColor: colors.warning, alignItems: 'center', justifyContent: 'center' },
  justTxt: { color: colors.textInverse, fontWeight: '900' },
  na: { color: colors.textMuted, fontWeight: '800' },
  tabla: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  fila: { flexDirection: 'row', alignItems: 'center', height: FILA_H, borderBottomWidth: 1, borderBottomColor: colors.border },
  filaHead: { height: 46, backgroundColor: colors.bg },
  celda: { width: COL_DIA, height: '100%', alignItems: 'center', justifyContent: 'center' },
  celdaHoy: { backgroundColor: colors.primaryLight },
  celdaNombre: { fontSize: 12, fontWeight: '700', color: colors.text, paddingHorizontal: 8 },
  th: { fontSize: 11, fontWeight: '800', color: colors.textBody, paddingHorizontal: 8 },
  thDia: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  total: { fontSize: 12, fontWeight: '800', color: colors.text },
  leyenda: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
  leyItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leyTxt: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  detHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  link: { fontSize: 13, fontWeight: '700', color: colors.primary },
  input: {
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, marginTop: spacing.xs,
  },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  btnEstado: { flex: 1, paddingVertical: 11, borderRadius: radius.md, alignItems: 'center' },
  btnEstadoTxt: { color: colors.textInverse, fontWeight: '800', fontSize: 13 },
  reset: { alignItems: 'center', paddingVertical: 8 },
  resetTxt: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});
