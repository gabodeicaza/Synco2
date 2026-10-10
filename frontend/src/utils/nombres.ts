// Comparación de nombres para detectar duplicados (K-07): sin acentos, sin
// mayúsculas y sin espacios sobrantes ("  Topografía " == "topografia").
function sinAcentos(s: string): string {
  try {
    if (!s.normalize) return s;
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    return s;
  }
}

export function normalizarNombre(s: string | null | undefined): string {
  return sinAcentos((s ?? '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

export function esNombreRepetido(nombre: string, existentes: Array<string | null | undefined>): boolean {
  const buscado = normalizarNombre(nombre);
  if (!buscado) return false;
  return existentes.some((e) => normalizarNombre(e) === buscado);
}
