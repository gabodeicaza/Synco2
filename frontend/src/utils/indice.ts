// Logica del editor del indice de PDF/PPTX. `aplicarOrden` es el espejo exacto
// de `_indice_apply_order` (server.py): el editor muestra las secciones en el
// mismo orden en que el servidor las va a dejar en el documento.
import type { IndiceConfig, IndicePeriodo, IndiceSeccion } from '@/src/api';

export const INDICE_PERIODOS: { value: IndicePeriodo; label: string }[] = [
  { value: 'diario', label: 'Diario' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'mensual', label: 'Mensual' },
];

export const INDICE_CONFIG_DEFAULT: IndiceConfig = {
  enabled: true,
  titulo: 'ÍNDICE',
  order: [],
  titles: {},
  hidden: [],
  portadillas_area: true,
};

// Las claves guardadas (que aun existen) se reparten, en el orden guardado,
// entre los huecos que ocupaban en el orden natural; una seccion nueva
// conserva su posicion natural.
export function aplicarOrden(natural: string[], guardado: string[]): string[] {
  const conocidas = new Set(natural);
  const guardadas = guardado.filter((k) => conocidas.has(k));
  const setGuardadas = new Set(guardadas);
  let i = 0;
  return natural.map((k) => (setGuardadas.has(k) ? guardadas[i++] : k));
}

// Secciones en el orden en que quedaran en el documento.
export function seccionesOrdenadas(estructura: IndiceSeccion[], config: IndiceConfig): IndiceSeccion[] {
  const porClave = new Map(estructura.map((s) => [s.key, s]));
  return aplicarOrden(estructura.map((s) => s.key), config.order).map((k) => porClave.get(k)!);
}

// Mueve la seccion `key` una posicion y devuelve la config con el orden
// COMPLETO explicito (asi el servidor reproduce exactamente lo que se ve).
export function moverSeccion(
  estructura: IndiceSeccion[], config: IndiceConfig, key: string, delta: -1 | 1,
): IndiceConfig {
  const claves = seccionesOrdenadas(estructura, config).map((s) => s.key);
  const i = claves.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= claves.length) return config;
  [claves[i], claves[j]] = [claves[j], claves[i]];
  return { ...config, order: claves };
}

export function renombrarSeccion(config: IndiceConfig, key: string, titulo: string): IndiceConfig {
  const titles = { ...config.titles };
  if (titulo.trim()) titles[key] = titulo;
  else delete titles[key];
  return { ...config, titles };
}

export function alternarOculta(config: IndiceConfig, key: string): IndiceConfig {
  const hidden = config.hidden.includes(key)
    ? config.hidden.filter((k) => k !== key)
    : [...config.hidden, key];
  return { ...config, hidden };
}
