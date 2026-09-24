// Formulario ÚNICO de Nuevo / Editar evento (G-04, X-03). Lo usan el Calendario de todos
// los roles y la administración de eventos del Coordinador General.
// - Errores en línea junto a cada campo; el error se borra al corregir el campo (K-09).
// - El botón se bloquea mientras guarda y un doble Enter no manda dos eventos (K-08).
// - Fecha y horas se capturan en la zona del proyecto; en móvil hay selector nativo.
// - Al crear con éxito el formulario se limpia y se cierra (P-01/G-04).
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api, Area, ProjectEvent, User } from '@/src/api';
import { FormField } from '@/src/components/FormField';
import { InlineError } from '@/src/components/InlineError';
import { useEnvio } from '@/src/hooks/useEnvio';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { a11y, t } from '@/src/i18n';
import { areaTone, colors, radius, spacing } from '@/src/theme';
import { diaDelEvento, esDiaCompleto, fmtHora, hoyProyecto, ZonaProyecto } from '@/src/utils/fechas';
import { showToast } from '@/src/utils/toast';
import {
  armarPayloadEvento, CampoEvento, esFechaValida, esHoraValida, normalizarHora, validarEvento,
} from '@/src/utils/validacionEvento';

type CampoPicker = 'fecha' | 'horaInicio' | 'horaFin' | null;

export interface EventoFormProps {
  visible: boolean;
  /** Evento a editar; sin él se crea uno nuevo. */
  evento?: ProjectEvent | null;
  projectId: string;
  members: User[];
  areas?: Area[];
  /** Día que se propone al crear (AAAA-MM-DD). Por defecto, hoy en la zona del proyecto. */
  fechaInicial?: string;
  onClose: () => void;
  onSaved: () => void;
}

const HORA_POR_DEFECTO = '09:00';
const pad2 = (n: number) => String(n).padStart(2, '0');

function SelectorNativo({
  campo, fecha, horaInicio, horaFin, onElegido, onCerrar,
}: {
  campo: Exclude<CampoPicker, null>;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  onElegido: (campo: Exclude<CampoPicker, null>, valor: string) => void;
  onCerrar: () => void;
}) {
  // Carga perezosa: el selector nativo no existe en web ni en las pruebas.
  const Picker = require('@react-native-community/datetimepicker').default;
  const [y, m, d] = (esFechaValida(fecha) ? fecha : hoyProyecto()).split('-').map(Number);
  const hora = campo === 'horaFin' ? horaFin : horaInicio;
  const [hh, mm] = (esHoraValida(hora) ? normalizarHora(hora) : HORA_POR_DEFECTO).split(':').map(Number);
  // El selector trabaja con dígitos de pared, no con instantes: mismos dígitos que se escriben.
  const valor = new Date(y, m - 1, d, hh, mm, 0, 0);
  return (
    <Picker
      value={valor}
      mode={campo === 'fecha' ? 'date' : 'time'}
      is24Hour
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      themeVariant="light"
      onChange={(ev: { type: string }, sel?: Date) => {
        if (Platform.OS === 'android' || ev.type === 'dismissed') onCerrar();
        if (ev.type === 'dismissed' || !sel) return;
        onElegido(campo, campo === 'fecha'
          ? `${sel.getFullYear()}-${pad2(sel.getMonth() + 1)}-${pad2(sel.getDate())}`
          : `${pad2(sel.getHours())}:${pad2(sel.getMinutes())}`);
      }}
    />
  );
}

export function EventoForm({
  visible, evento, projectId, members, areas = [], fechaInicial, onClose, onSaved,
}: EventoFormProps) {
  const { errores, errorGeneral, ponerTodos, limpiar, limpiarTodo, alCambiar, errorDeGuardado } = useFormErrors<CampoEvento>();
  const { guardando, ejecutar } = useEnvio();
  const scrollRef = useRef<ScrollView>(null);

  const [zona, setZona] = useState<ZonaProyecto | null>(null);
  const [titulo, setTitulo] = useState('');
  const [fecha, setFecha] = useState('');
  const [horaInicio, setHoraInicio] = useState(HORA_POR_DEFECTO);
  const [horaFin, setHoraFin] = useState('');
  const [todoElDia, setTodoElDia] = useState(false);
  const [ubicacion, setUbicacion] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [asistentes, setAsistentes] = useState<string[]>([]);
  const [asistentesAbierto, setAsistentesAbierto] = useState(false);
  const [picker, setPicker] = useState<CampoPicker>(null);

  const editando = !!evento;
  const diaCompletoExistente = !!evento && esDiaCompleto(evento);
  const esWeb = Platform.OS === 'web';

  useEffect(() => {
    let vivo = true;
    if (projectId) {
      api.getProject(projectId)
        .then((p) => { if (vivo) setZona({ tz_offset_min: p?.tz_offset_min, dia_inicio_semana: p?.dia_inicio_semana }); })
        .catch(() => {});
    }
    return () => { vivo = false; };
  }, [projectId]);

  function reiniciar() {
    limpiarTodo();
    setPicker(null);
    setAsistentesAbierto(false);
    if (evento) {
      setTitulo(evento.title || '');
      setFecha(diaDelEvento(evento, zona));
      setTodoElDia(esDiaCompleto(evento));
      setHoraInicio(esDiaCompleto(evento) ? HORA_POR_DEFECTO : fmtHora(evento.start_at, zona) || HORA_POR_DEFECTO);
      setHoraFin(esDiaCompleto(evento) ? '' : fmtHora(evento.end_at, zona));
      setUbicacion(evento.location || '');
      setDescripcion(evento.description || '');
      setAreaId(evento.area_id || null);
      setAsistentes(evento.attendee_ids || []);
    } else {
      setTitulo('');
      setFecha(fechaInicial || hoyProyecto(zona));
      setTodoElDia(false);
      setHoraInicio(HORA_POR_DEFECTO);
      setHoraFin('');
      setUbicacion('');
      setDescripcion('');
      setAreaId(null);
      setAsistentes([]);
    }
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }

  // Cada vez que se abre arranca limpio y con el scroll arriba.
  useEffect(() => {
    if (visible) reiniciar();
  }, [visible, evento, fechaInicial]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al llegar la zona del proyecto, propone "hoy" en su zona si el formulario sigue intacto.
  useEffect(() => {
    if (visible && !evento && !fechaInicial && !titulo) setFecha(hoyProyecto(zona));
  }, [zona]); // eslint-disable-line react-hooks/exhaustive-deps

  function alElegirEnSelector(campo: Exclude<CampoPicker, null>, valor: string) {
    if (campo === 'fecha') { limpiar('fecha'); setFecha(valor); }
    else if (campo === 'horaInicio') { limpiar('horaInicio'); limpiar('horaFin'); setHoraInicio(valor); }
    else { limpiar('horaFin'); setHoraFin(valor); }
  }

  function alternarAsistente(uid: string) {
    setAsistentes((prev) => (prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]));
  }

  async function guardar() {
    const datos = { titulo, fecha, horaInicio, horaFin, todoElDia };
    if (ponerTodos(validarEvento(datos))) return;
    await ejecutar(async () => {
      try {
        const payload: any = armarPayloadEvento({ ...datos, descripcion, ubicacion, areaId, asistentes }, zona);
        if (evento) {
          // El servidor no cambia un evento de todo el día al editarlo: no se reenvía su fecha.
          if (diaCompletoExistente) { delete payload.start_at; delete payload.end_at; delete payload.all_day; }
          await api.updateEvent(evento.id, payload);
        } else {
          await api.createEvent(projectId, payload);
        }
        showToast(t(evento ? 'evento.guardado' : 'evento.creado'));
        reiniciar();
        onSaved();
      } catch (e) {
        errorDeGuardado(e);
      }
    });
  }

  function botonSelector(campo: Exclude<CampoPicker, null>, icono: 'calendar-outline' | 'time-outline') {
    if (esWeb) return null;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(campo === 'fecha' ? 'evento.elegirFecha' : 'evento.elegirHora')}
        onPress={() => setPicker(campo)}
        disabled={guardando}
        hitSlop={6}
        style={styles.selectorBtn}
      >
        <Ionicons name={icono} size={20} color={colors.primary} />
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={a11y('cerrar')} accessibilityRole="button" />
        <View style={styles.card}>
          <View style={styles.handle} />
          <Text style={styles.titulo}>{t(editando ? 'evento.tituloEditar' : 'evento.tituloNuevo')}</Text>

          <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={{ paddingBottom: spacing.sm }} keyboardShouldPersistTaps="handled">
            <FormField
              label={t('evento.titulo')}
              obligatorio
              value={titulo}
              onChangeText={alCambiar<string>('titulo', setTitulo)}
              error={errores.titulo}
              placeholder={t('evento.tituloPlaceholder')}
              maxLength={140}
              editable={!guardando}
              returnKeyType="done"
              onSubmitEditing={guardar}
            />

            {areas.length > 0 ? (
              <View style={styles.bloque}>
                <Text style={styles.etiqueta}>{t('evento.disciplina')}</Text>
                <View style={styles.areasWrap}>
                  <Pressable
                    accessibilityRole="button" accessibilityState={{ selected: !areaId }}
                    onPress={() => setAreaId(null)} style={[styles.areaChip, !areaId && styles.areaChipActivo]}
                  >
                    <Text style={[styles.areaChipTxt, !areaId && styles.areaChipTxtActivo]}>{t('evento.sinDisciplina')}</Text>
                  </Pressable>
                  {areas.map((a) => {
                    const activo = areaId === a.id;
                    const tono = areaTone(a.color);
                    return (
                      <Pressable
                        key={a.id} accessibilityRole="button" accessibilityState={{ selected: activo }}
                        onPress={() => setAreaId(a.id)}
                        style={[styles.areaChip, {
                          backgroundColor: activo ? (a.color || colors.primary) : tono.bg,
                          borderColor: activo ? (a.color || colors.primary) : tono.border,
                        }]}
                      >
                        <View style={[styles.areaDot, { backgroundColor: activo ? colors.textInverse : (a.color || colors.primary) }]} />
                        <Text style={[styles.areaChipTxt, { color: activo ? colors.textInverse : tono.text }]} numberOfLines={1}>{a.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={styles.fila}>
              <FormField
                style={styles.flexCampo}
                label={t('evento.fecha')}
                obligatorio
                value={fecha}
                onChangeText={alCambiar<string>('fecha', setFecha)}
                error={errores.fecha}
                placeholder="2026-09-23"
                maxLength={10}
                keyboardType={esWeb ? 'default' : 'numbers-and-punctuation'}
                editable={!guardando && !diaCompletoExistente}
                onSubmitEditing={guardar}
              />
              {botonSelector('fecha', 'calendar-outline')}
            </View>

            {!editando ? (
              <View style={styles.conmutador}>
                <Text style={styles.conmutadorTxt}>{t('evento.todoElDia')}</Text>
                <Switch
                  value={todoElDia}
                  onValueChange={setTodoElDia}
                  disabled={guardando}
                  accessibilityLabel={t('evento.todoElDia')}
                  trackColor={{ true: colors.primary, false: colors.borderStrong }}
                />
              </View>
            ) : null}

            {!todoElDia && !diaCompletoExistente ? (
              <View style={styles.fila}>
                <View style={styles.horaCol}>
                  <View style={styles.fila}>
                    <FormField
                      style={styles.flexCampo}
                      label={t('evento.horaInicio')}
                      obligatorio
                      value={horaInicio}
                      onChangeText={(v) => { limpiar('horaInicio'); limpiar('horaFin'); setHoraInicio(v); }}
                      onBlur={() => { if (esHoraValida(horaInicio)) setHoraInicio(normalizarHora(horaInicio)); }}
                      error={errores.horaInicio}
                      placeholder="09:00"
                      maxLength={5}
                      keyboardType={esWeb ? 'default' : 'numbers-and-punctuation'}
                      editable={!guardando}
                      onSubmitEditing={guardar}
                    />
                    {botonSelector('horaInicio', 'time-outline')}
                  </View>
                </View>
                <View style={styles.horaCol}>
                  <View style={styles.fila}>
                    <FormField
                      style={styles.flexCampo}
                      label={t('evento.horaFin')}
                      value={horaFin}
                      onChangeText={alCambiar<string>('horaFin', setHoraFin)}
                      onBlur={() => { if (esHoraValida(horaFin)) setHoraFin(normalizarHora(horaFin)); }}
                      error={errores.horaFin}
                      placeholder="11:30"
                      maxLength={5}
                      keyboardType={esWeb ? 'default' : 'numbers-and-punctuation'}
                      editable={!guardando}
                      onSubmitEditing={guardar}
                    />
                    {botonSelector('horaFin', 'time-outline')}
                  </View>
                </View>
              </View>
            ) : null}

            {picker ? (
              <SelectorNativo
                campo={picker}
                fecha={fecha}
                horaInicio={horaInicio}
                horaFin={horaFin}
                onElegido={alElegirEnSelector}
                onCerrar={() => setPicker(null)}
              />
            ) : null}

            <FormField
              label={t('evento.ubicacion')}
              value={ubicacion}
              onChangeText={setUbicacion}
              placeholder={t('evento.ubicacionPlaceholder')}
              maxLength={200}
              editable={!guardando}
            />
            <FormField
              label={t('evento.descripcion')}
              value={descripcion}
              onChangeText={setDescripcion}
              placeholder={t('evento.descripcionPlaceholder')}
              maxLength={2000}
              multiline
              editable={!guardando}
              inputStyle={styles.area}
              textAlignVertical="top"
            />

            <View style={styles.asistentesCab}>
              <Text style={styles.etiqueta}>{t('evento.asistentes')}</Text>
              <Pressable accessibilityRole="button" onPress={() => setAsistentesAbierto(true)} style={styles.agregar} disabled={guardando}>
                <Ionicons name="person-add-outline" size={16} color={colors.primary} />
                <Text style={styles.agregarTxt}>
                  {asistentes.length > 0 ? t('evento.editarAsistentes', { n: asistentes.length }) : t('evento.agregarPersonas')}
                </Text>
              </Pressable>
            </View>
            {asistentes.length === 0 ? (
              <Text style={styles.vacio}>{t('evento.sinAsistentes')}</Text>
            ) : (
              <View style={styles.chips}>
                {asistentes.map((uid) => {
                  const m = members.find((x) => x.id === uid);
                  if (!m) return null;
                  return (
                    <View key={uid} style={styles.chip}>
                      <Ionicons name="person" size={11} color={colors.primary} />
                      <Text style={styles.chipTxt}>{m.name}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={() => alternarAsistente(uid)} hitSlop={8}>
                        <Ionicons name="close" size={12} color={colors.textMuted} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            <InlineError message={errorGeneral} style={styles.errorGeneral} />
          </ScrollView>

          <View style={styles.acciones}>
            <Pressable accessibilityRole="button" onPress={onClose} style={[styles.btn, styles.btnFantasma]} disabled={guardando}>
              <Text style={styles.btnFantasmaTxt}>{t('evento.cancelar')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: guardando, busy: guardando }}
              onPress={guardar}
              disabled={guardando}
              style={[styles.btn, styles.btnPrimario, guardando && { opacity: 0.6 }]}
            >
              {guardando ? <ActivityIndicator color={colors.textInverse} /> : (
                <Text style={styles.btnPrimarioTxt}>{t(editando ? 'evento.guardar' : 'evento.programar')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {asistentesAbierto ? (
        <Modal transparent animationType="fade" visible={asistentesAbierto} onRequestClose={() => setAsistentesAbierto(false)}>
          <View style={styles.pickerFondo}>
            <View style={styles.pickerHoja}>
              <View style={styles.pickerCab}>
                <Text style={styles.pickerTitulo}>{t('evento.asistentes')} ({asistentes.length})</Text>
                <Pressable accessibilityRole="button" onPress={() => setAsistentesAbierto(false)} hitSlop={8}>
                  <Text style={styles.pickerListo}>{t('evento.listo')}</Text>
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 420 }}>
                {members.length === 0 ? (
                  <Text style={styles.pickerVacio}>{t('evento.sinMiembros')}</Text>
                ) : members.map((m) => {
                  const activo = asistentes.includes(m.id);
                  return (
                    <Pressable
                      key={m.id} accessibilityRole="button" accessibilityState={{ selected: activo }}
                      onPress={() => alternarAsistente(m.id)} style={styles.pickerFila}
                    >
                      <Ionicons name={activo ? 'checkbox' : 'square-outline'} size={20} color={activo ? colors.primary : colors.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pickerNombre}>{m.name}</Text>
                        <Text style={styles.pickerRol}>{(m.role || '').replace('_', ' ')}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  card: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.md, paddingBottom: spacing.lg, maxHeight: '92%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm },
  titulo: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  scroll: { maxHeight: 520 },
  bloque: { marginTop: 10 },
  etiqueta: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  fila: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  flexCampo: { flex: 1 },
  horaCol: { flex: 1 },
  selectorBtn: {
    width: 44, height: 44, marginTop: 24, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  conmutador: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, minHeight: 44 },
  conmutadorTxt: { fontSize: 14, fontWeight: '700', color: colors.text },
  area: { minHeight: 90 },
  areasWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  areaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, minHeight: 44,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  areaChipActivo: { backgroundColor: colors.primary, borderColor: colors.primary },
  areaChipTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  areaChipTxtActivo: { color: colors.textInverse },
  areaDot: { width: 8, height: 8, borderRadius: 4 },
  asistentesCab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  agregar: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  agregarTxt: { fontSize: 12, fontWeight: '800', color: colors.primary },
  vacio: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.bg, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.full,
  },
  chipTxt: { fontSize: 11, color: colors.text, fontWeight: '700' },
  errorGeneral: { marginTop: spacing.sm },
  acciones: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, minHeight: 44, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnFantasma: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  btnFantasmaTxt: { color: colors.text, fontWeight: '800', fontSize: 14 },
  btnPrimario: { backgroundColor: colors.primary },
  btnPrimarioTxt: { color: colors.textInverse, fontWeight: '800', fontSize: 14 },
  pickerFondo: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  pickerHoja: { backgroundColor: colors.surface, borderRadius: radius.lg, maxHeight: '80%' },
  pickerCab: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pickerTitulo: { fontSize: 15, fontWeight: '800', color: colors.text },
  pickerListo: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  pickerVacio: { padding: 16, color: colors.textMuted },
  pickerFila: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, minHeight: 44,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pickerNombre: { fontWeight: '700', color: colors.text, fontSize: 14 },
  pickerRol: { color: colors.textMuted, fontSize: 12, textTransform: 'capitalize' },
});
