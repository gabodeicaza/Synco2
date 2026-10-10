import {
  ayudaVigencia, etiquetaVigencia, textoTiempoRestante, vigenciaParaGuardar, vigenciaValida, VIGENCIAS_HORAS,
} from '../vigenciaNoticias';

const AHORA = Date.parse('2026-09-24T12:00:00Z');
const en = (minutos: number) => new Date(AHORA + minutos * 60000).toISOString();

describe('vigencia de noticias (G-05)', () => {
  it('las opciones son exactamente 6 h, 24 h, 48 h y 7 días', () => {
    expect([...VIGENCIAS_HORAS]).toEqual([6, 24, 48, 168]);
    expect(VIGENCIAS_HORAS.map(etiquetaVigencia)).toEqual(['6 horas', '24 horas', '48 horas', '7 días']);
  });

  it('vigenciaValida cae a 24 con valores raros o ausentes (noticias anteriores)', () => {
    expect(vigenciaValida(48)).toBe(48);
    expect(vigenciaValida(undefined)).toBe(24);
    expect(vigenciaValida(null)).toBe(24);
    expect(vigenciaValida(12)).toBe(24);
    expect(vigenciaValida('168')).toBe(24);
  });

  it('el texto de ayuda cambia con la vigencia elegida', () => {
    expect(ayudaVigencia(6)).toMatch(/6 horas/);
    expect(ayudaVigencia(168)).toMatch(/7 días/);
    expect(ayudaVigencia(24)).not.toEqual(ayudaVigencia(48));
  });

  it('tiempo restante: minutos, horas, días y por expirar', () => {
    expect(textoTiempoRestante(en(45), AHORA)).toBe('Vence en 45 min');
    expect(textoTiempoRestante(en(5 * 60), AHORA)).toBe('Vence en 5 h');
    expect(textoTiempoRestante(en(47 * 60), AHORA)).toBe('Vence en 47 h');
    expect(textoTiempoRestante(en(3 * 24 * 60), AHORA)).toBe('Vence en 3 d');
    expect(textoTiempoRestante(en(-1), AHORA)).toBe('Por expirar');
    expect(textoTiempoRestante(en(0), AHORA)).toBe('Por expirar');
  });

  it('nunca dice "0 min": menos de un minuto redondea a 1', () => {
    expect(textoTiempoRestante(new Date(AHORA + 20000).toISOString(), AHORA)).toBe('Vence en 1 min');
  });

  it('sin fecha o con fecha inválida no muestra nada', () => {
    expect(textoTiempoRestante(undefined, AHORA)).toBe('');
    expect(textoTiempoRestante('no-es-fecha', AHORA)).toBe('');
  });

  it('al editar, la vigencia solo se envía si cambió (cambiarla reinicia el plazo)', () => {
    expect(vigenciaParaGuardar(24, 24)).toEqual({});
    expect(vigenciaParaGuardar(168, 24)).toEqual({ vigencia_horas: 168 });
    expect(vigenciaParaGuardar(24, null)).toEqual({ vigencia_horas: 24 });
  });
});
