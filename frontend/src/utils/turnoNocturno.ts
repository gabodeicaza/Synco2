// Turno nocturno del proyecto: horario único "HH:MM" (puede cruzar la medianoche).
// Ambos vacíos = sin turno nocturno. El servidor vuelve a validar.

export type ResultadoTurno =
  | { ok: true; inicio: string | null; fin: string | null }
  | { ok: false; motivo: 'formato' | 'iguales' };

/** "8:05" -> "08:05"; vacío -> null; inválido -> undefined. */
export function normalizarHora(valor: string): string | null | undefined {
  const v = (valor || '').trim();
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function validarTurnoNocturno(inicio: string, fin: string): ResultadoTurno {
  const i = normalizarHora(inicio);
  const f = normalizarHora(fin);
  if (i === undefined || f === undefined) return { ok: false, motivo: 'formato' };
  if ((i === null) !== (f === null)) return { ok: false, motivo: 'formato' };
  if (i !== null && i === f) return { ok: false, motivo: 'iguales' };
  return { ok: true, inicio: i, fin: f };
}
