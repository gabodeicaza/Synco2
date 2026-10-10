import { grupoDeRol, rutaDeNotificacion } from '../rutaNotificacion';

const COORD = 'coordinador_general';
const JEFE = 'jefe_proyecto';
const SUB = 'sub_coordinador';
const ESP = 'especialista';

describe('grupoDeRol', () => {
  it('mapea cada rol a su grupo de rutas', () => {
    expect(grupoDeRol(COORD)).toBe('(coord)');
    expect(grupoDeRol(JEFE)).toBe('(coord)');
    expect(grupoDeRol(SUB)).toBe('(subcoord)');
    expect(grupoDeRol(ESP)).toBe('(spec)');
    expect(grupoDeRol('otro')).toBeNull();
    expect(grupoDeRol(undefined)).toBeNull();
  });
});

describe('rutaDeNotificacion', () => {
  it.each([COORD, JEFE, SUB, ESP])('meeting_reminder → calendario del grupo de %s', (rol) => {
    const grupo = grupoDeRol(rol);
    expect(rutaDeNotificacion({ type: 'meeting_reminder', project_id: 'p1' }, rol)).toEqual({ pathname: `/${grupo}/calendario` });
  });

  it.each([COORD, JEFE, SUB, ESP])('urgent_announcement → noticias del grupo de %s', (rol) => {
    const grupo = grupoDeRol(rol);
    expect(rutaDeNotificacion({ type: 'urgent_announcement', project_id: 'p1' }, rol)).toEqual({ pathname: `/${grupo}/noticias` });
  });

  it('agreement_due: el coordinador va a las minutas del proyecto; los demás a su pantalla de minutas', () => {
    expect(rutaDeNotificacion({ type: 'agreement_due', project_id: 'p1' }, COORD)).toEqual({
      pathname: '/(coord)/projects/[id]/minutas', params: { id: 'p1' },
    });
    expect(rutaDeNotificacion({ type: 'agreement_due', project_id: 'p1' }, ESP)).toEqual({ pathname: '/(spec)/minutas' });
    expect(rutaDeNotificacion({ type: 'agreement_due', project_id: 'p1' }, SUB)).toEqual({ pathname: '/(subcoord)/minutas' });
    // Sin proyecto, el coordinador cae a su pantalla general de minutas.
    expect(rutaDeNotificacion({ type: 'agreement_due' }, COORD)).toEqual({ pathname: '/(coord)/minutas' });
  });

  it('invitation_accepted: solo el Coordinador General y con proyecto', () => {
    expect(rutaDeNotificacion({ type: 'invitation_accepted', project_id: 'p1', invitation_id: 'i1' }, COORD)).toEqual({
      pathname: '/(coord)/projects/[id]/invitations', params: { id: 'p1' },
    });
    expect(rutaDeNotificacion({ type: 'invitation_accepted', project_id: 'p1' }, JEFE)).toBeNull();
    expect(rutaDeNotificacion({ type: 'invitation_accepted', project_id: 'p1' }, ESP)).toBeNull();
    expect(rutaDeNotificacion({ type: 'invitation_accepted' }, COORD)).toBeNull();
  });

  it('new_report: los supervisores van al proyecto; los demás no', () => {
    expect(rutaDeNotificacion({ type: 'new_report', project_id: 'p1', report_id: 'r1' }, COORD)).toEqual({
      pathname: '/(coord)/projects/[id]', params: { id: 'p1' },
    });
    expect(rutaDeNotificacion({ type: 'new_report', project_id: 'p1' }, JEFE)).not.toBeNull();
    expect(rutaDeNotificacion({ type: 'new_report', project_id: 'p1' }, ESP)).toBeNull();
    expect(rutaDeNotificacion({ type: 'new_report' }, COORD)).toBeNull();
  });

  it('tipo desconocido, ausente o data inválida → null sin lanzar', () => {
    expect(rutaDeNotificacion({ type: 'algo_nuevo' }, COORD)).toBeNull();
    expect(rutaDeNotificacion({}, COORD)).toBeNull();
    expect(rutaDeNotificacion(null, COORD)).toBeNull();
    expect(rutaDeNotificacion(undefined, COORD)).toBeNull();
    expect(rutaDeNotificacion('texto', COORD)).toBeNull();
    expect(rutaDeNotificacion(42, COORD)).toBeNull();
    expect(rutaDeNotificacion({ type: 7 }, COORD)).toBeNull();
    expect(rutaDeNotificacion({ type: '  ' }, COORD)).toBeNull();
  });

  it('rol desconocido o ausente → null (aunque el tipo sea válido)', () => {
    expect(rutaDeNotificacion({ type: 'meeting_reminder' }, undefined)).toBeNull();
    expect(rutaDeNotificacion({ type: 'meeting_reminder' }, 'visitante')).toBeNull();
  });

  it('ignora espacios y un project_id que no es texto', () => {
    expect(rutaDeNotificacion({ type: ' meeting_reminder ' }, ESP)).toEqual({ pathname: '/(spec)/calendario' });
    expect(rutaDeNotificacion({ type: 'invitation_accepted', project_id: 5 }, COORD)).toBeNull();
  });
});
