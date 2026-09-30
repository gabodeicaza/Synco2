// Crear un concepto del catálogo a mano (C-05): clave, descripción, unidad, cantidad,
// P.U. y bandera de extraordinario. Errores en línea por campo, sin dobles envíos, números
// con el separador decimal del proyecto y unidades base + personalizadas sin repetir.
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api, Concepto, Project } from '@/src/api';
import { Button } from '@/src/components/Button';
import { FormField } from '@/src/components/FormField';
import { InlineError } from '@/src/components/InlineError';
import { useEnvio } from '@/src/hooks/useEnvio';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { t } from '@/src/i18n';
import { colors, radius, shadow, spacing } from '@/src/theme';
import { concordanciaConcepto } from '@/src/utils/nombresNivel';
import { cadenciaDeProyecto, metaPorDefecto } from '@/src/utils/metaPorDefecto';
import { DECIMALES_CANTIDAD, DECIMALES_IMPORTE, SeparadorDecimal, formatoNumero, parseNumeroEntrada } from '@/src/utils/numeros';
import { showToast } from '@/src/utils/toast';
import { UNIDAD_DEFAULT, UNIDAD_LABELS, Unidad, unidadesDelProyecto } from '@/src/utils/unidades';
import { CampoConcepto, validarNuevoConcepto } from '@/src/utils/validacionCatalogo';

interface Props {
  visible: boolean;
  project: Project | null;
  /** Partida donde se crea el concepto. */
  partida: { id: string; clave: string; nombre: string } | null;
  onClose: () => void;
  onCreado: (concepto: Concepto) => void;
}

export function NuevoConceptoModal({ visible, project, partida, onClose, onCreado }: Props) {
  const separador: SeparadorDecimal = project?.separador_decimal === ',' ? ',' : '.';
  const unidades = useMemo(() => unidadesDelProyecto(project?.unidades_personalizadas), [project?.unidades_personalizadas]);
  const conc = concordanciaConcepto(project);
  const nombre = conc.nombre;

  const [clave, setClave] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [unidad, setUnidad] = useState<string>(UNIDAD_DEFAULT);
  const [cantidad, setCantidad] = useState('');
  const [precio, setPrecio] = useState('');
  const [extraordinario, setExtraordinario] = useState(false);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [meta, setMeta] = useState('');
  const { errores, errorGeneral, poner, ponerTodos, alCambiar, errorDeGuardado, limpiarTodo, limpiar } = useFormErrors<CampoConcepto>();
  const { guardando, ejecutar } = useEnvio();

  useEffect(() => {
    if (!visible) return;
    setClave(''); setDescripcion(''); setUnidad(UNIDAD_DEFAULT); setCantidad(''); setPrecio(''); setExtraordinario(false);
    setFechaInicio(''); setFechaFin(''); setMeta('');
    limpiarTodo();
  }, [visible, limpiarTodo]);

  // C-06: meta por defecto = cantidad ÷ duración en la cadencia del proyecto; sin fechas queda vacía.
  const periodicidad = cadenciaDeProyecto(project?.cadencia_reporte);
  const periodoTxt = t(periodicidad === 'DIARIA' ? 'meta.porDia' : periodicidad === 'SEMANAL' ? 'meta.porSemana' : 'meta.porMes');
  const metaCalculada = useMemo(() => {
    const c = parseNumeroEntrada(cantidad, { separador, maxDecimales: DECIMALES_CANTIDAD });
    return c.ok ? metaPorDefecto(c.valor, fechaInicio.trim(), fechaFin.trim(), periodicidad) : null;
  }, [cantidad, fechaInicio, fechaFin, periodicidad, separador]);
  const metaCalculadaTxt = metaCalculada ? formatoNumero(metaCalculada, { separador, maxDecimales: DECIMALES_CANTIDAD }) : '';

  async function crear() {
    if (!partida) return;
    await ejecutar(async () => {
      const r = validarNuevoConcepto(
        { clave, descripcion, unidad, cantidad, precioUnitario: precio, extraordinario, fechaInicio, fechaFin, meta },
        { separador, unidadesValidas: unidades, cadencia: project?.cadencia_reporte },
      );
      if (ponerTodos(r.errores) || !r.valores) return;
      try {
        const creado = await api.createConcepto({ partida_id: partida.id, ...r.valores });
        showToast(t('catalogoForm.conceptoCreado', { concepto: nombre, creado: conc.creado }));
        onCreado(creado);
      } catch (e) {
        if ((e as any)?.status === 409) poner('clave', t('catalogoForm.claveEnUso', { clave: clave.trim() }));
        else errorDeGuardado(e);
      }
    });
  }

  const etiquetaUnidad = (u: string) => UNIDAD_LABELS[u as Unidad] ?? u;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !guardando && onClose()}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.title} accessibilityRole="header">{t('catalogoForm.nuevoConcepto', { nuevo: conc.nuevo, concepto: conc.minuscula })}</Text>
            {partida ? (
              <Text style={styles.padre}>{t('catalogoForm.seCreaEn', { partida: `${partida.clave} — ${partida.nombre}` })}</Text>
            ) : null}

            <FormField
              label={t('catalogoForm.clave')}
              value={clave}
              onChangeText={alCambiar<string>('clave', setClave)}
              error={errores.clave}
              placeholder={t('catalogoForm.claveEjemplo')}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!guardando}
              obligatorio
            />
            <FormField
              label={t('catalogoForm.descripcion')}
              value={descripcion}
              onChangeText={alCambiar<string>('descripcion', setDescripcion)}
              error={errores.descripcion}
              editable={!guardando}
              multiline
              obligatorio
            />

            <Text style={styles.label}>{t('catalogoForm.unidad')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              {unidades.map((u) => {
                const activa = unidad === u;
                return (
                  <Pressable
                    key={u}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: activa }}
                    accessibilityLabel={etiquetaUnidad(u)}
                    disabled={guardando}
                    onPress={() => { limpiar('unidad'); setUnidad(u); }}
                    style={[styles.chip, activa && styles.chipActivo]}
                  >
                    <Text style={[styles.chipTxt, activa && styles.chipTxtActivo]}>{u}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <InlineError message={errores.unidad} style={styles.errorUnidad} />

            <FormField
              label={t('catalogoForm.cantidad')}
              value={cantidad}
              onChangeText={alCambiar<string>('cantidad', setCantidad)}
              error={errores.cantidad}
              numero={{ separador, maxDecimales: DECIMALES_CANTIDAD }}
              editable={!guardando}
              obligatorio
            />
            <FormField
              label={extraordinario ? t('catalogoForm.precioUnitarioPropuesto') : t('catalogoForm.precioUnitario')}
              value={precio}
              onChangeText={alCambiar<string>('precioUnitario', setPrecio)}
              error={errores.precioUnitario}
              numero={{ separador, maxDecimales: DECIMALES_IMPORTE, minDecimales: DECIMALES_IMPORTE }}
              editable={!guardando}
              returnKeyType="done"
              onSubmitEditing={crear}
              obligatorio={!extraordinario}
            />

            <FormField
              label={t('meta.fechaInicio')}
              value={fechaInicio}
              onChangeText={alCambiar<string>('fechaInicio', setFechaInicio)}
              error={errores.fechaInicio}
              placeholder={t('meta.fechaEjemplo')}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={10}
              editable={!guardando}
            />
            <FormField
              label={t('meta.fechaFin')}
              value={fechaFin}
              onChangeText={alCambiar<string>('fechaFin', setFechaFin)}
              error={errores.fechaFin}
              placeholder={t('meta.fechaEjemplo')}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={10}
              editable={!guardando}
            />
            <FormField
              label={t('meta.titulo', { periodo: periodoTxt })}
              value={meta}
              onChangeText={alCambiar<string>('meta', setMeta)}
              error={errores.meta}
              placeholder={metaCalculadaTxt}
              ayuda={metaCalculada
                ? t('meta.calculada', { meta: metaCalculadaTxt, unidad, periodo: periodoTxt })
                : t('meta.sinPrograma')}
              numero={{ separador, maxDecimales: DECIMALES_CANTIDAD }}
              editable={!guardando}
            />

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: extraordinario }}
              accessibilityLabel={t('catalogoForm.extraordinario')}
              disabled={guardando}
              onPress={() => setExtraordinario((v) => !v)}
              style={styles.checkFila}
            >
              <Ionicons name={extraordinario ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
              <Text style={styles.checkTxt}>{t('catalogoForm.extraordinario')}</Text>
            </Pressable>
            {extraordinario ? <Text style={styles.ayuda}>{t('catalogoForm.extraordinarioAyuda')}</Text> : null}

            <InlineError message={errorGeneral} style={styles.errorGeneral} />
            <View style={styles.botones}>
              <Button label={t('catalogoForm.cancelar')} variant="secondary" onPress={onClose} disabled={guardando} style={styles.boton} />
              <Button label={t('catalogoForm.crear')} onPress={crear} loading={guardando} style={styles.boton} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  card: { width: '100%', maxWidth: 420, maxHeight: '92%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.lg },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 4 },
  padre: { fontSize: 12, color: colors.textMuted, marginBottom: 4, fontStyle: 'italic' },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 10, marginBottom: 4 },
  chips: { gap: 6, paddingVertical: 2 },
  chip: {
    minHeight: 44, paddingHorizontal: 12, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  chipActivo: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { fontSize: 12, fontWeight: '700', color: colors.textBody },
  chipTxtActivo: { color: colors.textInverse },
  errorUnidad: { marginTop: 6 },
  checkFila: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, marginTop: 8 },
  checkTxt: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '600' },
  ayuda: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  errorGeneral: { marginTop: 10 },
  botones: { flexDirection: 'row', gap: 10, marginTop: 16 },
  boton: { flex: 1 },
});
