// Capacidades de Operadores — consulta rápida y edición.
// Módulo genérico: cada proyecto define sus propias certificaciones y tipos de
// equipo/puesto (pestaña Catálogos); el semáforo de cada operador sale de
// cruzar lo que exige su tipo (y los equipos que tiene asignados) contra las
// constancias vigentes. Todos los roles del proyecto consultan; solo
// Coordinador y Sub-Coordinador editan (bajas lógicas, nunca borrado en duro).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import {
  api, CapCert, CapEquipo, CapOperador, CapPersonaCoincidencia, CapResumen, CapSemaforo, CapTipo,
} from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { ImportarCapacidadesModal } from '@/src/components/ImportarCapacidadesModal';
import { colors, radius, spacing } from '@/src/theme';
import { ROLE_COORD, ROLE_SUB } from '@/src/utils/roles';
import { confirm } from '@/src/utils/confirm';
import { downloadBlob } from '@/src/utils/downloadBlob';

type Tab = 'operadores' | 'equipos' | 'resumen' | 'catalogos';
const TABS: { value: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'operadores', label: 'Operadores', icon: 'people-outline' },
  { value: 'equipos', label: 'Equipos', icon: 'construct-outline' },
  { value: 'resumen', label: 'Resumen', icon: 'stats-chart-outline' },
  { value: 'catalogos', label: 'Catálogos', icon: 'list-outline' },
];

const SEMAFORO: Record<CapSemaforo, { label: string; color: string; bg: string }> = {
  verde: { label: 'Apto', color: '#047857', bg: colors.successBg },
  amarillo: { label: 'Por vencer', color: '#B45309', bg: colors.warningBg },
  rojo: { label: 'Con brechas', color: '#B91C1C', bg: colors.errorBg },
  sin_reglas: { label: 'Sin reglas', color: colors.textMuted, bg: '#E2E8F0' },
};
const ESTADO_CERT: Record<string, { label: string; color: string }> = {
  vigente: { label: 'Vigente', color: '#047857' },
  por_vencer: { label: 'Por vencer', color: '#B45309' },
  vencida: { label: 'Vencida', color: '#B91C1C' },
  faltante: { label: 'Falta', color: '#B91C1C' },
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function mensajeError(e: any): string {
  return e?.message || 'Ocurrió un error';
}

function Semaforo({ s }: { s: CapSemaforo }) {
  const c = SEMAFORO[s];
  return (
    <View style={[st.badge, { backgroundColor: c.bg }]}>
      <View style={[st.dot, { backgroundColor: c.color }]} />
      <Text style={[st.badgeTxt, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[st.chip, active && st.chipActive]}>
      <Text style={[st.chipTxt, active && st.chipTxtActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[st.sheetHead, { paddingTop: insets.top + spacing.sm }]}>
          <Text style={st.sheetTitle} numberOfLines={1}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: insets.bottom + 60 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Campo({ label, value, onChange, placeholder, multiline, keyboardType }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: any;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={st.label}>{label}</Text>
      <TextInput
        style={[st.input, multiline && { minHeight: 70, textAlignVertical: 'top' }]}
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.textMuted}
        multiline={multiline} keyboardType={keyboardType}
      />
    </View>
  );
}

function Boton({ label, onPress, kind = 'primary', disabled, icon }: {
  label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap;
}) {
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? colors.error : colors.primary;
  return (
    <Pressable
      onPress={onPress} disabled={disabled}
      style={[st.btn, kind === 'primary' && { backgroundColor: colors.primary }, kind !== 'primary' && st.btnGhost, disabled && { opacity: 0.5 }]}
    >
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <Text style={[st.btnTxt, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function CapacidadesScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const puedeEditar = user?.role === ROLE_COORD || user?.role === ROLE_SUB;

  const [tab, setTab] = useState<Tab>('operadores');
  const [certs, setCerts] = useState<CapCert[]>([]);
  const [tipos, setTipos] = useState<CapTipo[]>([]);
  const [resumen, setResumen] = useState<CapResumen | null>(null);
  const [operadores, setOperadores] = useState<CapOperador[]>([]);
  const [total, setTotal] = useState(0);
  const [equipos, setEquipos] = useState<CapEquipo[]>([]);
  const [q, setQ] = useState('');
  const [qAplicada, setQAplicada] = useState('');
  const [fSemaforo, setFSemaforo] = useState<CapSemaforo | ''>('');
  const [fFrente, setFFrente] = useState('');
  const [fCert, setFCert] = useState('');
  const [verBajas, setVerBajas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [formOp, setFormOp] = useState<{ op: CapOperador | null } | null>(null);
  const [formEq, setFormEq] = useState<{ eq: CapEquipo | null } | null>(null);
  const [formCert, setFormCert] = useState<{ cert: CapCert | null } | null>(null);
  const [formTipo, setFormTipo] = useState<{ tipo: CapTipo | null } | null>(null);
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQAplicada(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const cargarCatalogos = useCallback(async () => {
    const [c, t] = await Promise.all([api.capListCerts(projectId), api.capListTipos(projectId)]);
    setCerts(c); setTipos(t);
  }, [projectId]);

  const cargar = useCallback(async (silencioso = false) => {
    if (!projectId) return;
    if (!silencioso) setCargando(true);
    setError(null);
    try {
      if (tab === 'operadores') {
        const [r] = await Promise.all([
          api.capListOperadores(projectId, {
            q: qAplicada || undefined, semaforo: fSemaforo || undefined, frente: fFrente || undefined,
            cert_id: fCert || undefined, estatus: verBajas ? 'baja' : 'activo', limit: 200,
          }),
          cargarCatalogos(),
          api.capResumen(projectId).then(setResumen),
        ]);
        setOperadores(r.items); setTotal(r.total);
      } else if (tab === 'equipos') {
        const [e] = await Promise.all([api.capListEquipos(projectId, qAplicada || undefined), cargarCatalogos()]);
        setEquipos(e);
      } else if (tab === 'resumen') {
        setResumen(await api.capResumen(projectId));
      } else {
        await cargarCatalogos();
      }
    } catch (e: any) {
      setError(mensajeError(e));
    } finally {
      setCargando(false); setRefrescando(false);
    }
  }, [projectId, tab, qAplicada, fSemaforo, fFrente, fCert, verBajas, cargarCatalogos]);

  useEffect(() => { cargar(); }, [cargar]);

  const frentes = useMemo(() => Object.keys(resumen?.por_frente || {}).filter((f) => f !== 'Sin frente').sort(), [resumen]);

  async function ejecutar(fn: () => Promise<any>, okMsg?: string): Promise<boolean> {
    try {
      await fn();
      await cargar(true);
      if (okMsg) Alert.alert(okMsg);
      return true;
    } catch (e: any) {
      Alert.alert('No se pudo completar', mensajeError(e));
      return false;
    }
  }

  // ---------------- Pestañas ----------------
  function renderOperadores() {
    return (
      <>
        <View style={st.searchRow}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={st.searchInput} value={q} onChangeText={setQ} placeholder="Buscar nombre, puesto o equipo…"
            placeholderTextColor={colors.textMuted} autoCorrect={false}
          />
          {q ? <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chipsRow}>
          <Chip label="Todos" active={!fSemaforo} onPress={() => setFSemaforo('')} />
          {(['verde', 'amarillo', 'rojo'] as CapSemaforo[]).map((s) => (
            <Chip key={s} label={SEMAFORO[s].label} active={fSemaforo === s} onPress={() => setFSemaforo(fSemaforo === s ? '' : s)} />
          ))}
        </ScrollView>
        {frentes.length > 0 || certs.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chipsRow}>
            {frentes.map((f) => <Chip key={f} label={f} active={fFrente === f} onPress={() => setFFrente(fFrente === f ? '' : f)} />)}
            {certs.map((c) => <Chip key={c.id} label={`✓ ${c.nombre}`} active={fCert === c.id} onPress={() => setFCert(fCert === c.id ? '' : c.id)} />)}
          </ScrollView>
        ) : null}
        <View style={st.rowBetween}>
          <Text style={st.muted}>{total} {verBajas ? 'en baja' : 'activos'}</Text>
          <Pressable onPress={() => setVerBajas(!verBajas)}><Text style={st.link}>{verBajas ? 'Ver activos' : 'Ver bajas'}</Text></Pressable>
        </View>
        {operadores.length === 0 && !cargando ? <Text style={st.empty}>Sin operadores con esos filtros.</Text> : null}
        {operadores.map((o) => (
          <Pressable key={o.id} style={st.card} onPress={() => setDetalleId(o.id)}>
            <View style={st.rowBetween}>
              <Text style={st.cardTitle} numberOfLines={2}>{o.nombre}</Text>
              <Semaforo s={o.semaforo} />
            </View>
            <Text style={st.muted} numberOfLines={1}>
              {[o.puesto || o.tipo, o.frente, o.empresa].filter(Boolean).join(' · ') || 'Sin puesto'}
            </Text>
            {o.equipos.length > 0 ? (
              <Text style={st.muted} numberOfLines={1}>
                <Ionicons name="construct-outline" size={12} color={colors.textMuted} /> {o.equipos.map((e) => e.nombre).join(', ')}
              </Text>
            ) : null}
            {o.faltantes.length + o.vencidas.length + o.por_vencer.length > 0 ? (
              <View style={st.tagsRow}>
                {o.faltantes.map((n) => <Text key={`f${n}`} style={[st.tag, st.tagRed]}>Falta: {n}</Text>)}
                {o.vencidas.map((n) => <Text key={`v${n}`} style={[st.tag, st.tagRed]}>Vencida: {n}</Text>)}
                {o.por_vencer.map((n) => <Text key={`p${n}`} style={[st.tag, st.tagAmber]}>Por vencer: {n}</Text>)}
              </View>
            ) : null}
          </Pressable>
        ))}
      </>
    );
  }

  function renderEquipos() {
    return (
      <>
        <View style={st.searchRow}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput style={st.searchInput} value={q} onChangeText={setQ} placeholder="Buscar equipo, modelo, operador…" placeholderTextColor={colors.textMuted} />
        </View>
        {equipos.length === 0 && !cargando ? <Text style={st.empty}>Sin equipos registrados.</Text> : null}
        {equipos.map((e) => (
          <Pressable key={e.id} style={st.card} onPress={() => (puedeEditar ? setFormEq({ eq: e }) : e.operador && setDetalleId(e.operador.id))}>
            <View style={st.rowBetween}>
              <Text style={st.cardTitle} numberOfLines={2}>{e.nombre}</Text>
              {e.operador ? <Semaforo s={e.operador.semaforo} /> : <Text style={st.muted}>Sin operador</Text>}
            </View>
            <Text style={st.muted} numberOfLines={1}>{[e.modelo, e.tipo, e.ubicacion, e.estado === 'inactivo' ? 'Inactivo' : null].filter(Boolean).join(' · ')}</Text>
            {e.operador ? (
              <Pressable onPress={() => setDetalleId(e.operador!.id)} hitSlop={6}>
                <Text style={st.link}>Operador: {e.operador.nombre}</Text>
              </Pressable>
            ) : null}
            {e.operador && (e.operador.faltantes.length + e.operador.vencidas.length) > 0 ? (
              <View style={st.tagsRow}>
                {e.operador.faltantes.map((n) => <Text key={`f${n}`} style={[st.tag, st.tagRed]}>Falta: {n}</Text>)}
                {e.operador.vencidas.map((n) => <Text key={`v${n}`} style={[st.tag, st.tagRed]}>Vencida: {n}</Text>)}
              </View>
            ) : null}
          </Pressable>
        ))}
      </>
    );
  }

  function renderResumen() {
    if (!resumen) return null;
    const ps = resumen.por_semaforo;
    return (
      <>
        <View style={st.kpiRow}>
          {(['verde', 'amarillo', 'rojo', 'sin_reglas'] as CapSemaforo[]).map((s) => (
            <View key={s} style={[st.kpi, { backgroundColor: SEMAFORO[s].bg }]}>
              <Text style={[st.kpiNum, { color: SEMAFORO[s].color }]}>{ps[s]}</Text>
              <Text style={[st.kpiLbl, { color: SEMAFORO[s].color }]}>{SEMAFORO[s].label}</Text>
            </View>
          ))}
        </View>
        <Text style={st.section}>Por frente ({resumen.total_activos} activos)</Text>
        {Object.entries(resumen.por_frente).map(([f, c]) => (
          <View key={f} style={st.card}>
            <Text style={st.cardTitle}>{f}</Text>
            <Text style={st.muted}>Aptos {c.verde} · Por vencer {c.amarillo} · Con brechas {c.rojo} · Sin reglas {c.sin_reglas}</Text>
          </View>
        ))}
        <Text style={st.section}>Brechas ({resumen.brechas.length})</Text>
        {resumen.brechas.length === 0 ? <Text style={st.empty}>Sin brechas.</Text> : null}
        {resumen.brechas.map((b) => (
          <Pressable key={b.id} style={st.card} onPress={() => setDetalleId(b.id)}>
            <Text style={st.cardTitle}>{b.nombre}{b.frente ? ` · ${b.frente}` : ''}</Text>
            <View style={st.tagsRow}>
              {b.faltantes.map((n) => <Text key={`f${n}`} style={[st.tag, st.tagRed]}>Falta: {n}</Text>)}
              {b.vencidas.map((n) => <Text key={`v${n}`} style={[st.tag, st.tagRed]}>Vencida: {n}</Text>)}
            </View>
          </Pressable>
        ))}
        <Text style={st.section}>Vencimientos (alerta a {resumen.alerta_dias} días)</Text>
        {resumen.vencimientos.length === 0 ? <Text style={st.empty}>Nada por vencer.</Text> : null}
        {resumen.vencimientos.map((v, i) => (
          <Pressable key={`${v.id}${v.cert}${i}`} style={st.card} onPress={() => setDetalleId(v.id)}>
            <View style={st.rowBetween}>
              <Text style={st.cardTitle} numberOfLines={1}>{v.nombre}</Text>
              <Text style={[st.tag, v.estado === 'vencida' ? st.tagRed : st.tagAmber]}>{v.estado === 'vencida' ? 'Vencida' : 'Por vencer'}</Text>
            </View>
            <Text style={st.muted}>{v.cert} · {v.vencimiento}</Text>
          </Pressable>
        ))}
      </>
    );
  }

  function renderCatalogos() {
    return (
      <>
        <View style={st.rowBetween}>
          <Text style={st.section}>Certificaciones</Text>
          {puedeEditar ? <Boton label="Nueva" icon="add" kind="ghost" onPress={() => setFormCert({ cert: null })} /> : null}
        </View>
        {certs.length === 0 ? <Text style={st.empty}>Aún no hay certificaciones. Crea la primera (p. ej. DC3 Trabajos en altura).</Text> : null}
        {certs.map((c) => (
          <Pressable key={c.id} style={st.card} onPress={() => puedeEditar && setFormCert({ cert: c })}>
            <Text style={st.cardTitle}>{c.nombre}</Text>
            <Text style={st.muted}>
              {c.vigencia_meses ? `Vigencia ${c.vigencia_meses} meses` : 'No vence'}{c.obligatoria ? ' · Obligatoria para todos' : ''}
            </Text>
          </Pressable>
        ))}
        <View style={[st.rowBetween, { marginTop: spacing.md }]}>
          <Text style={st.section}>Tipos de equipo / puesto</Text>
          {puedeEditar ? <Boton label="Nuevo" icon="add" kind="ghost" onPress={() => setFormTipo({ tipo: null })} /> : null}
        </View>
        {tipos.length === 0 ? <Text style={st.empty}>Define qué certificaciones exige cada tipo para calcular el semáforo.</Text> : null}
        {tipos.map((t) => (
          <Pressable key={t.id} style={st.card} onPress={() => puedeEditar && setFormTipo({ tipo: t })}>
            <Text style={st.cardTitle}>{t.nombre}</Text>
            <Text style={st.muted}>
              Exige: {t.cert_ids.map((id) => certs.find((c) => c.id === id)?.nombre).filter(Boolean).join(', ') || 'nada (sin reglas)'}
            </Text>
          </Pressable>
        ))}
      </>
    );
  }

  return (
    <View style={[st.flex, { paddingTop: insets.top }]}>
      <View style={st.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={st.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={st.title} numberOfLines={1}>Capacidades de Operadores</Text>
        {puedeEditar ? (
          <Pressable onPress={() => setImportando(true)} hitSlop={8} style={st.iconBtn} accessibilityLabel="Importar desde Excel">
            <Ionicons name="cloud-upload-outline" size={22} color={colors.primary} />
          </Pressable>
        ) : <View style={{ width: 32 }} />}
      </View>
      <View style={st.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.value} style={[st.tabBtn, tab === t.value && st.tabBtnActive]} onPress={() => setTab(t.value)}>
            <Ionicons name={t.icon} size={16} color={tab === t.value ? colors.primary : colors.textMuted} />
            <Text style={[st.tabTxt, tab === t.value && { color: colors.primary }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: insets.bottom + 100 }}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => { setRefrescando(true); cargar(true); }} />}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <View style={st.errorBox}><Text style={st.errorTxt}>{error}</Text></View> : null}
        {cargando ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} /> : null}
        {tab === 'operadores' ? renderOperadores() : tab === 'equipos' ? renderEquipos() : tab === 'resumen' ? renderResumen() : renderCatalogos()}
      </ScrollView>

      {puedeEditar && (tab === 'operadores' || tab === 'equipos') ? (
        <Pressable
          style={[st.fab, { bottom: insets.bottom + 20 }]}
          onPress={() => (tab === 'operadores' ? setFormOp({ op: null }) : setFormEq({ eq: null }))}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      ) : null}

      {importando ? (
        <ImportarCapacidadesModal
          projectId={projectId} certs={certs}
          onClose={() => { setImportando(false); cargar(true); }}
          onDone={() => cargar(true)}
        />
      ) : null}
      {detalleId ? (
        <DetalleOperador
          projectId={projectId} id={detalleId} certs={certs} puedeEditar={puedeEditar}
          onClose={() => { setDetalleId(null); cargar(true); }}
          onEditar={(o) => { setDetalleId(null); setFormOp({ op: o }); }}
        />
      ) : null}
      {formOp ? (
        <FormOperador
          projectId={projectId} op={formOp.op} tipos={tipos} frentes={frentes}
          onClose={() => setFormOp(null)}
          onSaved={() => { setFormOp(null); cargar(true); }}
        />
      ) : null}
      {formEq ? (
        <FormEquipo
          projectId={projectId} eq={formEq.eq} tipos={tipos}
          onClose={() => setFormEq(null)}
          onSaved={() => { setFormEq(null); cargar(true); }}
        />
      ) : null}
      {formCert ? (
        <FormCert
          cert={formCert.cert} onClose={() => setFormCert(null)}
          onSave={(body) => ejecutar(() => api.capSaveCert(projectId, formCert.cert?.id || null, body)).then((ok) => ok && setFormCert(null))}
          onBaja={formCert.cert ? async () => {
            if (await confirm('Dar de baja', `¿Dar de baja «${formCert.cert!.nombre}»? Las constancias ya capturadas se conservan.`, { destructive: true, confirmText: 'Dar de baja' })) {
              if (await ejecutar(() => api.capDeleteCert(projectId, formCert.cert!.id))) setFormCert(null);
            }
          } : undefined}
        />
      ) : null}
      {formTipo ? (
        <FormTipo
          tipo={formTipo.tipo} certs={certs} onClose={() => setFormTipo(null)}
          onSave={(body) => ejecutar(() => api.capSaveTipo(projectId, formTipo.tipo?.id || null, body)).then((ok) => ok && setFormTipo(null))}
          onBaja={formTipo.tipo ? async () => {
            if (await confirm('Dar de baja', `¿Dar de baja «${formTipo.tipo!.nombre}»?`, { destructive: true, confirmText: 'Dar de baja' })) {
              if (await ejecutar(() => api.capDeleteTipo(projectId, formTipo.tipo!.id))) setFormTipo(null);
            }
          } : undefined}
        />
      ) : null}
    </View>
  );
}

// ---------------- Detalle del operador + constancias ----------------
function DetalleOperador({ projectId, id, certs, puedeEditar, onClose, onEditar }: {
  projectId: string; id: string; certs: CapCert[]; puedeEditar: boolean; onClose: () => void; onEditar: (o: CapOperador) => void;
}) {
  const [o, setO] = useState<CapOperador | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [constForm, setConstForm] = useState<{ cid: string | null; cert_id: string; folio: string; emision: string; vencimiento: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try { setO(await api.capGetOperador(projectId, id)); setErr(null); } catch (e: any) { setErr(mensajeError(e)); }
  }, [projectId, id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function accion(fn: () => Promise<any>) {
    setOcupado(true);
    try { await fn(); await cargar(); } catch (e: any) { Alert.alert('No se pudo completar', mensajeError(e)); } finally { setOcupado(false); }
  }

  async function guardarConstancia() {
    if (!constForm) return;
    if (!constForm.cert_id) { Alert.alert('Elige la certificación'); return; }
    for (const f of [constForm.emision, constForm.vencimiento]) {
      if (f && !FECHA_RE.test(f)) { Alert.alert('Fecha inválida', 'Usa el formato AAAA-MM-DD, por ejemplo 2026-08-31.'); return; }
    }
    const body = {
      cert_id: constForm.cert_id, folio: constForm.folio.trim() || undefined,
      emision: constForm.emision || undefined, vencimiento: constForm.vencimiento || undefined,
    };
    await accion(async () => {
      if (constForm.cid) await api.capUpdateConstancia(projectId, constForm.cid, body);
      else await api.capAddConstancia(projectId, id, body);
    });
    setConstForm(null);
  }

  async function adjuntar(cid: string) {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    await accion(() => api.capUploadConstanciaArchivo(projectId, cid, { uri: a.uri, name: a.name || 'constancia.pdf', mimeType: a.mimeType }));
  }

  async function verArchivo(cid: string) {
    setOcupado(true);
    try {
      const { blob, filename } = await api.capDownloadConstancia(projectId, cid);
      await downloadBlob(blob, filename, blob.type || undefined);
    } catch (e: any) {
      Alert.alert('No se pudo abrir', mensajeError(e));
    } finally { setOcupado(false); }
  }

  const certNombre = (cid: string) => certs.find((c) => c.id === cid)?.nombre || 'Certificación';

  return (
    <Sheet visible title={o?.nombre || 'Operador'} onClose={onClose}>
      {err ? <View style={st.errorBox}><Text style={st.errorTxt}>{err}</Text></View> : null}
      {!o ? <ActivityIndicator color={colors.primary} /> : (
        <>
          <View style={st.rowBetween}>
            <Semaforo s={o.semaforo} />
            {o.estatus === 'baja' ? <Text style={[st.tag, st.tagRed]}>BAJA</Text> : null}
          </View>
          <Text style={st.muted}>{[o.puesto, o.tipo, o.frente, o.empresa].filter(Boolean).join(' · ') || 'Sin datos de puesto'}</Text>
          {o.aliases.length > 0 ? <Text style={st.muted}>También registrado como: {o.aliases.join(', ')}</Text> : null}
          {o.notas ? <Text style={st.muted}>{o.notas}</Text> : null}
          {o.equipos.length > 0 ? (
            <>
              <Text style={st.section}>Equipos asignados</Text>
              {o.equipos.map((e) => <Text key={e.id} style={st.cardTitle}>{e.nombre}{e.modelo ? ` · ${e.modelo}` : ''}</Text>)}
            </>
          ) : null}

          <Text style={st.section}>Certificaciones</Text>
          {o.certificaciones.length === 0 ? <Text style={st.empty}>Sin certificaciones registradas ni exigidas.</Text> : null}
          {o.certificaciones.map((c) => (
            <View key={c.cert_id} style={st.card}>
              <View style={st.rowBetween}>
                <Text style={st.cardTitle} numberOfLines={2}>{c.nombre}</Text>
                <Text style={[st.estado, { color: ESTADO_CERT[c.estado].color }]}>{ESTADO_CERT[c.estado].label}</Text>
              </View>
              <Text style={st.muted}>
                {c.requerida ? 'Exigida' : 'Adicional'}{c.vencimiento ? ` · vence ${c.vencimiento}` : c.constancia_id ? ' · no vence' : ''}{c.folio ? ` · folio ${c.folio}` : ''}
              </Text>
            </View>
          ))}

          <View style={[st.rowBetween, { marginTop: spacing.sm }]}>
            <Text style={st.section}>Constancias</Text>
            {puedeEditar ? (
              <Boton label="Agregar" icon="add" kind="ghost" onPress={() => setConstForm({ cid: null, cert_id: '', folio: '', emision: '', vencimiento: '' })} />
            ) : null}
          </View>
          {(o.constancias || []).length === 0 ? <Text style={st.empty}>Sin constancias capturadas.</Text> : null}
          {(o.constancias || []).map((k) => (
            <View key={k.id} style={st.card}>
              <Text style={st.cardTitle}>{certNombre(k.cert_id)}</Text>
              <Text style={st.muted}>
                {[k.folio ? `Folio ${k.folio}` : null, k.emision ? `emitida ${k.emision}` : null, k.vencimiento ? `vence ${k.vencimiento}` : 'sin vencimiento'].filter(Boolean).join(' · ')}
              </Text>
              <View style={st.tagsRow}>
                {k.archivo ? <Boton label="Ver constancia" icon="document-attach-outline" kind="ghost" onPress={() => verArchivo(k.id)} disabled={ocupado} /> : <Text style={st.muted}>Sin archivo adjunto</Text>}
                {puedeEditar ? (
                  <>
                    <Boton label={k.archivo ? 'Reemplazar' : 'Adjuntar'} icon="attach" kind="ghost" onPress={() => adjuntar(k.id)} disabled={ocupado} />
                    <Boton label="Editar" icon="create-outline" kind="ghost" onPress={() => setConstForm({
                      cid: k.id, cert_id: k.cert_id, folio: k.folio || '', emision: k.emision || '', vencimiento: k.vencimiento || '' })} />
                    <Boton label="Quitar" icon="trash-outline" kind="danger" disabled={ocupado} onPress={async () => {
                      if (await confirm('Quitar constancia', 'Se da de baja la constancia (queda en el historial).', { destructive: true, confirmText: 'Quitar' })) {
                        accion(() => api.capDeleteConstancia(projectId, k.id));
                      }
                    }} />
                  </>
                ) : null}
              </View>
            </View>
          ))}

          {puedeEditar ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Boton label="Editar datos del operador" icon="create-outline" kind="ghost" onPress={() => onEditar(o)} />
              {o.estatus === 'activo' ? (
                <Boton label="Dar de baja" icon="person-remove-outline" kind="danger" onPress={async () => {
                  if (await confirm('Dar de baja', `¿Dar de baja a ${o.nombre}? Sus constancias se conservan y sus equipos quedan sin operador.`, { destructive: true, confirmText: 'Dar de baja' })) {
                    await accion(() => api.capBajaOperador(projectId, id));
                    onClose();
                  }
                }} />
              ) : (
                <Boton label="Reactivar" icon="person-add-outline" kind="primary" onPress={() => accion(() => api.capUpdateOperador(projectId, id, { estatus: 'activo' }))} />
              )}
            </View>
          ) : null}
        </>
      )}

      {constForm ? (
        <Sheet visible title={constForm.cid ? 'Editar constancia' : 'Nueva constancia'} onClose={() => setConstForm(null)}>
          <Text style={st.label}>Certificación</Text>
          <View style={st.tagsRow}>
            {certs.map((c) => <Chip key={c.id} label={c.nombre} active={constForm.cert_id === c.id} onPress={() => setConstForm({ ...constForm, cert_id: c.id })} />)}
          </View>
          {certs.length === 0 ? <Text style={st.empty}>Primero crea certificaciones en la pestaña Catálogos.</Text> : null}
          <Campo label="Folio" value={constForm.folio} onChange={(v) => setConstForm({ ...constForm, folio: v })} />
          <Campo label="Fecha de emisión (AAAA-MM-DD)" value={constForm.emision} onChange={(v) => setConstForm({ ...constForm, emision: v })} placeholder="2026-08-31" />
          <Campo label="Vencimiento (AAAA-MM-DD; vacío = se calcula con la vigencia)" value={constForm.vencimiento} onChange={(v) => setConstForm({ ...constForm, vencimiento: v })} placeholder="2027-08-31" />
          <Boton label="Guardar" onPress={guardarConstancia} disabled={ocupado} />
        </Sheet>
      ) : null}
    </Sheet>
  );
}

// ---------------- Formularios ----------------
function FormOperador({ projectId, op, tipos, frentes, onClose, onSaved }: {
  projectId: string; op: CapOperador | null; tipos: CapTipo[]; frentes: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(op?.nombre || '');
  const [puesto, setPuesto] = useState(op?.puesto || '');
  const [tipoId, setTipoId] = useState(op?.tipo_id || '');
  const [frente, setFrente] = useState(op?.frente || '');
  const [empresa, setEmpresa] = useState(op?.empresa || '');
  const [notas, setNotas] = useState(op?.notas || '');
  const [guardando, setGuardando] = useState(false);
  const [candidatos, setCandidatos] = useState<CapPersonaCoincidencia[] | null>(null);
  const [sugeridos, setSugeridos] = useState<CapPersonaCoincidencia[]>([]);

  // Al crear, avisa si ya existe una persona grabada con ese nombre (reutilizable entre proyectos).
  useEffect(() => {
    if (op || nombre.trim().length < 3) { setSugeridos([]); return; }
    const t = setTimeout(() => {
      api.capBuscarPersonas(projectId, nombre.trim()).then(setSugeridos).catch(() => setSugeridos([]));
    }, 350);
    return () => clearTimeout(t);
  }, [nombre, op, projectId]);

  async function guardar(extra: { persona_id?: string; force?: boolean } = {}) {
    if (!nombre.trim()) { Alert.alert('Falta el nombre'); return; }
    const body = {
      nombre: nombre.trim(), puesto: puesto.trim() || null, tipo_id: tipoId || null,
      frente: frente.trim() || null, empresa: empresa.trim() || null, notas: notas.trim() || null, ...extra,
    };
    setGuardando(true);
    try {
      if (op) await api.capUpdateOperador(projectId, op.id, body);
      else await api.capCreateOperador(projectId, body);
      onSaved();
    } catch (e: any) {
      let detalle: any = null;
      try { detalle = JSON.parse(e?.message); } catch { /* mensaje de texto */ }
      if (detalle?.code === 'posibles_duplicados') setCandidatos(detalle.candidatos || []);
      else Alert.alert('No se pudo guardar', mensajeError(e));
    } finally { setGuardando(false); }
  }

  return (
    <Sheet visible title={op ? 'Editar operador' : 'Nuevo operador'} onClose={onClose}>
      <Campo label="Nombre completo" value={nombre} onChange={setNombre} />
      {sugeridos.length > 0 ? (
        <View style={st.warnBox}>
          <Text style={st.warnTitle}>Ya hay personas grabadas con nombre parecido:</Text>
          {sugeridos.slice(0, 5).map((s) => (
            <View key={s.persona_id} style={st.rowBetween}>
              <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>{s.nombre}</Text>
              {s.operador_id ? <Text style={st.muted}>Ya está en el proyecto</Text> : (
                <Pressable onPress={() => guardar({ persona_id: s.persona_id })}><Text style={st.link}>Usar esta</Text></Pressable>
              )}
            </View>
          ))}
        </View>
      ) : null}
      <Campo label="Puesto" value={puesto} onChange={setPuesto} />
      <Text style={st.label}>Tipo de equipo / puesto (define lo que se le exige)</Text>
      <View style={st.tagsRow}>
        <Chip label="Ninguno" active={!tipoId} onPress={() => setTipoId('')} />
        {tipos.map((t) => <Chip key={t.id} label={t.nombre} active={tipoId === t.id} onPress={() => setTipoId(t.id)} />)}
      </View>
      <Campo label="Frente / estación" value={frente} onChange={setFrente} placeholder={frentes[0] || 'E1 Universidad'} />
      <Campo label="Empresa / proveedor" value={empresa} onChange={setEmpresa} />
      <Campo label="Notas" value={notas} onChange={setNotas} multiline />
      {candidatos ? (
        <View style={st.warnBox}>
          <Text style={st.warnTitle}>Posibles duplicados</Text>
          {candidatos.map((c) => (
            <View key={c.persona_id} style={st.rowBetween}>
              <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>{c.nombre} ({Math.round(c.similitud * 100)}%)</Text>
              <Pressable onPress={() => guardar({ persona_id: c.persona_id })}><Text style={st.link}>Es la misma</Text></Pressable>
            </View>
          ))}
          <Boton label="Es otra persona, crear de todos modos" kind="ghost" onPress={() => guardar({ force: true })} />
        </View>
      ) : null}
      <Boton label={guardando ? 'Guardando…' : 'Guardar'} onPress={() => guardar()} disabled={guardando} />
    </Sheet>
  );
}

function FormEquipo({ projectId, eq, tipos, onClose, onSaved }: {
  projectId: string; eq: CapEquipo | null; tipos: CapTipo[]; onClose: () => void; onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(eq?.nombre || '');
  const [modelo, setModelo] = useState(eq?.modelo || '');
  const [tipoId, setTipoId] = useState(eq?.tipo_id || '');
  const [ubicacion, setUbicacion] = useState(eq?.ubicacion || '');
  const [estado, setEstado] = useState<'activo' | 'inactivo'>(eq?.estado || 'activo');
  const [operadorId, setOperadorId] = useState(eq?.operador_id || '');
  const [ingreso, setIngreso] = useState(eq?.fecha_ingreso || '');
  const [salida, setSalida] = useState(eq?.fecha_salida || '');
  const [ops, setOps] = useState<CapOperador[]>([]);
  const [qOp, setQOp] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.capListOperadores(projectId, { q: qOp || undefined, limit: 30 }).then((r) => setOps(r.items)).catch(() => setOps([]));
  }, [projectId, qOp]);

  async function guardar() {
    if (!nombre.trim()) { Alert.alert('Falta el nombre del equipo'); return; }
    for (const f of [ingreso, salida]) if (f && !FECHA_RE.test(f)) { Alert.alert('Fecha inválida', 'Usa AAAA-MM-DD.'); return; }
    setGuardando(true);
    try {
      await api.capSaveEquipo(projectId, eq?.id || null, {
        nombre: nombre.trim(), modelo: modelo.trim() || null, tipo_id: tipoId || null, ubicacion: ubicacion.trim() || null,
        estado, operador_id: operadorId || null, fecha_ingreso: ingreso || null, fecha_salida: salida || null,
      });
      onSaved();
    } catch (e: any) { Alert.alert('No se pudo guardar', mensajeError(e)); } finally { setGuardando(false); }
  }

  const elegido = ops.find((o) => o.id === operadorId)?.nombre || eq?.operador?.nombre;
  return (
    <Sheet visible title={eq ? 'Editar equipo' : 'Nuevo equipo'} onClose={onClose}>
      <Campo label="Equipo" value={nombre} onChange={setNombre} placeholder="Excavadora" />
      <Campo label="Modelo / identificación" value={modelo} onChange={setModelo} />
      <Text style={st.label}>Tipo (exige certificaciones a su operador)</Text>
      <View style={st.tagsRow}>
        <Chip label="Ninguno" active={!tipoId} onPress={() => setTipoId('')} />
        {tipos.map((t) => <Chip key={t.id} label={t.nombre} active={tipoId === t.id} onPress={() => setTipoId(t.id)} />)}
      </View>
      <Campo label="Estación / ubicación" value={ubicacion} onChange={setUbicacion} />
      <View style={st.tagsRow}>
        <Chip label="Activo" active={estado === 'activo'} onPress={() => setEstado('activo')} />
        <Chip label="Inactivo" active={estado === 'inactivo'} onPress={() => setEstado('inactivo')} />
      </View>
      <Text style={st.label}>Operador{elegido ? `: ${elegido}` : ''}</Text>
      <TextInput style={st.input} value={qOp} onChangeText={setQOp} placeholder="Buscar operador…" placeholderTextColor={colors.textMuted} />
      <View style={st.tagsRow}>
        <Chip label="Sin operador" active={!operadorId} onPress={() => setOperadorId('')} />
        {ops.map((o) => <Chip key={o.id} label={o.nombre} active={operadorId === o.id} onPress={() => setOperadorId(o.id)} />)}
      </View>
      <Campo label="Fecha de ingreso (AAAA-MM-DD)" value={ingreso} onChange={setIngreso} />
      <Campo label="Fecha de salida (AAAA-MM-DD)" value={salida} onChange={setSalida} />
      <Boton label={guardando ? 'Guardando…' : 'Guardar'} onPress={guardar} disabled={guardando} />
      {eq ? (
        <Boton label="Dar de baja el equipo" kind="danger" onPress={async () => {
          if (await confirm('Dar de baja', `¿Dar de baja «${eq.nombre}»?`, { destructive: true, confirmText: 'Dar de baja' })) {
            try { await api.capBajaEquipo(projectId, eq.id); onSaved(); } catch (e: any) { Alert.alert('No se pudo', mensajeError(e)); }
          }
        }} />
      ) : null}
    </Sheet>
  );
}

function FormCert({ cert, onClose, onSave, onBaja }: {
  cert: CapCert | null; onClose: () => void; onSave: (b: Partial<CapCert>) => void; onBaja?: () => void;
}) {
  const [nombre, setNombre] = useState(cert?.nombre || '');
  const [aliases, setAliases] = useState((cert?.aliases || []).join(', '));
  const [vig, setVig] = useState(cert?.vigencia_meses ? String(cert.vigencia_meses) : '');
  const [oblig, setOblig] = useState(!!cert?.obligatoria);
  return (
    <Sheet visible title={cert ? 'Editar certificación' : 'Nueva certificación'} onClose={onClose}>
      <Campo label="Nombre" value={nombre} onChange={setNombre} placeholder="DC3 Trabajos en altura" />
      <Campo label="Otros nombres con los que aparece (separados por coma)" value={aliases} onChange={setAliases} />
      <Campo label="Vigencia en meses (vacío = no vence)" value={vig} onChange={setVig} keyboardType="number-pad" />
      <View style={st.rowBetween}>
        <Text style={[st.label, { flex: 1 }]}>Obligatoria para todo el personal activo</Text>
        <Switch value={oblig} onValueChange={setOblig} />
      </View>
      <Boton label="Guardar" onPress={() => {
        if (!nombre.trim()) { Alert.alert('Falta el nombre'); return; }
        const v = vig.trim() ? parseInt(vig, 10) : null;
        if (vig.trim() && (!v || v < 1)) { Alert.alert('Vigencia inválida'); return; }
        onSave({ nombre: nombre.trim(), aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean), vigencia_meses: v, obligatoria: oblig });
      }} />
      {onBaja ? <Boton label="Dar de baja" kind="danger" onPress={onBaja} /> : null}
    </Sheet>
  );
}

function FormTipo({ tipo, certs, onClose, onSave, onBaja }: {
  tipo: CapTipo | null; certs: CapCert[]; onClose: () => void; onSave: (b: Partial<CapTipo>) => void; onBaja?: () => void;
}) {
  const [nombre, setNombre] = useState(tipo?.nombre || '');
  const [aliases, setAliases] = useState((tipo?.aliases || []).join(', '));
  const [sel, setSel] = useState<string[]>(tipo?.cert_ids || []);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Sheet visible title={tipo ? 'Editar tipo' : 'Nuevo tipo'} onClose={onClose}>
      <Campo label="Nombre (equipo o puesto)" value={nombre} onChange={setNombre} placeholder="Operador de excavadora" />
      <Campo label="Otros nombres (separados por coma)" value={aliases} onChange={setAliases} />
      <Text style={st.label}>Certificaciones que exige</Text>
      <View style={st.tagsRow}>
        {certs.map((c) => <Chip key={c.id} label={c.nombre} active={sel.includes(c.id)} onPress={() => toggle(c.id)} />)}
      </View>
      {certs.length === 0 ? <Text style={st.empty}>Primero crea certificaciones.</Text> : null}
      <Boton label="Guardar" onPress={() => {
        if (!nombre.trim()) { Alert.alert('Falta el nombre'); return; }
        onSave({ nombre: nombre.trim(), aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean), cert_ids: sel });
      }} />
      {onBaja ? <Boton label="Dar de baja" kind="danger" onPress={onBaja} /> : null}
    </Sheet>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: colors.text },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: colors.primary },
  tabTxt: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 15, color: colors.text },
  chipsRow: { gap: 6, paddingVertical: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipTxt: { fontSize: 13, color: colors.textBody, fontWeight: '600' },
  chipTxtActive: { color: colors.primaryDark },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 4 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  muted: { fontSize: 13, color: colors.textMuted },
  link: { fontSize: 13, color: colors.primary, fontWeight: '700' },
  empty: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
  section: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.full },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeTxt: { fontSize: 12, fontWeight: '800' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  tag: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, overflow: 'hidden' },
  tagRed: { backgroundColor: colors.errorBg, color: '#B91C1C' },
  tagAmber: { backgroundColor: colors.warningBg, color: '#B45309' },
  estado: { fontSize: 12, fontWeight: '800' },
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, borderRadius: radius.md, padding: 10, alignItems: 'center' },
  kpiNum: { fontSize: 24, fontWeight: '800' },
  kpiLbl: { fontSize: 11, fontWeight: '700' },
  fab: { position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  errorBox: { backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md },
  errorTxt: { color: colors.error, fontSize: 13, fontWeight: '600' },
  warnBox: { backgroundColor: colors.warningBg, padding: 10, borderRadius: radius.md, gap: 6 },
  warnTitle: { fontSize: 13, fontWeight: '800', color: '#B45309' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.md },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  btnTxt: { fontSize: 14, fontWeight: '700' },
});
