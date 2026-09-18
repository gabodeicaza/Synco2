// Control de Obra — réplica del mismo look & feel (tarjetas con % grande,
// tabs, tabla de columnas agrupadas con celdas de estatus tocables) de una
// herramienta HTML externa que el usuario ya usaba para seguir avance de
// Postes/Cimentación/Perforadoras. DECISIÓN DE DISEÑO: en vez de hardcodear
// la paleta institucional de esa herramienta (ámbar/vino fijos), se usa el
// sistema de temas YA EXISTENTE en SynCo (`colors`/`radius`/`spacing`/
// `shadow` de `@/src/theme`, y `project.color_institucional` como acento) — así esta
// pantalla se ve como el resto de la app (cada proyecto con su color), pero
// conserva la MISMA estructura visual (tarjetas de intertramo/estación con
// %, tabla con encabezados agrupados, celdas de color cicladas al tocar).
//
// "Postes por Intertramo" NO tiene colección propia: reusa los nodos tipo
// "intertramo" ya existentes (Acceso al Predio) y sus 4 campos
// estatus_pilas/cabezal/fuste/poste (mismo dato que AccesoPredioManager.tsx
// ya edita) — el usuario pidió explícitamente conectar esto al árbol
// existente en vez de duplicar datos. El único cambio es que aquí el
// estatus se cicla con un tap (Sin iniciar → En proceso → Concluido →
// Cambio de trayectoria → …) en vez de un selector de 4 opciones, y se
// puede hacer desde el rol Especialista (ver PATCH /nodes/{id}/poste-estatus,
// más abierto que el PATCH general de nodo).
// "Cimentación por Estación" y "Perforadoras" sí son colecciones nuevas
// (cimentacion_elementos / perforadoras) sin equivalente previo.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  api, LocationNode, Project, PosteEstatus, CimentacionElemento, Perforadora,
} from '@/src/api';
import { colors, radius, shadow, spacing, contrastText } from '@/src/theme';
import { ESTATUS_LABEL, ESTATUS_COLOR, POSTE_CAMPOS, PosteCampo } from '@/src/components/AccesoPredioManager';
import { downloadBlob } from '@/src/utils/downloadBlob';

type Tab = 'postes' | 'cimentacion' | 'perforadoras';

const CYCLE: PosteEstatus[] = ['sin_iniciar', 'en_proceso', 'concluido', 'cambio_trayectoria'];

function nextEstatus(cur: PosteEstatus | null | undefined): PosteEstatus {
  const idx = CYCLE.indexOf((cur || 'sin_iniciar') as PosteEstatus);
  return CYCLE[(idx + 1) % CYCLE.length];
}

function fieldFor(campo: PosteCampo): 'estatus_pilas' | 'estatus_cabezal' | 'estatus_fuste' | 'estatus_poste' {
  return `estatus_${campo}` as const;
}

// Mismo criterio que el panel de referencia: concluido=1, en_proceso=0.5,
// sin_iniciar/cambio_trayectoria=0 (la excepción no suma avance, se marca
// aparte como alerta — ver posteHasAlert).
function posteProgress(node: LocationNode): number {
  const vals = POSTE_CAMPOS.map(({ campo }) => node[fieldFor(campo)]).filter(Boolean) as PosteEstatus[];
  if (!vals.length) return 0;
  let sum = 0;
  vals.forEach((v) => { if (v === 'concluido') sum += 1; else if (v === 'en_proceso') sum += 0.5; });
  return sum / vals.length;
}
function posteHasAlert(node: LocationNode): boolean {
  return POSTE_CAMPOS.some(({ campo }) => node[fieldFor(campo)] === 'cambio_trayectoria');
}
function fmtPct(x: number): number { return Math.round(x * 100); }

function nodePathNames(nodeId: string, byId: Record<string, LocationNode>): string[] {
  const names: string[] = [];
  let current: LocationNode | undefined = byId[nodeId];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    names.unshift(current.name);
    seen.add(current.id);
    current = current.parent_id ? byId[current.parent_id] : undefined;
  }
  return names;
}

export default function ControlObraScreen({ projectId }: { projectId: string }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [allNodes, setAllNodes] = useState<LocationNode[]>([]);
  const [cimentacion, setCimentacion] = useState<CimentacionElemento[]>([]);
  const [perforadoras, setPerforadoras] = useState<Perforadora[]>([]);
  const [tab, setTab] = useState<Tab>('postes');
  const [activeIntertramoId, setActiveIntertramoId] = useState<string | null>(null);
  const [activeEstacionId, setActiveEstacionId] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Record<string, boolean>>({});

  const [addElementoOpen, setAddElementoOpen] = useState(false);
  const [elementoDraft, setElementoDraft] = useState('');
  const [elementoFieldDrafts, setElementoFieldDrafts] = useState<Record<string, { total: string; acumulado_total: string; en_proceso: string }>>({});

  const [perfModal, setPerfModal] = useState<Perforadora | 'nueva' | null>(null);
  const [perfDraft, setPerfDraft] = useState({ nombre: '', serie: '', ubicacion: '', estatus: '' });
  const [perfSaving, setPerfSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const headerColor = project?.color_institucional || project?.color_tema || colors.primary;
  const headerTextColor = contrastText(headerColor);

  // Puente app → panel externo: descarga el mismo Excel de 3 hojas (POSTES/
  // CIMENTACION/PERFORADORAS) que ya sabe leer el panel HTML de obra que se
  // usaba antes de este módulo — así se puede refrescar con datos en vivo
  // sin recapturar nada a mano (ver export_control_obra_xlsx en server.py).
  async function exportXlsx() {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await api.downloadControlObraXlsx(projectId);
      await downloadBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e: any) {
      Alert.alert('No se pudo exportar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setExporting(false);
    }
  }

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [proj, nodes, cim, perf] = await Promise.all([
        api.getProject(projectId), api.listNodes(projectId),
        api.listCimentacionElementos(projectId), api.listPerforadoras(projectId),
      ]);
      setProject(proj);
      setAllNodes(nodes || []);
      setCimentacion(cim.elementos || []);
      setPerforadoras(perf.perforadoras || []);
      const fd: Record<string, { total: string; acumulado_total: string; en_proceso: string }> = {};
      (cim.elementos || []).forEach((e) => {
        fd[e.id] = { total: String(e.total), acumulado_total: String(e.acumulado_total), en_proceso: String(e.en_proceso) };
      });
      setElementoFieldDrafts(fd);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar Control de Obra.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => {
    const m: Record<string, LocationNode> = {};
    allNodes.forEach((n) => { m[n.id] = n; });
    return m;
  }, [allNodes]);

  const intertramos = useMemo(
    () => allNodes.filter((n) => n.tipo_nodo === 'intertramo' && n.acceso_predio_efectivo),
    [allNodes],
  );
  const estaciones = useMemo(
    () => allNodes.filter((n) => (n.tipo_nodo || 'estacion') === 'estacion' && n.acceso_predio_efectivo),
    [allNodes],
  );

  function postesOf(intertramoId: string): LocationNode[] {
    return allNodes
      .filter((n) => n.parent_id === intertramoId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  }

  function intertramoStats(intertramoId: string) {
    const postes = postesOf(intertramoId);
    if (!postes.length) return { pct: 0, total: 0, alertCount: 0 };
    let sum = 0, alertCount = 0;
    postes.forEach((p) => { sum += posteProgress(p); if (posteHasAlert(p)) alertCount++; });
    return { pct: sum / postes.length, total: postes.length, alertCount };
  }

  const overallStats = useMemo(() => {
    let all: LocationNode[] = [];
    intertramos.forEach((it) => { all = all.concat(postesOf(it.id)); });
    if (!all.length) return { pct: 0, total: 0, alertCount: 0 };
    let sum = 0, alertCount = 0;
    all.forEach((p) => { sum += posteProgress(p); if (posteHasAlert(p)) alertCount++; });
    return { pct: sum / all.length, total: all.length, alertCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allNodes, intertramos]);

  function estacionPct(estacionId: string): number {
    const elems = cimentacion.filter((e) => e.node_id === estacionId);
    if (!elems.length) return 0;
    const totalSum = elems.reduce((s, e) => s + (e.total || 0), 0);
    const acumSum = elems.reduce((s, e) => s + (e.acumulado_total || 0), 0);
    return totalSum > 0 ? acumSum / totalSum : 0;
  }

  async function cycleEstatus(node: LocationNode, campo: PosteCampo) {
    const field = fieldFor(campo);
    const key = `${node.id}:${campo}`;
    if (busyKeys[key]) return;
    const next = nextEstatus(node[field] as PosteEstatus | undefined);
    setBusyKeys((b) => ({ ...b, [key]: true }));
    try {
      const updated = await api.updatePosteEstatus(node.id, { [field]: next } as any);
      setAllNodes((list) => list.map((n) => (n.id === node.id ? { ...n, [field]: (updated as any)[field] } : n)));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo actualizar el estatus');
    } finally {
      setBusyKeys((b) => ({ ...b, [key]: false }));
    }
  }

  async function addElemento() {
    if (!activeEstacionId) return;
    const nombre = elementoDraft.trim();
    if (!nombre) { Alert.alert('Falta información', 'Escribe el nombre del elemento.'); return; }
    try {
      const created = await api.createCimentacionElemento(projectId, { node_id: activeEstacionId, elemento: nombre });
      setCimentacion((list) => [...list, created]);
      setElementoFieldDrafts((d) => ({ ...d, [created.id]: { total: '0', acumulado_total: '0', en_proceso: '0' } }));
      setElementoDraft('');
      setAddElementoOpen(false);
    } catch (e: any) {
      Alert.alert('No se pudo agregar', e?.message || 'Intentalo nuevamente.');
    }
  }

  function elementoDirty(el: CimentacionElemento): boolean {
    const d = elementoFieldDrafts[el.id];
    if (!d) return false;
    return d.total !== String(el.total) || d.acumulado_total !== String(el.acumulado_total) || d.en_proceso !== String(el.en_proceso);
  }

  async function saveElemento(el: CimentacionElemento) {
    const d = elementoFieldDrafts[el.id];
    if (!d) return;
    const key = `elem:${el.id}`;
    if (busyKeys[key]) return;
    setBusyKeys((b) => ({ ...b, [key]: true }));
    try {
      const updated = await api.updateCimentacionElemento(projectId, el.id, {
        total: Math.max(0, Number(d.total) || 0),
        acumulado_total: Math.max(0, Number(d.acumulado_total) || 0),
        en_proceso: Math.max(0, Number(d.en_proceso) || 0),
      });
      setCimentacion((list) => list.map((e) => (e.id === el.id ? updated : e)));
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setBusyKeys((b) => ({ ...b, [key]: false }));
    }
  }

  async function deleteElemento(el: CimentacionElemento) {
    try {
      await api.deleteCimentacionElemento(projectId, el.id);
      setCimentacion((list) => list.filter((e) => e.id !== el.id));
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    }
  }

  function openPerfModal(target: Perforadora | 'nueva') {
    if (target === 'nueva') setPerfDraft({ nombre: '', serie: '', ubicacion: '', estatus: '' });
    else setPerfDraft({ nombre: target.nombre, serie: target.serie, ubicacion: target.ubicacion, estatus: target.estatus });
    setPerfModal(target);
  }

  async function savePerforadora() {
    const nombre = perfDraft.nombre.trim();
    if (!nombre) { Alert.alert('Falta información', 'Escribe el nombre de la perforadora.'); return; }
    setPerfSaving(true);
    try {
      if (perfModal === 'nueva') {
        const created = await api.createPerforadora(projectId, perfDraft);
        setPerforadoras((list) => [...list, created]);
      } else if (perfModal) {
        const updated = await api.updatePerforadora(projectId, perfModal.id, perfDraft);
        setPerforadoras((list) => list.map((p) => (p.id === updated.id ? updated : p)));
      }
      setPerfModal(null);
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
    } finally {
      setPerfSaving(false);
    }
  }

  async function deletePerforadora(p: Perforadora) {
    try {
      await api.deletePerforadora(projectId, p.id);
      setPerforadoras((list) => list.filter((x) => x.id !== p.id));
    } catch (e: any) {
      Alert.alert('No se pudo eliminar', e?.message || 'Intentalo nuevamente.');
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  const activeIntertramo = intertramos.find((i) => i.id === activeIntertramoId) || intertramos[0] || null;
  const activeEstacion = estaciones.find((e) => e.id === activeEstacionId) || estaciones[0] || null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.headerWrap, { backgroundColor: headerColor, paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={headerTextColor} />
          </Pressable>
          <Text style={[styles.titleBar, { color: headerTextColor }]} numberOfLines={1}>Control de Obra</Text>
          <Pressable onPress={exportXlsx} disabled={exporting} hitSlop={10} style={styles.iconBtn}>
            {exporting ? (
              <ActivityIndicator size="small" color={headerTextColor} />
            ) : (
              <Ionicons name="download-outline" size={22} color={headerTextColor} />
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.tabRow}>
        {([
          { key: 'postes', label: 'Postes', icon: 'git-network-outline' },
          { key: 'cimentacion', label: 'Cimentación', icon: 'layers-outline' },
          { key: 'perforadoras', label: 'Perforadoras', icon: 'construct-outline' },
        ] as { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[]).map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tabBtn, tab === t.key && { borderBottomColor: headerColor }]}>
            <Ionicons name={t.icon} size={15} color={tab === t.key ? headerColor : colors.textMuted} />
            <Text style={[styles.tabTxt, tab === t.key && { color: headerColor }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'postes' ? (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.heroRow}>
            <View style={styles.heroPct}>
              <Text style={[styles.heroNum, { color: headerColor }]}>{fmtPct(overallStats.pct)}</Text>
              <Text style={[styles.heroPctSign, { color: headerColor }]}>%</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroLabel}>Avance físico general de postes</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${fmtPct(overallStats.pct)}%`, backgroundColor: headerColor }]} />
              </View>
              <Text style={styles.kpiTxt}>{overallStats.total} postes registrados{overallStats.alertCount > 0 ? ` · ${overallStats.alertCount} con cambio de trayectoria` : ''}</Text>
            </View>
          </View>

          {intertramos.length === 0 ? (
            <Text style={styles.empty}>No hay nodos tipo Intertramo habilitados en Acceso al Predio todavía.</Text>
          ) : (
            <>
              <Text style={styles.sectionLabel}>Avance por intertramo</Text>
              <View style={styles.cardsGrid}>
                {intertramos.map((it) => {
                  const s = intertramoStats(it.id);
                  const active = activeIntertramo?.id === it.id;
                  return (
                    <Pressable
                      key={it.id}
                      onPress={() => setActiveIntertramoId(it.id)}
                      style={[styles.stationCard, active && { borderColor: headerColor, backgroundColor: `${headerColor}0D` }]}
                    >
                      <Text style={styles.stationName} numberOfLines={2}>{it.name}</Text>
                      <Text style={styles.stationCount}>{s.total} poste{s.total === 1 ? '' : 's'}{s.alertCount > 0 ? ` · ${s.alertCount} alerta${s.alertCount === 1 ? '' : 's'}` : ''}</Text>
                      <View style={styles.progressTrackSm}>
                        <View style={[styles.progressFill, { width: `${fmtPct(s.pct)}%`, backgroundColor: headerColor }]} />
                      </View>
                      <Text style={[styles.stationPct, { color: headerColor }]}>{fmtPct(s.pct)}%</Text>
                    </Pressable>
                  );
                })}
              </View>

              {activeIntertramo ? (
                <View style={styles.detailCard}>
                  <Text style={styles.detailTitle}>{activeIntertramo.name}</Text>
                  {postesOf(activeIntertramo.id).length === 0 ? (
                    <Text style={styles.empty}>Este intertramo todavía no tiene postes (hijos) en el árbol.</Text>
                  ) : (
                    <View style={styles.posteTable}>
                      <View style={styles.posteHeaderRow}>
                        <Text style={[styles.posteHeaderCell, styles.posteIdCol, { backgroundColor: `${headerColor}1A` }]}>Poste</Text>
                        {POSTE_CAMPOS.map(({ campo, label }) => (
                          <Text key={campo} style={[styles.posteHeaderCell, { backgroundColor: `${headerColor}1A` }]}>{label}</Text>
                        ))}
                      </View>
                      {postesOf(activeIntertramo.id).map((poste) => (
                        <View key={poste.id} style={[styles.posteRow, posteHasAlert(poste) && styles.posteRowAlert]}>
                          <Text style={[styles.posteIdCell, styles.posteIdCol]} numberOfLines={1}>{poste.name}</Text>
                          {POSTE_CAMPOS.map(({ campo }) => {
                            const value = (poste[fieldFor(campo)] as PosteEstatus) || 'sin_iniciar';
                            const key = `${poste.id}:${campo}`;
                            return (
                              <Pressable
                                key={campo}
                                onPress={() => cycleEstatus(poste, campo)}
                                disabled={!!busyKeys[key]}
                                style={[styles.posteCell, { backgroundColor: `${ESTATUS_COLOR[value]}22` }]}
                              >
                                {busyKeys[key] ? (
                                  <ActivityIndicator size="small" color={ESTATUS_COLOR[value]} />
                                ) : (
                                  <View style={[styles.posteDot, { backgroundColor: ESTATUS_COLOR[value] }]} />
                                )}
                              </Pressable>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={styles.legendRow}>
                    {(Object.keys(ESTATUS_LABEL) as PosteEstatus[]).map((k) => (
                      <View key={k} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: ESTATUS_COLOR[k] }]} />
                        <Text style={styles.legendTxt}>{ESTATUS_LABEL[k]}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.hintTxt}>Toca una celda para cambiar su estatus.</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : tab === 'cimentacion' ? (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          {estaciones.length === 0 ? (
            <Text style={styles.empty}>No hay nodos tipo Estación habilitados en Acceso al Predio todavía.</Text>
          ) : (
            <>
              <Text style={styles.sectionLabel}>Avance de cimentación por estación</Text>
              <View style={styles.cardsGrid}>
                {estaciones.map((est) => {
                  const pct = estacionPct(est.id);
                  const hasData = cimentacion.some((e) => e.node_id === est.id);
                  const active = activeEstacion?.id === est.id;
                  return (
                    <Pressable
                      key={est.id}
                      onPress={() => setActiveEstacionId(est.id)}
                      style={[styles.stationCard, active && { borderColor: headerColor, backgroundColor: `${headerColor}0D` }]}
                    >
                      <Text style={styles.stationName} numberOfLines={2}>{est.name}</Text>
                      {hasData ? (
                        <>
                          <View style={styles.progressTrackSm}>
                            <View style={[styles.progressFill, { width: `${fmtPct(pct)}%`, backgroundColor: headerColor }]} />
                          </View>
                          <Text style={[styles.stationPct, { color: headerColor }]}>{fmtPct(pct)}% colado</Text>
                        </>
                      ) : (
                        <Text style={styles.stationCount}>Sin elementos capturados</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>

              {activeEstacion ? (
                <View style={styles.detailCard}>
                  <View style={styles.detailHeadRow}>
                    <Text style={styles.detailTitle}>{activeEstacion.name}</Text>
                    <Pressable onPress={() => setAddElementoOpen(true)} style={styles.addBtn}>
                      <Ionicons name="add" size={16} color={headerColor} />
                      <Text style={[styles.addBtnTxt, { color: headerColor }]}>Agregar elemento</Text>
                    </Pressable>
                  </View>
                  {cimentacion.filter((e) => e.node_id === activeEstacion.id).length === 0 ? (
                    <Text style={styles.empty}>Sin elementos de cimentación capturados para esta estación.</Text>
                  ) : (
                    cimentacion.filter((e) => e.node_id === activeEstacion.id).map((el) => {
                      const d = elementoFieldDrafts[el.id] || { total: '0', acumulado_total: '0', en_proceso: '0' };
                      const total = Number(d.total) || 0;
                      const acum = Number(d.acumulado_total) || 0;
                      const pctColado = total > 0 ? acum / total : 0;
                      const dirty = elementoDirty(el);
                      const busyKey = `elem:${el.id}`;
                      return (
                        <View key={el.id} style={styles.elementoCard}>
                          <View style={styles.elementoHeadRow}>
                            <Text style={styles.elementoName}>{el.elemento}</Text>
                            <Text style={[styles.elementoPct, { color: headerColor }]}>{fmtPct(pctColado)}% colado</Text>
                            <Pressable onPress={() => deleteElemento(el)} hitSlop={8}>
                              <Ionicons name="trash-outline" size={16} color={colors.error} />
                            </Pressable>
                          </View>
                          <View style={styles.elementoFieldsRow}>
                            {([
                              { key: 'total', label: 'Total' },
                              { key: 'acumulado_total', label: 'Acumulado' },
                              { key: 'en_proceso', label: 'En proceso' },
                            ] as const).map(({ key, label }) => (
                              <View key={key} style={{ flex: 1 }}>
                                <Text style={styles.elementoFieldLabel}>{label}</Text>
                                <TextInput
                                  value={d[key]}
                                  onChangeText={(t) => setElementoFieldDrafts((prev) => ({ ...prev, [el.id]: { ...prev[el.id], [key]: t } }))}
                                  keyboardType="numeric"
                                  style={styles.elementoFieldInput}
                                />
                              </View>
                            ))}
                          </View>
                          {dirty ? (
                            <Pressable onPress={() => saveElemento(el)} disabled={!!busyKeys[busyKey]} style={[styles.saveBtn, { backgroundColor: headerColor }]}>
                              {busyKeys[busyKey] ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnTxt}>Guardar</Text>}
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    })
                  )}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.detailHeadRow}>
            <Text style={styles.sectionLabel}>Relación de perforadoras</Text>
            <Pressable onPress={() => openPerfModal('nueva')} style={styles.addBtn}>
              <Ionicons name="add" size={16} color={headerColor} />
              <Text style={[styles.addBtnTxt, { color: headerColor }]}>Agregar perforadora</Text>
            </Pressable>
          </View>
          {perforadoras.length === 0 ? (
            <Text style={styles.empty}>Sin perforadoras registradas todavía.</Text>
          ) : (
            perforadoras.map((p) => (
              <Pressable key={p.id} onPress={() => openPerfModal(p)} style={styles.perfCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.perfName}>{p.nombre}</Text>
                  <Text style={styles.perfMeta}>{p.serie || '—'} · {p.ubicacion || 'Sin ubicación'}</Text>
                  {p.estatus ? <Text style={[styles.perfEstatus, { color: headerColor }]}>{p.estatus}</Text> : null}
                </View>
                <Pressable onPress={() => deletePerforadora(p)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </Pressable>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      {/* Modal: agregar elemento de cimentación */}
      <Modal visible={addElementoOpen} transparent animationType="slide" onRequestClose={() => setAddElementoOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nuevo elemento</Text>
            <TextInput
              value={elementoDraft} onChangeText={setElementoDraft}
              placeholder="Ej. Zapata, Dado..." placeholderTextColor={colors.textMuted}
              style={styles.input} autoFocus
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Pressable onPress={() => setAddElementoOpen(false)} style={[styles.modalBtn, styles.modalBtnGhost]}>
                <Text style={styles.modalBtnGhostTxt}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={addElemento} style={[styles.modalBtn, { backgroundColor: headerColor }]}>
                <Text style={styles.modalBtnTxt}>Agregar</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: agregar/editar perforadora */}
      <Modal visible={!!perfModal} transparent animationType="slide" onRequestClose={() => setPerfModal(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{perfModal === 'nueva' ? 'Nueva perforadora' : 'Editar perforadora'}</Text>
            <Text style={styles.fieldLabel}>Nombre</Text>
            <TextInput value={perfDraft.nombre} onChangeText={(t) => setPerfDraft((d) => ({ ...d, nombre: t }))} style={styles.input} />
            <Text style={styles.fieldLabel}>Serie</Text>
            <TextInput value={perfDraft.serie} onChangeText={(t) => setPerfDraft((d) => ({ ...d, serie: t }))} style={styles.input} />
            <Text style={styles.fieldLabel}>Ubicación</Text>
            <TextInput
              value={perfDraft.ubicacion} onChangeText={(t) => setPerfDraft((d) => ({ ...d, ubicacion: t }))}
              placeholder="Ej. Cerca del poste C1" placeholderTextColor={colors.textMuted} style={styles.input}
            />
            <Text style={styles.fieldLabel}>Estatus</Text>
            <TextInput
              value={perfDraft.estatus} onChangeText={(t) => setPerfDraft((d) => ({ ...d, estatus: t }))}
              placeholder="Ej. Activa, Mantenimiento" placeholderTextColor={colors.textMuted} style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Pressable onPress={() => setPerfModal(null)} disabled={perfSaving} style={[styles.modalBtn, styles.modalBtnGhost]}>
                <Text style={styles.modalBtnGhostTxt}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={savePerforadora} disabled={perfSaving} style={[styles.modalBtn, { backgroundColor: headerColor }]}>
                {perfSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.modalBtnTxt}>Guardar</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleBar: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },

  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabTxt: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },

  scroll: { padding: spacing.md, gap: spacing.md },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 24, fontStyle: 'italic' },

  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg, marginBottom: spacing.sm, flexWrap: 'wrap' },
  heroPct: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  heroNum: { fontSize: 44, fontWeight: '800' },
  heroPctSign: { fontSize: 18, fontWeight: '700' },
  heroLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 6, fontWeight: '600' },
  kpiTxt: { fontSize: 11, color: colors.textMuted, marginTop: 6, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },

  progressTrack: { height: 9, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  progressTrackSm: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: '100%', borderRadius: 5 },

  sectionLabel: { fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 4 },

  cardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: spacing.md },
  stationCard: {
    flexGrow: 1, minWidth: 150, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.md, padding: 12, gap: 4,
  },
  stationName: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  stationCount: { fontSize: 10.5, color: colors.textMuted },
  stationPct: { fontSize: 15, fontWeight: '800', marginTop: 2 },

  detailCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadow.card, gap: 10 },
  detailHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  detailTitle: { fontSize: 16, fontWeight: '800', color: colors.text },

  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnTxt: { fontSize: 12, fontWeight: '700' },

  posteTable: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' },
  posteHeaderRow: { flexDirection: 'row' },
  posteHeaderCell: { flex: 1, fontSize: 10.5, fontWeight: '800', color: colors.text, textAlign: 'center', paddingVertical: 8 },
  posteIdCol: { flex: 0.7 },
  posteRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border },
  posteRowAlert: { backgroundColor: '#8F48891A' },
  posteIdCell: { flex: 0.7, fontSize: 12, fontWeight: '700', color: colors.text, textAlignVertical: 'center', paddingLeft: 8, paddingVertical: 10 },
  posteCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderLeftWidth: 1, borderLeftColor: colors.border },
  posteDot: { width: 14, height: 14, borderRadius: 7 },

  legendRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendTxt: { fontSize: 10.5, color: colors.textBody, fontWeight: '600' },
  hintTxt: { fontSize: 11, color: colors.textMuted, textAlign: 'center' },

  elementoCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, gap: 8, backgroundColor: colors.bg },
  elementoHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  elementoName: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  elementoPct: { fontSize: 12, fontWeight: '800' },
  elementoFieldsRow: { flexDirection: 'row', gap: 8 },
  elementoFieldLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  elementoFieldInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6,
    fontSize: 13, color: colors.text, backgroundColor: colors.surface, textAlign: 'center',
  },
  saveBtn: { alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm },
  saveBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },

  perfCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12,
  },
  perfName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  perfMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  perfEstatus: { fontSize: 11, fontWeight: '700', marginTop: 4 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.text, backgroundColor: colors.bg,
  },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  modalBtnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  modalBtnGhostTxt: { color: colors.text, fontWeight: '700', fontSize: 13 },
  modalBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
