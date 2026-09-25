import { debeEnviarConEnter, decisionEnter } from '../enviarConEnter';

const base = { key: 'Enter', shiftKey: false, plataforma: 'web', enviando: false, texto: 'Hola' };

describe('Enter en el campo de mensaje (G-06)', () => {
  it('en web, Enter con texto envía', () => {
    expect(decisionEnter(base)).toBe('enviar');
    expect(debeEnviarConEnter(base)).toBe(true);
  });

  it('en web, Mayús+Enter deja el salto de línea', () => {
    expect(decisionEnter({ ...base, shiftKey: true })).toBe('salto');
    expect(debeEnviarConEnter({ ...base, shiftKey: true })).toBe(false);
  });

  it('en móvil nunca cambia el comportamiento (Enter es salto de línea)', () => {
    for (const plataforma of ['android', 'ios']) {
      expect(decisionEnter({ ...base, plataforma })).toBe('salto');
    }
  });

  it('otras teclas no hacen nada especial', () => {
    expect(decisionEnter({ ...base, key: 'a' })).toBe('salto');
    expect(decisionEnter({ ...base, key: 'Tab' })).toBe('salto');
  });

  it('mensaje vacío o ya enviando: Enter no envía pero tampoco mete un salto de línea', () => {
    expect(decisionEnter({ ...base, texto: '' })).toBe('nada');
    expect(decisionEnter({ ...base, texto: '   \n ' })).toBe('nada');
    expect(decisionEnter({ ...base, enviando: true })).toBe('nada');
    expect(debeEnviarConEnter({ ...base, enviando: true })).toBe(false);
  });

  it('durante la composición de un IME, Enter confirma la palabra y no envía', () => {
    expect(decisionEnter({ ...base, componiendo: true })).toBe('salto');
  });
});
