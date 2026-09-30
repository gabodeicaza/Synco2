import {
  claveDeConcepto, generoDe, generosParaGuardar, migrarGenero, normalizarGeneros, podarGeneros, ponerGenero,
} from '../generoNiveles';

describe('generoDe', () => {
  it('sin clave es automático; con clave devuelve m o f sin distinguir mayúsculas ni espacios', () => {
    expect(generoDe({}, 'Frente')).toBe('auto');
    expect(generoDe(undefined, 'Frente')).toBe('auto');
    expect(generoDe({ Frente: 'f' }, ' frente ')).toBe('f');
    expect(generoDe({ Sistema: 'm' }, 'SISTEMA')).toBe('m');
    expect(generoDe({ Frente: 'f' }, '')).toBe('auto');
  });
});

describe('ponerGenero', () => {
  it('agrega, cambia y quita (automático) sin mutar el mapa original', () => {
    const base = { Frente: 'f' } as const;
    const con = ponerGenero(base, 'Tramo', 'm');
    expect(con).toEqual({ Frente: 'f', Tramo: 'm' });
    expect(base).toEqual({ Frente: 'f' });
    expect(ponerGenero(con, 'tramo', 'f')).toEqual({ Frente: 'f', tramo: 'f' });
    expect(ponerGenero(con, 'Tramo', 'auto')).toEqual({ Frente: 'f' });
  });

  it('ignora nombres vacíos', () => {
    expect(ponerGenero({}, '  ', 'f')).toEqual({});
  });
});

describe('migrarGenero (renombrar un nivel)', () => {
  it('el género pasa a la clave nueva', () => {
    expect(migrarGenero({ Frente: 'f', Tramo: 'm' }, 'Frente', 'Zona')).toEqual({ Tramo: 'm', Zona: 'f' });
  });

  it('si no había género, solo desaparece la clave vieja', () => {
    expect(migrarGenero({ Tramo: 'm' }, 'Frente', 'Zona')).toEqual({ Tramo: 'm' });
  });
});

describe('podarGeneros y generosParaGuardar', () => {
  it('descarta los géneros de niveles que ya no existen y conserva el nombre vigente', () => {
    expect(podarGeneros({ Frente: 'f', Viejo: 'm' }, ['frente', 'Tramo'])).toEqual({ frente: 'f' });
  });

  it('incluye el nivel de concepto, con su nombre o con la clave por defecto', () => {
    expect(generosParaGuardar({ Frente: 'f', Actividad: 'f' }, ['Frente'], 'Actividad')).toEqual({ Frente: 'f', Actividad: 'f' });
    expect(generosParaGuardar({ concepto: 'f', Otro: 'm' }, ['Frente'], '')).toEqual({ concepto: 'f' });
    expect(claveDeConcepto('  ')).toBe('concepto');
  });
});

describe('normalizarGeneros', () => {
  it('descarta valores que no son m o f y claves vacías', () => {
    expect(normalizarGeneros({ Frente: 'f', Malo: 'x', ' ': 'm', Tramo: 'm' } as any)).toEqual({ Frente: 'f', Tramo: 'm' });
    expect(normalizarGeneros(null)).toEqual({});
  });
});
