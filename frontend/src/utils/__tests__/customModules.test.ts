import {
  campoNuevo, campoVisible, evaluarFormula, fmtValor, formulaDesdeTokens, formulaLegible, PLANTILLAS,
  recalcular, tokensFormula, validarCaptura, validarDefinicion, valoresIniciales,
} from '../customModules';
import type { CustomCampo } from '@/src/api';

const num = (id: string, extra: Partial<CustomCampo> = {}): CustomCampo => ({ ...campoNuevo('numero', id), id, ...extra });

describe('fórmulas', () => {
  it('respeta precedencia, paréntesis y negativos', () => {
    expect(evaluarFormula('{a} + {b} * 2', { a: 1, b: 3 })).toBe(7);
    expect(evaluarFormula('({a} + {b}) * 2', { a: 1, b: 3 })).toBe(8);
    expect(evaluarFormula('-{a} + 10', { a: 4 })).toBe(6);
  });
  it('referencias vacías valen 0 y dividir entre 0 da null', () => {
    expect(evaluarFormula('{a} + {b}', { a: 5, b: '' })).toBe(5);
    expect(evaluarFormula('{a} / {b}', { a: 1, b: 0 })).toBeNull();
  });
  it('rechaza sintaxis inválida sin ejecutar nada', () => {
    for (const mala of ['', '{a} +', '(1 + 2', '1 2', "alert('x')", '{a} ** 2']) {
      expect(evaluarFormula(mala, { a: 1 })).toBeNull();
    }
  });
  it('tokens ida y vuelta y texto legible', () => {
    const f = '{cant} * {pu} + 10';
    expect(formulaDesdeTokens(tokensFormula(f))).toBe(f);
    const campos = [num('cant', { etiqueta: 'Cantidad' }), num('pu', { etiqueta: 'P.U.' })];
    expect(formulaLegible(f, campos)).toBe('[Cantidad] × [P.U.] + 10');
  });
});

describe('formato de valores', () => {
  it('numeros, moneda, porcentaje, fecha, interruptor y multiselección', () => {
    expect(fmtValor(num('a', { unidad: 'm3' }), 1234.5)).toBe('1,234.5 m3');
    expect(fmtValor({ ...campoNuevo('moneda'), id: 'm' }, 1234.5)).toBe('$1,234.50');
    expect(fmtValor({ ...campoNuevo('porcentaje'), id: 'p', decimales: 1 }, 12)).toBe('12.0%');
    expect(fmtValor({ ...campoNuevo('fecha'), id: 'f' }, '2026-06-24')).toBe('24/06/2026');
    expect(fmtValor({ ...campoNuevo('interruptor'), id: 'i' }, false)).toBe('No');
    expect(fmtValor({ ...campoNuevo('multiseleccion'), id: 'ms' }, ['A', 'B'])).toBe('A, B');
    expect(fmtValor(num('a'), null)).toBe('');
  });
  it('un calculado se muestra con su formato (moneda)', () => {
    const c: CustomCampo = { ...campoNuevo('calculado'), id: 'imp', formato: 'moneda', formula: '{a}' };
    expect(fmtValor(c, 255)).toBe('$255.00');
  });
});

describe('captura', () => {
  const campos: CustomCampo[] = [
    { ...campoNuevo('texto', 'Descripción'), id: 'desc', requerido: true },
    num('cant'), num('pu'),
    { ...campoNuevo('calculado', 'Importe'), id: 'imp', formula: '{cant} * {pu}' },
    { ...campoNuevo('interruptor', 'Conforme'), id: 'ok', valor_defecto: true },
    { ...campoNuevo('texto', 'Motivo'), id: 'motivo', requerido: true, visible_si: { campo: 'ok', igual: false } },
    { ...campoNuevo('foto', 'Evidencia'), id: 'foto', requerido: true },
  ];
  it('valores iniciales y recálculo', () => {
    const v = valoresIniciales(campos);
    expect(v.ok).toBe(true);
    expect(recalcular(campos, { ...v, cant: '3', pu: 2 }).imp).toBe(6);
  });
  it('campos condicionales solo se exigen si están visibles', () => {
    const v = { ...valoresIniciales(campos), desc: 'Acero' };
    expect(campoVisible(campos[5], v)).toBe(false);
    expect(validarCaptura(campos, v, { foto: 'x' })).toBeNull();
    expect(validarCaptura(campos, { ...v, ok: false }, { foto: 'x' })).toMatch(/Motivo/);
  });
  it('exige obligatorios, fotos y números válidos', () => {
    expect(validarCaptura(campos, valoresIniciales(campos), { foto: 'x' })).toMatch(/Descripción/);
    expect(validarCaptura(campos, { ...valoresIniciales(campos), desc: 'x' }, {})).toMatch(/Evidencia/);
    expect(validarCaptura(campos, { ...valoresIniciales(campos), desc: 'x', cant: 'abc' }, { foto: 'x' })).toMatch(/número válido/);
  });
});

describe('definición y plantillas', () => {
  it('toda plantilla de inicio es una definición válida', () => {
    for (const p of PLANTILLAS.filter((x) => x.clave !== 'blanco')) {
      const d = p.crear();
      expect(validarDefinicion({ ...d })).toBeNull();
      const ids = (d.campos || []).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it('detecta nombre vacío, sin campos, lista sin opciones y fórmula vacía', () => {
    expect(validarDefinicion({ nombre: ' ', campos: [num('a')] })).toMatch(/nombre/);
    expect(validarDefinicion({ nombre: 'x', campos: [] })).toMatch(/campo/);
    expect(validarDefinicion({ nombre: 'x', campos: [{ ...campoNuevo('seleccion', 'L'), opciones: [''] }] })).toMatch(/opción/);
    expect(validarDefinicion({ nombre: 'x', campos: [{ ...campoNuevo('calculado', 'C'), formula: '' }] })).toMatch(/fórmula/i);
  });
});
