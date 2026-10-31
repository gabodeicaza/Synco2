// Slide "Portada". Con plantilla PPTX subida dibuja la MISMA portada que sale en el
// PowerPoint/PDF (fondo + logos compuestos por el backend y los textos encima, en su
// posición y tamaño). Sin plantilla cae a un fondo liso con el color de marca.
import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, LayoutChangeEvent } from 'react-native';
import { contrastText } from '@/src/theme';
import type { PortadaPresentacion } from '@/src/api';

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/** '2026-10-30' → '30 OCTUBRE DE 2026' (igual que el PPTX). */
function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} DE ${m[1]}` : iso;
}

export function SlidePortada({
  titulo, fecha, colorTema, portada, objeto,
}: { titulo: string; fecha: string; colorTema: string; portada?: PortadaPresentacion | null; objeto?: string }) {
  const [caja, setCaja] = useState<{ w: number; h: number } | null>(null);
  const textColor = contrastText(colorTema);

  if (portada?.image && portada.aspecto) {
    const onLayout = (e: LayoutChangeEvent) => setCaja({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
    const w = caja ? Math.min(caja.w, caja.h * portada.aspecto) : 0;
    const h = w / portada.aspecto;
    return (
      <View style={styles.centro} onLayout={onLayout}>
        {caja ? (
          <View style={{ width: w, height: h, overflow: 'hidden' }}>
            <Image source={{ uri: portada.image }} style={{ width: w, height: h }} resizeMode="stretch" />
            {(portada.cuadros || []).map((c, i) => (
              <Text
                key={i} numberOfLines={i === 2 ? 3 : 2} adjustsFontSizeToFit
                style={{
                  position: 'absolute', left: c.x * w, top: c.y * h, width: c.w * w, height: c.h * h,
                  fontSize: c.pt_rel * w, lineHeight: c.pt_rel * w * 1.15, color: c.color,
                  fontWeight: c.negrita ? '700' : '400',
                }}
              >
                {c.texto}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: colorTema }]}>
      <Text style={[styles.titulo, { color: textColor }]}>{titulo}</Text>
      <Text style={[styles.fecha, { color: textColor }]}>{fechaLarga(fecha)}</Text>
      {objeto ? <Text style={[styles.objeto, { color: textColor }]}>{objeto.toUpperCase()}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  // Mismo formato que la portada del PPTX sin plantilla: texto a la izquierda, título grande, fecha y objeto.
  wrap: { flex: 1, alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 24 },
  titulo: { fontSize: 34, fontWeight: '800', letterSpacing: 0.5, marginBottom: 8 },
  fecha: { fontSize: 20, fontWeight: '700', marginBottom: 18 },
  objeto: { fontSize: 12, fontWeight: '700', maxWidth: '60%' },
});
