// Ubicación GPS real de un nodo (T-05b): "Usar mi ubicación", "Quitar ubicación" y enlace a
// mapas. Guarda al instante con PATCH /nodes/{id} (gps_lat/gps_lon), separado del botón
// "Guardar cambios" del editor y sin tocar las coordenadas objetivo (UTM).
// El permiso de ubicación se pide solo al tocar el botón, con una explicación previa en línea.
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api';
import { InlineError } from '@/src/components/InlineError';
import { t } from '@/src/i18n';
import { colors, radius } from '@/src/theme';
import { esErrorDeRed } from '@/src/utils/errores';
import { ErrorGps, errorGpsDe, formatoGps, puntoGpsDeCoords, PuntoGps, urlMapas } from '@/src/utils/gpsNodo';
import { showToast } from '@/src/utils/toast';

export const ESPERA_GPS_MS = 20000;

type Fase = 'reposo' | 'explicando' | 'obteniendo' | 'guardando';

function mensajeDe(error: ErrorGps): string {
  if (error === 'sin_permiso') return t('gpsNodo.sinPermiso');
  if (error === 'servicio_apagado') return t('gpsNodo.servicioApagado');
  return t('gpsNodo.noDisponible');
}

export function UbicacionGpsNodo({
  nodeId, punto: puntoInicial, onChanged,
}: {
  nodeId: string;
  punto: PuntoGps | null;
  onChanged?: () => void;
}) {
  const [punto, setPunto] = useState<PuntoGps | null>(puntoInicial);
  const [fase, setFase] = useState<Fase>('reposo');
  const [error, setError] = useState<string | null>(null);
  const [errorPermiso, setErrorPermiso] = useState(false);
  const ocupado = fase === 'obteniendo' || fase === 'guardando';

  function fallo(e: unknown) {
    if (esErrorDeRed(e)) {
      showToast(t('red.errorDeRed'));
      return;
    }
    const mensaje = (e as any)?.message;
    setError(typeof mensaje === 'string' && mensaje ? mensaje : t('gpsNodo.noSePudoGuardar'));
  }

  async function guardar(cuerpo: Record<string, unknown>, nuevo: PuntoGps | null) {
    setFase('guardando');
    try {
      await api.updateNode(nodeId, cuerpo);
      setPunto(nuevo);
      showToast(t(nuevo ? 'gpsNodo.guardadaAviso' : 'gpsNodo.quitadaAviso'));
      onChanged?.();
    } catch (e) {
      fallo(e);
    } finally {
      setFase('reposo');
    }
  }

  async function obtenerPosicion() {
    setFase('obteniendo');
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      const espera = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new Error('Location request timed out')), ESPERA_GPS_MS);
      });
      const posicion = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        espera,
      ]);
      const nuevo = puntoGpsDeCoords(posicion?.coords);
      if (!nuevo) throw new Error('Location unavailable');
      if (temporizador) clearTimeout(temporizador);
      await guardar({ gps_lat: nuevo.lat, gps_lon: nuevo.lon }, nuevo);
    } catch (e) {
      if (temporizador) clearTimeout(temporizador);
      const tipo = errorGpsDe(e);
      setErrorPermiso(tipo === 'sin_permiso');
      setError(mensajeDe(tipo));
      setFase('reposo');
    }
  }

  async function usarMiUbicacion() {
    setError(null);
    setErrorPermiso(false);
    if (Platform.OS === 'web') {
      await obtenerPosicion();
      return;
    }
    try {
      const permiso = await Location.getForegroundPermissionsAsync();
      if (permiso.granted) {
        await obtenerPosicion();
      } else if (permiso.canAskAgain === false) {
        setErrorPermiso(true);
        setError(mensajeDe('sin_permiso'));
      } else {
        setFase('explicando');
      }
    } catch (e) {
      setError(mensajeDe(errorGpsDe(e)));
    }
  }

  async function continuarConPermiso() {
    setFase('reposo');
    try {
      const permiso = await Location.requestForegroundPermissionsAsync();
      if (!permiso.granted) {
        setErrorPermiso(true);
        setError(mensajeDe('sin_permiso'));
        return;
      }
      await obtenerPosicion();
    } catch (e) {
      setError(mensajeDe(errorGpsDe(e)));
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.encabezado}>
        <Ionicons name="navigate-circle-outline" size={18} color={colors.primary} />
        <Text style={styles.titulo} accessibilityRole="header">{t('gpsNodo.titulo')}</Text>
      </View>
      <Text style={styles.ayuda}>{t('gpsNodo.ayuda')}</Text>

      {punto ? (
        <View style={styles.guardada}>
          <Text style={styles.coordenadas} selectable>
            {t('gpsNodo.guardada', { coordenadas: formatoGps(punto) })}
          </Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('gpsNodo.abrirEnMapas')}
            onPress={() => Linking.openURL(urlMapas(punto)).catch(() => {})}
            style={styles.enlace}
          >
            <Ionicons name="map-outline" size={16} color={colors.primary} />
            <Text style={styles.enlaceTexto}>{t('gpsNodo.abrirEnMapas')}</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.vacio}>{t('gpsNodo.sinUbicacion')}</Text>
      )}

      {fase === 'explicando' ? (
        <View style={styles.explicacion} accessibilityRole="alert">
          <Text style={styles.explicacionTitulo}>{t('gpsNodo.explicacionTitulo')}</Text>
          <Text style={styles.explicacionTexto}>{t('gpsNodo.explicacion')}</Text>
          <View style={styles.fila}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('gpsNodo.continuar')}
              onPress={continuarConPermiso}
              style={[styles.boton, styles.botonPrimario]}
            >
              <Text style={styles.botonPrimarioTexto}>{t('gpsNodo.continuar')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('gpsNodo.cancelar')}
              onPress={() => setFase('reposo')}
              style={[styles.boton, styles.botonSecundario]}
            >
              <Text style={styles.botonSecundarioTexto}>{t('gpsNodo.cancelar')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <InlineError message={error} style={styles.error} />
      {errorPermiso ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('gpsNodo.abrirAjustes')}
          onPress={() => Linking.openSettings().catch(() => {})}
          style={[styles.boton, styles.botonSecundario, styles.separado]}
        >
          <Text style={styles.botonSecundarioTexto}>{t('gpsNodo.abrirAjustes')}</Text>
        </Pressable>
      ) : null}

      <View style={[styles.fila, styles.separado]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('gpsNodo.usarMiUbicacion')}
          accessibilityState={{ disabled: ocupado, busy: ocupado }}
          disabled={ocupado || fase === 'explicando'}
          onPress={usarMiUbicacion}
          style={[styles.boton, styles.botonPrimario, (ocupado || fase === 'explicando') && styles.inactivo]}
        >
          {ocupado ? (
            <View style={styles.fila}>
              <ActivityIndicator color={colors.textInverse} size="small" />
              <Text style={styles.botonPrimarioTexto}>
                {fase === 'obteniendo' ? t('gpsNodo.obteniendo') : t('formulario.guardando')}
              </Text>
            </View>
          ) : (
            <Text style={styles.botonPrimarioTexto}>{t('gpsNodo.usarMiUbicacion')}</Text>
          )}
        </Pressable>
        {punto ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('gpsNodo.quitar')}
            disabled={ocupado}
            onPress={() => guardar({ quitar_gps: true }, null)}
            style={[styles.boton, styles.botonSecundario, ocupado && styles.inactivo]}
          >
            <Text style={styles.botonSecundarioTexto}>{t('gpsNodo.quitar')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surface, padding: 12,
  },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  titulo: { fontSize: 14, fontWeight: '800', color: colors.text },
  ayuda: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  vacio: { fontSize: 13, color: colors.textBody, marginTop: 8 },
  guardada: { marginTop: 8, gap: 6 },
  coordenadas: { fontSize: 13, fontWeight: '700', color: colors.text },
  enlace: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  enlaceTexto: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  explicacion: {
    marginTop: 10, padding: 10, borderRadius: radius.md, backgroundColor: colors.primaryLight,
  },
  explicacionTitulo: { fontSize: 13, fontWeight: '800', color: colors.text },
  explicacionTexto: { fontSize: 12, color: colors.textBody, marginTop: 4, marginBottom: 8 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  separado: { marginTop: 10 },
  error: { marginTop: 8 },
  boton: {
    minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  botonPrimario: { backgroundColor: colors.primary },
  botonPrimarioTexto: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
  botonSecundario: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  botonSecundarioTexto: { color: colors.text, fontWeight: '700', fontSize: 14 },
  inactivo: { opacity: 0.6 },
});
