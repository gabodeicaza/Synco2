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
import { api, ApiError, Invitation, Area } from '@/src/api';
import { colors, radius, spacing, shadow } from '@/src/theme';
import { roleLabel, ROLE_SUB, ROLE_ESP, ROLE_JEFE } from '@/src/utils/roles';
import { confirm, notify } from '@/src/utils/confirm';
import { ImportarInvitacionesModal } from '@/src/components/ImportarInvitacionesModal';
import { t } from '@/src/i18n';

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
  const [search, setSearch] = useState('');

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(0);
  const [role, setRole] = useState<WizardRole>('especialista');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [puesto, setPuesto] = useState('');
  const [noControl, setNoControl] = useState('');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [wizardErr, setWizardErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const wizardScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (wizardOpen) {
      wizardScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [step, wizardOpen]);

  const [areas, setAreas] = useState<Area[]>([]);
  const [createdInvite, setCreatedInvite] = useState<Invitation | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [items, a] = await Promise.all([api.listInvitations(pid), api.listAreas(pid)]);
      setInvitations(items || []);
      setAreas(a || []);
    } catch (e: any) {
      setError(e?.message || 'Error al cargar invitaciones');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filteredInvitations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invitations;
    return invitations.filter((inv) =>
      inv.name.toLowerCase().includes(q) || inv.email.toLowerCase().includes(q)
    );
  }, [invitations, search]);

  const groupedInvitations = useMemo(() => {
    const NO_AREA_LABEL = 'Obra Civil';
    const map = new Map<string, { areaName: string; items: Invitation[] }>();
    for (const inv of filteredInvitations) {
      const key = inv.area_id || '_sin_area';
      let group = map.get(key);
      if (!group) {
        const areaName = inv.area_id
          ? areas.find((a) => a.id === inv.area_id)?.name || 'Area desconocida'
          : NO_AREA_LABEL;
        group = { areaName, items: [] };
        map.set(key, group);
      }
      group.items.push(inv);
    }
    return Array.from(map.values()).sort((a, b) => a.areaName.localeCompare(b.areaName, 'es'));
  }, [filteredInvitations, areas]);

  async function openWizard() {
    setStep(0); setRole('especialista');
    setName(''); setEmail(''); setPuesto(''); setNoControl('');
    setAreaId(null);
    setWizardErr(null); setWizardOpen(true);
    try {
      const a = await api.listAreas(pid);
      setAreas(a || []);
    } catch {}
  }

  const wizardCanProceed = useMemo(() => {
    if (step === 0) return true;
    if (step === 1) return name.trim().length > 0 && email.trim().length > 0;
    if (step === 2) {
      if (role === ROLE_ESP) return !!areaId;
      return true;
    }
    return true;
  }, [step, role, name, email, areaId]);

  function next() {
    setWizardErr(null);
    if (step === 0) setStep(1);
    else if (step === 1) {
      if (!name.trim()) return setWizardErr('Ingresa el nombre');
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setWizardErr('Correo no válido');
      role === ROLE_JEFE ? setStep(3) : setStep(2);
    } else if (step === 2) {
      if (role === ROLE_ESP && !areaId) return setWizardErr('Selecciona el área');
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
        no_control: noControl.trim() || null,
        area_id: areaId,
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
    const msg = t('marca.invitacion', { nombre: inv.name, enlace: url, token: inv.token });
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
  const [editNoControl, setEditNoControl] = useState('');
  const [editAreaId, setEditAreaId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  function openEdit(inv: Invitation) {
    setEditTarget(inv);
    setEditName(inv.name);
    setEditEmail(inv.email);
    setEditPuesto(inv.puesto || '');
    setEditNoControl(inv.no_control || '');
    setEditAreaId(inv.area_id || null);
  }

  async function saveEdit() {
    if (!editTarget?.accepted_user_id || editSaving) return;
    const name = editName.trim();
    const email = editEmail.trim().toLowerCase();
    if (!name) return Alert.alert('Campo requerido', 'Ingresa el nombre');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Alert.alert('Correo inválido', 'Ingresa un correo válido');
    if (editTarget.role === ROLE_ESP && !editAreaId) return Alert.alert('Campo requerido', 'Selecciona el área');
    try {
      setEditSaving(true);
      await api.updateTeamMember(pid, editTarget.accepted_user_id, {
        name,
        email,
        puesto: editTarget.role === ROLE_ESP ? (editPuesto.trim() || undefined) : undefined,
        no_control: editNoControl.trim() || undefined,
        area_id: editAreaId || '',
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

  async function resetPassword() {
    if (!editTarget?.accepted_user_id || resettingPassword) return;
    const ok = await confirm(
      'Restablecer contraseña',
      `Se generará una contraseña temporal nueva para ${editTarget.name}. La contraseña anterior dejará de funcionar. ¿Continuar?`,
    );
    if (!ok) return;
    try {
      setResettingPassword(true);
      const res = await api.resetTeamMemberPassword(pid, editTarget.accepted_user_id);
      setTempPassword(res.temp_password);
    } catch (e: any) {
      Alert.alert('No se pudo restablecer', e?.message || 'Intentalo nuevamente.');
    } finally {
      setResettingPassword(false);
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
          <Pressable onPress={() => setBulkImportOpen(true)} hitSlop={8} style={styles.importHeaderBtn}>
            <Ionicons name="document-attach-outline" size={16} color={colors.primary} />
            <Text style={styles.importHeaderBtnTxt}>Importar Excel</Text>
          </Pressable>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar por nombre o correo..."
            style={styles.searchInput}
            autoCapitalize="none"
          />
          {!!search && (
            <Pressable onPress={() => setSearch('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <ScrollView
          style={styles.flex1}
          contentContainerStyle={{ flexGrow: 1, padding: spacing.md, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : groupedInvitations.length === 0 ? (
            <Text style={styles.emptyText}>
              {search ? `Sin resultados para "${search}"` : 'Aun no hay invitaciones.'}
            </Text>
          ) : groupedInvitations.map((group) => (
            <View key={group.areaName} style={styles.group}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupHeaderText}>{group.areaName}</Text>
                <View style={styles.groupBadge}>
                  <Text style={styles.groupBadgeText}>{group.items.length}</Text>
                </View>
              </View>
              {group.items.map((inv) => (
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
            </View>
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
                  step === 1 ? (
                    <StepIdentity
                      name={name} setName={setName} email={email} setEmail={setEmail}
                      role={role} puesto={puesto} setPuesto={setPuesto}
                      noControl={noControl} setNoControl={setNoControl}
                    />
                  ) :
                  step === 2 ? <StepArea role={role} areas={areas} areaId={areaId} onArea={setAreaId} /> :
                  <StepReview role={role} name={name} email={email} areas={areas} areaId={areaId} />}

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

              <Text style={styles.label}>No. de Control (opcional)</Text>
              <TextInput value={editNoControl} onChangeText={setEditNoControl} style={styles.inputSimple} placeholder="No. de Control" />

              {(editTarget?.role === ROLE_ESP || editTarget?.role === ROLE_SUB) && (
                <>
                  <Text style={styles.label}>Área {editTarget?.role === ROLE_SUB ? '(opcional)' : ''}</Text>
                  <View style={styles.areaRow}>
                    {editTarget?.role === ROLE_SUB && (
                      <Pressable onPress={() => setEditAreaId(null)} style={[styles.areaPill, !editAreaId && styles.areaPillOn]}>
                        <Text>Obra Civil</Text>
                      </Pressable>
                    )}
                    {areas.map((a) => (
                      <Pressable key={a.id} onPress={() => setEditAreaId(a.id)} style={[styles.areaPill, editAreaId === a.id && styles.areaPillOn]}>
                        <Text>{a.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <View style={{ marginTop: 20 }}>
                <Button label="Guardar cambios" fullWidth onPress={saveEdit} loading={editSaving} />
              </View>

              <Pressable onPress={resetPassword} style={styles.resetPasswordBtn} disabled={resettingPassword}>
                {resettingPassword ? <ActivityIndicator color={colors.error} /> : (
                  <>
                    <Ionicons name="key-outline" size={16} color={colors.error} />
                    <Text style={styles.resetPasswordBtnTxt}>Restablecer contraseña</Text>
                  </>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={!!tempPassword} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.successCard}>
            <Ionicons name="key" size={48} color={colors.primary} />
            <Text style={styles.successTitle}>Contraseña nueva</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 10 }}>
              Compártesela a {editTarget?.name}. Solo se muestra una vez.
            </Text>
            <View style={styles.tokenBox}>
              <Text style={styles.tokenLabel}>CONTRASEÑA TEMPORAL</Text>
              <Text selectable style={styles.tokenValueText}>{tempPassword}</Text>
            </View>
            <Pressable
              style={styles.actionPill}
              onPress={async () => { if (tempPassword) { await Clipboard.setStringAsync(tempPassword); notify('Copiado', 'Contraseña copiada'); } }}
            >
              <Ionicons name="copy-outline" size={16} color={colors.primary} />
              <Text style={styles.actionPillText}>Copiar</Text>
            </Pressable>
            <View style={{ marginTop: 16, width: '100%' }}>
              <Button label="Cerrar" fullWidth onPress={() => setTempPassword(null)} />
            </View>
          </View>
        </View>
      </Modal>

      <ImportarInvitacionesModal
        visible={bulkImportOpen}
        projectId={pid}
        onClose={() => setBulkImportOpen(false)}
        onImported={load}
      />
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

function StepIdentity({ name, setName, email, setEmail, role, puesto, setPuesto, noControl, setNoControl }: any) {
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.stepTitle}>Datos básicos</Text>
      <TextInput value={name} onChangeText={setName} style={styles.inputSimple} placeholder="Nombre completo" />
      <TextInput value={email} onChangeText={setEmail} style={styles.inputSimple} placeholder="Correo electrónico" keyboardType="email-address" autoCapitalize="none" />
      {role === ROLE_ESP && <TextInput value={puesto} onChangeText={setPuesto} style={styles.inputSimple} placeholder="Puesto" />}
      <TextInput value={noControl} onChangeText={setNoControl} style={styles.inputSimple} placeholder="No. de Control (opcional)" />
    </View>
  );
}

function StepArea({ role, areas, areaId, onArea }: any) {
  return (
    <View style={{ gap: 15 }}>
      <Text style={styles.stepTitle}>Área / Disciplina</Text>
      <Text style={styles.label}>{role === ROLE_ESP ? 'Selecciona el área' : 'Selecciona el área (opcional)'}</Text>
      <View style={styles.areaRow}>
        {role === ROLE_SUB && (
          <Pressable onPress={() => onArea(null)} style={[styles.areaPill, !areaId && styles.areaPillOn]}><Text>Obra Civil</Text></Pressable>
        )}
        {areas.map((a: any) => (
          <Pressable key={a.id} onPress={() => onArea(a.id)} style={[styles.areaPill, areaId === a.id && styles.areaPillOn]}><Text>{a.name}</Text></Pressable>
        ))}
      </View>
    </View>
  );
}

function StepReview({ name, email, role, areas, areaId }: any) {
  const areaName = areas.find((a: any) => a.id === areaId)?.name || 'Obra Civil';

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.stepTitle}>Resumen</Text>
      <View style={styles.reviewCard}>
        <ReviewRow label="Nombre" value={name} />
        <ReviewRow label="Correo" value={email} />
        <ReviewRow label="Rol" value={roleLabel(role)} />
        {role !== ROLE_JEFE && <ReviewRow label="Área" value={areaName} />}
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
        {!!inv.no_control && <Text style={styles.tokenInline}>No. Control: {inv.no_control}</Text>}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'white' },
  flex1: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 18, fontWeight: '900' },
  subtitle: { fontSize: 12, color: colors.textMuted },
  iconBtn: { padding: 5, marginRight: 10 },
  importHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  importHeaderBtnTxt: { fontSize: 11, fontWeight: '800', color: colors.primary },

  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.md, marginTop: spacing.sm, paddingHorizontal: 12, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },

  group: { marginBottom: spacing.md, gap: 8 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 2 },
  groupHeaderText: { fontSize: 13, fontWeight: '800', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  groupBadge: { backgroundColor: colors.primaryLight, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, minWidth: 24, alignItems: 'center' },
  groupBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },
  emptyText: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontStyle: 'italic' },

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

  resetPasswordBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 8 },
  resetPasswordBtnTxt: { fontSize: 13, fontWeight: '700', color: colors.error },

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
