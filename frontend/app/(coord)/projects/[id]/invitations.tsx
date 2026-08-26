import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
  Modal, TextInput, KeyboardAvoidingView, Platform, RefreshControl, Share,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Button } from '@/src/components/Button';
import { api, ApiError, Invitation, LocationNodeTree, Area } from '@/src/api';
import { colors, radius, spacing, shadow } from '@/src/theme';
import { roleLabel, ROLE_SUB, ROLE_ESP, ROLE_JEFE } from '@/src/utils/roles';
import { confirm, notify } from '@/src/utils/confirm';

type WizardStep = 0 | 1 | 2 | 3;
type WizardRole = 'sub_coordinador' | 'especialista' | 'jefe_proyecto';

export default function InvitationsScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = (Array.isArray(id) ? id[0] : id) || '';

  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(0);
  const [role, setRole] = useState<WizardRole>('especialista');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [puesto, setPuesto] = useState('');
  const [scopeNodeId, setScopeNodeId] = useState<string | null>(null);
  const [scopeNodeIds, setScopeNodeIds] = useState<string[]>([]);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [wizardErr, setWizardErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const wizardScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (wizardOpen) {
      wizardScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [step, wizardOpen]);

  const [tree, setTree] = useState<LocationNodeTree[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [createdInvite, setCreatedInvite] = useState<Invitation | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const items = await api.listInvitations(pid);
      setInvitations(items || []);
    } catch (e: any) {
      setError(e?.message || 'Error al cargar invitaciones');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function openWizard() {
    setStep(0); setRole('especialista');
    setName(''); setEmail(''); setPuesto('');
    setScopeNodeId(null); setScopeNodeIds([]); setAreaId(null);
    setWizardErr(null); setWizardOpen(true);
    try {
      const [t, a] = await Promise.all([api.getTree(pid), api.listAreas(pid)]);
      setTree(t || []); setAreas(a || []);
    } catch {}
  }

  const wizardCanProceed = useMemo(() => {
    if (step === 0) return true;
    if (step === 1) return name.trim().length > 0 && email.trim().length > 0;
    if (step === 2) {
      if (role === ROLE_JEFE) return true;
      if (role === ROLE_SUB) return !!scopeNodeId;
      if (role === ROLE_ESP) return !!areaId && scopeNodeIds.length > 0;
    }
    return true;
  }, [step, role, name, email, scopeNodeId, scopeNodeIds, areaId]);

  function next() {
    setWizardErr(null);
    if (step === 0) setStep(1);
    else if (step === 1) {
      if (!name.trim()) return setWizardErr('Ingresa el nombre');
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setWizardErr('Correo no válido');
      role === ROLE_JEFE ? setStep(3) : setStep(2);
    } else if (step === 2) {
      if (role === ROLE_SUB && !scopeNodeId) return setWizardErr('Selecciona el nodo');
      if (role === ROLE_ESP) {
        if (!areaId) return setWizardErr('Selecciona el área');
        if (scopeNodeIds.length === 0) return setWizardErr('Selecciona al menos un nodo');
      }
      setStep(3);
    }
  }

  function back() {
    setWizardErr(null);
    if (step === 3 && role === ROLE_JEFE) setStep(1);
    else setStep((s) => (s > 0 ? ((s - 1) as WizardStep) : s));
  }

  async function submitInvite() {
    setWizardErr(null);
    setSubmitting(true);
    try {
      const body: any = {
        project_id: pid,
        email: email.trim().toLowerCase(),
        name: name.trim(),
        role,
        puesto: role === ROLE_ESP ? (puesto.trim() || null) : null,
        area_id: areaId,
        scope_node_id: role === ROLE_SUB ? scopeNodeId : null,
        scope_node_ids: role === ROLE_ESP ? scopeNodeIds : [],
      };
      const inv: any = await api.createInvitation(pid, body);
      setWizardOpen(false);
      if (inv && inv.status === 'auto_linked') {
        await load();
        Alert.alert('Usuario vinculado');
      } else {
        setCreatedInvite(inv);
        await load();
      }
    } catch (e: any) {
      setWizardErr(e?.message || 'Error al crear');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToken(token: string) {
    await Clipboard.setStringAsync(token);
    notify('Copiado', 'Token copiado');
  }

  async function copyLink(token: string) {
    const url = `https://apm-app.mx/invite/${token}`;
    await Clipboard.setStringAsync(url);
    notify('Copiado', 'Enlace copiado');
  }

  async function shareInvite(inv: Invitation) {
    const url = `https://apm-app.mx/invite/${inv.token}`;
    const msg = `Hola ${inv.name}, te invito a SynCo.\nEnlace: ${url}\nToken: ${inv.token}`;
    try { await Share.share({ message: msg }); } catch {}
  }

  async function revoke(inv: Invitation) {
    const ok = await confirm('Revocar', '¿Revocar invitación?', { destructive: true });
    if (!ok) return;
    try { await api.revokeInvitation(inv.id); await load(); }
    catch (e: any) { Alert.alert('Error', e?.message); }
  }

  // === Edición / baja de miembros ya aceptados (Sub-coordinador / Especialista) ===
  const [editTarget, setEditTarget] = useState<Invitation | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPuesto, setEditPuesto] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  function openEdit(inv: Invitation) {
    setEditTarget(inv);
    setEditName(inv.name);
    setEditEmail(inv.email);
    setEditPuesto(inv.puesto || '');
  }

  async function saveEdit() {
    if (!editTarget?.accepted_user_id || editSaving) return;
    const name = editName.trim();
    const email = editEmail.trim().toLowerCase();
    if (!name) return Alert.alert('Campo requerido', 'Ingresa el nombre');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Alert.alert('Correo inválido', 'Ingresa un correo válido');
    try {
      setEditSaving(true);
      await api.updateTeamMember(pid, editTarget.accepted_user_id, {
        name,
        email,
        puesto: editTarget.role === ROLE_ESP ? (editPuesto.trim() || undefined) : undefined,
      });
      setEditTarget(null);
      await load();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) {
        Alert.alert('Correo duplicado', 'Ya existe un usuario con ese correo.');
      } else {
        Alert.alert('No se pudo guardar', e?.message || 'Intentalo nuevamente.');
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function removeMember(inv: Invitation) {
    if (!inv.accepted_user_id) return;
    const ok = await confirm(
      'Sacar del proyecto',
      `¿Quitar a ${inv.name} del proyecto? Perderá acceso a la app de inmediato.`,
      { confirmText: 'Sacar', destructive: true },
    );
    if (!ok) return;
    try {
      await api.removeTeamMember(pid, inv.accepted_user_id);
      await load();
    } catch (e: any) {
      Alert.alert('No se pudo quitar', e?.message || 'Intentalo nuevamente.');
    }
  }

  return (
    <View style={styles.root}>
      <View style={[styles.flex1, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Invitaciones</Text>
            <Text style={styles.subtitle}>{invitations.length} en total</Text>
          </View>
        </View>

        <ScrollView
          style={styles.flex1}
          contentContainerStyle={{ flexGrow: 1, padding: spacing.md, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : invitations.map((inv) => (
            <InviteCard
              key={inv.id}
              inv={inv}
              onCopyToken={() => copyToken(inv.token)}
              onCopyLink={() => copyLink(inv.token)}
              onShare={() => shareInvite(inv)}
              onRevoke={() => revoke(inv)}
              onEdit={() => openEdit(inv)}
              onRemove={() => removeMember(inv)}
            />
          ))}
        </ScrollView>

        <Pressable style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={openWizard}>
          <Ionicons name="add" size={26} color={colors.textInverse} />
          <Text style={styles.fabText}>Nueva invitación</Text>
        </Pressable>
      </View>

      <Modal visible={wizardOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1}>
            <View style={[styles.modalCard, { height: windowHeight * 0.9, marginTop: windowHeight * 0.1 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Nueva invitación - Paso {step + 1}</Text>
                <Pressable onPress={() => setWizardOpen(false)} hitSlop={15}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
              </View>

              <View style={styles.flex1}>
                <ScrollView
                  ref={wizardScrollRef}
                  style={styles.flex1}
                  contentContainerStyle={{ flexGrow: 1, padding: spacing.lg }}
                  keyboardShouldPersistTaps="handled"
                >
                  {step === 0 ? <StepRole role={role} onChange={setRole} /> :
                  step === 1 ? <StepIdentity name={name} setName={setName} email={email} setEmail={setEmail} role={role} puesto={puesto} setPuesto={setPuesto} /> :
                  step === 2 ? (
                    role === ROLE_SUB ? <StepScopeSingle tree={tree} selected={scopeNodeId} onSelect={setScopeNodeId} areas={areas} areaId={areaId} onArea={setAreaId} /> :
                    <StepScopeMulti tree={tree} areas={areas} areaId={areaId} onArea={setAreaId} selected={scopeNodeIds} onToggle={(id) => setScopeNodeIds(arr => arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id])} />
                  ) : <StepReview role={role} name={name} email={email} areas={areas} areaId={areaId} scopeNodeId={scopeNodeId} scopeNodeIds={scopeNodeIds} tree={tree} />}

                  {wizardErr && <Text style={styles.errorTextInline}>{wizardErr}</Text>}
                </ScrollView>
              </View>

              <View style={[styles.wizardActions, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                {step > 0 && (
                  <Pressable onPress={back} style={styles.backBtn}><Text style={styles.backText}>Atrás</Text></Pressable>
                )}
                <Button
                  label={step === 3 ? "Generar" : "Continuar"}
                  onPress={step === 3 ? submitInvite : next}
                  loading={submitting}
                  disabled={!wizardCanProceed}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={!!createdInvite} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.successCard}>
            <Ionicons name="checkmark-circle" size={60} color={colors.success} />
            <Text style={styles.successTitle}>¡Listo!</Text>
            <View style={styles.tokenBox}>
              <Text style={styles.tokenLabel}>TOKEN</Text>
              <Text selectable style={styles.tokenValueText}>{createdInvite?.token}</Text>
            </View>

            <View style={styles.successActions}>
              <Pressable style={styles.actionPill} onPress={() => createdInvite && copyToken(createdInvite.token)}>
                <Ionicons name="copy-outline" size={16} color={colors.primary} />
                <Text style={styles.actionPillText}>Token</Text>
              </Pressable>
              <Pressable style={styles.actionPill} onPress={() => createdInvite && shareInvite(createdInvite)}>
                <Ionicons name="share-social-outline" size={16} color={colors.primary} />
                <Text style={styles.actionPillText}>Compartir</Text>
              </Pressable>
            </View>

            <Button label="Cerrar" fullWidth onPress={() => setCreatedInvite(null)} />
          </View>
        </View>
      </Modal>

      <Modal visible={!!editTarget} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1} pointerEvents="box-none">
            <View style={styles.editCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Editar {editTarget ? roleLabel(editTarget.role) : ''}</Text>
                <Pressable onPress={() => setEditTarget(null)} hitSlop={15}>
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              <Text style={styles.label}>Nombre completo</Text>
              <TextInput value={editName} onChangeText={setEditName} style={styles.inputSimple} placeholder="Nombre completo" />

              <Text style={styles.label}>Correo electrónico</Text>
              <TextInput
                value={editEmail}
                onChangeText={setEditEmail}
                style={styles.inputSimple}
                placeholder="Correo electrónico"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              {editTarget?.role === ROLE_ESP && (
                <>
                  <Text style={styles.label}>Puesto</Text>
                  <TextInput value={editPuesto} onChangeText={setEditPuesto} style={styles.inputSimple} placeholder="Puesto" />
                </>
              )}

              <View style={{ marginTop: 20 }}>
                <Button label="Guardar cambios" fullWidth onPress={saveEdit} loading={editSaving} />
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function StepRole({ role, onChange }: any) {
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.stepTitle}>Selecciona el rol</Text>
      {[ROLE_ESP, ROLE_SUB, ROLE_JEFE].map((r) => (
        <Pressable key={r} onPress={() => onChange(r)} style={[styles.roleCard, role === r && styles.roleCardOn]}>
          <View>
            <Text style={styles.roleTitle}>{roleLabel(r)}</Text>
            <Text style={styles.roleDesc}>{r === ROLE_ESP ? 'Captura mediciones' : r === ROLE_SUB ? 'Supervisa tramos' : 'Solo lectura global'}</Text>
          </View>
          {role === r && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
        </Pressable>
      ))}
    </View>
  );
}

function StepIdentity({ name, setName, email, setEmail, role, puesto, setPuesto }: any) {
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.stepTitle}>Datos básicos</Text>
      <TextInput value={name} onChangeText={setName} style={styles.inputSimple} placeholder="Nombre completo" />
      <TextInput value={email} onChangeText={setEmail} style={styles.inputSimple} placeholder="Correo electrónico" keyboardType="email-address" autoCapitalize="none" />
      {role === ROLE_ESP && <TextInput value={puesto} onChangeText={setPuesto} style={styles.inputSimple} placeholder="Puesto" />}
    </View>
  );
}

function StepScopeSingle({ tree, selected, onSelect, areas, areaId, onArea }: any) {
  return (
    <View style={{ gap: 15 }}>
      <Text style={styles.stepTitle}>Área y Alcance</Text>
      <Text style={styles.label}>1. Selecciona la Disciplina (Área)</Text>
      <View style={styles.areaRow}>
        <Pressable onPress={() => onArea(null)} style={[styles.areaPill, !areaId && styles.areaPillOn]}><Text>Obra Civil</Text></Pressable>
        {areas.map((a: any) => (
          <Pressable key={a.id} onPress={() => onArea(a.id)} style={[styles.areaPill, areaId === a.id && styles.areaPillOn]}><Text>{a.name}</Text></Pressable>
        ))}
      </View>
      <Text style={styles.label}>2. Selecciona el Nodo de alcance</Text>
      <View style={styles.treeBox}>
        {tree.map((n: any) => <TreeRow key={n.id} node={n} selected={selected} onSelect={onSelect} mode="single" />)}
      </View>
    </View>
  );
}

function StepScopeMulti({ tree, areas, areaId, onArea, selected, onToggle }: any) {
  return (
    <View style={{ gap: 15 }}>
      <Text style={styles.stepTitle}>Área y Alcance</Text>
      <Text style={styles.label}>1. Selecciona la Disciplina (Área)</Text>
      <View style={styles.areaRow}>
        {areas.map((a: any) => (
          <Pressable key={a.id} onPress={() => onArea(a.id)} style={[styles.areaPill, areaId === a.id && styles.areaPillOn]}><Text>{a.name}</Text></Pressable>
        ))}
      </View>
      <Text style={styles.label}>2. Selecciona los Nodos hoja ({selected.length})</Text>
      <View style={styles.treeBox}>
        {tree.map((n: any) => <TreeRow key={n.id} node={n} onlyLeavesSelectable selected={selected} onSelect={onToggle} mode="multi" />)}
      </View>
    </View>
  );
}

function StepReview({ name, email, role, areas, areaId, scopeNodeId, scopeNodeIds, tree }: any) {
  const allNodes = flattenTree(tree);
  const areaName = areas.find((a: any) => a.id === areaId)?.name || 'Obra Civil';
  const scopeNodeName = scopeNodeId ? allNodes.find((n) => n.id === scopeNodeId)?.name : null;

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.stepTitle}>Resumen</Text>
      <View style={styles.reviewCard}>
        <ReviewRow label="Nombre" value={name} />
        <ReviewRow label="Correo" value={email} />
        <ReviewRow label="Rol" value={roleLabel(role)} />
        <ReviewRow label="Área" value={areaName} />
        {scopeNodeName && <ReviewRow label="Alcance" value={scopeNodeName} />}
        {scopeNodeIds.length > 0 && <ReviewRow label="Nodos" value={`${scopeNodeIds.length} seleccionados`} />}
      </View>
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}:</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

function TreeRow({ node, selected, onSelect, mode, onlyLeavesSelectable, depth = 0 }: any) {
  const isLeaf = !node.children || node.children.length === 0;
  const isSelectable = (!onlyLeavesSelectable || isLeaf);
  const isSelected = mode === 'multi' ? selected.includes(node.id) : selected === node.id;
  const indent = Math.min(depth, 6) * 14;

  return (
    <View>
      <Pressable
        disabled={!isSelectable}
        onPress={() => onSelect(node.id)}
        style={[
          styles.treeRow,
          { paddingLeft: indent + 10 },
          isSelected && styles.treeRowOn,
          !isSelectable && { opacity: 0.4 }
        ]}
      >
        <Ionicons
          name={isSelected ? (mode === 'multi' ? "checkbox" : "radio-button-on") : (mode === 'multi' ? "square-outline" : "radio-button-off")}
          size={18}
          color={isSelected ? colors.primary : colors.textMuted}
        />
        <Ionicons
          name={isLeaf ? 'flag' : 'folder-outline'}
          size={14}
          color={isLeaf ? colors.primary : colors.textBody}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.treeName} numberOfLines={1}>
            {node.name}
          </Text>
        </View>
      </Pressable>
      {node.children?.map((c: any) => (
        <TreeRow
          key={c.id}
          node={c}
          selected={selected}
          onSelect={onSelect}
          mode={mode}
          onlyLeavesSelectable={onlyLeavesSelectable}
          depth={depth + 1}
        />
      ))}
    </View>
  );
}

function InviteCard({ inv, onCopyToken, onCopyLink, onShare, onRevoke, onEdit, onRemove }: any) {
  const isPending = inv.status === 'pending';
  const isAccepted = inv.status === 'accepted' && !!inv.accepted_user_id;
  return (
    <View style={styles.inviteCard}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '800' }}>{inv.name}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>{inv.email} • {roleLabel(inv.role)}</Text>
        {isPending && <Text style={styles.tokenInline}>Token: {inv.token}</Text>}
        {isAccepted && !!inv.puesto && <Text style={styles.tokenInline}>Puesto: {inv.puesto}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 10 }}>
        <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '800' }}>{inv.status.toUpperCase()}</Text>
        {isPending && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={onCopyToken}><Ionicons name="copy-outline" size={18} color={colors.primary} /></Pressable>
            <Pressable onPress={onShare}><Ionicons name="share-social-outline" size={18} color={colors.primary} /></Pressable>
            <Pressable onPress={onRevoke}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
          </View>
        )}
        {isAccepted && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={onEdit}><Ionicons name="create-outline" size={18} color={colors.primary} /></Pressable>
            <Pressable onPress={onRemove}><Ionicons name="person-remove-outline" size={18} color={colors.error} /></Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function flattenTree(tree: LocationNodeTree[]): LocationNodeTree[] {
  const out: LocationNodeTree[] = [];
  function walk(ns: LocationNodeTree[]) { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }
  walk(tree); return out;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'white' },
  flex1: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 18, fontWeight: '900' },
  subtitle: { fontSize: 12, color: colors.textMuted },
  iconBtn: { padding: 5, marginRight: 10 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: 16, fontWeight: '800' },

  stepTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginTop: 5 },

  inputSimple: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12, fontSize: 16 },

  roleCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: '#f9f9f9', marginBottom: 8 },
  roleCardOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight + '20' },
  roleTitle: { fontWeight: '700' },
  roleDesc: { fontSize: 12, color: colors.textMuted },

  areaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 5 },
  areaPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: '#eee' },
  areaPillOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight, borderWidth: 2 },

  treeBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, marginTop: 10, overflow: 'hidden' },
  treeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border, gap: 10 },
  treeRowOn: { backgroundColor: colors.primaryLight + '15' },
  treeName: { fontSize: 14, fontWeight: '600' },

  wizardActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: 'white' },
  backBtn: { padding: 10 },
  backText: { fontWeight: '700', color: colors.textMuted },

  errorTextInline: { color: colors.error, fontWeight: '700', marginTop: 10 },

  fab: { position: 'absolute', right: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 30, elevation: 5 },
  fabText: { color: 'white', fontWeight: '800', marginLeft: 8 },

  inviteCard: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: 'white', borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  tokenInline: { fontSize: 11, color: colors.textMuted, marginTop: 4, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },

  reviewCard: { padding: 15, backgroundColor: '#f9f9f9', borderRadius: 10, gap: 5 },
  reviewRow: { flexDirection: 'row', gap: 8 },
  reviewLabel: { fontWeight: '700', color: colors.textMuted, width: 70 },
  reviewValue: { flex: 1, fontWeight: '600' },

  editCard: { backgroundColor: 'white', padding: 20, borderRadius: 16, width: '88%', alignSelf: 'center', marginBottom: 'auto', marginTop: 'auto' },

  successCard: { backgroundColor: 'white', padding: 30, borderRadius: 20, alignItems: 'center', width: '85%', alignSelf: 'center', marginBottom: 'auto', marginTop: 'auto' },
  successTitle: { fontSize: 22, fontWeight: '900', marginVertical: 10 },
  tokenBox: { width: '100%', padding: 15, backgroundColor: '#f0f0f0', borderRadius: 12, alignItems: 'center', marginBottom: 20 },
  tokenLabel: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 1 },
  tokenValueText: { fontSize: 22, fontWeight: '900', color: colors.primary, marginTop: 5 },
  successActions: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  actionPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.primaryLight + '30', borderWidth: 1, borderColor: colors.primary },
  actionPillText: { fontWeight: '800', color: colors.primary, fontSize: 13 },
});
