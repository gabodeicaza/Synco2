import { etiquetaPeriodo, periodoDePresentacion, textoRangoPeriodo, variacionCostoUI } from '../finanzas';

describe('variacionCostoUI (A-04)', () => {
  it('sin gasto real (null) muestra "—", la nota de sin gasto y ningún color de semáforo', () => {
    expect(variacionCostoUI(null)).toEqual({ valor: '—', nota: 'Sin gasto real capturado', tono: null });
    expect(variacionCostoUI(undefined).valor).toBe('—');
  });

  it('con gasto muestra el monto y el tono según el signo', () => {
    expect(variacionCostoUI('1500.50')).toEqual({ valor: '$1,500.50', nota: 'Ganado − Real', tono: 'positivo' });
    expect(variacionCostoUI('-20.00').tono).toBe('negativo');
  });

  it('un CV de exactamente 0 (con gasto) es positivo, no "—"', () => {
    const cv = variacionCostoUI('0.00');
    expect(cv.valor).toBe('$0.00');
    expect(cv.tono).toBe('positivo');
  });
});

describe('periodos financieros (A-05)', () => {
  it('una presentación sin periodo o con uno desconocido usa el mes actual', () => {
    expect(periodoDePresentacion(undefined)).toBe('mes_actual');
    expect(periodoDePresentacion('semana')).toBe('mes_actual');
    expect(periodoDePresentacion('ultimos_3_meses')).toBe('ultimos_3_meses');
    expect(periodoDePresentacion('proyecto_completo')).toBe('proyecto_completo');
  });

  it('las etiquetas son las mismas del tablero, con acentos', () => {
    expect(etiquetaPeriodo('mes_actual')).toBe('Mes actual');
    expect(etiquetaPeriodo('ultimos_3_meses')).toBe('Últimos 3 meses');
    expect(etiquetaPeriodo('proyecto_completo')).toBe('Proyecto completo');
  });

  it('imprime el rango del periodo y queda vacío si faltan fechas', () => {
    expect(textoRangoPeriodo('2026-09-01', '2026-09-24')).toBe('Periodo: Del 1 al 24 de septiembre de 2026');
    expect(textoRangoPeriodo(null, '2026-09-24')).toBe('');
    expect(textoRangoPeriodo(undefined, undefined)).toBe('');
  });
});
