import {
  categoriasEquipo, categoriasPersonal, claveCampo, filtrarHojas, hojasConRuta, validarCapturaRapida,
} from '../capturaRapidaFuerzaTrabajo';

const nodo = (id: string, name: string, is_leaf: boolean, children: any[] = []) =>
  ({ id, name, is_leaf, children, project_id: 'p', parent_id: null, depth: 0, order: 0, measurement_type: 'nivel' } as any);

describe('catálogos de fuerza de trabajo', () => {
  it('personal: une proyecto y local sin repetir (sin acentos ni mayúsculas)', () => {
    expect(categoriasPersonal(['Albañiles', 'Peones'], ['albañiles', 'Soldadores', ' '])).toEqual(['Albañiles', 'Peones', 'Soldadores']);
  });

  it('equipo: toma solo el nombre del formato empaquetado y acepta objetos locales', () => {
    const proyecto = ['Retroexcavadora :: CAT :: 320 :: A1', 'Grúa :: :: :: '];
    const locales = [{ nombre: 'retroexcavadora' }, 'Compresor'];
    expect(categoriasEquipo(proyecto, locales)).toEqual(['Retroexcavadora', 'Grúa', 'Compresor']);
  });

  it('sin catálogos devuelve listas vacías', () => {
    expect(categoriasPersonal(undefined, null)).toEqual([]);
    expect(categoriasEquipo(null, undefined)).toEqual([]);
  });
});

describe('ubicaciones', () => {
  const arbol = [
    nodo('t1', 'Tramo 1', false, [nodo('h1', 'Hoja A', true), nodo('h2', 'Hoja B', true)]),
    nodo('h3', 'Suelta', true),
  ];

  it('lista solo hojas, con su ruta', () => {
    expect(hojasConRuta(arbol).map((h) => h.ruta)).toEqual(['Tramo 1 › Hoja A', 'Tramo 1 › Hoja B', 'Suelta']);
  });

  it('respeta las ubicaciones asignadas al usuario', () => {
    expect(hojasConRuta(arbol, ['h2']).map((h) => h.id)).toEqual(['h2']);
    expect(hojasConRuta(arbol, []).length).toBe(3);
  });

  it('filtra por texto sin acentos ni mayúsculas', () => {
    expect(filtrarHojas(hojasConRuta(arbol), 'hoja b').map((h) => h.id)).toEqual(['h2']);
    expect(filtrarHojas(hojasConRuta(arbol), '').length).toBe(3);
  });
});

describe('validarCapturaRapida', () => {
  const base = { nodeId: 'h1', personal: ['Albañiles', 'Peones'], equipo: ['Grúa'], cantidades: {} as Record<string, string> };

  it('arma personnel y equipment como "cantidad nombre"', () => {
    const r = validarCapturaRapida({
      ...base,
      cantidades: { [claveCampo('personal', 0)]: '4', [claveCampo('equipo', 0)]: '1' },
    });
    expect(r.errores).toEqual({});
    expect(r.personnel).toEqual(['4 Albañiles']);
    expect(r.equipment).toEqual(['1 Grúa']);
  });

  it('acepta miles con coma ("1,200") y guarda 1200', () => {
    const r = validarCapturaRapida({ ...base, cantidades: { [claveCampo('personal', 1)]: '1,200' } });
    expect(r.personnel).toEqual(['1200 Peones']);
  });

  it('sin ubicación marca el error de ubicación', () => {
    const r = validarCapturaRapida({ ...base, nodeId: null, cantidades: { [claveCampo('personal', 0)]: '2' } });
    expect(r.errores.ubicacion).toBe('Elige la ubicación donde se trabajó.');
  });

  it('sin ninguna cantidad pide al menos una', () => {
    const r = validarCapturaRapida(base);
    expect(r.errores.cantidades).toBe('Escribe la cantidad de al menos una categoría.');
  });

  it.each(['0', '-3', '2.5', 'abc'])('rechaza la cantidad "%s" junto a su categoría', (texto) => {
    const clave = claveCampo('personal', 0);
    const r = validarCapturaRapida({ ...base, cantidades: { [clave]: texto } });
    expect(r.errores[clave]).toBeTruthy();
    expect(r.personnel).toEqual([]);
    expect(r.errores.cantidades).toBeUndefined();
  });

  it('las categorías vacías se ignoran y las válidas se conservan aunque otra falle', () => {
    const r = validarCapturaRapida({
      ...base,
      cantidades: { [claveCampo('personal', 0)]: '3', [claveCampo('personal', 1)]: '0' },
    });
    expect(r.personnel).toEqual(['3 Albañiles']);
    expect(Object.keys(r.errores)).toEqual([claveCampo('personal', 1)]);
  });
});
