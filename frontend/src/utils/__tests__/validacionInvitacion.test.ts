import { validarArea, validarIdentidad } from '../validacionInvitacion';

describe('validarIdentidad', () => {
  it('sin problemas devuelve un objeto vacío', () => {
    expect(validarIdentidad({ name: 'Ana Pérez', email: 'ana@empresa.com' })).toEqual({});
  });

  it('marca nombre y correo vacíos, cada uno con su mensaje', () => {
    expect(validarIdentidad({ name: '  ', email: '' })).toEqual({
      name: 'El nombre es obligatorio.',
      email: 'El correo es obligatorio.',
    });
  });

  it('rechaza un correo mal escrito', () => {
    expect(validarIdentidad({ name: 'Ana', email: 'ana@empresa' }).email).toBe(
      'Escribe un correo válido, por ejemplo nombre@empresa.com.',
    );
    expect(validarIdentidad({ name: 'Ana', email: 'ana empresa@x.com' }).email).toBeDefined();
  });
});

describe('validarArea', () => {
  it('solo el especialista está obligado a elegir área', () => {
    expect(validarArea(true, null)).toBe('Selecciona el área.');
    expect(validarArea(true, 'a1')).toBeUndefined();
    expect(validarArea(false, null)).toBeUndefined();
  });
});
