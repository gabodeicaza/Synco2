import { buildReportShareText } from '../reportText';

describe('buildReportShareText - semáforo de gravedad', () => {
  const base = { created_at: '2026-10-15T12:00:00Z', actividades: 'en espera de inicio de actividades' };

  it('verde por defecto cuando el reporte no trae gravedad', () => {
    expect(buildReportShareText(base)).toContain('*Actividades:*🟢\nen espera');
  });

  it('cada actividad sale con su propio semáforo', () => {
    const txt = buildReportShareText({
      created_at: base.created_at,
      actividades: 'a\nb\nc',
      gravedad: 'rojo',
      actividades_items: [
        { texto: 'en espera de inicio', gravedad: 'verde' },
        { texto: 'falta material', gravedad: 'amarillo' },
        { texto: 'derrumbe en frente', gravedad: 'rojo' },
        { texto: '   ', gravedad: 'rojo' },
        { texto: 'sin dato' },
      ],
    });
    expect(txt).toContain('*Actividades:*\n🟢 en espera de inicio\n🟡 falta material\n🔴 derrumbe en frente\n🟢 sin dato');
  });

  it('amarillo y rojo se reflejan junto al encabezado de actividades', () => {
    expect(buildReportShareText({ ...base, gravedad: 'amarillo' })).toContain('*Actividades:*🟡\n');
    expect(buildReportShareText({ ...base, gravedad: 'rojo' })).toContain('*Actividades:*🔴\n');
  });
});
