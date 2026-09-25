import {
  claveProyectoActivo, clavePestanaProyecto, pestanaValida, proyectosDelUsuario, resolverProyectoActivo,
} from '../proyectoActivo';

const P = (id: string) => ({ id, name: id });

describe('resolverProyectoActivo (P-05)', () => {
  it('conserva el proyecto recordado si sigue existiendo', () => {
    expect(resolverProyectoActivo('p2', [P('p1'), P('p2')])).toBe('p2');
  });

  it('cae al primero si el recordado ya no existe, viene vacío o es nulo', () => {
    expect(resolverProyectoActivo('borrado', [P('p1'), P('p2')])).toBe('p1');
    expect(resolverProyectoActivo('', [P('p1')])).toBe('p1');
    expect(resolverProyectoActivo(null, [P('p3')])).toBe('p3');
  });

  it('sin proyectos no hay proyecto activo', () => {
    expect(resolverProyectoActivo('p1', [])).toBeNull();
  });
});

describe('proyectosDelUsuario', () => {
  const todos = [P('p1'), P('p2'), P('p3')];

  it('el Coordinador y el Jefe ven todos los proyectos que devuelve la API', () => {
    expect(proyectosDelUsuario(todos, { role: 'coordinador_general', project_ids: [] })).toHaveLength(3);
    expect(proyectosDelUsuario(todos, { role: 'jefe_proyecto', project_ids: ['p1'] })).toHaveLength(3);
  });

  it('el Especialista y el Subcoordinador solo ven los de su project_ids', () => {
    expect(proyectosDelUsuario(todos, { role: 'especialista', project_ids: ['p2'] }).map((p) => p.id)).toEqual(['p2']);
    expect(proyectosDelUsuario(todos, { role: 'sub_coordinador', project_ids: ['p1', 'p3'] }).map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(proyectosDelUsuario(todos, { role: 'especialista', project_ids: null })).toEqual([]);
  });

  it('sin usuario no hay proyectos', () => {
    expect(proyectosDelUsuario(todos, null)).toEqual([]);
  });
});

describe('pestanaValida (P-04)', () => {
  it('acepta las tres pestañas', () => {
    expect(pestanaValida('reportes')).toBe('reportes');
    expect(pestanaValida('operacion')).toBe('operacion');
    expect(pestanaValida('configuracion')).toBe('configuracion');
  });

  it('cualquier otro valor cae a reportes', () => {
    for (const malo of ['', 'otra', null, undefined, 3, { a: 1 }]) expect(pestanaValida(malo)).toBe('reportes');
  });
});

describe('claves de almacenamiento', () => {
  it('son distintas por proyecto y por usuario', () => {
    expect(clavePestanaProyecto('p1')).not.toBe(clavePestanaProyecto('p2'));
    expect(claveProyectoActivo('u1')).not.toBe(claveProyectoActivo('u2'));
    expect(clavePestanaProyecto('p1')).toBe('dirac_pestana_proyecto_p1');
  });
});
