// Búsqueda de personas por texto libre (nombre, puesto, rol, área). Ignora mayúsculas y acentos,
// y exige que TODAS las palabras escritas aparezcan (en cualquier orden), así "ana top" encuentra
// a "Ana Pérez · Topografía".
export interface PersonaBuscable {
  name?: string | null;
  role?: string | null;
  puesto?: string | null;
  area?: string | null;
}

export function normalizarBusqueda(txt: string): string {
  return (txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/_/g, ' ').toLowerCase().trim();
}

export function coincidePersona(p: PersonaBuscable, consulta: string): boolean {
  const palabras = normalizarBusqueda(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return true;
  const pajar = normalizarBusqueda([p.name, p.puesto, p.role, p.area].filter(Boolean).join(' '));
  return palabras.every((w) => pajar.includes(w));
}

export function filtrarPersonas<T extends PersonaBuscable>(lista: T[], consulta: string): T[] {
  return consulta.trim() ? lista.filter((p) => coincidePersona(p, consulta)) : lista;
}
