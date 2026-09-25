import { mensajesDeFlush } from '../resumenFlushCola';

const resumen = (p: Partial<{ synced: number; failed: number; remaining: number; skippedOffline: boolean }> = {}) => ({
  synced: 0, failed: 0, remaining: 0, skippedOffline: false, ...p,
});

describe('mensajesDeFlush', () => {
  it('sin nada que decir no avisa', () => {
    expect(mensajesDeFlush(resumen(), resumen(), false)).toEqual([]);
    expect(mensajesDeFlush(null, null, true)).toEqual([]);
  });

  it('avisa los reportes y los avances sincronizados, en singular y plural', () => {
    expect(mensajesDeFlush(resumen({ synced: 1 }), resumen({ synced: 1 }), false)).toEqual([
      '1 reporte sincronizado',
      '1 registro de avance sincronizado',
    ]);
    expect(mensajesDeFlush(resumen({ synced: 3 }), resumen({ synced: 2 }), false)).toEqual([
      '3 reportes sincronizados',
      '2 registros de avance sincronizados',
    ]);
  });

  it('un pendiente rechazado por el servidor se avisa aunque el flush sea automático', () => {
    const m = mensajesDeFlush(resumen({ failed: 1, remaining: 1 }), resumen({ failed: 2, remaining: 2 }), false);
    expect(m).toEqual(['No se pudieron enviar 3 pendientes: revisa el detalle.']);
  });

  it('en un reintento manual que no pudo enviar nada dice que revise la conexión', () => {
    expect(mensajesDeFlush(resumen({ remaining: 2 }), resumen(), true)).toEqual([
      'No se pudo sincronizar. Revisa tu conexión.',
    ]);
  });

  it('no dice "revisa tu conexión" en un flush automático ni si simplemente no había red', () => {
    expect(mensajesDeFlush(resumen({ remaining: 2 }), resumen(), false)).toEqual([]);
    expect(mensajesDeFlush(resumen({ remaining: 2, skippedOffline: true }), resumen({ remaining: 1, skippedOffline: true }), true)).toEqual([]);
  });

  it('un avance sincronizado y otro rechazado se avisan los dos', () => {
    expect(mensajesDeFlush(resumen(), resumen({ synced: 2, failed: 1, remaining: 1 }), false)).toEqual([
      '2 registros de avance sincronizados',
      'No se pudieron enviar 1 pendientes: revisa el detalle.',
    ]);
  });
});
