// Importador masivo de Capacidades de Operadores (Excel / CSV).
// 1) Archivo y hoja → 2) Columnas (con sugerencias y plantillas guardadas) →
// 3) Revisión de nombres (concilia contra las personas ya grabadas; solo se
// pregunta por los dudosos) → 4) Resultado, con opción de deshacer.
// La vista previa no escribe nada; todo se aplica al confirmar.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import {
  api, CapCert, CapImportAnalisis, CapImportGrupo, CapImportHistorial, CapImportHoja, CapImportPlantilla,
  CapImportPreview, CapImportResultado, CapImportTipo,
} from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { confirm } from '@/src/utils/confirm';

type Paso = 'archivo' | 'columnas' | 'revision' | 'resultado';

const TIPOS: { value: CapImportTipo; label: string; ayuda: string }[] = [
  { value: 'personal', label: 'Personal', ayuda: 'Lista de trabajadores (nombre, puesto, frente…)' },
  { value: 'certificaciones', label: 'Constancias', ayuda: 'Quién tiene qué curso o certificación' },
  { value: 'equipos', label: 'Equipos', ayuda: 'Maquinaria con su operador' },
];

const CAMPOS: Record<CapImportTipo, { clave: string; label: string; obligatorio?: boolean }[]> = {
  personal: [
    { clave: 'nombre', label: 'Nombre', obligatorio: true }, { clave: 'puesto', label: 'Puesto' },
    { clave: 'frente', label: 'Frente / estación' }, { clave: 'empresa', label: 'Empresa' }, { clave: 'estatus', label: 'Estatus' },
  ],
  certificaciones: [
    { clave: 'nombre', label: 'Nombre', obligatorio: true }, { clave: 'certificacion', label: 'Curso / certificación', obligatorio: true },
    { clave: 'folio', label: 'Folio' }, { clave: 'emision', label: 'Fecha de emisión' },
    { clave: 'vencimiento', label: 'Vencimiento' }, { clave: 'estado', label: 'Columna de estado (p. ej. DC3)' },
  ],
  equipos: [
    { clave: 'nombre', label: 'Equipo', obligatorio: true }, { clave: 'modelo', label: 'Modelo' }, { clave: 'tipo', label: 'Tipo' },
    { clave: 'ubicacion', label: 'Estación / ubicación' }, { clave: 'estado', label: 'Estado' }, { clave: 'operador', label: 'Operador' },
    { clave: 'fecha_ingreso', label: 'Fecha de ingreso' }, { clave: 'fecha_salida', label: 'Fecha de salida' },
  ],
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[st.chip, active && st.chipActive]}>
      <Text style={[st.chipTxt, active && { color: colors.primaryDark }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Boton({ label, onPress, kind = 'primary', disabled, icon }: {
  label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap;
}) {
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? colors.error : colors.primary;
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={[st.btn, kind === 'primary' && { backgroundColor: colors.primary }, kind !== 'primary' && st.btnGhost, disabled && { opacity: 0.5 }]}>
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <Text style={[st.btnTxt, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function ImportarCapacidadesModal({ projectId, certs, onClose, onDone }: {
  projectId: string; certs: CapCert[]; onClose: () => void; onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [paso, setPaso] = useState<Paso>('archivo');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [analisis, setAnalisis] = useState<CapImportAnalisis | null>(null);
  const [hoja, setHoja] = useState<CapImportHoja | null>(null);
  const [tipo, setTipo] = useState<CapImportTipo>('personal');
  const [mapeo, setMapeo] = useState<Record<string, number>>({});
  const [crearCatalogo, setCrearCatalogo] = useState(true);
  const [crearPersonas, setCrearPersonas] = useState(false);
  const [omitirSi, setOmitirSi] = useState('SIN DC3');
  const [estatusCertId, setEstatusCertId] = useState('');
  const [estatusOk, setEstatusOk] = useState('VIGENTE');
  const [plantillaNombre, setPlantillaNombre] = useState('');
  const [plantillas, setPlantillas] = useState<CapImportPlantilla[]>([]);
  const [historial, setHistorial] = useState<CapImportHistorial[]>([]);

  const [preview, setPreview] = useState<CapImportPreview | null>(null);
  const [vista, setVista] = useState<'dudoso' | 'nuevo'>('dudoso');
  const [grupos, setGrupos] = useState<CapImportGrupo[]>([]);
  const [totalGrupos, setTotalGrupos] = useState(0);
  const [pendientes, setPendientes] = useState(0);
  const [resultado, setResultado] = useState<CapImportResultado | null>(null);

  useEffect(() => {
    api.capImportHistorial(projectId).then(setHistorial).catch(() => setHistorial([]));
  }, [projectId]);

  const fail = (e: any) => setMsg(e?.message || 'Ocurrió un error');

  async function elegirArchivo() {
    setMsg(null);
    const r = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/comma-separated-values', 'application/octet-stream'],
      copyToCacheDirectory: true,
    });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setOcupado(true);
    try {
      const an = await api.capImportAnalizar(projectId, { uri: a.uri, name: a.name || 'importacion.xlsx', mimeType: a.mimeType });
      setAnalisis(an);
      seleccionarHoja(an.hojas[0], 'personal');
      setPlantillas(await api.capImportPlantillas(projectId).catch(() => []));
      setPaso('columnas');
    } catch (e: any) { fail(e); } finally { setOcupado(false); }
  }

  function seleccionarHoja(h: CapImportHoja, t: CapImportTipo) {
    setHoja(h); setTipo(t); setMapeo(h.sugerido[t] || {});
  }

  function cambiarTipo(t: CapImportTipo) {
    if (hoja) seleccionarHoja(hoja, t);
    else setTipo(t);
    setCrearCatalogo(true);
    setCrearPersonas(false);
  }

  function aplicarPlantilla(p: CapImportPlantilla) {
    if (!hoja) return;
    const m: Record<string, number> = {};
    for (const [campo, nombre] of Object.entries(p.mapeo)) {
      const col = hoja.columnas.find((c) => norm(c.nombre) === norm(nombre));
      if (col) m[campo] = col.idx;
    }
    setTipo(p.tipo); setMapeo(m); setPlantillaNombre(p.nombre);
    const o = p.opciones || {};
    if (typeof o.crear_catalogo_nuevo === 'boolean') setCrearCatalogo(o.crear_catalogo_nuevo);
    if (typeof o.crear_personas_faltantes === 'boolean') setCrearPersonas(o.crear_personas_faltantes);
    if (Array.isArray(o.omitir_si)) setOmitirSi(o.omitir_si.join(', '));
    if (o.estatus_cert?.cert_id) { setEstatusCertId(o.estatus_cert.cert_id); setEstatusOk((o.estatus_cert.valores_ok || []).join(', ')); }
  }

  const lista = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);

  async function previsualizar() {
    if (!analisis || !hoja) return;
    const faltan = CAMPOS[tipo].filter((c) => c.obligatorio && mapeo[c.clave] === undefined);
    if (faltan.length) { setMsg(`Indica la columna de: ${faltan.map((f) => f.label).join(', ')}`); return; }
    setOcupado(true); setMsg(null);
    try {
      const opciones: Record<string, any> = { crear_catalogo_nuevo: crearCatalogo, crear_personas_faltantes: crearPersonas };
      if (tipo === 'certificaciones') opciones.omitir_si = lista(omitirSi);
      if (tipo === 'personal' && estatusCertId) opciones.estatus_cert = { cert_id: estatusCertId, valores_ok: lista(estatusOk) };
      const p = await api.capImportPreview(projectId, {
        archivo_id: analisis.archivo_id, hoja: hoja.nombre, tipo, header_row: hoja.header_row, mapeo, opciones,
      });
      setPreview(p); setPendientes(p.resumen.dudosos_pendientes);
      setVista(p.resumen.por_estado.dudoso > 0 ? 'dudoso' : 'nuevo');
      setPaso('revision');
    } catch (e: any) { fail(e); } finally { setOcupado(false); }
  }

  const cargarGrupos = useCallback(async () => {
    if (!preview || paso !== 'revision') return;
    try {
      const r = await api.capImportGrupos(projectId, preview.import_id, vista, 0, 200);
      setGrupos(r.items); setTotalGrupos(r.total);
      if (vista === 'dudoso') setPendientes(r.items.filter((g) => !g.decision).length + Math.max(0, r.total - r.items.length));
    } catch (e: any) { fail(e); }
  }, [projectId, preview, vista, paso]);
  useEffect(() => { cargarGrupos(); }, [cargarGrupos]);

  async function decidir(g: CapImportGrupo, accion: 'ligar' | 'crear' | 'omitir', persona_id?: string) {
    if (!preview) return;
    try {
      await api.capImportResolver(projectId, preview.import_id, [{ grupo: g.grupo, accion, persona_id: persona_id || null }]);
      await cargarGrupos();
    } catch (e: any) { fail(e); }
  }

  async function confirmar() {
    if (!preview) return;
    if (!(await confirm('Aplicar importación', `Se guardarán ${preview.resumen.filas_validas} filas. Podrás deshacerlo después.`, { confirmText: 'Aplicar' }))) return;
    setOcupado(true); setMsg(null);
    try {
      const r = await api.capImportConfirmar(projectId, preview.import_id, plantillaNombre.trim() || undefined);
      setResultado(r); setPaso('resultado'); onDone();
    } catch (e: any) { fail(e); } finally { setOcupado(false); }
  }

  async function deshacer(id: string) {
    if (!(await confirm('Deshacer importación', 'Se revierte solo lo que esta importación creó o modificó.', { destructive: true, confirmText: 'Deshacer' }))) return;
    setOcupado(true); setMsg(null);
    try {
      await api.capImportDeshacer(projectId, id);
      setHistorial(await api.capImportHistorial(projectId));
      setResultado(null); onDone();
      Alert.alert('Importación revertida');
      if (paso === 'resultado') setPaso('archivo');
    } catch (e: any) { fail(e); } finally { setOcupado(false); }
  }

  const titulo = paso === 'archivo' ? 'Importar desde Excel' : paso === 'columnas' ? 'Columnas' : paso === 'revision' ? 'Revisar nombres' : 'Resultado';
  const colChip = (campo: string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      <Chip label="— ninguna —" active={mapeo[campo] === undefined} onPress={() => setMapeo((m) => { const n = { ...m }; delete n[campo]; return n; })} />
      {hoja?.columnas.map((c) => <Chip key={c.idx} label={c.nombre} active={mapeo[campo] === c.idx} onPress={() => setMapeo((m) => ({ ...m, [campo]: c.idx }))} />)}
    </ScrollView>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[st.head, { paddingTop: insets.top + spacing.sm }]}>
          <Text style={st.headTitle}>{titulo}</Text>
          <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: insets.bottom + 80 }} keyboardShouldPersistTaps="handled">
          {msg ? <View style={st.errorBox}><Text style={st.errorTxt}>{msg}</Text></View> : null}
          {ocupado ? <ActivityIndicator color={colors.primary} /> : null}

          {paso === 'archivo' ? (
            <>
              <Text style={st.muted}>
                Sube un Excel (.xlsx) o CSV. Se concilian los nombres con las personas ya grabadas, así que puedes cargar listas grandes sin duplicar a nadie.
              </Text>
              <Boton label="Elegir archivo" icon="document-outline" onPress={elegirArchivo} disabled={ocupado} />
              {historial.length > 0 ? <Text style={st.section}>Importaciones anteriores</Text> : null}
              {historial.map((h) => (
                <View key={h.id} style={st.card}>
                  <Text style={st.cardTitle}>{TIPOS.find((t) => t.value === h.tipo)?.label} · {h.hoja}</Text>
                  <Text style={st.muted}>
                    {new Date(h.created_at).toLocaleString()} · {h.created_by_name || ''} · {h.estado}
                    {h.stats ? ` · ${h.stats.creados ?? 0} creados, ${h.stats.actualizados ?? 0} actualizados` : ''}
                  </Text>
                  {h.estado === 'aplicada' || h.estado === 'parcial' ? <Boton label="Deshacer" kind="danger" icon="arrow-undo-outline" onPress={() => deshacer(h.id)} disabled={ocupado} /> : null}
                </View>
              ))}
            </>
          ) : null}

          {paso === 'columnas' && analisis && hoja ? (
            <>
              <Text style={st.muted}>{analisis.nombre}</Text>
              <Text style={st.label}>¿Qué trae el archivo?</Text>
              <View style={st.wrap}>
                {TIPOS.map((t) => <Chip key={t.value} label={t.label} active={tipo === t.value} onPress={() => cambiarTipo(t.value)} />)}
              </View>
              <Text style={st.muted}>{TIPOS.find((t) => t.value === tipo)?.ayuda}</Text>
              <Text style={st.label}>Hoja</Text>
              <View style={st.wrap}>
                {analisis.hojas.map((h) => <Chip key={h.nombre} label={`${h.nombre} (${h.filas})`} active={hoja.nombre === h.nombre} onPress={() => seleccionarHoja(h, tipo)} />)}
              </View>
              {plantillas.filter((p) => p.tipo === tipo).length > 0 ? (
                <>
                  <Text style={st.label}>Plantillas guardadas</Text>
                  <View style={st.wrap}>
                    {plantillas.filter((p) => p.tipo === tipo).map((p) => <Chip key={p.id} label={p.nombre} onPress={() => aplicarPlantilla(p)} />)}
                  </View>
                </>
              ) : null}

              <Text style={st.section}>Columnas del archivo (fila de encabezados: {hoja.header_row})</Text>
              {CAMPOS[tipo].map((c) => (
                <View key={c.clave} style={{ gap: 4 }}>
                  <Text style={st.label}>{c.label}{c.obligatorio ? ' *' : ''}</Text>
                  {colChip(c.clave)}
                </View>
              ))}
              {hoja.muestra.length > 0 ? (
                <View style={st.card}>
                  <Text style={st.label}>Primeras filas</Text>
                  {hoja.muestra.slice(0, 3).map((r, i) => <Text key={i} style={st.muted} numberOfLines={1}>{r.filter(Boolean).join(' | ')}</Text>)}
                </View>
              ) : null}

              <Text style={st.section}>Opciones</Text>
              {tipo === 'personal' ? (
                <>
                  <View style={st.rowBetween}>
                    <Text style={[st.label, { flex: 1 }]}>Crear como tipos los puestos nuevos</Text>
                    <Switch value={crearCatalogo} onValueChange={setCrearCatalogo} />
                  </View>
                  <Text style={st.label}>Convertir el estatus en una certificación (opcional, p. ej. SUA)</Text>
                  <View style={st.wrap}>
                    <Chip label="Ninguna" active={!estatusCertId} onPress={() => setEstatusCertId('')} />
                    {certs.map((c) => <Chip key={c.id} label={c.nombre} active={estatusCertId === c.id} onPress={() => setEstatusCertId(c.id)} />)}
                  </View>
                  {estatusCertId ? (
                    <>
                      <Text style={st.label}>Valores del estatus que cuentan como «tiene la constancia» (separados por coma)</Text>
                      <TextInput style={st.input} value={estatusOk} onChangeText={setEstatusOk} />
                    </>
                  ) : null}
                </>
              ) : null}
              {tipo === 'certificaciones' ? (
                <>
                  <View style={st.rowBetween}>
                    <Text style={[st.label, { flex: 1 }]}>Crear certificaciones nuevas del catálogo</Text>
                    <Switch value={crearCatalogo} onValueChange={setCrearCatalogo} />
                  </View>
                  <View style={st.rowBetween}>
                    <Text style={[st.label, { flex: 1 }]}>Crear a las personas que no existan</Text>
                    <Switch value={crearPersonas} onValueChange={setCrearPersonas} />
                  </View>
                  <Text style={st.label}>Omitir filas cuya columna de estado diga (separado por coma)</Text>
                  <TextInput style={st.input} value={omitirSi} onChangeText={setOmitirSi} placeholder="SIN DC3" placeholderTextColor={colors.textMuted} />
                </>
              ) : null}
              {tipo === 'equipos' ? (
                <>
                  <View style={st.rowBetween}>
                    <Text style={[st.label, { flex: 1 }]}>Crear como tipos los tipos nuevos</Text>
                    <Switch value={crearCatalogo} onValueChange={setCrearCatalogo} />
                  </View>
                  <View style={st.rowBetween}>
                    <Text style={[st.label, { flex: 1 }]}>Crear a los operadores que no existan</Text>
                    <Switch value={crearPersonas} onValueChange={setCrearPersonas} />
                  </View>
                </>
              ) : null}
              <Text style={st.label}>Guardar estas columnas como plantilla (opcional)</Text>
              <TextInput style={st.input} value={plantillaNombre} onChangeText={setPlantillaNombre} placeholder="Ej. Lista mensual de SUA" placeholderTextColor={colors.textMuted} />

              <View style={st.wrap}>
                <Boton label="Atrás" kind="ghost" onPress={() => setPaso('archivo')} />
                <Boton label="Previsualizar" onPress={previsualizar} disabled={ocupado} />
              </View>
            </>
          ) : null}

          {paso === 'revision' && preview ? (
            <>
              <View style={st.kpiRow}>
                <View style={st.kpi}><Text style={st.kpiNum}>{preview.resumen.filas_validas}</Text><Text style={st.kpiLbl}>filas</Text></View>
                <View style={st.kpi}><Text style={st.kpiNum}>{preview.resumen.por_estado.exacto + preview.resumen.por_estado.alto}</Text><Text style={st.kpiLbl}>ya existen</Text></View>
                <View style={st.kpi}><Text style={[st.kpiNum, { color: '#B45309' }]}>{preview.resumen.por_estado.dudoso}</Text><Text style={st.kpiLbl}>dudosos</Text></View>
                <View style={st.kpi}><Text style={st.kpiNum}>{preview.resumen.por_estado.nuevo}</Text><Text style={st.kpiLbl}>nuevos</Text></View>
              </View>
              {preview.resumen.filas_omitidas > 0 ? <Text style={st.muted}>{preview.resumen.filas_omitidas} fila(s) de total/pie omitidas.</Text> : null}
              {preview.errores.length > 0 ? (
                <View style={st.warnBox}>
                  <Text style={st.warnTitle}>{preview.resumen.errores} fila(s) con problema (se omiten)</Text>
                  {preview.errores.slice(0, 6).map((e, i) => <Text key={i} style={st.muted}>Fila {e.fila}: {e.motivo}</Text>)}
                </View>
              ) : null}
              {(['puestos', 'certificaciones', 'tipos'] as const).some((k) => preview.valores_nuevos[k].length > 0) ? (
                <View style={st.warnBox}>
                  <Text style={st.warnTitle}>Valores que no están en tus catálogos</Text>
                  {(['puestos', 'certificaciones', 'tipos'] as const).flatMap((k) => preview.valores_nuevos[k].map((v) => (
                    <Text key={`${k}${v.valor}`} style={st.muted}>{k}: {v.valor} ({v.filas})</Text>
                  )))}
                  <Text style={st.muted}>Activa «crear…» en el paso anterior o agrégalos en Catálogos y previsualiza de nuevo.</Text>
                </View>
              ) : null}

              <View style={st.wrap}>
                <Chip label={`Dudosos (${preview.resumen.por_estado.dudoso})`} active={vista === 'dudoso'} onPress={() => setVista('dudoso')} />
                <Chip label={`Nuevos (${preview.resumen.por_estado.nuevo})`} active={vista === 'nuevo'} onPress={() => setVista('nuevo')} />
              </View>
              {grupos.length === 0 ? <Text style={st.empty}>Nada por revisar aquí.</Text> : null}
              {grupos.map((g) => (
                <View key={g.grupo} style={st.card}>
                  <Text style={st.cardTitle}>{g.nombre_origen} <Text style={st.muted}>({g.filas} fila{g.filas > 1 ? 's' : ''})</Text></Text>
                  {g.decision ? (
                    <Text style={[st.muted, { color: '#047857' }]}>
                      {g.decision.accion === 'ligar' ? `→ ligado a ${g.candidatos.find((c) => c.persona_id === g.decision!.persona_id)?.nombre || 'persona existente'}` : g.decision.accion === 'crear' ? '→ se crea como persona nueva' : '→ se omite'}
                    </Text>
                  ) : <Text style={[st.muted, { color: '#B45309' }]}>Decide qué hacer con este nombre</Text>}
                  <View style={st.wrap}>
                    {g.candidatos.map((c) => (
                      <Boton key={c.persona_id} label={`Es: ${c.nombre} (${Math.round(c.similitud * 100)}%)`} kind="ghost" onPress={() => decidir(g, 'ligar', c.persona_id)} />
                    ))}
                    <Boton label="Crear nueva" kind="ghost" onPress={() => decidir(g, 'crear')} />
                    <Boton label="Omitir" kind="ghost" onPress={() => decidir(g, 'omitir')} />
                  </View>
                </View>
              ))}
              {totalGrupos > grupos.length ? <Text style={st.muted}>Mostrando {grupos.length} de {totalGrupos}.</Text> : null}

              <View style={st.wrap}>
                <Boton label="Atrás" kind="ghost" onPress={() => setPaso('columnas')} />
                <Boton label={pendientes > 0 ? `Faltan ${pendientes} por decidir` : 'Aplicar importación'} onPress={confirmar} disabled={ocupado || pendientes > 0} />
              </View>
            </>
          ) : null}

          {paso === 'resultado' && resultado ? (
            <>
              <View style={st.card}>
                <Text style={st.cardTitle}>Importación aplicada</Text>
                <Text style={st.muted}>
                  {resultado.creados} creados · {resultado.actualizados} actualizados · {resultado.sin_cambios} sin cambios · {resultado.omitidos} omitidos
                </Text>
                <Text style={st.muted}>{resultado.personas_creadas} personas nuevas · {resultado.personas_ligadas} ligadas a personas existentes</Text>
              </View>
              <Boton label="Deshacer esta importación" kind="danger" icon="arrow-undo-outline" onPress={() => deshacer(resultado.import_id)} disabled={ocupado} />
              <Boton label="Importar otro archivo" kind="ghost" onPress={() => { setPaso('archivo'); api.capImportHistorial(projectId).then(setHistorial).catch(() => undefined); }} />
              <Boton label="Cerrar" onPress={onClose} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  section: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  empty: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipTxt: { fontSize: 13, color: colors.textBody, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  btnTxt: { fontSize: 14, fontWeight: '700' },
  errorBox: { backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md },
  errorTxt: { color: colors.error, fontSize: 13, fontWeight: '600' },
  warnBox: { backgroundColor: colors.warningBg, padding: 10, borderRadius: radius.md, gap: 4 },
  warnTitle: { fontSize: 13, fontWeight: '800', color: '#B45309' },
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 10, alignItems: 'center' },
  kpiNum: { fontSize: 22, fontWeight: '800', color: colors.text },
  kpiLbl: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
});
