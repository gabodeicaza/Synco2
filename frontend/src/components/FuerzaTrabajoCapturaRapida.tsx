// Captura rápida de Fuerza de Trabajo (R-02). Crea un reporte MÍNIMO (solo Personal y Equipo)
// con las categorías del catálogo del proyecto y su cantidad. Se ve como cualquier reporte
// (autor = quien captura) y aparece en la tabla de Fuerza de Trabajo. Sin conexión, el reporte
// se encola igual que los demás (api.createReport).
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, LocationNodeTree } from '@/src/api';
import { useAuth } from '@/src/auth-context';
import { FormField } from '@/src/components/FormField';
import { InlineError } from '@/src/components/InlineError';
import { useEnvio } from '@/src/hooks/useEnvio';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { t } from '@/src/i18n';
import { colors, radius, shadow, spacing } from '@/src/theme';
import {
  CATALOGO_EQUIPO_KEY, CATALOGO_PERSONAL_KEY, categoriasEquipo, categoriasPersonal, claveCampo, filtrarHojas,
  HojaConRuta, hojasConRuta, validarCapturaRapida,
} from '@/src/utils/capturaRapidaFuerzaTrabajo';
import { storage } from '@/src/utils/storage';
import { showToast } from '@/src/utils/toast';

const MAX_UBICACIONES_VISIBLES = 60;

async function leerCatalogoLocal(clave: string): Promise<unknown[]> {
  try {
    const crudo = await storage.getItem<string>(clave, '[]');
    const lista = JSON.parse(crudo || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

export function FuerzaTrabajoCapturaRapida({
  projectId, visible, onClose, onSaved,
}: {
  projectId: string;
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { user } = useAuth();
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [constructora, setConstructora] = useState('');
  const [personal, setPersonal] = useState<string[]>([]);
  const [equipo, setEquipo] = useState<string[]>([]);
  const [hojas, setHojas] = useState<HojaConRuta[]>([]);
  const [hoja, setHoja] = useState<HojaConRuta | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const { errores, errorGeneral, ponerTodos, limpiar, limpiarTodo, errorDeGuardado } = useFormErrors<string>();
  const { guardando, ejecutar } = useEnvio();

  useEffect(() => {
    if (!visible || !projectId) return;
    let vivo = true;
    setHoja(null);
    setEligiendo(false);
    setBusqueda('');
    setCantidades({});
    limpiarTodo();
    setCargando(true);
    setErrorCarga(null);
    (async () => {
      try {
        const [proyecto, arbol, localesP, localesE] = await Promise.all([
          api.getProject(projectId),
          api.getTree(projectId),
          leerCatalogoLocal(CATALOGO_PERSONAL_KEY),
          leerCatalogoLocal(CATALOGO_EQUIPO_KEY),
        ]);
        if (!vivo) return;
        setConstructora(proyecto?.constructora || '');
        setPersonal(categoriasPersonal(proyecto?.categorias_personal, localesP));
        setEquipo(categoriasEquipo(proyecto?.categorias_equipo, localesE));
        setHojas(hojasConRuta((arbol || []) as LocationNodeTree[], user?.scope_node_ids));
      } catch (e: any) {
        if (vivo) setErrorCarga(e?.message || t('formulario.noSePudoGuardar'));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, projectId]);

  const visibles = useMemo(() => filtrarHojas(hojas, busqueda).slice(0, MAX_UBICACIONES_VISIBLES), [hojas, busqueda]);
  const sinCategorias = !cargando && !errorCarga && personal.length === 0 && equipo.length === 0;

  function cambiarCantidad(clave: string, valor: string) {
    limpiar(clave);
    limpiar('cantidades');
    setCantidades((prev) => ({ ...prev, [clave]: valor }));
  }

  async function guardar() {
    await ejecutar(async () => {
      const r = validarCapturaRapida({ nodeId: hoja?.id ?? null, personal, equipo, cantidades });
      if (ponerTodos(r.errores)) return;
      try {
        const res: any = await api.createReport({
          project_id: projectId,
          node_id: hoja!.id,
          title: t('fuerzaTrabajo.tituloReporte'),
          severidad: ['informativo'],
          personnel: r.personnel,
          equipment: r.equipment,
          images: [],
          actividades: '',
          contratista: constructora,
          measurement_value: {},
          solo_fuerza_trabajo: true,
        });
        showToast(res?._queued ? t('fuerzaTrabajo.guardadoSinConexion') : t('fuerzaTrabajo.guardado'));
        onSaved?.();
        onClose();
      } catch (e) {
        errorDeGuardado(e);
      }
    });
  }

  function grupo(titulo: string, nombres: string[], tipo: 'personal' | 'equipo') {
    if (nombres.length === 0) return null;
    return (
      <View style={styles.grupo}>
        <Text style={styles.grupoTitulo} accessibilityRole="header">{titulo}</Text>
        {nombres.map((nombre, i) => {
          const clave = claveCampo(tipo, i);
          return (
            <FormField
              key={clave}
              label={t('fuerzaTrabajo.cantidadDe', { nombre })}
              value={cantidades[clave] || ''}
              onChangeText={(v) => cambiarCantidad(clave, v)}
              error={errores[clave]}
              numero={{ maxDecimales: 0 }}
              placeholder="0"
              editable={!guardando}
            />
          );
        })}
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!guardando) onClose(); }}>
      <View style={styles.fondo}>
        <View style={styles.hoja}>
          <View style={styles.encabezado}>
            <Text style={styles.titulo} accessibilityRole="header">{t('fuerzaTrabajo.titulo')}</Text>
            <Pressable
              accessibilityRole="button" accessibilityLabel={t('fuerzaTrabajo.cerrar')}
              onPress={() => { if (!guardando) onClose(); }} hitSlop={10} style={styles.cerrar}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          {cargando ? (
            <View style={styles.centro}><ActivityIndicator color={colors.primary} /></View>
          ) : errorCarga ? (
            <View style={styles.cuerpo}><InlineError message={errorCarga} /></View>
          ) : (
            <ScrollView contentContainerStyle={styles.cuerpo} keyboardShouldPersistTaps="handled">
              <Text style={styles.ayuda}>{t('fuerzaTrabajo.ayuda')}</Text>

              <Text style={styles.etiqueta}>{t('fuerzaTrabajo.ubicacion')} <Text style={styles.asterisco}>*</Text></Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={hoja ? `${t('fuerzaTrabajo.ubicacion')}: ${hoja.ruta}` : t('fuerzaTrabajo.elegirUbicacion')}
                onPress={() => { setEligiendo((v) => !v); limpiar('ubicacion'); }}
                style={[styles.selector, errores.ubicacion ? styles.selectorError : null]}
              >
                <Ionicons name="location-outline" size={18} color={colors.primary} />
                <Text style={styles.selectorTxt} numberOfLines={2}>{hoja ? hoja.ruta : t('fuerzaTrabajo.elegirUbicacion')}</Text>
                <Ionicons name={eligiendo ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </Pressable>
              <InlineError message={errores.ubicacion} style={styles.errorSeparado} />

              {eligiendo ? (
                <View style={styles.lista}>
                  <FormField
                    label={t('fuerzaTrabajo.buscarUbicacion')} value={busqueda} onChangeText={setBusqueda}
                    autoCorrect={false} autoCapitalize="none"
                  />
                  {visibles.length === 0 ? (
                    <Text style={styles.vacio}>{t('fuerzaTrabajo.sinUbicaciones')}</Text>
                  ) : visibles.map((h) => (
                    <Pressable
                      key={h.id} accessibilityRole="button" accessibilityLabel={h.ruta}
                      onPress={() => { setHoja(h); setEligiendo(false); setBusqueda(''); limpiar('ubicacion'); }}
                      style={styles.fila}
                    >
                      <Text style={styles.filaTxt} numberOfLines={2}>{h.ruta}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {sinCategorias ? <Text style={styles.vacio}>{t('fuerzaTrabajo.sinCategorias')}</Text> : null}
              {grupo(t('fuerzaTrabajo.personal'), personal, 'personal')}
              {grupo(t('fuerzaTrabajo.equipo'), equipo, 'equipo')}

              <InlineError message={errores.cantidades} style={styles.errorSeparado} />
              <InlineError message={errorGeneral} style={styles.errorSeparado} />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('fuerzaTrabajo.guardar')}
                accessibilityState={{ busy: guardando, disabled: guardando || sinCategorias }}
                disabled={guardando || sinCategorias}
                onPress={guardar}
                style={[styles.guardar, (guardando || sinCategorias) && { opacity: 0.5 }]}
              >
                {guardando ? <ActivityIndicator color={colors.textInverse} /> : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color={colors.textInverse} />
                    <Text style={styles.guardarTxt}>{t('fuerzaTrabajo.guardar')}</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  hoja: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    maxHeight: '92%', ...shadow.lg,
  },
  encabezado: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  titulo: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text },
  cerrar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  centro: { padding: spacing.xl, alignItems: 'center' },
  cuerpo: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: 4 },
  ayuda: { fontSize: 13, color: colors.textBody, lineHeight: 19, marginBottom: 6 },
  etiqueta: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 8, marginBottom: 4 },
  asterisco: { color: colors.error },
  selector: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bg,
  },
  selectorError: { borderColor: colors.error },
  selectorTxt: { flex: 1, fontSize: 14, color: colors.text },
  errorSeparado: { marginTop: 6 },
  lista: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, marginTop: 6 },
  fila: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  filaTxt: { fontSize: 14, color: colors.text },
  vacio: { fontSize: 13, color: colors.textMuted, paddingVertical: 8 },
  grupo: { marginTop: 10 },
  grupoTitulo: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 6 },
  guardar: {
    marginTop: 14, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.md,
  },
  guardarTxt: { color: colors.textInverse, fontWeight: '800', fontSize: 15 },
});
