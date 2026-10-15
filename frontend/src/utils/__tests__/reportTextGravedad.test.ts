import { buildReportShareText } from '../reportText';

describe('buildReportShareText - semáforo de gravedad', () => {
  const base = { created_at: '2026-10-15T12:00:00Z', actividades: 'en espera de inicio de actividades' };

  it('verde por defecto cuando el reporte no trae gravedad', () => {
    expect(buildReportShareText(base)).toContain('*Actividades:*🟢\nen espera');
  });

  it('amarillo y rojo se reflejan junto al encabezado de actividades', () => {
    expect(buildReportShareText({ ...base, gravedad: 'amarillo' })).toContain('*Actividades:*🟡\n');
    expect(buildReportShareText({ ...base, gravedad: 'rojo' })).toContain('*Actividades:*🔴\n');
  });
});
