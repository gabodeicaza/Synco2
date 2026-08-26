import {
  quedanFueraLabel, filasFueraCount, puedeValidar, pasoSiguienteTrasSubir, pasoAnterior, retroceder, pasoInicialDeSesionPendiente,
  WizardState,
} from '../importWizard';

describe('filasFueraCount', () => {
  it('0 sin resumen', () => {
    expect(filasFueraCount(null)).toBe(0);
  });
  it('suma error + descartado', () => {
    expect(filasFueraCount({ total: 10, ok: 3, advertencia: 2, error: 3, duplicado: 1, descartado: 1 })).toBe(4);
  });
});

describe('quedanFueraLabel', () => {
  it('vacío cuando no hay resumen', () => {
    expect(quedanFueraLabel(null)).toBe('');
  });

  it('vacío cuando no queda nada fuera', () => {
    expect(quedanFueraLabel({ total: 5, ok: 5, advertencia: 0, error: 0, duplicado: 0, descartado: 0 })).toBe('');
  });

  it('suma error + descartado, ignora advertencia y duplicado', () => {
    expect(quedanFueraLabel({ total: 10, ok: 3, advertencia: 2, error: 3, duplicado: 1, descartado: 1 })).toBe(' (4 quedarán fuera)');
  });
});

describe('puedeValidar', () => {
  const partidaId = 'p1';
  it('false si falta cualquier campo obligatorio del mapeo', () => {
    expect(puedeValidar({}, partidaId)).toBe(false);
    expect(puedeValidar({ clave: 'A' }, partidaId)).toBe(false);
    expect(puedeValidar({ clave: 'A', descripcion: 'B', cantidad: 'C' }, partidaId)).toBe(false);
  });

  it('false si no hay partida elegida, aunque el mapeo esté completo', () => {
    const mapping = { clave: 'A', descripcion: 'B', cantidad: 'C', precio_unitario: 'D' };
    expect(puedeValidar(mapping, null)).toBe(false);
  });

  it('true con los 4 campos obligatorios + partida, unidad/importe opcionales', () => {
    const mapping = { clave: 'A', descripcion: 'B', cantidad: 'C', precio_unitario: 'D' };
    expect(puedeValidar(mapping, partidaId)).toBe(true);
  });
});

describe('pasoSiguienteTrasSubir', () => {
  it('va a "hoja" si el libro tiene varias hojas', () => {
    expect(pasoSiguienteTrasSubir(true)).toBe('hoja');
  });
  it('salta directo a "mapeo" si solo tiene una', () => {
    expect(pasoSiguienteTrasSubir(false)).toBe('mapeo');
  });
});

describe('pasoAnterior', () => {
  it('de "hoja" siempre vuelve a "archivo"', () => {
    expect(pasoAnterior('hoja', true)).toBe('archivo');
  });
  it('de "mapeo" vuelve a "hoja" si hubo selección de hoja, si no a "archivo"', () => {
    expect(pasoAnterior('mapeo', true)).toBe('hoja');
    expect(pasoAnterior('mapeo', false)).toBe('archivo');
  });
  it('de "revision" vuelve a "mapeo"', () => {
    expect(pasoAnterior('revision', true)).toBe('mapeo');
    expect(pasoAnterior('revision', false)).toBe('mapeo');
  });
});

describe('retroceder — no pierde mapeo/partida/convención', () => {
  it('cambia el paso pero preserva el resto del estado por referencia', () => {
    const mapping = { clave: 'Clave', descripcion: 'Desc', cantidad: 'Cant', precio_unitario: 'PU' };
    const estado: WizardState = {
      step: 'revision',
      sheetNames: ['Hoja1', 'Hoja2'],
      mapping,
      partidaId: 'partida-123',
      convencion: 'coma',
    };
    const anterior = retroceder(estado);

    expect(anterior.step).toBe('mapeo');
    expect(anterior.mapping).toBe(mapping); // misma referencia: no se reconstruyó ni se vació
    expect(anterior.partidaId).toBe('partida-123');
    expect(anterior.convencion).toBe('coma');
    expect(anterior.sheetNames).toBe(estado.sheetNames);
  });

  it('retroceder dos veces desde mapeo (con varias hojas) pasa por hoja sin perder nada', () => {
    const mapping = { clave: 'Clave', descripcion: 'Desc', cantidad: 'Cant', precio_unitario: 'PU' };
    let estado: WizardState = { step: 'mapeo', sheetNames: ['A', 'B'], mapping, partidaId: 'p1', convencion: 'punto' };

    estado = retroceder(estado);
    expect(estado.step).toBe('hoja');
    expect(estado.mapping).toBe(mapping);
    expect(estado.partidaId).toBe('p1');
    expect(estado.convencion).toBe('punto');

    estado = retroceder(estado);
    expect(estado.step).toBe('archivo');
    expect(estado.mapping).toBe(mapping);
    expect(estado.partidaId).toBe('p1');
    expect(estado.convencion).toBe('punto');
  });
});

describe('pasoInicialDeSesionPendiente', () => {
  it('salta directo a revisión si ya se validó (no hace falta re-validar)', () => {
    expect(pasoInicialDeSesionPendiente({ validado: true, sheet_names: ['Hoja1'] })).toBe('revision');
  });
  it('manda a elegir hoja si no se validó y el archivo tiene varias hojas', () => {
    expect(pasoInicialDeSesionPendiente({ validado: false, sheet_names: ['Hoja1', 'Hoja2'] })).toBe('hoja');
  });
  it('manda directo a mapeo si no se validó y el archivo tiene una sola hoja', () => {
    expect(pasoInicialDeSesionPendiente({ validado: false, sheet_names: ['Hoja1'] })).toBe('mapeo');
  });
});
