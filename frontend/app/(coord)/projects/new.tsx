import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/src/components/Button';
import { api } from '@/src/api';
import { COLOR_IDENTIDAD_DEFECTO, colors, spacing } from '@/src/theme';
import { a11y, t } from '@/src/i18n';
import { ColorInput } from '@/src/components/ColorInput';
import { FormField } from '@/src/components/FormField';
import { InlineError } from '@/src/components/InlineError';
import { useEnvio } from '@/src/hooks/useEnvio';
import { useFormErrors } from '@/src/hooks/useFormErrors';
import { errorDeColor, normalizarColorHex } from '@/src/utils/color';
import { showToast } from '@/src/utils/toast';
import { esFechaValida } from '@/src/utils/validacionEvento';

type Campo =
  | 'nombre' | 'constructora' | 'contrato' | 'fechaInicio' | 'fechaTermino' | 'colorInstitucional' | 'colorTema';

// Los dos colores nacen prellenados con el mismo color de identidad: se comportan igual (P-03).
const FORMULARIO_VACIO = {
  nombre: '', constructora: '', contrato: '', objeto: '', cliente: '',
  colorTema: COLOR_IDENTIDAD_DEFECTO, colorInstitucional: COLOR_IDENTIDAD_DEFECTO,
  fechaInicio: '', fechaTermino: '', descripcion: '',
};

export default function NewProjectScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { errores, errorGeneral, ponerTodos, limpiarTodo, alCambiar, errorDeGuardado } = useFormErrors<Campo>();
  const { guardando, ejecutar } = useEnvio();
  const [f, setF] = useState(FORMULARIO_VACIO);

  const poner = <K extends keyof typeof FORMULARIO_VACIO>(k: K) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  function reiniciar() {
    setF(FORMULARIO_VACIO);
    limpiarTodo();
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }

  function validar(): boolean {
    const e: Partial<Record<Campo, string>> = {};
    if (!f.nombre.trim()) e.nombre = t('proyectoForm.errores.nombreObligatorio');
    if (!f.constructora.trim()) e.constructora = t('proyectoForm.errores.constructoraObligatoria');
    if (!f.contrato.trim()) e.contrato = t('proyectoForm.errores.contratoObligatorio');
    const ini = f.fechaInicio.trim();
    const fin = f.fechaTermino.trim();
    if (ini && !esFechaValida(ini)) e.fechaInicio = t('proyectoForm.errores.fechaInvalida');
    if (fin && !esFechaValida(fin)) e.fechaTermino = t('proyectoForm.errores.fechaInvalida');
    if (!e.fechaInicio && !e.fechaTermino && ini && fin && fin < ini) e.fechaTermino = t('proyectoForm.errores.terminoAnterior');
    e.colorInstitucional = errorDeColor(f.colorInstitucional) ?? undefined;
    e.colorTema = errorDeColor(f.colorTema) ?? undefined;
    return !ponerTodos(e);
  }

  async function onCreate() {
    if (!validar()) return;
    await ejecutar(async () => {
      try {
        const p = await api.createProject({
          name: f.nombre.trim(),
          constructora: f.constructora.trim(),
          contract_number: f.contrato.trim(),
          objeto_contrato: f.objeto.trim() || null,
          cliente_principal: f.cliente.trim() || null,
          color_tema: normalizarColorHex(f.colorTema),
          color_institucional: normalizarColorHex(f.colorInstitucional),
          start_date: f.fechaInicio.trim() || null,
          end_date: f.fechaTermino.trim() || null,
          description: f.descripcion.trim() || null,
        });
        showToast(t('proyectoForm.creado'));
        reiniciar();
        router.replace({ pathname: '/(coord)/projects/[id]', params: { id: p.id } });
      } catch (e) {
        errorDeGuardado(e, t('proyectoForm.errores.noSePudoCrear'));
      }
    });
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={a11y('cerrar')} onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t('proyectoForm.titulo')}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <FormField
          label={t('proyectoForm.nombre')} obligatorio value={f.nombre}
          onChangeText={alCambiar<string>('nombre', poner('nombre'))} error={errores.nombre}
          placeholder={t('proyectoForm.nombrePlaceholder')} editable={!guardando}
        />
        <FormField
          label={t('proyectoForm.constructora')} obligatorio value={f.constructora}
          onChangeText={alCambiar<string>('constructora', poner('constructora'))} error={errores.constructora}
          placeholder={t('proyectoForm.constructoraPlaceholder')} editable={!guardando}
        />
        <FormField
          label={t('proyectoForm.contrato')} obligatorio value={f.contrato}
          onChangeText={alCambiar<string>('contrato', poner('contrato'))} error={errores.contrato}
          placeholder={t('proyectoForm.contratoPlaceholder')} editable={!guardando}
        />
        <FormField
          label={t('proyectoForm.objeto')} value={f.objeto} onChangeText={poner('objeto')}
          placeholder={t('proyectoForm.objetoPlaceholder')} multiline inputStyle={styles.multilinea}
          textAlignVertical="top" editable={!guardando}
        />
        <FormField
          label={t('proyectoForm.cliente')} value={f.cliente} onChangeText={poner('cliente')}
          placeholder={t('proyectoForm.clientePlaceholder')} editable={!guardando}
        />
        <ColorInput
          label={t('proyectoForm.colorInstitucional')}
          ayuda={t('proyectoForm.colorInstitucionalAyuda')}
          value={f.colorInstitucional}
          onChange={alCambiar<string>('colorInstitucional', poner('colorInstitucional'))}
          error={errores.colorInstitucional}
          editable={!guardando}
        />
        <ColorInput
          label={t('proyectoForm.colorPortada')}
          ayuda={t('proyectoForm.colorPortadaAyuda')}
          value={f.colorTema}
          onChange={alCambiar<string>('colorTema', poner('colorTema'))}
          error={errores.colorTema}
          editable={!guardando}
        />
        <FormField
          label={t('proyectoForm.fechaInicio')} value={f.fechaInicio}
          onChangeText={alCambiar<string>('fechaInicio', poner('fechaInicio'))} error={errores.fechaInicio}
          placeholder="2026-01-15" maxLength={10} editable={!guardando}
          keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
        />
        <FormField
          label={t('proyectoForm.fechaTermino')} value={f.fechaTermino}
          onChangeText={alCambiar<string>('fechaTermino', poner('fechaTermino'))} error={errores.fechaTermino}
          placeholder="2027-06-30" maxLength={10} editable={!guardando}
          keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
        />
        <FormField
          label={t('proyectoForm.descripcion')} value={f.descripcion} onChangeText={poner('descripcion')}
          placeholder={t('proyectoForm.descripcionPlaceholder')} multiline inputStyle={styles.multilinea}
          textAlignVertical="top" editable={!guardando}
        />

        <InlineError message={errorGeneral} />

        <View style={{ height: spacing.md }} />
        <Button label={t('proyectoForm.crear')} onPress={onCreate} loading={guardando} fullWidth />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xs },
  multilinea: { minHeight: 80 },
});
