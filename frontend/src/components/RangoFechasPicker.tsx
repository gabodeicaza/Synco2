// Selector de rango personalizado (Etapa 4) — un solo calendario: se toca
// la fecha de inicio, luego la de fin, con el rango intermedio resaltado
// con el color de identidad del proyecto. La lógica de fechas (atajos,
// validación, marcado) vive en src/utils/rangoFechas.ts, puro y probado
// aparte; este componente solo la conecta a la UI del calendario.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, shadow } from '@/src/theme';
import { dayjs, CDMX_TZ } from '@/src/utils/tz';
import { marcarPeriodoCalendario, validarRango, formatearRangoLegible } from '@/src/utils/rangoFechas';

// Mismo LocaleConfig que UniversalCalendar.tsx — mutar LocaleConfig es
// idempotente (fijar el mismo valor dos veces es inofensivo), así que no
// hace falta compartir un módulo aparte solo para esto.
LocaleConfig.locales['es'] = {
  monthNames: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  monthNamesShort: ['Ene.', 'Feb.', 'Mar.', 'Abr.', 'May.', 'Jun.', 'Jul.', 'Ago.', 'Sep.', 'Oct.', 'Nov.', 'Dic.'],
  dayNames: ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'],
  dayNamesShort: ['D', 'L', 'M', 'M', 'J', 'V', 'S'],
  today: 'Hoy',
};
LocaleConfig.defaultLocale = 'es';

interface Props {
  visible: boolean;
  desdeInicial: string | null;
  hastaInicial: string | null;
  onCancelar: () => void;
  onConfirmar: (desde: string, hasta: string) => void;
}

export function RangoFechasPicker({ visible, desdeInicial, hastaInicial, onCancelar, onConfirmar }: Props) {
  const [desde, setDesde] = useState<string | null>(desdeInicial);
  const [hasta, setHasta] = useState<string | null>(hastaInicial);
  // Antes usaba el color de identidad del proyecto (`project.color_tema`)
  // como acento del calendario: si ese color era claro/pastel, el círculo
  // del día seleccionado quedaba blanco-sobre-blanco (texto invisible).
  // Se fija al azul estándar de la app, que siempre es legible.
  const acento = colors.primary;

  useEffect(() => {
    if (visible) { setDesde(desdeInicial); setHasta(hastaInicial); }
  }, [visible, desdeInicial, hastaInicial]);

  function onDayPress(day: { dateString: string }) {
    if (!desde || (desde && hasta)) {
      // Primer toque de una selección nueva (o se reinicia tras completar una).
      setDesde(day.dateString);
      setHasta(null);
    } else if (day.dateString < desde) {
      // Tocaron una fecha anterior al inicio: se invierte el rango.
      setHasta(desde);
      setDesde(day.dateString);
    } else {
      setHasta(day.dateString);
    }
  }

  const marcado = marcarPeriodoCalendario(desde, hasta, acento);
  // [FIX] `dayjs()` sin `.tz()` usa la zona horaria del dispositivo, no CDMX.
  // Si el dispositivo esta en una zona horaria detras de CDMX, `hoyStr`
  // calculaba una fecha anterior al mes que el calendario abre por defecto
  // (que usa el "hoy" real del dispositivo), dejando TODO el mes visible
  // fuera de `maxDate` -> se veia gris/deshabilitado por completo.
  const hoyStr = dayjs().tz(CDMX_TZ).format('YYYY-MM-DD');
  const validacion = validarRango(desde, hasta, dayjs().tz(CDMX_TZ));
  const puedeConfirmar = !!desde && !!hasta && validacion.valido;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Selecciona un rango</Text>
          <Text style={styles.subtitle}>
            {desde && hasta ? formatearRangoLegible(desde, hasta) : desde ? 'Ahora toca la fecha final' : 'Toca la fecha de inicio'}
          </Text>

          <Calendar
            key={hoyStr}
            current={hoyStr}
            markingType="period"
            markedDates={marcado}
            maxDate={hoyStr}
            // Domingo primero — misma convención de semana natural que el resto de la app
            firstDay={0}
            onDayPress={onDayPress}
            theme={{
              backgroundColor: '#ffffff',
              calendarBackground: '#ffffff',
              textSectionTitleColor: '#1e293b',
              selectedDayBackgroundColor: acento,
              selectedDayTextColor: '#ffffff',
              todayTextColor: acento,
              dayTextColor: '#1e293b',
              textDisabledColor: '#cbd5e1',
              monthTextColor: '#1e293b',
              arrowColor: acento,
              indicatorColor: acento,
              textDayFontWeight: '600',
              textMonthFontWeight: '800',
              textDayHeaderFontWeight: '700',
            }}
          />

          {desde && hasta && !validacion.valido ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={14} color={colors.error} />
              <Text style={styles.errorTxt}>{validacion.motivo}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancelar} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnGhostTxt}>Cancelar</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              onPress={() => { if (puedeConfirmar && desde && hasta) onConfirmar(desde, hasta); }}
              disabled={!puedeConfirmar}
              style={[styles.btn, styles.btnPrimary, !puedeConfirmar && { opacity: 0.5 }]}
            >
              <Text style={styles.btnPrimaryTxt}>Aplicar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadow.lg },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.errorBg, padding: 8, borderRadius: radius.sm, marginTop: spacing.sm },
  errorTxt: { color: colors.error, fontSize: 12, fontWeight: '700', flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  btnGhostTxt: { color: colors.text, fontWeight: '800', fontSize: 14 },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
