// Enter en el campo de mensaje (G-06). En web Enter envía y Mayús+Enter hace salto de línea;
// en móvil no cambia nada (Enter es salto de línea y se envía con el botón).
export type DecisionEnter = 'enviar' | 'nada' | 'salto';

export interface EntradaEnter {
  key: string;
  shiftKey?: boolean;
  /** Platform.OS */
  plataforma: string;
  enviando: boolean;
  texto: string;
  /** Composición de un IME (acentos, japonés...): Enter confirma la palabra, no envía. */
  componiendo?: boolean;
}

/**
 * - 'enviar': hay que enviar (y evitar el salto de línea).
 * - 'nada': Enter sin efecto (mensaje vacío o ya enviando): hay que evitar el salto de línea.
 * - 'salto': comportamiento normal del campo (móvil, Mayús+Enter, otras teclas, IME).
 */
export function decisionEnter(e: EntradaEnter): DecisionEnter {
  if (e.plataforma !== 'web') return 'salto';
  if (e.key !== 'Enter' || e.shiftKey || e.componiendo) return 'salto';
  if (e.enviando || !e.texto.trim()) return 'nada';
  return 'enviar';
}

export function debeEnviarConEnter(e: EntradaEnter): boolean {
  return decisionEnter(e) === 'enviar';
}
