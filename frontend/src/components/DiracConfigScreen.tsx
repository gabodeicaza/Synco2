import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Switch, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { olvidarDirac } from '@/src/utils/dirac';
import { colors, radius, spacing } from '@/src/theme';

type Cfg = {
  conectado: boolean;
  origen: string | null;
  id_contrato: string | null;
  url_configurada: boolean;
  avisos_numeros: string[];
  avisos_activo: boolean;
};

/** Conexión del proyecto con Dirac: URL de la API (con su token), números de WhatsApp de directivos y avisos. */
export default function DiracConfigScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ project_id?: string; id?: string }>();
  const raw = params.project_id || params.id;
  const projectId = (Array.isArray(raw) ? raw[0] : raw) || '';
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [url, setUrl] = useState('');
  const [numeros, setNumeros] = useState('');
  const [avisos, setAvisos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const aplicar = (c: Cfg) => {
    setCfg(c);
    setNumeros((c.avisos_numeros || []).join('\n'));
    setAvisos(!!c.avisos_activo);
  };
  const load = useCallback(async () => {
    try {
      aplicar(await api.diracConfig(projectId));
    } catch (e: any) {
      setMsg(e?.message || 'No se pudo cargar la configuración');
    }
  }, [projectId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const guardar = async (body: { url?: string; avisos_numeros?: string[]; avisos_activo?: boolean }) => {
    setBusy(true);
    setMsg(null);
    try {
      aplicar(await api.diracConfigGuardar(projectId, body));
      olvidarDirac(projectId);
      setUrl('');
      setMsg('Guardado');
    } catch (e: any) {
      setMsg(e?.message || 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const guardarAvisos = () =>
    guardar({ avisos_numeros: numeros.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean), avisos_activo: avisos });

  const sincronizar = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.diracSincronizar(projectId);
      setMsg(`Sincronizado: ${r.eventos} fechas en el calendario, semáforo ${r.semaforo}, ${r.enviados} avisos enviados`);
    } catch (e: any) {
      setMsg(e?.message || 'No se pudo sincronizar');
    } finally {
      setBusy(false);
    }
  };

  const desconectar = () =>
    Alert.alert('Desconectar Dirac', 'El proyecto dejará de leer datos de Dirac. Los eventos y pendientes ya creados se conservan.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Desconectar', style: 'destructive', onPress: () => guardar({ url: '' }) },
    ]);

  return (
    <View style={[s.flex, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={s.title}>Conexión con Dirac</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 60 }} keyboardShouldPersistTaps="handled">
        {!cfg && !msg ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : null}
        {cfg ? (
          <>
            <View style={s.card}>
              <Text style={s.cardTitle}>Estado</Text>
              <Text style={[s.muted, { color: cfg.conectado ? colors.success : colors.textMuted }]}>
                {cfg.conectado ? `Conectado${cfg.id_contrato ? ' · ' + cfg.id_contrato : ''}` : 'Sin conexión'}
              </Text>
              {cfg.conectado && cfg.origen === 'servidor' ? (
                <Text style={s.muted}>Usa la conexión general del servidor. Si pegas una URL aquí, este proyecto usará la suya.</Text>
              ) : null}
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>URL de la API de Dirac</Text>
              <Text style={s.muted}>Pega la URL completa que te dio Dirac. Se guarda en el servidor y no se vuelve a mostrar.</Text>
              <TextInput
                style={s.input}
                value={url}
                onChangeText={setUrl}
                placeholder={cfg.url_configurada ? '•••• URL guardada (pega otra para reemplazarla)' : 'https://diracapm.qubi.com.mx/api-apm/v1/…'}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Pressable style={[s.btn, (!url.trim() || busy) && s.btnOff]} disabled={!url.trim() || busy} onPress={() => guardar({ url })}>
                <Text style={s.btnText}>Probar y conectar</Text>
              </Pressable>
              {cfg.url_configurada ? (
                <Pressable onPress={desconectar} disabled={busy}><Text style={s.link}>Desconectar este proyecto</Text></Pressable>
              ) : null}
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Avisos por WhatsApp a directivos</Text>
              <Text style={s.muted}>
                Números distintos a los de los reportes. Se avisa cuando aparece una alerta roja nueva o cambia el estatus de una estimación. Uno por línea, con lada de país (ej. 5215512345678).
              </Text>
              <TextInput
                style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
                value={numeros}
                onChangeText={setNumeros}
                multiline
                placeholder="5215512345678"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
              />
              <View style={s.rowBetween}>
                <Text style={s.cardTitle}>Avisos activos</Text>
                <Switch value={avisos} onValueChange={setAvisos} />
              </View>
              <Pressable style={[s.btn, busy && s.btnOff]} disabled={busy} onPress={guardarAvisos}>
                <Text style={s.btnText}>Guardar avisos</Text>
              </Pressable>
            </View>

            {cfg.conectado ? (
              <Pressable style={[s.btnSec, busy && s.btnOff]} disabled={busy} onPress={sincronizar}>
                <Text style={s.btnSecText}>Sincronizar ahora (calendario, pendientes y avisos)</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
        {msg ? <Text style={[s.muted, { marginTop: spacing.md }]}>{msg}</Text> : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text, fontSize: 14, marginTop: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  btn: { backgroundColor: colors.primary, borderRadius: radius.sm, padding: 12, alignItems: 'center', marginTop: 8 },
  btnOff: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700' },
  btnSec: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, padding: 12, alignItems: 'center' },
  btnSecText: { color: colors.primary, fontWeight: '700' },
  link: { color: colors.error, fontSize: 13, marginTop: 8 },
});
