import { coincidePersona, filtrarPersonas } from '../buscarPersonas';

const gente = [
  { name: 'Ana Pérez', role: 'especialista', area: 'Topografía', puesto: 'Topógrafa' },
  { name: 'Luis Gómez', role: 'sub_coordinador', area: null, puesto: null },
];

describe('buscarPersonas', () => {
  it('ignora mayúsculas y acentos', () => {
    expect(filtrarPersonas(gente, 'PEREZ')).toHaveLength(1);
    expect(filtrarPersonas(gente, 'topografia')[0].name).toBe('Ana Pérez');
  });
  it('exige todas las palabras en cualquier orden', () => {
    expect(coincidePersona(gente[0], 'top ana')).toBe(true);
    expect(coincidePersona(gente[0], 'ana luis')).toBe(false);
  });
  it('busca por rol con guion bajo', () => {
    expect(filtrarPersonas(gente, 'sub coordinador')[0].name).toBe('Luis Gómez');
  });
  it('sin consulta devuelve todo', () => {
    expect(filtrarPersonas(gente, '  ')).toHaveLength(2);
  });
});
