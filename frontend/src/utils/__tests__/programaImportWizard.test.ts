import {
  filasFueraCount, quedanFueraLabel, puedeValidar, pasoInicialDeSesionPendiente,
} from '../programaImportWizard';

describe('filasFueraCount / quedanFueraLabel', () => {
  it('suma error + descartado + sin_distribucion, no cuenta ok', () => {
    const resumen = { total: 10, ok: 5, error: 2, descartado: 1, sin_distribucion: 2 };
    expect(filasFueraCount(resumen)).toBe(5);
    expect(quedanFueraLabel(resumen)).toBe(' (5 quedarán fuera)');
  });

  it('sin filas fuera, el label queda vacío', () => {
    const resumen = { total: 3, ok: 3, error: 0, descartado: 0, sin_distribucion: 0 };
    expect(filasFueraCount(resumen)).toBe(0);
    expect(quedanFueraLabel(resumen)).toBe('');
  });

  it('resumen null no revienta', () => {
    expect(filasFueraCount(null)).toBe(0);
    expect(quedanFueraLabel(null)).toBe('');
  });
});

describe('puedeValidar', () => {
  it('exige codigo + importe + al menos un mes', () => {
    expect(puedeValidar({ codigo: 'Codigo', importe: 'Importe', meses: ['Mes 1'] })).toBe(true);
    expect(puedeValidar({ codigo: 'Codigo', importe: 'Importe', meses: [] })).toBe(false);
    expect(puedeValidar({ importe: 'Importe', meses: ['Mes 1'] })).toBe(false);
    expect(puedeValidar({ codigo: 'Codigo', meses: ['Mes 1'] })).toBe(false);
  });
});

describe('pasoInicialDeSesionPendiente', () => {
  it('si ya se validó, va directo a revisión sin importar cuántas hojas tenga', () => {
    expect(pasoInicialDeSesionPendiente({ validado: true, sheet_names: ['A', 'B'] })).toBe('revision');
  });

  it('sin validar y una sola hoja, va a mapeo', () => {
    expect(pasoInicialDeSesionPendiente({ validado: false, sheet_names: ['A'] })).toBe('mapeo');
  });

  it('sin validar y varias hojas, va a elegir hoja', () => {
    expect(pasoInicialDeSesionPendiente({ validado: false, sheet_names: ['A', 'B'] })).toBe('hoja');
  });
});
