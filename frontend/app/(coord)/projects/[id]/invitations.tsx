import React, { useCallback, useMemo, useState } from 'react';
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
import { api, Invitation, LocationNodeTree, Area } from '@/src/api';
import { colors, radius, spacing, shadow } from '@/src/theme';
import { roleLabel, ROLE_SUB, ROLE_ESP, ROLE_JEFE } from '@/src/utils/roles';
import { confirm, notify } from '@/src/utils/confirm';

type WizardStep = 0 | 1 | 2 | 3;
type WizardRole = 'sub_coordinador' | 'especialista' | 'jefe_proyecto';

export default function InvitationsScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.max(480, Math.floor(windowHeight * 0.92));
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

  // Resources for the wizard
  const [tree, setTree] = useState<LocationNodeTree[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);

  // Created token modal
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
    // Preload tree & areas
    try {
      const [t, a] = await Promise.all([api.getTree(pid), api.listAreas(pid)]);
      setTree(t || []); setAreas(a || []);
    } catch {}
  }

  function next() {
    setWizardErr(null);
    if (step === 0) {
      setStep(1);
    } else if (step === 1) {
      if (!name.trim()) return setWizardErr('Ingresa el nombre');
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setWizardErr('Correo no válido');
      // Jefe de Proyecto tiene acceso global → saltar el step de scope
      if (role === ROLE_JEFE) {
        setStep(3);
      } else {
        setStep(2);
      }
    } else if (step === 2) {
      if (role === ROLE_SUB) {
        if (!scopeNodeId) return setWizardErr('Selecciona el nodo donde tendrá alcance');
      } else if (role === ROLE_ESP) {
        if (!areaId) return setWizardErr('Selecciona el área a la que pertenece el Especialista');
        if (scopeNodeIds.length === 0) return setWizardErr('Selecciona al menos un nodo hoja donde podrá registrar');
      }
      setStep(3);
    }
  }

  function back() {
    setWizardErr(null);
    if (step === 3 && role === ROLE_JEFE) {
      // Saltar el step de scope al regresar
      setStep(1);
      return;
    }
    setStep((s) => (s > 0 ? ((s - 1) as WizardStep) : s));
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
        // area_id se envía para ESP (obligatorio) y para SUB (opcional).
        // En Sub-coord define la disciplina bajo la que se agruparán sus
        // reportes en los exports ejecutivos (PDF/PPTX). Sin área: "Obra Civil".
        area_id: role === ROLE_ESP ? areaId : (role === ROLE_SUB ? areaId : null),
        scope_node_id: role === ROLE_SUB ? scopeNodeId : null,
        scope_node_ids: role === ROLE_ESP ? scopeNodeIds : [],
      };
      const inv: any = await api.createInvitation(pid, body);
      setWizardOpen(false);
      if (inv && inv.status === 'auto_linked') {
        // Usuario ya existía: fue vinculado automáticamente al proyecto sin generar token
        await load();
        Alert.alert('Usuario vinculado', inv.message || 'Usuario existente vinculado exitosamente al proyecto.');
      } else {
        setCreatedInvite(inv);
        await load();
      }
    } catch (e: any) {
      setWizardErr(e?.message || 'No se pudo crear la invitación');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToken(token: string) {
    await Clipboard.setStringAsync(token);
    notify('Copiado', 'Token copiado al portapapeles');
  }
  async function copyLink(token: string) {
    const base = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
    const url = `${base}/invite/${token}`;
    await Clipboard.setStringAsync(url);
    notify('Copiado', 'Enlace copiado al portapapeles');
  }
  async function shareInvite(inv: Invitation) {
    const base = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
    const url = `${base}/invite/${inv.token}`;
    const msg = `Hola ${inv.name}, te invito a unirte al proyecto "${inv.project_name}" en SynCo como ${roleLabel(inv.role)}.\n\nAbre este enlace o usa el token:\n${url}\n\nToken: ${inv.token}`;
    try { await Share.share({ message: msg }); } catch {}
  }
  async function revoke(inv: Invitation) {
    const ok = await confirm(
      'Revocar invitación',
      `¿Revocar la invitación de ${inv.email}? Ya no podrá ser usada.`,
      { confirmText: 'Revocar', destructive: true },
    );
    if (!ok) return;
    try { await api.revokeInvitation(inv.id); await load(); }
    catch (e: any) { Alert.alert('Error', e?.message || 'No se pudo revocar'); }
  }

  const wizardCanProceed = useMemo(() => {
    if (step === 0) return true;
    if (step === 1) return name.trim().length > 0 && email.trim().length > 0;
    if (step === 2) {
      if (role === ROLE_JEFE) return true; // El jefe no requiere scope
      if (role === ROLE_SUB) return !!scopeNodeId;
      return !!areaId && scopeNodeIds.length > 0;
    }
    return true;
  }, [step, role, name, email, scopeNodeId, scopeNodeIds, areaId]);

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
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
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 110 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : invitations.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="mail-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Sin invitaciones todavía</Text>
            <Text style={styles.emptyMsg}>
              Invita a Sub-Coordinadores (con alcance limitado a una rama del árbol) y a Especialistas (atados a un área y a los nodos hoja donde podrán capturar).
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {invitations.map((inv) => (
              <InviteCard
                key={inv.id}
                inv={inv}
                onCopyToken={() => copyToken(inv.token)}
                onCopyLink={() => copyLink(inv.token)}
                onShare={() => shareInvite(inv)}
                onRevoke={() => revoke(inv)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={openWizard}>
        <Ionicons name="add" size={26} color={colors.textInverse} />
        <Text style={styles.fabText}>Nueva invitación</Text>
      </Pressable>

      {/* Wizard */}
      <Modal visible={wizardOpen} animationType="slide" transparent onRequestClose={() => setWizardOpen(false)}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.sheetWrapper, { height: sheetHeight }]}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + spacing.md }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Nueva invitación · Paso {step + 1} de 4</Text>
                <Pressable onPress={() => setWizardOpen(false)} hitSlop={8}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
              </View>

              <View style={styles.stepDots}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={[styles.dot, step >= (i as WizardStep) && styles.dotOn]} />
                ))}
              </View>

              <ScrollView
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: spacing.md, paddingBottom: insets.bottom + spacing.lg }}
              >
                {step === 0 ? (
                  <StepRole role={role} onChange={setRole} />
                ) : step === 1 ? (
                  <StepIdentity
                    name={name} setName={setName}
                    email={email} setEmail={setEmail}
                    role={role} puesto={puesto} setPuesto={setPuesto}
                  />
                ) : step === 2 ? (
                  role === ROLE_SUB ? (
                    <StepScopeSingle
                      tree={tree}
                      selected={scopeNodeId}
                      onSelect={setScopeNodeId}
                      areas={areas}
                      areaId={areaId}
                      onArea={setAreaId}
                    />
                  ) : (
                    <StepScopeMulti
                      tree={tree}
                      areas={areas}
                      areaId={areaId}
                      onArea={setAreaId}
                      selected={scopeNodeIds}
                      onToggle={(nodeId) => setScopeNodeIds((arr) => arr.includes(nodeId) ? arr.filter((x) => x !== nodeId) : [...arr, nodeId])}
                    />
                  )
                ) : (
                  <StepReview
                    role={role} name={name} email={email} puesto={puesto}
                    tree={tree} areas={areas}
                    scopeNodeId={scopeNodeId} scopeNodeIds={scopeNodeIds} areaId={areaId}
                  />
                )}

                {wizardErr ? (
                  <View style={styles.errorBoxInline}>
                    <Ionicons name="alert-circle" size={16} color={colors.error} />
                    <Text style={styles.errorText}>{wizardErr}</Text>
                  </View>
                ) : null}

                {/* Hint inline: confirma que el usuario ya puede continuar */}
                {step === 2 && wizardCanProceed ? (
                  <View style={styles.readyHint}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    <Text style={styles.readyHintText}>
                      {role === ROLE_ESP
                        ? `${scopeNodeIds.length} nodo${scopeNodeIds.length === 1 ? '' : 's'} hoja seleccionado${scopeNodeIds.length === 1 ? '' : 's'}. Pulsa "Continuar" abajo.`
                        : 'Nodo seleccionado. Pulsa "Continuar" abajo.'}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>

              <View style={styles.wizardActions}>
                {step > 0 ? (
                  <Pressable onPress={back} style={styles.backBtn} disabled={submitting}>
                    <Ionicons name="chevron-back" size={18} color={colors.textBody} />
                    <Text style={styles.backText}>Atrás</Text>
                  </Pressable>
                ) : <View />}
                {step < 3 ? (
                  <Button
                    label={step === 2 ? 'Confirmar selección' : 'Continuar'}
                    onPress={next}
                    variant={wizardCanProceed ? 'primary' : 'secondary'}
                    disabled={!wizardCanProceed}
                    icon={step === 2 && wizardCanProceed ? <Ionicons name="checkmark" size={18} color="#fff" /> : undefined}
                  />
                ) : (
                  <Button label="Generar invitación" onPress={submitInvite} loading={submitting} />
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Token success modal */}
      <Modal visible={!!createdInvite} animationType="fade" transparent onRequestClose={() => setCreatedInvite(null)}>
        <View style={styles.successBackdrop}>
          <View style={[styles.successCard, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.successIconBox}>
              <Ionicons name="checkmark-circle" size={48} color={colors.success} />
            </View>
            <Text style={styles.successTitle}>¡Invitación generada!</Text>
            <Text style={styles.successMsg}>
              Comparte el token o el enlace con {createdInvite?.name} ({createdInvite?.email}).
            </Text>

            <View style={styles.tokenBox}>
              <Text style={styles.tokenLabel}>TOKEN</Text>
              <Text selectable style={styles.tokenValue}>{createdInvite?.token}</Text>
            </View>

            <View style={styles.successActions}>
              <Pressable style={styles.actionPill} onPress={() => createdInvite && copyToken(createdInvite.token)}>
                <Ionicons name="copy-outline" size={16} color={colors.primary} />
                <Text style={styles.actionPillText}>Copiar token</Text>
              </Pressable>
              <Pressable style={styles.actionPill} onPress={() => createdInvite && copyLink(createdInvite.token)}>
                <Ionicons name="link-outline" size={16} color={colors.primary} />
                <Text style={styles.actionPillText}>Copiar enlace</Text>
              </Pressable>
              <Pressable style={styles.actionPill} onPress={() => createdInvite && shareInvite(createdInvite)}>
                <Ionicons name="share-social-outline" size={16} color={colors.primary} />
                <Text style={styles.actionPillText}>Compartir</Text>
              </Pressable>
            </View>

            <Button label="Listo" fullWidth onPress={() => setCreatedInvite(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Invite card
// -----------------------------------------------------------------------------

function InviteCard({
  inv, onCopyToken, onCopyLink, onShare, onRevoke,
}: {
  inv: Invitation;
  onCopyToken: () => void; onCopyLink: () => void; onShare: () => void; onRevoke: () => void;
}) {
  const isPending = inv.status === 'pending';
  const isAccepted = inv.status === 'accepted';
  const statusColor = isAccepted ? colors.success : isPending ? colors.warning : colors.textMuted;
  const statusLabel = isAccepted ? 'Aceptada' : isPending ? 'Pendiente' : 'Revocada';
  const statusIcon = isAccepted ? 'checkmark-circle' : isPending ? 'time-outline' : 'close-circle';

  return (
    <View style={styles.inviteCard}>
      <View style={styles.inviteHeader}>
        <View style={[styles.roleIcon, { backgroundColor: inv.role === ROLE_ESP ? colors.primaryLight : '#FEF3C7' }]}>
          <Ionicons name={inv.role === ROLE_ESP ? 'hammer-outline' : 'shield-half-outline'} size={18} color={inv.role === ROLE_ESP ? colors.primary : '#A16207'} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.inviteName} numberOfLines={1}>{inv.name}</Text>
          <Text style={styles.inviteEmail} numberOfLines={1}>{inv.email}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
          <Ionicons name={statusIcon as any} size={12} color={statusColor} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.inviteMetaRow}>
        <View style={styles.metaPill}>
          <Ionicons name="shield-outline" size={11} color={colors.textBody} />
          <Text style={styles.metaText}>{roleLabel(inv.role)}</Text>
        </View>
        {inv.puesto ? (
          <View style={styles.metaPill}>
            <Ionicons name="briefcase-outline" size={11} color={colors.textBody} />
            <Text style={styles.metaText}>{inv.puesto}</Text>
          </View>
        ) : null}
        {inv.role === ROLE_ESP && inv.scope_node_ids?.length > 0 ? (
          <View style={styles.metaPill}>
            <Ionicons name="git-network-outline" size={11} color={colors.textBody} />
            <Text style={styles.metaText}>{inv.scope_node_ids.length} hoja{inv.scope_node_ids.length === 1 ? '' : 's'}</Text>
          </View>
        ) : null}
      </View>

      {isPending ? (
        <View style={styles.tokenRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.tokenInlineLabel}>TOKEN</Text>
            <Text selectable style={styles.tokenInlineValue} numberOfLines={1}>{inv.token}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.inviteActions}>
        {isPending ? (
          <>
            <Pressable style={styles.actionMini} onPress={onCopyToken}>
              <Ionicons name="copy-outline" size={14} color={colors.primary} />
              <Text style={styles.actionMiniText}>Token</Text>
            </Pressable>
            <Pressable style={styles.actionMini} onPress={onCopyLink}>
              <Ionicons name="link-outline" size={14} color={colors.primary} />
              <Text style={styles.actionMiniText}>Enlace</Text>
            </Pressable>
            <Pressable style={styles.actionMini} onPress={onShare}>
              <Ionicons name="share-social-outline" size={14} color={colors.primary} />
              <Text style={styles.actionMiniText}>Compartir</Text>
            </Pressable>
            <Pressable style={[styles.actionMini, { borderColor: colors.errorBg }]} onPress={onRevoke}>
              <Ionicons name="close-circle-outline" size={14} color={colors.error} />
              <Text style={[styles.actionMiniText, { color: colors.error }]}>Revocar</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Wizard steps
// -----------------------------------------------------------------------------

function StepRole({ role, onChange }: { role: WizardRole; onChange: (r: WizardRole) => void }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.stepTitle}>¿Qué rol tendrá la persona?</Text>
      <Text style={styles.stepSub}>El rol define qué puede ver y hacer en el proyecto.</Text>

      <Pressable onPress={() => onChange(ROLE_ESP)} style={[styles.roleCard, role === ROLE_ESP && styles.roleCardOn]}>
        <View style={[styles.roleIconBig, { backgroundColor: colors.primaryLight }]}>
          <Ionicons name="hammer" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.roleTitle}>Especialista</Text>
          <Text style={styles.roleDesc}>Captura mediciones en los nodos hoja que le asignes. Atado a un área (disciplina).</Text>
        </View>
        {role === ROLE_ESP ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
      </Pressable>

      <Pressable onPress={() => onChange(ROLE_SUB)} style={[styles.roleCard, role === ROLE_SUB && styles.roleCardOn]}>
        <View style={[styles.roleIconBig, { backgroundColor: '#FEF3C7' }]}>
          <Ionicons name="shield-half" size={22} color="#A16207" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.roleTitle}>Sub-Coordinador</Text>
          <Text style={styles.roleDesc}>Supervisa una rama específica del árbol (tramo o sección). Su alcance se limita al nodo que le asignes.</Text>
        </View>
        {role === ROLE_SUB ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
      </Pressable>

      <Pressable onPress={() => onChange(ROLE_JEFE)} style={[styles.roleCard, role === ROLE_JEFE && styles.roleCardOn]}>
        <View style={[styles.roleIconBig, { backgroundColor: '#FEF9C3' }]}>
          <Ionicons name="ribbon" size={22} color="#B45309" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.roleTitle}>Jefe de Proyecto</Text>
          <Text style={styles.roleDesc}>Supervisión global del proyecto. Tiene acceso total a todos los tramos, nodos y reportes de la obra (solo lectura).</Text>
        </View>
        {role === ROLE_JEFE ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
      </Pressable>
    </View>
  );
}

function StepIdentity({
  name, setName, email, setEmail, role, puesto, setPuesto,
}: {
  name: string; setName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  role: WizardRole; puesto: string; setPuesto: (v: string) => void;
}) {
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.stepTitle}>Datos de contacto</Text>
      <Text style={styles.stepSub}>Estos datos se mostrarán al destinatario al abrir la invitación.</Text>

      <View>
        <Text style={styles.label}>Nombre completo</Text>
        <View style={styles.inputWrap}>
          <Ionicons name="person-outline" size={18} color={colors.textMuted} />
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Ej. Ana López"
            placeholderTextColor={colors.textMuted} autoCapitalize="words" />
        </View>
      </View>

      <View>
        <Text style={styles.label}>Correo electrónico</Text>
        <View style={styles.inputWrap}>
          <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
          <TextInput value={email} onChangeText={setEmail} style={styles.input} placeholder="ana@empresa.com"
            placeholderTextColor={colors.textMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        </View>
      </View>

      {role === ROLE_ESP ? (
        <View>
          <Text style={styles.label}>Puesto (opcional)</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="briefcase-outline" size={18} color={colors.textMuted} />
            <TextInput value={puesto} onChangeText={setPuesto} style={styles.input} placeholder="Ej. Topógrafa Senior"
              placeholderTextColor={colors.textMuted} autoCapitalize="sentences" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function StepScopeSingle({
  tree, selected, onSelect, areas, areaId, onArea,
}: {
  tree: LocationNodeTree[]; selected: string | null; onSelect: (id: string) => void;
  areas: Area[]; areaId: string | null; onArea: (id: string | null) => void;
}) {
  if (tree.length === 0) {
    return (
      <View style={styles.warnBlock}>
        <Ionicons name="warning" size={20} color={colors.warning} />
        <Text style={styles.warnText}>El árbol está vacío. Primero crea al menos un nodo padre desde la pantalla del árbol.</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 14 }}>
      <Text style={styles.stepTitle}>Alcance del Sub-Coordinador</Text>
      <Text style={styles.stepSub}>Selecciona el nodo del árbol que supervisará. Tendrá acceso a ese nodo y a todos sus descendientes.</Text>
      <View style={styles.treeBox}>
        {tree.map((n) => <TreeRow key={n.id} node={n} selected={selected} onSelect={onSelect} mode="single" />)}
      </View>

      {/* Disciplina / Área (opcional) — se usa en exports ejecutivos. */}
      <View style={{ marginTop: 4 }}>
        <Text style={styles.label}>Disciplina / Área (opcional)</Text>
        <Text style={[styles.stepSub, { marginBottom: 6 }]}>
          Bajo esta disciplina se agruparán los reportes del Sub-Coordinador en las exportaciones ejecutivas (PDF/PPTX). Si no eliges, se usa &ldquo;Obra Civil&rdquo; por defecto.
        </Text>
        {areas.length === 0 ? (
          <View style={styles.warnBlock}>
            <Ionicons name="information-circle" size={18} color={colors.warning} />
            <Text style={styles.warnText}>No hay áreas configuradas. Los reportes se agruparán como &ldquo;Obra Civil&rdquo;.</Text>
          </View>
        ) : (
          <View style={styles.areaRow}>
            <Pressable
              onPress={() => onArea(null)}
              style={[styles.areaPill, !areaId && styles.areaPillOn]}
            >
              <View style={[styles.areaDot, { backgroundColor: '#6B7280' }]} />
              <Text style={[styles.areaText, !areaId && { color: colors.primary, fontWeight: '800' }]}>
                Obra Civil (por defecto)
              </Text>
            </Pressable>
            {areas.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => onArea(a.id)}
                style={[styles.areaPill, areaId === a.id && styles.areaPillOn]}
              >
                <View style={[styles.areaDot, { backgroundColor: a.color }]} />
                <Text style={[styles.areaText, areaId === a.id && { color: colors.primary, fontWeight: '800' }]}>
                  {a.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function StepScopeMulti({
  tree, areas, areaId, onArea, selected, onToggle,
}: {
  tree: LocationNodeTree[]; areas: Area[]; areaId: string | null;
  onArea: (id: string) => void; selected: string[]; onToggle: (id: string) => void;
}) {
  return (
    <View style={{ gap: 14 }}>
      <Text style={styles.stepTitle}>Área y hojas asignadas</Text>
      <Text style={styles.stepSub}>El Especialista pertenece a un área (disciplina) y solo podrá capturar mediciones en los nodos hoja seleccionados.</Text>

      <View>
        <Text style={styles.label}>Área / Disciplina</Text>
        {areas.length === 0 ? (
          <View style={styles.warnBlock}>
            <Ionicons name="warning" size={18} color={colors.warning} />
            <Text style={styles.warnText}>No hay áreas. Crea primero al menos un área desde la pantalla &ldquo;Áreas&rdquo;.</Text>
          </View>
        ) : (
          <View style={styles.areaRow}>
            {areas.map((a) => (
              <Pressable key={a.id} onPress={() => onArea(a.id)} style={[styles.areaPill, areaId === a.id && styles.areaPillOn]}>
                <View style={[styles.areaDot, { backgroundColor: a.color }]} />
                <Text style={[styles.areaText, areaId === a.id && { color: colors.primary, fontWeight: '800' }]}>{a.name}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View>
        <Text style={styles.label}>Nodos hoja donde podrá capturar ({selected.length})</Text>
        {tree.length === 0 ? (
          <View style={styles.warnBlock}>
            <Ionicons name="warning" size={18} color={colors.warning} />
            <Text style={styles.warnText}>El árbol está vacío. Crea nodos hoja primero.</Text>
          </View>
        ) : !hasAnyLeaf(tree) ? (
          <View style={styles.warnBlock}>
            <Ionicons name="warning" size={18} color={colors.warning} />
            <Text style={styles.warnText}>Aún no hay nodos hoja. Marca algunos nodos como &ldquo;hoja&rdquo; en la pantalla del árbol.</Text>
          </View>
        ) : (
          <View style={styles.treeBox}>
            {tree.map((n) => (
              <TreeRow key={n.id} node={n} onlyLeavesSelectable selected={selected} onSelect={onToggle} mode="multi" />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function StepReview({
  role, name, email, puesto, tree, areas, scopeNodeId, scopeNodeIds, areaId,
}: {
  role: WizardRole; name: string; email: string; puesto: string;
  tree: LocationNodeTree[]; areas: Area[];
  scopeNodeId: string | null; scopeNodeIds: string[]; areaId: string | null;
}) {
  const allNodes = flattenTree(tree);
  const areaName = areas.find((a) => a.id === areaId)?.name;
  const scopeNodeName = scopeNodeId ? allNodes.find((n) => n.id === scopeNodeId)?.name : null;
  const scopeNames = scopeNodeIds.map((id) => allNodes.find((n) => n.id === id)?.name).filter(Boolean) as string[];

  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.stepTitle}>Revisar y generar</Text>
      <Text style={styles.stepSub}>Confirma los datos. Al generar la invitación se creará un token alfanumérico copiable.</Text>

      <View style={styles.reviewCard}>
        <ReviewRow icon="person-outline" label="Nombre" value={name} />
        <ReviewRow icon="mail-outline" label="Correo" value={email} />
        <ReviewRow icon="shield-outline" label="Rol" value={roleLabel(role)} />
        {role === ROLE_ESP && puesto ? <ReviewRow icon="briefcase-outline" label="Puesto" value={puesto} /> : null}
        {role === ROLE_ESP && areaName ? <ReviewRow icon="color-palette-outline" label="Área" value={areaName} /> : null}
        {role === ROLE_SUB && scopeNodeName ? <ReviewRow icon="git-network-outline" label="Alcance" value={scopeNodeName} /> : null}
        {role === ROLE_SUB ? (
          <ReviewRow
            icon="color-palette-outline"
            label="Disciplina"
            value={areaName || 'Obra Civil (por defecto)'}
          />
        ) : null}
        {role === ROLE_ESP && scopeNames.length > 0 ? (
          <ReviewRow icon="flag-outline" label={`Hojas (${scopeNames.length})`} value={scopeNames.join(', ')} />
        ) : null}
        {role === ROLE_JEFE ? (
          <ReviewRow icon="globe-outline" label="Alcance" value="Acceso global al proyecto (solo lectura)" />
        ) : null}
      </View>
    </View>
  );
}

function ReviewRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Ionicons name={icon} size={16} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.reviewLabel}>{label}</Text>
        <Text style={styles.reviewValue}>{value}</Text>
      </View>
    </View>
  );
}

// Tree row used inside both single and multi selection
function TreeRow({
  node, selected, onSelect, mode, onlyLeavesSelectable, depth = 0,
}: {
  node: LocationNodeTree;
  selected: string | string[] | null;
  onSelect: (id: string) => void;
  mode: 'single' | 'multi';
  onlyLeavesSelectable?: boolean;
  depth?: number;
}) {
  const isLeaf = node.is_leaf && node.children.length === 0;
  const isSelectable = !onlyLeavesSelectable || isLeaf;
  const isSelected = mode === 'multi'
    ? Array.isArray(selected) && selected.includes(node.id)
    : selected === node.id;
  const indent = Math.min(depth, 6) * 14;

  return (
    <View>
      <Pressable
        disabled={!isSelectable}
        onPress={() => onSelect(node.id)}
        style={[styles.treeRow, { paddingLeft: indent + 10 }, isSelected && styles.treeRowOn, !isSelectable && { opacity: 0.55 }]}
      >
        <Ionicons
          name={mode === 'multi'
            ? (isSelected ? 'checkbox' : 'square-outline')
            : (isSelected ? 'radio-button-on' : 'radio-button-off')}
          size={18}
          color={isSelected ? colors.primary : colors.textMuted}
        />
        <Ionicons name={isLeaf ? 'flag' : 'folder-outline'} size={14} color={isLeaf ? colors.primary : colors.textBody} />
        <View style={{ flex: 1 }}>
          <Text style={styles.treeName} numberOfLines={1}>{node.name}</Text>
          {isLeaf && node.measurement_type ? (
            <Text style={styles.treeMeta}>{node.measurement_type}</Text>
          ) : null}
        </View>
      </Pressable>
      {node.children.map((c) => (
        <TreeRow key={c.id} node={c} selected={selected} onSelect={onSelect} mode={mode} onlyLeavesSelectable={onlyLeavesSelectable} depth={depth + 1} />
      ))}
    </View>
  );
}

// helpers
function flattenTree(tree: LocationNodeTree[]): LocationNodeTree[] {
  const out: LocationNodeTree[] = [];
  function walk(ns: LocationNodeTree[]) {
    for (const n of ns) { out.push(n); walk(n.children); }
  }
  walk(tree);
  return out;
}
function hasAnyLeaf(tree: LocationNodeTree[]): boolean {
  for (const n of tree) {
    if (n.is_leaf && n.children.length === 0) return true;
    if (hasAnyLeaf(n.children)) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 11, color: colors.textMuted, fontWeight: '700', marginTop: 1 },
  scroll: { padding: spacing.md, gap: spacing.md },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md },
  errorBoxInline: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.errorBg, padding: 10, borderRadius: radius.md },
  errorText: { color: colors.error, fontSize: 13, flex: 1, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: spacing.xl + 12, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 8 },
  emptyMsg: { fontSize: 13, color: colors.textMuted, textAlign: 'center', maxWidth: 320, lineHeight: 19 },

  // Invite card
  inviteCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 10 },
  inviteHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roleIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  inviteName: { fontSize: 14, fontWeight: '800', color: colors.text },
  inviteEmail: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginTop: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  inviteMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  metaText: { fontSize: 11, fontWeight: '700', color: colors.textBody },
  tokenRow: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 10, borderWidth: 1, borderColor: colors.border },
  tokenInlineLabel: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.6 },
  tokenInlineValue: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 11, color: colors.text, marginTop: 2 },
  inviteActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionMini: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.primaryLight, backgroundColor: colors.primaryLight + '55' },
  actionMiniText: { fontSize: 11, fontWeight: '700', color: colors.primary },

  fab: { position: 'absolute', right: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.full, ...shadow.card },
  fabText: { color: colors.textInverse, fontWeight: '800', fontSize: 14 },

  // Modal & wizard
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0009' },
  sheetWrapper: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  modalCard: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: spacing.sm },
  modalTitle: { fontSize: 15, fontWeight: '800', color: colors.text, flex: 1 },
  stepDots: { flexDirection: 'row', gap: 6, marginBottom: spacing.md },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.primary },
  stepTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  stepSub: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },

  // Role cards
  roleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  roleCardOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight + '33' },
  roleIconBig: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  roleTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  roleDesc: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginTop: 2 },

  // Inputs
  label: { fontSize: 12, fontWeight: '700', color: colors.textBody, marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: 12, backgroundColor: colors.surface },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },

  // Tree selector
  treeBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden' },
  treeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  treeRowOn: { backgroundColor: colors.primaryLight + '44' },
  treeName: { fontSize: 13, fontWeight: '700', color: colors.text },
  treeMeta: { fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },

  // Areas chips
  areaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  areaPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  areaPillOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  areaDot: { width: 10, height: 10, borderRadius: 5 },
  areaText: { fontSize: 13, color: colors.textBody, fontWeight: '700' },

  // Review
  reviewCard: { backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 8 },
  reviewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  reviewLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  reviewValue: { fontSize: 13, color: colors.text, fontWeight: '700', marginTop: 2 },

  // Warnings
  warnBlock: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FEF3C7', borderRadius: radius.md, padding: 10, borderWidth: 1, borderColor: '#FCD34D' },
  warnText: { flex: 1, color: '#92400E', fontSize: 12, fontWeight: '700', lineHeight: 17 },

  // Wizard actions
  wizardActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  readyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.success + '15',
    borderWidth: 1,
    borderColor: colors.success + '55',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  readyHintText: { flex: 1, color: colors.success, fontSize: 13, fontWeight: '700' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10 },
  backText: { color: colors.textBody, fontWeight: '700' },

  // Success modal
  successBackdrop: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  successCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  successIconBox: { padding: spacing.sm },
  successTitle: { fontSize: 20, fontWeight: '900', color: colors.text },
  successMsg: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19, paddingHorizontal: 12 },
  tokenBox: { width: '100%', padding: spacing.md, backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 4 },
  tokenLabel: { fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.6 },
  tokenValue: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 13, color: colors.text, textAlign: 'center' },
  successActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', width: '100%' },
  actionPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primaryLight },
  actionPillText: { fontSize: 12, fontWeight: '800', color: colors.primary },
});
