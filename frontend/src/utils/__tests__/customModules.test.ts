import {
  campoEstatus, campoNuevo, campoVisible, estaCerrado, evaluarFormula, fechaIso, filasParaImportar, filtrarRegistros,
  FILTROS_VACIOS, fmtValor, formulaDesdeTokens, formulaLegible, hayFiltros, mapearColumnas, moduloDesdePlantilla, PLANTILLAS,
  recalcular, tokensFormula, validarCaptura, validarDefinicion, valoresIniciales, valorCelda,
} from '../customModules';
import type { CustomCampo, CustomRecord, CustomTemplate } from '@/src/api';

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

describe('estatus y filtros', () => {
  const campos: CustomCampo[] = [
    { ...campoNuevo('texto', 'Asunto'), id: 'asunto' },
    { ...campoEstatus(), id: 'est' },
    { ...campoNuevo('interruptor', 'Urgente'), id: 'urg' },
  ];
  const reg = (id: string, fecha: string, est: string, urg: boolean, autor: string, asunto = 'x'): CustomRecord => ({
    id, project_id: 'p', module_id: 'm', fecha, valores: { asunto, est, urg }, created_by_name: autor, folio: `F-${id}`,
  });
  const lista = [
    reg('1', '2026-06-20', 'Abierto', true, 'Ana', 'Fuga de agua'),
    reg('2', '2026-06-25', 'Cerrado', false, 'Beto', 'Poste torcido'),
    reg('3', '2026-06-27', 'En proceso', false, 'Ana', 'Grieta'),
  ];
  it('campoEstatus nace con opciones, cierre y valor inicial', () => {
    const e = campoEstatus();
    expect(e.estatus).toBe(true);
    expect(e.cierre).toEqual(['Cerrado']);
    expect(e.valor_defecto).toBe('Abierto');
    expect(valoresIniciales([e])[e.id]).toBe('Abierto');
  });
  it('estaCerrado usa las opciones de cierre', () => {
    expect(estaCerrado(campos, lista[1])).toBe(true);
    expect(estaCerrado(campos, lista[0])).toBe(false);
  });
  it('filtra por fecha, autor, estatus, abiertos, campo y texto (incl. folio)', () => {
    const f = (p: Partial<typeof FILTROS_VACIOS>) => filtrarRegistros(lista, campos, { ...FILTROS_VACIOS, ...p }).map((r) => r.id);
    expect(f({})).toEqual(['1', '2', '3']);
    expect(f({ desde: '24/06/2026' })).toEqual(['2', '3']);
    expect(f({ hasta: '2026-06-25' })).toEqual(['1', '2']);
    expect(f({ autor: 'Ana' })).toEqual(['1', '3']);
    expect(f({ estatus: 'Cerrado' })).toEqual(['2']);
    expect(f({ soloAbiertos: true })).toEqual(['1', '3']);
    expect(f({ campoId: 'urg', campoValor: 'si' })).toEqual(['1']);
    expect(f({ campoId: 'urg', campoValor: 'no' })).toEqual(['2', '3']);
    expect(f({ texto: 'POSTE' })).toEqual(['2']);
    expect(f({ texto: 'f-3' })).toEqual(['3']);
    expect(f({ autor: 'Ana', soloAbiertos: true, desde: '2026-06-26' })).toEqual(['3']);
  });
  it('hayFiltros ignora el texto de búsqueda y fechaIso normaliza', () => {
    expect(hayFiltros({ ...FILTROS_VACIOS, texto: 'a' })).toBe(false);
    expect(hayFiltros({ ...FILTROS_VACIOS, autor: 'Ana' })).toBe(true);
    expect(fechaIso('5/6/26')).toBe('2026-06-05');
    expect(fechaIso('2026-6-5')).toBe('2026-06-05');
    expect(fechaIso('hola')).toBe('');
  });
});

describe('importación desde Excel', () => {
  const campos: CustomCampo[] = [
    { ...campoNuevo('texto', 'Descripción'), id: 'desc', requerido: true },
    { ...campoNuevo('numero', 'Cantidad'), id: 'cant' },
    { ...campoNuevo('foto', 'Foto'), id: 'foto' },
    { ...campoNuevo('calculado', 'Importe'), id: 'imp', formula: '{cant}' },
  ];
  it('empareja columnas por nombre (sin acentos ni asterisco) e ignora foto/calculados', () => {
    const m = mapearColumnas(['Fecha', 'DESCRIPCION *', 'cantidad', 'Foto', 'Importe', 'Notas', ''], campos);
    expect(m).toEqual(['fecha', 'desc', 'cant', null, null, null, null]);
  });
  it('convierte fechas de Excel a ISO y recorta textos', () => {
    expect(valorCelda(new Date(Date.UTC(2026, 5, 24)))).toBe('2026-06-24');
    expect(valorCelda('  hola ')).toBe('hola');
    expect(valorCelda(12)).toBe(12);
  });
  it('arma las filas con su número real de hoja y salta las vacías', () => {
    const rows = [
      ['Fecha', 'Descripción *', 'Cantidad', 'Columna extra'],
      [new Date(Date.UTC(2026, 5, 24)), 'Acero', 10, 'x'],
      [null, null, null, null],
      [null, ' Grava ', '2,5', null],
    ];
    const r = filasParaImportar(rows, campos);
    expect(r.filas).toEqual([
      { fila: 2, fecha: '2026-06-24', valores: { desc: 'Acero', cant: 10 } },
      { fila: 4, valores: { desc: 'Grava', cant: '2,5' } },
    ]);
    expect(r.columnasIgnoradas).toEqual(['Columna extra']);
    expect(filasParaImportar([], campos).filas).toEqual([]);
  });
});

describe('plantillas propias', () => {
  it('moduloDesdePlantilla completa lo que falte y libera el área', () => {
    const t: CustomTemplate = {
      id: 't', nombre: 'Mía', descripcion: '', created_at: '',
      definicion: { nombre: 'Mía', campos: [{ ...campoNuevo('texto', 'A'), id: 'a' }], opciones: { folio_activo: true } as any },
    };
    const m = moduloDesdePlantilla(t);
    expect(m.area_id).toBeNull();
    expect(m.opciones?.folio_activo).toBe(true);
    expect(m.opciones?.texto_vacio).toBeTruthy(); // lo no guardado toma el valor por defecto
    expect(m.salida?.reportes_semanales.modo).toBe('oculto');
    expect(m.graficas).toEqual([]);
    expect(validarDefinicion(m)).toBeNull();
  });
  it('la plantilla de seguimiento trae folio, estatus y gráfica coherentes', () => {
    const d = PLANTILLAS.find((p) => p.clave === 'seguimiento')!.crear();
    expect(d.opciones?.folio_activo).toBe(true);
    const est = d.campos!.find((c) => c.estatus)!;
    expect(est.cierre).toEqual(['Cerrado']);
    expect(d.graficas![0].categoria).toBe(est.id);
  });
});
