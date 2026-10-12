// El texto del reporte respeta lo que el Área captura (Personal, Equipo y
// campos libres como Banderilleros) y los helpers del editor de áreas.
import { buildReportShareText } from '../reportText';
import { camposLimpios, problemaCampos } from '@/src/components/AreaCapturaEditor';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const base = { created_at: '2026-10-10T15:00:00Z', captured_by_name: 'Ana', personnel: [], equipment: [] };

describe('buildReportShareText con configuración de área', () => {
  it('sin configuración conserva Personal y Equipo', () => {
    const txt = buildReportShareText({ ...base, personnel: ['3 Peón'] });
    expect(txt).toContain('Personal:\n3 Peón');
    expect(txt).toContain('Equipo:\n-');
  });

  it('el área que no captura Personal ni Equipo no los muestra y sí sus campos extra', () => {
    const txt = buildReportShareText({
      ...base,
      captura_personal: false,
      captura_equipo: false,
      campos_extra: [{ nombre: 'Banderilleros', valor: 4 }],
    });
    expect(txt).not.toContain('Personal:');
    expect(txt).not.toContain('Equipo:');
    expect(txt).toContain('Banderilleros: 4');
  });

  it('agrega la unidad del campo cuando existe', () => {
    const txt = buildReportShareText({ ...base, campos_extra: [{ nombre: 'Agua', valor: 10, unidad: 'L' }] });
    expect(txt).toContain('Agua: 10 L');
  });
});

describe('helpers del editor de campos del área', () => {
  it('descarta campos sin nombre y recorta espacios', () => {
    const out = camposLimpios([
      { nombre: '  Banderilleros ', tipo: 'numero', unidad: ' ' },
      { nombre: '   ', tipo: 'texto' },
    ]);
    expect(out).toEqual([{ nombre: 'Banderilleros', tipo: 'numero', unidad: null }]);
  });

  it('detecta nombres repetidos sin importar mayúsculas', () => {
    expect(problemaCampos([{ nombre: 'Turno', tipo: 'texto' }, { nombre: 'turno', tipo: 'texto' }])).not.toBeNull();
    expect(problemaCampos([{ nombre: 'Turno', tipo: 'texto' }, { nombre: 'Banderilleros', tipo: 'numero' }])).toBeNull();
  });
});
