import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

export const GRAVEDAD_COLOR: Record<string, string> = { verde: '#16A34A', amarillo: '#EAB308', rojo: '#DC2626' };

export type GravedadFiltroValor = 'todas' | 'verde' | 'amarillo' | 'rojo';

/** Gravedad efectiva de un reporte: sin dato = verde (informativo). */
export function gravedadDe(r: { gravedad?: string | null }): 'verde' | 'amarillo' | 'rojo' {
  return r.gravedad === 'amarillo' || r.gravedad === 'rojo' ? r.gravedad : 'verde';
}

/** Filtra una lista de reportes por gravedad ('todas' no filtra). */
export function filtrarPorGravedad<T extends { gravedad?: string | null }>(lista: T[], filtro: GravedadFiltroValor): T[] {
  return filtro === 'todas' ? lista : lista.filter((r) => gravedadDe(r) === filtro);
}

/** Punto del semáforo de gravedad del reporte (verde / amarillo / rojo). Sin dato = verde. */
export function GravedadDot({ gravedad, size = 10 }: { gravedad?: string | null; size?: number }) {
  const g = gravedadDe({ gravedad });
  return <View accessibilityLabel={`Gravedad ${g}`} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: GRAVEDAD_COLOR[g] }} />;
}

const OPCIONES: { key: GravedadFiltroValor; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'verde', label: 'Informativo' },
  { key: 'amarillo', label: 'Relevante' },
  { key: 'rojo', label: 'Grave' },
];

/** Chips para filtrar los reportes del Inicio por semáforo de gravedad. */
export function GravedadFiltro({ valor, onChange }: { valor: GravedadFiltroValor; onChange: (v: GravedadFiltroValor) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4, gap: 8 }}>
      {OPCIONES.map((o) => {
        const activo = valor === o.key;
        const color = o.key === 'todas' ? '#1E40AF' : GRAVEDAD_COLOR[o.key];
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: activo }}
            onPress={() => onChange(o.key)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: color, backgroundColor: activo ? color : '#fff' }}
          >
            {o.key !== 'todas' && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: activo ? '#fff' : color }} />}
            <Text style={{ fontSize: 13, fontWeight: '600', color: activo ? '#fff' : color }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
