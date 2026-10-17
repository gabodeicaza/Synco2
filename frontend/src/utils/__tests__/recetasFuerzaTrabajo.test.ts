import { cantidadesDesdeReceta, parseEntrada, recetasDesdeReportes } from '../recetasFuerzaTrabajo';

const rep = (id: string, created_at: string, personnel: string[], equipment: string[], extra: any = {}) =>
  ({ id, created_at, personnel, equipment, node_path_names: ['Tramo 1', 'Estación A'], is_mine: true, ...extra });

describe('parseEntrada', () => {
  it('separa cantidad y nombre; sin número cuenta 1', () => {
    expect(parseEntrada('3 Ayudante (S2)')).toEqual({ qty: 3, nombre: 'Ayudante (S2)' });
    expect(parseEntrada('Topógrafo')).toEqual({ qty: 1, nombre: 'Topógrafo' });
    expect(parseEntrada('  ')).toBeNull();
  });
});

describe('recetasDesdeReportes', () => {
  it('une reportes con la misma combinación (sin importar orden, acentos ni mayúsculas) y cuenta las veces', () => {
    const r = recetasDesdeReportes([
      rep('1', '2026-10-01T10:00:00Z', ['4 Albañil', '2 Peón'], ['1 Grúa']),
      rep('2', '2026-10-03T10:00:00Z', ['2 peón', '4 albañil'], ['1 grua'], { node_path_names: ['Tramo 2', 'Estación B'] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].veces).toBe(2);
    expect(r[0].ultima).toBe('2026-10-03T10:00:00Z');
    expect(r[0].ubicacion).toBe('Estación B');
  });

  it('cantidades distintas son recetas distintas, la más reciente primero', () => {
    const r = recetasDesdeReportes([
      rep('1', '2026-10-01T10:00:00Z', ['4 Albañil'], []),
      rep('2', '2026-10-05T10:00:00Z', ['5 Albañil'], []),
    ]);
    expect(r.map((x) => x.personal[0].qty)).toEqual([5, 4]);
  });

  it('ignora reportes vacíos y, por defecto, los de otros autores', () => {
    const lista = [
      rep('1', '2026-10-01T10:00:00Z', [], []),
      rep('2', '2026-10-02T10:00:00Z', ['1 Peón'], [], { is_mine: false }),
      rep('3', '2026-10-03T10:00:00Z', ['2 Peón'], []),
    ];
    expect(recetasDesdeReportes(lista)).toHaveLength(1);
    expect(recetasDesdeReportes(lista, { soloMios: false })).toHaveLength(2);
  });

  it('respeta el máximo', () => {
    const lista = Array.from({ length: 30 }, (_, i) => rep(String(i), `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z`, [`${i + 1} Peón`], []));
    expect(recetasDesdeReportes(lista, { max: 5 })).toHaveLength(5);
  });
});

describe('cantidadesDesdeReceta', () => {
  it('asigna cantidades a las categorías vigentes y cuenta las que ya no existen', () => {
    const [receta] = recetasDesdeReportes([rep('1', '2026-10-01T10:00:00Z', ['4 Albañil', '2 Soldador'], ['1 Grúa'])]);
    const r = cantidadesDesdeReceta(receta, ['Peón', 'albañil'], ['Grúa']);
    expect(r.cantidades).toEqual({ 'personal:1': '4', 'equipo:0': '1' });
    expect(r.omitidas).toBe(1);
  });
});
